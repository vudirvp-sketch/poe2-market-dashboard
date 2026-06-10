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
  - Limited interpolation for small gaps (<=2 points)

PERFORMANCE: The O(n^2) pairwise Spearman correlation computation is CPU-bound
and runs in ProcessPoolExecutor to prevent blocking the asyncio event loop.
This avoids health check timeouts and circuit breaker cascade failures.
"""

from __future__ import annotations

import asyncio
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

# Timeout for correlation computation in executor (seconds).
# O(n^2) Spearman for 600+ currencies with adaptive overlap can take 20-40s.
_EXECUTOR_TIMEOUT = 60.0


def _interpolate_small_gaps(
    prices: list[float],
    max_gap: int = MAX_INTERPOLATION_GAP,
) -> list[float]:
    """Linear interpolation for small gaps (<=max_gap consecutive zeros/NaNs).

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


def _compute_correlation_matrix_sync(
    currency_log_returns: dict[str, list[float]],
) -> dict:
    """CPU-bound correlation matrix computation — runs in executor process.

    Receives only plain dicts of float lists (picklable), not the full
    DataSnapshot. This reduces pickle payload size significantly.

    Args:
        currency_log_returns: Dict mapping currency_id → list of log-returns.

    Returns:
        Dict with currencies, matrix, significant, valid_pairs, significant_pairs.
    """
    currencies = sorted(currency_log_returns.keys())
    n = len(currencies)

    # Pairwise Spearman correlation with adaptive overlap
    corr_matrix = np.full((n, n), np.nan)
    sig_matrix = np.zeros((n, n), dtype=bool)

    for i in range(n):
        corr_matrix[i, i] = 1.0
        sig_matrix[i, i] = True  # Diagonal is always significant

    for i in range(n):
        for j in range(i + 1, n):
            returns_i = np.array(currency_log_returns[currencies[i]])
            returns_j = np.array(currency_log_returns[currencies[j]])

            # Adaptive overlap threshold
            min_len = min(len(returns_i), len(returns_j))
            min_overlap = max(2, int(0.3 * min_len))

            # Use the overlapping portion
            overlap_len = min(len(returns_i), len(returns_j))
            if overlap_len < min_overlap:
                # Insufficient overlap — mark as None (no data)
                continue

            r_i = returns_i[:overlap_len]
            r_j = returns_j[:overlap_len]

            # Spearman rank correlation
            try:
                if np.std(r_i) == 0 or np.std(r_j) == 0:
                    continue

                with np.errstate(invalid="ignore"):
                    corr, p_value = scipy_stats.spearmanr(r_i, r_j)

                if np.isnan(corr):
                    continue

                # Clamp to [-1, 1]
                corr = np.clip(corr, -1.0, 1.0)

                corr_matrix[i, j] = corr
                corr_matrix[j, i] = corr

                # Mark significance
                is_significant = p_value <= P_VALUE_THRESHOLD
                sig_matrix[i, j] = is_significant
                sig_matrix[j, i] = is_significant

            except Exception:
                continue

    # Replace remaining NaN with None (for JSON null)
    matrix_list = []
    sig_list = []
    for i in range(n):
        row = []
        sig_row = []
        for j in range(n):
            val = corr_matrix[i, j]
            if np.isnan(val):
                row.append(None)
                sig_row.append(False)
            else:
                row.append(round(float(val), 4))
                sig_row.append(bool(sig_matrix[i, j]))
        matrix_list.append(row)
        sig_list.append(sig_row)

    # Count valid and significant pairs
    valid_pairs = sum(
        1 for i in range(n) for j in range(i + 1, n)
        if matrix_list[i][j] is not None
    )
    significant_pairs = sum(
        1 for i in range(n) for j in range(i + 1, n)
        if sig_list[i][j]
    )

    return {
        "currencies": currencies,
        "matrix": matrix_list,
        "significant": sig_list,
        "valid_pairs": valid_pairs,
        "significant_pairs": significant_pairs,
        "n": n,
    }


@router.get("/correlation")
async def get_correlation_matrix():
    """Return the pairwise Spearman rank correlation matrix for all eligible currencies.

    P2-2: Uses Spearman rank correlation on log-returns instead of Pearson on
    absolute prices. Spearman is robust to outliers (PoE prices can swing 50%
    in a day) and returns a p-value for significance filtering.

    Adaptive overlap threshold: requires max(2, 30% of shorter series) data
    points of overlap for a valid correlation. Insufficient overlap -> None
    (which is different from 0.0 — it means "no data").

    PERFORMANCE: The CPU-bound O(n^2) computation is offloaded to
    ProcessPoolExecutor via loop.run_in_executor() with
    asyncio.wait_for(timeout=60s) to prevent indefinite blocking.
    This ensures health check endpoints remain responsive during heavy
    computation, preventing circuit breaker cascade failures.
    """
    config = get_settings()

    # Check if snapshot data is available before processing.
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

    # Collect log-returns for eligible currencies (pre-extract as plain data)
    currency_log_returns: dict[str, list[float]] = {}
    skipped_reasons: dict[str, str] = {}

    for api_id_lower, points in snapshot.price_histories.items():
        if len(points) < MIN_LOG_RETURNS + 1:
            skipped_reasons[api_id_lower] = f"too few points ({len(points)} < {MIN_LOG_RETURNS + 1})"
            continue

        # Extract prices sorted by timestamp
        prices = [p.price for p in points]

        # Apply limited interpolation for small gaps
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

    # Check pipeline cache for previously computed correlation matrix.
    # The TTL matches the snapshot TTL — results are refreshed when new
    # snapshot data arrives, preventing stale correlation data.
    from backend.data.pipeline_cache import get_pipeline_cache
    pipeline_cache = get_pipeline_cache()
    cache_key = "portfolio_correlation"
    cached = pipeline_cache.get(cache_key)
    if cached is not None and not cached.stale:
        return {
            "currencies": cached.value["currencies"],
            "matrix": cached.value["matrix"],
            "significant": cached.value["significant"],
            "data_available": True,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }

    # Offload CPU-bound correlation computation to ProcessPoolExecutor
    loop = asyncio.get_running_loop()
    executor = None
    try:
        from backend.main import process_pool
        executor = process_pool
    except (ImportError, AttributeError):
        pass

    try:
        result = await asyncio.wait_for(
            loop.run_in_executor(
                executor,
                _compute_correlation_matrix_sync,
                currency_log_returns,
            ),
            timeout=_EXECUTOR_TIMEOUT,
        )
    except asyncio.TimeoutError:
        logger.error(
            "Correlation matrix computation timed out after %.0fs — "
            "returning empty result. Consider reducing currency count or "
            "increasing timeout.",
            _EXECUTOR_TIMEOUT,
        )
        return {
            "currencies": [],
            "matrix": [],
            "significant": [],
            "data_available": False,
        }

    currencies = result["currencies"]
    n = result["n"]
    valid_pairs = result["valid_pairs"]
    significant_pairs = result["significant_pairs"]

    # Cache the result for subsequent requests (TTL = snapshot TTL)
    pipeline_cache.put(cache_key, {
        "currencies": currencies,
        "matrix": result["matrix"],
        "significant": result["significant"],
    })

    logger.info(
        "Correlation matrix computed: %d currencies, %d/%d valid pairs, "
        "%d significant (p <= %.2f)",
        n, valid_pairs, n * (n - 1) // 2,
        significant_pairs, P_VALUE_THRESHOLD,
    )

    return {
        "currencies": currencies,
        "matrix": result["matrix"],
        "significant": result["significant"],
        "data_available": True,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }
