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
from backend.economy.gold_costs import compute_gold_fee_fraction, compute_gold_fee
from backend.economy.gold_cost_table import get_gold_cost_per_unit, get_api_id_to_gold_cost
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
# Helper: build portfolio allocation from live data
# ---------------------------------------------------------------------------

async def _build_portfolio(config: AppConfig, method_override: str | None = None) -> PortfolioAllocation:
    """Fetch live data and compute portfolio allocation.

    This orchestrates:
    1. Get exchange rates from provider (via cache)
    2. Get historical data for each currency to compute log-returns
    3. Build the log-returns matrix
    4. Run PortfolioOptimizer
    """
    global _previous_corr

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
    for curr in currencies:
        history = snapshot.price_histories.get(curr.api_id.lower(), [])
        if history:
            currency_price_history[curr.api_id] = [
                p.price for p in history
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
    allocation = optimizer.optimize(
        currency_names=currency_names,
        log_returns=log_returns_matrix,
        previous_corr=_previous_corr,
        periods_per_year=365,  # daily returns
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

    # Build correlation matrix: prefer _current_corr (always available after
    # a successful build), fall back to recomputing from _previous_corr.
    # This ensures the matrix is returned even on the first request.
    correlation_matrix = None
    currency_names = sorted(_last_allocation.weights.keys())

    # Try _current_corr first (available on first request too)
    if _current_corr is not None and _current_corr.get("currencies") == currency_names:
        correlation_matrix = _current_corr
    elif _previous_corr is not None and _previous_corr.shape[0] == len(currency_names):
        # Fallback: recompute from _previous_corr (legacy path)
        try:
            corr_rows = []
            for i in range(len(currency_names)):
                row = []
                for j in range(len(currency_names)):
                    row.append(round(float(_previous_corr[i, j]), 4))
                corr_rows.append(row)
            correlation_matrix = {
                "currencies": currency_names,
                "matrix": corr_rows,
            }
        except Exception as e:
            logger.debug("Failed to serialize correlation matrix: %s", e)

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
    _last_allocation = await _build_portfolio(config, method_override=method)

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

    # Build correlation matrix: prefer _current_corr (set by _build_portfolio),
    # fall back to recomputing from _previous_corr.
    correlation_matrix = None
    currency_names = sorted(_last_allocation.weights.keys())

    if _current_corr is not None and _current_corr.get("currencies") == currency_names:
        correlation_matrix = _current_corr
    elif _previous_corr is not None and _previous_corr.shape[0] == len(currency_names):
        try:
            corr_rows = []
            for i in range(len(currency_names)):
                row = []
                for j in range(len(currency_names)):
                    row.append(round(float(_previous_corr[i, j]), 4))
                corr_rows.append(row)
            correlation_matrix = {
                "currencies": currency_names,
                "matrix": corr_rows,
            }
        except Exception as e:
            logger.debug("Failed to serialize correlation matrix: %s", e)

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
    for curr in currencies:
        history = snapshot.price_histories.get(curr.api_id.lower(), [])
        if history:
            currency_price_history[curr.api_id] = [
                p.price for p in history
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
    frontier_data = compute_efficient_frontier_chart_data(
        log_returns=log_returns_matrix,
        current_weights=current_weights,
        currency_names=currency_names,
        n_points=n_points,
        periods_per_year=365,
    )

    return frontier_data
