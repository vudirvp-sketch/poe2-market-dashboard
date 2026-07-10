"""
API routes for Weekly Patterns — weekday/weekend price pattern detector (P5).

Endpoint:
    GET /api/v1/weekly-patterns — Per-currency weekday (Mon-Sun) price
        aggregation + buy/sell day detection. Powers the heatmap UI
        in `weekly-patterns-tab.tsx` (iter 99).

The heavy lifting lives in `backend/economy/weekly_patterns.py` (pure
function, tests in tests/test_weekly_patterns.py) — this module is a
thin FastAPI wrapper that fetches the snapshot, calls the pure function,
and shapes the response. Same pattern as `routes_intraday_patterns.py`
(iter 98) and `routes_circuit_patterns.py` (iter 97).

Query params:
    weeks  — Lookback window in weeks (default 4, clamped to [1, 26]).
              Each week = 7 days, so weeks=4 → 28-day window.
    limit  — Maximum number of patterns to return (default 50, clamped
             to [1, 500]).
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Query

from backend.api.data_snapshot import get_snapshot, get_snapshot_manager
from backend.api.response_models import WeeklyPatternsResponse
from backend.config import get_settings
from backend.economy.weekly_patterns import (
    DEFAULT_LIMIT,
    DEFAULT_WEEKS,
    compute_weekly_patterns,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["weekly-patterns"])


@router.get("/weekly-patterns", response_model=WeeklyPatternsResponse)
async def get_weekly_patterns(
    weeks: int = Query(
        DEFAULT_WEEKS,
        ge=1,
        le=26,
        description="Lookback window in weeks for the weekday aggregation. "
                    "Each week = 7 days, so weeks=4 → 28-day window.",
    ),
    limit: int = Query(
        DEFAULT_LIMIT,
        ge=1,
        le=500,
        description="Maximum number of patterns to return.",
    ),
) -> dict:
    """Per-currency weekday (Mon-Sun) price pattern + buy/sell days.

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
            "weeks": weeks,
        }

    try:
        snapshot = await get_snapshot()
        result = compute_weekly_patterns(
            snapshot,
            config,
            weeks=weeks,
            limit=limit,
        )
        # The pure function does not echo `weeks` back (it's not part of its
        # contract — only route handlers care about it for client caching).
        # Inject it here so the response model's `weeks` field validates.
        result["weeks"] = weeks
        return result
    except Exception as e:
        logger.error("Weekly patterns computation failed: %s", e)
        return {
            "league": config.league.league_name,
            "patterns": [],
            "data_available": False,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "weeks": weeks,
        }
