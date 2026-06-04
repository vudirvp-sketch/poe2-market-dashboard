"""
API routes for portfolio analytics.

Endpoints:
    GET /api/portfolio/correlation — correlation matrix for all eligible currencies

P3-3: Provides a server-side correlation matrix for the ComparativeChart component.
The frontend can fall back to client-side computation, but the backend version
is more efficient for 10+ currencies and uses the full price history from
the DataSnapshot (not just the limited client-side data).

P2-2: Upgraded to Spearman rank correlation on log-returns with:
  - Adaptive overlap threshold (max(10, 30% of shorter series))
  - p-value filtering (insignificant correlations marked)
  - Limited interpolation for small gaps (≤2 points)
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

import numpy as np
from scipy import stats as scipy_stats
from fastapi import APIRouter
from fastapi.responses import JSONResponse

from backend.api.data_snapshot import get_snapshot
from backend.config import get_settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/portfolio", tags=["portfolio"])

# Minimum number of log-returns required to compute correlation.
# We need at least 2 returns for Spearman (it needs ranks).
MIN_LOG_RETURNS = 2

# Minimum number of currencies required for a meaningful matrix
MIN_CURRENCIES = 2

# Maximum gap (in consecutive missing points) that we will interpolate.
# Gaps larger than this are left as-is (no fabrication).
MAX_INTERPOLATION_GAP = 2

# Significance threshold for p-value filtering
P_VALUE_THRESHOLD = 0.05


def _interpolate_small_gaps(
    prices: list[float],
    max_gap: int = MAX_INTERPOLATION_GAP,
) -> list[float]:
    """Linear interpolation for small gaps (≤max_gap consecutive zeros/NaNs).

    Gaps larger than max_gap are NOT interpolated — that would fabricate data.
    Only interpolates where we have valid anchor points on both sides.

    Returns a new list with gaps filled where appropriate.
    """
    if not prices:
        return prices

    arr = np.array(prices, dtype=float)
    # Find NaN/zero positions (invalid price points)
    invalid = np.where((np.isnan(arr)) | (arr <= 0))[0]

    if len(invalid) == 0:
        return prices

    # Group consecutive invalid positions into gaps
    gaps: list[list[int]] = []
    current_gap: list[int] = [invalid[0]]
    for i in range(1, len(invalid)):
        if invalid[i] == invalid[i - 1] + 1:
            current_gap.append(invalid[i])
        else:
            gaps.append(current_gap)
            current_gap = [invalid[i]]
    gaps.append(current_gap)

    # Interpolate small gaps only
    for gap in gaps:
        if len(gap) > max_gap:
            continue  # Skip large gaps — don't fabricate data
        start_idx = gap[0] - 1  # anchor before gap
        end_idx = gap[-1] + 1    # anchor after gap
        if start_idx < 0 or end_idx >= len(arr):
            continue  # No anchor on one side — skip
        if arr[start_idx] <= 0 or arr[end_idx] <= 0:
            continue  # Anchors are invalid — skip
        # Linear interpolation
        n_points = len(gap) + 1  # includes end anchor
        for j, idx in enumerate(gap):
            frac = (j + 1) / n_points
            arr[idx] = arr[start_idx] * (1 - frac) + arr[end_idx] * frac

    return arr.tolist()


@router.get("/correlation")
async def get_correlation_matrix():
    """Return the pairwise Spearman rank correlation matrix for all eligible currencies.

    P2-2: Uses Spearman rank correlation on log-returns instead of Pearson on
    absolute prices. Spearman is robust to outliers (PoE prices can swing 50%
    in a day) and returns a p-value for significance filtering.

    Adaptive overlap threshold: requires max(10, 30% of shorter series) data
    points of overlap for a valid correlation. Insufficient overlap → None
    (which is different from 0.0 — it means "no data").

    The response includes a `significant` matrix alongside the correlation
    matrix, allowing the frontend to visually distinguish insignificant
    correlations (p > 0.05).
    """
    config = get_settings()

    # P0-1: Check if snapshot data is available before processing.
    # Return 200 with data_available=false instead of 503 so the frontend
    # can show a graceful fallback UI instead of an error.
    from backend.api.data_snapshot import get_snapshot_manager
    snapshot_mgr = get_snapshot_manager()
    if snapshot_mgr.last_snapshot is None:
        return {
            "currencies": [],
            "matrix": [],
            "significant": [],
            "data_available": False,
            "message": "Snapshot is being collected. Try again in a few seconds.",
        }

    snapshot = await get_snapshot()

    if not snapshot.price_histories:
        logger.warning("Correlation: snapshot.price_histories is empty — no data available")
        return {
            "currencies": [],
            "matrix": [],
            "significant": [],
            "data_available": False,
        }

    # Collect log-returns for eligible currencies
    currency_log_returns: dict[str, list[float]] = {}
    skipped_reasons: dict[str, str] = {}

    for api_id_lower, points in snapshot.price_histories.items():
        if len(points) < MIN_LOG_RETURNS + 1:  # need at least 3 prices for 2 log-returns
            skipped_reasons[api_id_lower] = f"too few points ({len(points)} < {MIN_LOG_RETURNS + 1})"
            continue

        # Extract prices sorted by timestamp
        prices = [p.price for p in points]

        # P2-2: Apply limited interpolation for small gaps
        prices = _interpolate_small_gaps(prices)

        # Compute log-returns: ln(price[i] / price[i-1])
        log_returns = []
        for i in range(1, len(prices)):
            if prices[i] > 0 and prices[i - 1] > 0:
                log_returns.append(float(np.log(prices[i] / prices[i - 1])))

        if len(log_returns) >= MIN_LOG_RETURNS:
            # Use original-case api_id for the output
            curr = snapshot.get_currency(api_id_lower)
            orig_id = curr.get("api_id", api_id_lower) if curr else api_id_lower
            currency_log_returns[orig_id] = log_returns

    if len(currency_log_returns) < MIN_CURRENCIES:
        logger.warning(
            "Correlation: only %d eligible currencies (need %d). "
            "Skipped %d currencies: %s",
            len(currency_log_returns), MIN_CURRENCIES,
            len(skipped_reasons),
            "; ".join(f"{k}: {v}" for k, v in list(skipped_reasons.items())[:5]),
        )
        return {
            "currencies": [],
            "matrix": [],
            "significant": [],
            "data_available": False,
        }

    currencies = sorted(currency_log_returns.keys())
    n = len(currencies)

    # P2-2: Pairwise Spearman correlation with adaptive overlap
    # Instead of truncating all series to the shortest, compute pairwise
    # using only the overlapping portion.
    corr_matrix = np.full((n, n), np.nan)
    sig_matrix = np.zeros((n, n), dtype=bool)

    for i in range(n):
        corr_matrix[i, i] = 1.0
        sig_matrix[i, i] = True  # Diagonal is always significant

    for i in range(n):
        for j in range(i + 1, n):
            returns_i = np.array(currency_log_returns[currencies[i]])
            returns_j = np.array(currency_log_returns[currencies[j]])

            # P2-2: Adaptive overlap threshold
            min_len = min(len(returns_i), len(returns_j))
            min_overlap = max(10, int(0.3 * min_len))

            # Use the overlapping portion
            overlap_len = min(len(returns_i), len(returns_j))
            if overlap_len < min_overlap:
                # Insufficient overlap — mark as None (no data)
                continue

            r_i = returns_i[:overlap_len]
            r_j = returns_j[:overlap_len]

            # P2-2: Spearman rank correlation
            try:
                corr, p_value = scipy_stats.spearmanr(r_i, r_j)

                if np.isnan(corr):
                    continue

                # Clamp to [-1, 1]
                corr = np.clip(corr, -1.0, 1.0)

                corr_matrix[i, j] = corr
                corr_matrix[j, i] = corr

                # P2-2: Mark significance
                is_significant = p_value <= P_VALUE_THRESHOLD
                sig_matrix[i, j] = is_significant
                sig_matrix[j, i] = is_significant

            except Exception as e:
                logger.debug(
                    "Spearman correlation failed for %s/%s: %s",
                    currencies[i], currencies[j], e,
                )
                continue

    # Replace remaining NaN with None (for JSON null — different from 0.0)
    # NaN means "insufficient overlap", not "zero correlation"
    matrix_list = []
    sig_list = []
    for i in range(n):
        row = []
        sig_row = []
        for j in range(n):
            val = corr_matrix[i, j]
            if np.isnan(val):
                row.append(None)  # JSON null — means "no data"
                sig_row.append(False)
            else:
                row.append(round(float(val), 4))
                sig_row.append(bool(sig_matrix[i, j]))
        matrix_list.append(row)
        sig_list.append(sig_row)

    # Count how many pairs have valid (non-None) correlations
    valid_pairs = sum(
        1 for i in range(n) for j in range(i + 1, n)
        if matrix_list[i][j] is not None
    )
    significant_pairs = sum(
        1 for i in range(n) for j in range(i + 1, n)
        if sig_list[i][j]
    )

    logger.info(
        "Correlation matrix computed: %d currencies, %d/%d valid pairs, "
        "%d significant (p <= %.2f)",
        n, valid_pairs, n * (n - 1) // 2,
        significant_pairs, P_VALUE_THRESHOLD,
    )

    return {
        "currencies": currencies,
        "matrix": matrix_list,
        "significant": sig_list,
        "data_available": True,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }
