"""
API routes for Intraday Patterns — time-of-day price pattern detector (P4).

Endpoint:
    GET /api/v1/intraday-patterns — Per-currency hourly (UTC) price
        aggregation + buy/sell window detection. Powers the heatmap UI
        in `intraday-patterns-tab.tsx` (iter 98).

The heavy lifting lives in `backend/economy/intraday_patterns.py` (pure
function, tests in tests/test_intraday_patterns.py) — this module is a
thin FastAPI wrapper that fetches the snapshot, calls the pure function,
and shapes the response. Same pattern as `routes_circuit_patterns.py`
(iter 97) and `routes_speculation.py`.

Query params:
    days   — Lookback window in days (default 14, clamped to [1, 90]).
    limit  — Maximum number of patterns to return (default 50, clamped
             to [1, 500]).
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Query

from backend.api.data_snapshot import get_snapshot, get_snapshot_manager
from backend.api.response_models import IntradayPatternsResponse
from backend.config import get_settings
from backend.economy.intraday_patterns import (
    DEFAULT_DAYS,
    DEFAULT_LIMIT,
    compute_intraday_patterns,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["intraday-patterns"])


@router.get("/intraday-patterns", response_model=IntradayPatternsResponse)
async def get_intraday_patterns(
    days: int = Query(
        DEFAULT_DAYS,
        ge=1,
        le=90,
        description="Lookback window in days for the hourly aggregation.",
    ),
    limit: int = Query(
        DEFAULT_LIMIT,
        ge=1,
        le=500,
        description="Maximum number of patterns to return.",
    ),
) -> dict:
    """Per-currency time-of-day (UTC hour) price pattern + buy/sell windows.

    Returns data_available=false (with an empty patterns list) when the
    snapshot manager hasn't fetched any data yet — the frontend should show
    a "no data" state rather than treating it as an error.
    """
    config = get_settings()

    snapshot_mgr = get_snapshot_manager()
    if snapshot_mgr.last_snapshot is None:
        return {
            "league": config.league.league_name,
            "patterns": [],
            "data_available": False,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "days": days,
        }

    try:
        snapshot = await get_snapshot()
        result = compute_intraday_patterns(
            snapshot,
            config,
            days=days,
            limit=limit,
        )
        # The pure function does not echo `days` back (it's not part of its
        # contract — only route handlers care about it for client caching).
        # Inject it here so the response model's `days` field validates.
        result["days"] = days
        return result
    except Exception as e:
        logger.error("Intraday patterns computation failed: %s", e)
        return {
            "league": config.league.league_name,
            "patterns": [],
            "data_available": False,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "days": days,
        }
