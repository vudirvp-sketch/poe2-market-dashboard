"""
API routes for portfolio analytics.

Endpoints:
    GET /api/portfolio/correlation — correlation matrix for all eligible currencies

P3-3: Provides a server-side correlation matrix for the ComparativeChart component.
The frontend can fall back to client-side computation, but the backend version
is more efficient for 10+ currencies and uses the full price history from
the DataSnapshot (not just the limited client-side data).
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

import numpy as np
from fastapi import APIRouter

from backend.api.data_snapshot import get_snapshot
from backend.config import get_settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/portfolio", tags=["portfolio"])

# Minimum number of price points required to compute correlation
MIN_PRICE_POINTS = 5

# Minimum number of currencies required for a meaningful matrix
MIN_CURRENCIES = 2


@router.get("/correlation")
async def get_correlation_matrix():
    """Return the pairwise Pearson correlation matrix for all eligible currencies.

    Uses price histories from the DataSnapshot. Only currencies with at least
    MIN_PRICE_POINTS data points are included (to avoid degenerate correlations
    from very short histories).

    The response shape matches what the frontend ComparativeChart expects:
        {
            "currencies": ["exalted", "divine", "chaos", ...],
            "matrix": [[1.0, 0.85, -0.12], [0.85, 1.0, 0.03], [-0.12, 0.03, 1.0]],
            "dataAvailable": true
        }

    Returns:
        Correlation matrix with currency names and NxN matrix of correlation values.
    """
    config = get_settings()
    snapshot = await get_snapshot()

    if not snapshot.price_histories:
        return {
            "currencies": [],
            "matrix": [],
            "data_available": False,
        }

    # Collect price histories for eligible currencies
    # Use % change from first point (same as ComparativeChart does client-side)
    currency_returns: dict[str, list[float]] = {}

    for api_id_lower, points in snapshot.price_histories.items():
        if len(points) < MIN_PRICE_POINTS:
            continue

        # Extract prices sorted by timestamp (they should already be sorted)
        prices = [p.price for p in points]
        if len(prices) < MIN_PRICE_POINTS:
            continue

        # Compute log-returns for more stable correlation
        # log_return[i] = ln(price[i] / price[i-1])
        log_returns = []
        for i in range(1, len(prices)):
            if prices[i] > 0 and prices[i - 1] > 0:
                log_returns.append(float(np.log(prices[i] / prices[i - 1])))

        if len(log_returns) >= MIN_PRICE_POINTS - 1:
            # Also store by original-case api_id if available
            curr = snapshot.get_currency(api_id_lower)
            orig_id = curr.get("api_id", api_id_lower) if curr else api_id_lower
            # Use original-case key for the output
            currency_returns[orig_id] = log_returns

    if len(currency_returns) < MIN_CURRENCIES:
        return {
            "currencies": [],
            "matrix": [],
            "data_available": False,
        }

    # Align all return series to the same length (truncate to shortest)
    currencies = sorted(currency_returns.keys())
    min_len = min(len(currency_returns[c]) for c in currencies)

    if min_len < MIN_PRICE_POINTS - 1:
        return {
            "currencies": [],
            "matrix": [],
            "data_available": False,
        }

    # Build T×N matrix of log-returns
    returns_matrix = np.array([
        currency_returns[c][:min_len] for c in currencies
    ]).T  # shape: (T, N)

    # Compute Pearson correlation matrix
    try:
        # np.corrcoef expects variables in rows
        corr_matrix = np.corrcoef(returns_matrix, rowvar=False)

        # Handle NaN values (can occur for constant-price currencies)
        corr_matrix = np.nan_to_num(corr_matrix, nan=0.0)

        # Ensure diagonal is exactly 1.0
        np.fill_diagonal(corr_matrix, 1.0)

        # Clamp to [-1, 1]
        corr_matrix = np.clip(corr_matrix, -1.0, 1.0)
    except Exception as e:
        logger.error("Correlation matrix computation failed: %s", e)
        return {
            "currencies": [],
            "matrix": [],
            "data_available": False,
        }

    # Convert to list for JSON serialization
    matrix_list = [
        [round(float(corr_matrix[i][j]), 4) for j in range(len(currencies))]
        for i in range(len(currencies))
    ]

    logger.info(
        "Correlation matrix computed: %d currencies, %d data points each",
        len(currencies), min_len,
    )

    return {
        "currencies": currencies,
        "matrix": matrix_list,
        "data_available": True,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }
