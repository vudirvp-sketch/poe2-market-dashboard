"""
API routes for portfolio allocation.

Endpoints:
    GET /api/portfolio          — current portfolio allocation
    POST /api/portfolio/rebalance — trigger portfolio recalculation
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

import numpy as np
from fastapi import APIRouter, HTTPException, Query

from backend.config import get_settings, AppConfig
from backend.api.data_snapshot import get_snapshot
from backend.api.shared import get_phase_detector as _get_phase_detector
from backend.economy.momentum import PriceMomentumTracker
from backend.arbitrage.portfolio import PortfolioOptimizer, compute_efficient_frontier_chart_data
from backend.models.currency import (
    PortfolioAllocation,
    LeaguePhase,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/portfolio", tags=["portfolio"])

# ---------------------------------------------------------------------------
# Cached allocation state (not a provider singleton)
# ---------------------------------------------------------------------------

_last_allocation: PortfolioAllocation | None = None
_previous_corr: np.ndarray | None = None
# _current_corr stores the serialized correlation matrix from the latest
# _build_portfolio call. Unlike _previous_corr (used for shock detection),
# this is always available after a successful build — even on the first request.
_current_corr: dict | None = None


# ---------------------------------------------------------------------------
# Fix 2.1: Determine annualization factor based on data frequency
# ---------------------------------------------------------------------------

def _determine_periods_per_year(
    price_logs: dict[str, list[tuple[datetime, float]]]
) -> int:
    """Determine data frequency from actual time intervals between observations."""
    if not price_logs:
        return 365
    deltas: list[float] = []
    for points in price_logs.values():
        if len(points) < 2:
            continue
        for i in range(1, min(len(points), 50)):
            dt = (points[i][0] - points[i-1][0]).total_seconds()
            if dt > 0:
                deltas.append(dt)
    if not deltas:
        return 365
    import statistics
    median_delta = statistics.median(deltas)
    if median_delta < 4 * 3600:
        return 365 * 24
    else:
        return 365


# ---------------------------------------------------------------------------
# Fix 4.14: Extract correlation_matrix serialization into a helper
# ---------------------------------------------------------------------------

def _build_correlation_matrix_response(
    currency_names: list[str],
    current_corr: dict | None,
    previous_corr: np.ndarray | None,
) -> dict | None:
    """Build the correlation_matrix response dict.

    Uses current_corr (pre-serialized from _build_portfolio) if available,
    falls back to recomputing from previous_corr (raw numpy array).
    Returns None if neither is available.

    This eliminates the duplicate serialization code that was previously
    repeated in both get_portfolio() and rebalance_portfolio().
    """
    # Try current_corr first (available on first request too)
    if current_corr is not None and current_corr.get("currencies") == currency_names:
        return current_corr

    # Fallback: recompute from previous_corr (legacy path)
    if previous_corr is not None and previous_corr.shape[0] == len(currency_names):
        try:
            corr_rows = []
            for i in range(len(currency_names)):
                row = []
                for j in range(len(currency_names)):
                    row.append(round(float(previous_corr[i, j]), 4))
                corr_rows.append(row)
            return {
                "currencies": currency_names,
                "matrix": corr_rows,
                "is_stale": True,
            }
        except Exception as e:
            logger.debug("Failed to serialize correlation matrix: %s", e)

    return None


# ---------------------------------------------------------------------------
# Helper: build portfolio allocation from live data
# ---------------------------------------------------------------------------

async def _build_portfolio(config: AppConfig, method_override: str | None = None) -> PortfolioAllocation:
    """Fetch live data and compute portfolio allocation.

    This orchestrates:
    1. Get exchange rates from provider (via cache)
    2. Get historical data for each currency to compute log-returns
    3. Build the log-returns matrix
    4. Run PortfolioOptimizer

    FIX: Wrapped in comprehensive error handling to prevent 500 errors.
    Common failure modes:
    - sklearn LedoitWolf with too few data points
    - numpy.linalg errors from singular/near-singular covariance matrices
    - Missing data in snapshot
    """
    global _previous_corr

    try:
        detector = _get_phase_detector()
        optimizer = PortfolioOptimizer(config)

        # 1. Get unified data snapshot (single coordinated API pass)
        snapshot = await get_snapshot()

        # 2. Exchange rates
        rates = snapshot.exchange_rates
        if not rates:
            return PortfolioAllocation(
                weights={},
                expected_risk=0.0,
                method=method_override or config.portfolio.method,
                correlation_warning=False,
            )

        # 3. Currency metadata & price histories (from snapshot's single ByCategory pass)
        currencies = snapshot.currency_metadata
        currency_price_history: dict[str, list[float]] = {}
        currency_price_logs: dict[str, list[tuple[datetime, float]]] = {}
        for curr in currencies:
            history = snapshot.price_histories.get(curr.api_id.lower(), [])
            if history:
                currency_price_history[curr.api_id] = [
                    p.price for p in history
                ]
                currency_price_logs[curr.api_id] = [
                    (p.timestamp, p.price) for p in history
                ]

        # 4. Filter to currencies with enough data for portfolio construction
        min_history_length = 5  # need at least 5 price points for log-returns
        eligible_currencies = {
            api_id: prices
            for api_id, prices in currency_price_history.items()
            if len(prices) >= min_history_length
        }

        if len(eligible_currencies) < 2:
            return PortfolioAllocation(
                weights={},
                expected_risk=0.0,
                method=method_override or config.portfolio.method,
                correlation_warning=False,
            )

        # 5. Build aligned log-returns matrix
        # Find the shortest common history length
        min_len = min(len(p) for p in eligible_currencies.values())

        currency_names = sorted(eligible_currencies.keys())
        n_currencies = len(currency_names)
        log_returns_list = []

        for name in currency_names:
            prices = eligible_currencies[name][-min_len:]
            prices_arr = np.array(prices, dtype=float)
            # Avoid log(0) or negative prices
            prices_safe = np.maximum(prices_arr, 1e-10)
            log_prices = np.log(prices_safe)
            log_ret = np.diff(log_prices)
            log_returns_list.append(log_ret)

        # T×N matrix (T periods, N assets)
        log_returns_matrix = np.column_stack(log_returns_list)

        # 6. Run portfolio optimization
        # Fix 2.1: Determine periods_per_year based on data frequency
        periods_per_year = _determine_periods_per_year(currency_price_logs)
        allocation = optimizer.optimize(
            currency_names=currency_names,
            log_returns=log_returns_matrix,
            previous_corr=_previous_corr,
            periods_per_year=periods_per_year,
            method_override=method_override,
        )

        # Store current correlation matrix for next comparison
        # AND build the serialized version for the API response (so it's
        # available on the very first request, not just after the second).
        try:
            corr_matrix = np.corrcoef(log_returns_matrix, rowvar=False)
            if corr_matrix.ndim == 0:
                corr_matrix = np.array([[1.0]])
            _previous_corr = corr_matrix

            # Build serialized correlation matrix for the response
            if corr_matrix.shape[0] == len(currency_names):
                corr_rows = []
                for i in range(len(currency_names)):
                    row = []
                    for j in range(len(currency_names)):
                        row.append(round(float(corr_matrix[i, j]), 4))
                    corr_rows.append(row)
                global _current_corr
                _current_corr = {
                    "currencies": currency_names,
                    "matrix": corr_rows,
                }
        except Exception as e:
            logger.debug("Failed to compute/serialize correlation matrix: %s", e)
            _previous_corr = None

        return allocation
    except Exception as e:
        logger.error("_build_portfolio failed: %s", e, exc_info=True)
        # Return an empty allocation instead of raising 500
        return PortfolioAllocation(
            weights={},
            expected_risk=0.0,
            method=method_override or config.portfolio.method,
            correlation_warning=False,
        )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("")
async def get_portfolio():
    """Return current portfolio allocation.

    Includes weights per currency, annualized risk, method used,
    and correlation shock warning status.
    """
    global _last_allocation

    config = get_settings()

    # Check if we should rebalance
    should_rebalance = True
    if _last_allocation is not None and _last_allocation.last_rebalance is not None:
        hours_since = (
            datetime.now(timezone.utc) - _last_allocation.last_rebalance
        ).total_seconds() / 3600
        if hours_since < config.portfolio.rebalance_interval_hours:
            should_rebalance = False

    if should_rebalance:
        try:
            _last_allocation = await _build_portfolio(config)
        except HTTPException:
            if _last_allocation is not None:
                logger.warning("Portfolio rebuild failed; returning cached allocation.")
            else:
                return {
                    "method": config.portfolio.method,
                    "weights": {},
                    "expected_risk": 0,
                    "correlation_warning": False,
                    "data_available": False,
                    "last_rebalance": None,
                    "correlation_matrix": None,
                }
        except Exception as e:
            # FIX: Catch ALL exceptions from _build_portfolio to prevent 500.
            # Common causes: sklearn LedoitWolf fails with few data points,
            # numpy.linalg errors from singular matrices, etc.
            logger.error("Portfolio rebuild failed with unexpected error: %s", e)
            if _last_allocation is not None:
                logger.warning("Returning cached allocation after unexpected error.")
            else:
                return {
                    "method": config.portfolio.method,
                    "weights": {},
                    "expected_risk": 0,
                    "correlation_warning": False,
                    "data_available": False,
                    "last_rebalance": None,
                    "correlation_matrix": None,
                    "error": str(e),
                }

    if _last_allocation is None:
        return {
            "method": config.portfolio.method,
            "weights": {},
            "expected_risk": 0,
            "correlation_warning": False,
            "data_available": False,
            "last_rebalance": None,
            "correlation_matrix": None,
        }

    # Fix 4.14: Use extracted helper for correlation matrix serialization
    correlation_matrix = _build_correlation_matrix_response(
        currency_names=sorted(_last_allocation.weights.keys()),
        current_corr=_current_corr,
        previous_corr=_previous_corr,
    )

    return {
        "method": _last_allocation.method,
        "weights": {
            k: round(v, 6) for k, v in _last_allocation.weights.items()
        },
        "expected_risk": round(_last_allocation.expected_risk, 6),
        "correlation_warning": _last_allocation.correlation_warning,
        "data_available": True,
        "last_rebalance": _last_allocation.last_rebalance.isoformat()
        if _last_allocation.last_rebalance
        else None,
        "correlation_matrix": correlation_matrix,
    }


@router.post("/rebalance")
async def rebalance_portfolio(method: str | None = Query(default=None)):
    """Force portfolio recalculation regardless of rebalance interval.

    Args:
        method: Optional method override ("risk_parity" or "min_variance").
            If not provided, uses the config default.
    """
    global _last_allocation

    config = get_settings()
    try:
        _last_allocation = await _build_portfolio(config, method_override=method)
    except Exception as e:
        logger.error("Portfolio rebalance failed: %s", e)
        _last_allocation = None

    if _last_allocation is None:
        return {
            "method": method or config.portfolio.method,
            "weights": {},
            "expected_risk": 0,
            "correlation_warning": False,
            "data_available": False,
            "last_rebalance": None,
            "correlation_matrix": None,
        }

    # Fix 4.14: Use extracted helper for correlation matrix serialization
    correlation_matrix = _build_correlation_matrix_response(
        currency_names=sorted(_last_allocation.weights.keys()),
        current_corr=_current_corr,
        previous_corr=_previous_corr,
    )

    return {
        "method": _last_allocation.method,
        "weights": {
            k: round(v, 6) for k, v in _last_allocation.weights.items()
        },
        "expected_risk": round(_last_allocation.expected_risk, 6),
        "correlation_warning": _last_allocation.correlation_warning,
        "data_available": True,
        "last_rebalance": _last_allocation.last_rebalance.isoformat()
        if _last_allocation.last_rebalance
        else None,
        "correlation_matrix": correlation_matrix,
    }


@router.get("/frontier")
async def get_efficient_frontier(n_points: int = Query(default=50, ge=10, le=200)):
    """Return efficient frontier data for min-variance method.

    Phase 2 (Spec Section 5.3): Computes the efficient frontier by solving
    min-variance optimization across a range of target returns, then returns
    risk vs. return data for Plotly visualization.

    Annualized values (Spec §5.5):
        Risk axis: daily_vol * sqrt(365)
        Return axis: daily_return * 365

    Args:
        n_points: Number of points on the frontier (default 50, max 200).
    """
    config = get_settings()

    # Get unified data snapshot (single coordinated API pass)
    snapshot = await get_snapshot()

    # Exchange rates
    rates = snapshot.exchange_rates
    if not rates:
        return {"data_available": False, "frontier": [], "currencies": []}

    # Currency metadata & price histories (from snapshot's single ByCategory pass)
    currencies = snapshot.currency_metadata
    currency_price_history: dict[str, list[float]] = {}
    currency_price_logs: dict[str, list[tuple[datetime, float]]] = {}
    for curr in currencies:
        history = snapshot.price_histories.get(curr.api_id.lower(), [])
        if history:
            currency_price_history[curr.api_id] = [
                p.price for p in history
            ]
            currency_price_logs[curr.api_id] = [
                (p.timestamp, p.price) for p in history
            ]

    # Filter to eligible currencies
    min_history_length = 5
    eligible_currencies = {
        api_id: prices
        for api_id, prices in currency_price_history.items()
        if len(prices) >= min_history_length
    }

    if len(eligible_currencies) < 2:
        return {"data_available": False, "frontier": [], "currencies": []}

    # Build aligned log-returns matrix
    min_len = min(len(p) for p in eligible_currencies.values())
    currency_names = sorted(eligible_currencies.keys())

    log_returns_list = []
    for name in currency_names:
        prices = eligible_currencies[name][-min_len:]
        prices_arr = np.array(prices, dtype=float)
        prices_safe = np.maximum(prices_arr, 1e-10)
        log_prices = np.log(prices_safe)
        log_ret = np.diff(log_prices)
        log_returns_list.append(log_ret)

    log_returns_matrix = np.column_stack(log_returns_list)

    # Get current portfolio weights if available
    current_weights = None
    if _last_allocation is not None:
        weight_list = [_last_allocation.weights.get(name, 0.0) for name in currency_names]
        current_weights = np.array(weight_list)

    # Compute frontier
    # Fix 2.1: Use _determine_periods_per_year for consistent annualization
    periods_per_year = _determine_periods_per_year(currency_price_logs)
    frontier_data = compute_efficient_frontier_chart_data(
        log_returns=log_returns_matrix,
        current_weights=current_weights,
        currency_names=currency_names,
        n_points=n_points,
        periods_per_year=periods_per_year,
    )

    return frontier_data


# ---------------------------------------------------------------------------
# P3-3: Standalone correlation matrix endpoint
# ---------------------------------------------------------------------------

@router.get("/correlation")
async def get_correlation_matrix():
    """Return the correlation matrix for all eligible currencies.

    This endpoint computes the Pearson correlation matrix from log-returns
    of all currencies with sufficient price history. It's used by the
    ComparativeChart component to render a correlation heatmap.

    Returns:
        currencies: list of currency API IDs
        matrix: N×N correlation matrix (2D array of floats)
        data_available: whether sufficient data was available
    """
    config = get_settings()

    # Return cached correlation if available and fresh
    if _current_corr is not None and _current_corr.get("currencies"):
        # Check if the cached data is fresh enough (< 5 minutes old)
        if _last_allocation is not None and _last_allocation.last_rebalance is not None:
            hours_since = (
                datetime.now(timezone.utc) - _last_allocation.last_rebalance
            ).total_seconds() / 3600
            if hours_since < config.portfolio.rebalance_interval_hours:
                return {
                    "currencies": _current_corr["currencies"],
                    "matrix": _current_corr["matrix"],
                    "data_available": True,
                }

    # Otherwise, rebuild portfolio to get fresh correlation data
    try:
        await _build_portfolio(config)
    except HTTPException:
        pass

    if _current_corr is not None and _current_corr.get("currencies"):
        return {
            "currencies": _current_corr["currencies"],
            "matrix": _current_corr["matrix"],
            "data_available": True,
        }

    return {
        "currencies": [],
        "matrix": [],
        "data_available": False,
    }
