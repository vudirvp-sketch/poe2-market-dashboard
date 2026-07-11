"""
API routes for Mirror/Divine Arbitrage Detector (P7).

Endpoint:
    GET /api/v1/mirror-divine-arb — Detect Mirror:Divine rate arb windows.
        Returns a single-object response (Mirror:Divine is one market, not
        a per-currency list) with the current rate, historical mean/std,
        z-score, signal (SELL_MIRROR_BUY_DIVINE / SELL_DIVINE_BUY_MIRROR /
        NEUTRAL), and recommended action (EXECUTE_ARB / WATCH / HOLD).

The heavy lifting lives in `backend/economy/mirror_divine_arb.py` (pure
function, comprehensive tests in tests/test_mirror_divine_arb.py) — this
module is a thin FastAPI wrapper that fetches the snapshot, calls the
pure function, and shapes the response. Same pattern as
`routes_circuit_patterns.py` and `routes_speculation.py`.

Query params:
    days — Lookback window in days (default 30, clamped to [1, 90]).
           Matches the convention of circuit-patterns / speculation /
           intraday-patterns / weekly-patterns.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Query

from backend.api.data_snapshot import get_snapshot, get_snapshot_manager
from backend.api.response_models import MirrorDivineArbResponse
from backend.config import get_settings
from backend.economy.mirror_divine_arb import (
    DEFAULT_DAYS,
    MAX_DAYS,
    compute_mirror_divine_arb,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["mirror-divine-arb"])


@router.get("/mirror-divine-arb", response_model=MirrorDivineArbResponse)
async def get_mirror_divine_arb(
    days: int = Query(
        DEFAULT_DAYS,
        ge=1,
        le=MAX_DAYS,
        description=(
            "Lookback window in days for the Mirror:Divine rate series. "
            "Default 30, max 90 (matches historical_retention_days)."
        ),
    ),
) -> dict:
    """Detect Mirror:Divine arbitrage windows for chase-unique payment-method swaps.

    Returns `data_available=false` (with `current_rate=None` and an empty
    `price_history_short`) when the snapshot manager hasn't fetched any
    data yet, or when fewer than MIN_SAMPLE_SIZE (4) rate points fall
    inside the lookback window. The frontend should show a "no data yet"
    state rather than treating it as an error.
    """
    config = get_settings()

    snapshot_mgr = get_snapshot_manager()
    if snapshot_mgr.last_snapshot is None:
        return {
            "league": config.league.league_name,
            "mirror_currency": "mirror",
            "divine_currency": "divine",
            "current_rate": None,
            "mean_rate": None,
            "std_rate": None,
            "min_rate": None,
            "max_rate": None,
            "z_score": None,
            "deviation_pct": None,
            "profit_potential_per_mirror_div": None,
            "signal": "NEUTRAL",
            "is_actionable": False,
            "recommended_action": "HOLD",
            "sample_size": 0,
            "price_history_short": [],
            "data_available": False,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "days": days,
        }

    try:
        snapshot = await get_snapshot()
        return compute_mirror_divine_arb(snapshot, config, days=days)
    except Exception as e:
        logger.error("Mirror/Divine arb computation failed: %s", e)
        return {
            "league": config.league.league_name,
            "mirror_currency": "mirror",
            "divine_currency": "divine",
            "current_rate": None,
            "mean_rate": None,
            "std_rate": None,
            "min_rate": None,
            "max_rate": None,
            "z_score": None,
            "deviation_pct": None,
            "profit_potential_per_mirror_div": None,
            "signal": "NEUTRAL",
            "is_actionable": False,
            "recommended_action": "HOLD",
            "sample_size": 0,
            "price_history_short": [],
            "data_available": False,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "days": days,
        }
