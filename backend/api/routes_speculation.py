"""
API routes for Speculation — per-item z-score + BUY/SELL/HOLD signals (F5).

Endpoint:
    GET /api/v1/speculation — Per-item z-score vs N-day rolling price range,
                              with BUY/SELL/HOLD signals.

The heavy lifting lives in `backend/economy/speculation.py` — this module
is a thin FastAPI wrapper that fetches the snapshot, calls the pure function,
and shapes the response. Same pattern as `routes_content_pulse.py`.

Query params:
    days   — Lookback window in days (default 30, clamped to [1, 90]).
    limit  — Maximum number of signals to return (default 50, clamped to
             [1, 500]).
    signal — "ALL" (default) | "BUY" | "SELL" | "HOLD". When not ALL,
             only items with that signal are returned.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Query

from backend.api.data_snapshot import get_snapshot, get_snapshot_manager
from backend.api.response_models import SpeculationResponse
from backend.config import get_settings
from backend.economy.speculation import (
    DEFAULT_DAYS,
    DEFAULT_LIMIT,
    compute_speculation_signals,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["speculation"])


@router.get("/speculation", response_model=SpeculationResponse)
async def get_speculation(
    days: int = Query(
        DEFAULT_DAYS,
        ge=1,
        le=90,
        description="Lookback window in days for the z-score / percentile baseline.",
    ),
    limit: int = Query(
        DEFAULT_LIMIT,
        ge=1,
        le=500,
        description="Maximum number of signals to return.",
    ),
    signal: str = Query(
        "ALL",
        pattern="^(ALL|BUY|SELL|HOLD)$",
        description="Filter signals by type. ALL returns BUY + SELL + HOLD.",
    ),
) -> dict:
    """Per-item z-score + BUY/SELL/HOLD signals.

    Returns data_available=false (with an empty signals list) when the
    snapshot manager hasn't fetched any data yet — the frontend should show
    a "no data" state rather than treating it as an error.
    """
    config = get_settings()

    snapshot_mgr = get_snapshot_manager()
    if snapshot_mgr.last_snapshot is None:
        return {
            "league": config.league.league_name,
            "signals": [],
            "data_available": False,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "days": days,
        }

    try:
        snapshot = await get_snapshot()
        return compute_speculation_signals(
            snapshot,
            config,
            days=days,
            limit=limit,
            signal_filter=signal,
        )
    except Exception as e:
        logger.error("Speculation computation failed: %s", e)
        return {
            "league": config.league.league_name,
            "signals": [],
            "data_available": False,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "days": days,
        }
