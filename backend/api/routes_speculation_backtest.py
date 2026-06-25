"""
API routes for Speculation backtest — measure profitability of z-score
BUY/SELL/HOLD signals on historical data (F5 follow-up, iter 79).

Endpoint:
    GET /api/v1/speculation/backtest — Backtest the z-score strategy on
                                       historical price_logs. Returns per-
                                       trade results + per-signal aggregates.

The heavy lifting lives in `backend/economy/speculation_backtest.py` — this
module is a thin FastAPI wrapper that fetches the snapshot, calls the pure
function, and shapes the response. Same pattern as `routes_speculation.py`.

Query params:
    eval_days_ago   — When to evaluate the signal, in days before now.
                      Default 14, clamped to [1, 365].
    holding_days    — Holding period after entry, in days. Default 7,
                      clamped to [1, 90].
    lookback_days   — Z-score baseline window, in days before entry.
                      Default 30, clamped to [1, 90].
    limit           — Maximum number of trades to return in the `trades`
                      list. Aggregates are computed over ALL trades — this
                      only caps the response payload. Default 50, clamped
                      to [1, 500].
    signal          — "ALL" (default) | "BUY" | "SELL" | "HOLD". When not
                      ALL, only trades with that signal are returned. HOLD
                      signals are never in the trades list (no position
                      taken) but are counted in `signal_breakdown.HOLD`.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Query

from backend.api.data_snapshot import get_snapshot, get_snapshot_manager
from backend.api.response_models import SpeculationBacktestResponse
from backend.config import get_settings
from backend.economy.speculation_backtest import (
    DEFAULT_EVAL_DAYS_AGO,
    DEFAULT_HOLDING_DAYS,
    DEFAULT_LIMIT,
    DEFAULT_LOOKBACK_DAYS,
    backtest_speculation_signals,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["speculation-backtest"])


@router.get("/speculation/backtest", response_model=SpeculationBacktestResponse)
async def get_speculation_backtest(
    eval_days_ago: int = Query(
        DEFAULT_EVAL_DAYS_AGO,
        ge=1,
        le=365,
        description="When to evaluate the signal, in days before now.",
    ),
    holding_days: int = Query(
        DEFAULT_HOLDING_DAYS,
        ge=1,
        le=90,
        description="Holding period after entry, in days.",
    ),
    lookback_days: int = Query(
        DEFAULT_LOOKBACK_DAYS,
        ge=1,
        le=90,
        description="Z-score baseline window, in days before entry.",
    ),
    limit: int = Query(
        DEFAULT_LIMIT,
        ge=1,
        le=500,
        description="Maximum number of trades to return. Aggregates are over ALL trades.",
    ),
    signal: str = Query(
        "ALL",
        pattern="^(ALL|BUY|SELL|HOLD)$",
        description="Filter trades by signal type. HOLD signals are never in the trades list (no position taken).",
    ),
) -> dict:
    """Backtest the z-score BUY/SELL/HOLD strategy on historical price_logs.

    For each item: find the price at `now - eval_days_ago` (entry), compute
    the z-score of that price vs the `lookback_days` window strictly before
    entry, map to BUY/SELL/HOLD, then find the price at `entry + holding_days`
    (exit) and compute the realised return.

    Returns `data_available=false` (with empty trades + zero stats) when the
    snapshot manager hasn't fetched any data yet — the frontend should show
    a "no data" state rather than treating it as an error.
    """
    config = get_settings()

    snapshot_mgr = get_snapshot_manager()
    if snapshot_mgr.last_snapshot is None:
        return {
            "league": config.league.league_name,
            "trades": [],
            "signal_breakdown": {"BUY": 0, "SELL": 0, "HOLD": 0},
            "evaluated_count": 0,
            "unevaluated_count": 0,
            "buy_stats": {
                "count": 0,
                "win_rate": 0.0,
                "mean_return_pct": 0.0,
                "median_return_pct": 0.0,
                "best_return_pct": 0.0,
                "worst_return_pct": 0.0,
            },
            "sell_stats": {
                "count": 0,
                "win_rate": 0.0,
                "mean_return_pct": 0.0,
                "median_return_pct": 0.0,
                "best_return_pct": 0.0,
                "worst_return_pct": 0.0,
            },
            "overall_stats": {
                "count": 0,
                "win_rate": 0.0,
                "mean_return_pct": 0.0,
                "median_return_pct": 0.0,
                "best_return_pct": 0.0,
                "worst_return_pct": 0.0,
            },
            "data_available": False,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "eval_days_ago": eval_days_ago,
            "holding_days": holding_days,
            "lookback_days": lookback_days,
        }

    try:
        snapshot = await get_snapshot()
        return backtest_speculation_signals(
            snapshot,
            config,
            eval_days_ago=eval_days_ago,
            holding_days=holding_days,
            lookback_days=lookback_days,
            limit=limit,
            signal_filter=signal,
        )
    except Exception as e:
        logger.error("Speculation backtest failed: %s", e)
        return {
            "league": config.league.league_name,
            "trades": [],
            "signal_breakdown": {"BUY": 0, "SELL": 0, "HOLD": 0},
            "evaluated_count": 0,
            "unevaluated_count": 0,
            "buy_stats": {
                "count": 0,
                "win_rate": 0.0,
                "mean_return_pct": 0.0,
                "median_return_pct": 0.0,
                "best_return_pct": 0.0,
                "worst_return_pct": 0.0,
            },
            "sell_stats": {
                "count": 0,
                "win_rate": 0.0,
                "mean_return_pct": 0.0,
                "median_return_pct": 0.0,
                "best_return_pct": 0.0,
                "worst_return_pct": 0.0,
            },
            "overall_stats": {
                "count": 0,
                "win_rate": 0.0,
                "mean_return_pct": 0.0,
                "median_return_pct": 0.0,
                "best_return_pct": 0.0,
                "worst_return_pct": 0.0,
            },
            "data_available": False,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "eval_days_ago": eval_days_ago,
            "holding_days": holding_days,
            "lookback_days": lookback_days,
        }
