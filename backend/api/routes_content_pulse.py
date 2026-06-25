"""
API routes for Content Pulse — daily turnover per league mechanic (F3).

Endpoint:
    GET /api/v1/content-pulse — Per-category trade volume snapshot with
    7d/30d rolling averages, deltas, and top rising/falling items.

The heavy lifting lives in `backend/economy/content_pulse.py` — this module
is a thin FastAPI wrapper that fetches the snapshot, calls the pure function,
and shapes the response.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter

from backend.api.data_snapshot import get_snapshot, get_snapshot_manager
from backend.api.response_models import ContentPulseResponse
from backend.config import get_settings
from backend.economy.content_pulse import compute_content_pulse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["content-pulse"])


@router.get("/content-pulse", response_model=ContentPulseResponse)
async def get_content_pulse() -> dict:
    """Per-category turnover snapshot + 7d/30d rolling deltas + top movers.

    Returns data_available=false (with an empty categories list) when the
    snapshot manager hasn't fetched any data yet — the frontend should show
    a "no data" state in that case rather than treating it as an error.
    """
    config = get_settings()

    snapshot_mgr = get_snapshot_manager()
    if snapshot_mgr.last_snapshot is None:
        return {
            "league": config.league.league_name,
            "categories": [],
            "data_available": False,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }

    try:
        snapshot = await get_snapshot()
        return compute_content_pulse(snapshot, config)
    except Exception as e:
        logger.error("Content pulse computation failed: %s", e)
        return {
            "league": config.league.league_name,
            "categories": [],
            "data_available": False,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }
