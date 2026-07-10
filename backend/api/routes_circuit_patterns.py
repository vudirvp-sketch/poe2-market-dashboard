"""
API routes for Circuit Patterns — per-currency trajectory classification (P8/F7).

Endpoint:
    GET /api/v1/circuit-patterns — Per-currency trajectory archetype +
        recommended action (HOLD_FOR_GROWTH / SELL_NOW / AVOID / WATCH /
        NEUTRAL), sorted by |total_change_pct| descending.

The heavy lifting lives in `backend/economy/circuit_patterns.py` (pure
function, 75 tests in tests/test_circuit_patterns.py) — this module is a
thin FastAPI wrapper that fetches the snapshot, calls the pure function,
and shapes the response. Same pattern as `routes_speculation.py`.

Query params:
    days        — Lookback window in days (default 30, clamped to [1, 90]).
    limit       — Maximum number of patterns to return (default 50, clamped
                  to [1, 500]).
    trajectory  — "ALL" (default) | one of the trajectory archetypes
                  (EXPONENTIAL_GROWTH / LINEAR_GROWTH / PEAK_THEN_DECLINE /
                   MEAN_REVERTING / VOLATILE / DECLINING / STABLE).
                  When not ALL, only currencies with the matching trajectory
                  are returned.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Query

from backend.api.data_snapshot import get_snapshot, get_snapshot_manager
from backend.api.response_models import CircuitPatternsResponse
from backend.config import get_settings
from backend.economy.circuit_patterns import (
    ALL_TRAJECTORIES,
    DEFAULT_DAYS,
    DEFAULT_LIMIT,
    compute_circuit_patterns,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["circuit-patterns"])


# Build the regex pattern for the trajectory query param once.
# Matches "ALL" or any of the 7 trajectory archetypes.
_TRAJECTORY_PATTERN = "^(" + "|".join(("ALL", *ALL_TRAJECTORIES)) + ")$"


@router.get("/circuit-patterns", response_model=CircuitPatternsResponse)
async def get_circuit_patterns(
    days: int = Query(
        DEFAULT_DAYS,
        ge=1,
        le=90,
        description="Lookback window in days for the trajectory classification.",
    ),
    limit: int = Query(
        DEFAULT_LIMIT,
        ge=1,
        le=500,
        description="Maximum number of patterns to return.",
    ),
    trajectory: str = Query(
        "ALL",
        pattern=_TRAJECTORY_PATTERN,
        description=(
            "Filter by trajectory archetype. ALL returns every archetype. "
            "Allowed: ALL, EXPONENTIAL_GROWTH, LINEAR_GROWTH, "
            "PEAK_THEN_DECLINE, MEAN_REVERTING, VOLATILE, DECLINING, STABLE."
        ),
    ),
) -> dict:
    """Per-currency trajectory classification + recommended action.

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
        result = compute_circuit_patterns(
            snapshot,
            config,
            days=days,
            limit=limit,
            trajectory_filter=trajectory,
        )
        # The pure function does not echo `days` back (it's not part of its
        # contract — only route handlers care about it for client caching).
        # Inject it here so the response model's `days` field validates.
        result["days"] = days
        return result
    except Exception as e:
        logger.error("Circuit patterns computation failed: %s", e)
        return {
            "league": config.league.league_name,
            "patterns": [],
            "data_available": False,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "days": days,
        }
