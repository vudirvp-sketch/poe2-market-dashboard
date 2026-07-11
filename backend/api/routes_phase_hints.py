"""
API routes for Phase-aware Hints — Temporalis / skill gems / etc. (F6).

Endpoint:
    GET /api/v1/phase-hints — Phase-aware advisory hints based on the
    current league phase detected by PhaseDetector.

The heavy lifting lives in `backend/economy/phase_hints.py` — this module
is a thin FastAPI wrapper that:
  1. Fetches the global PhaseDetector singleton (configured with the
     league_start_datetime from config.yaml).
  2. Calls `detector.get_phase_info()` to get the current phase +
     days_since_reference + reference_currency.
  3. Forwards the result to `get_phase_hints()` (pure function).

iter 110 (P9): The route now ALSO fetches the DataSnapshot (best-effort)
and passes it to `get_phase_hints()`. When the snapshot is available,
each hint with a `tracked_currency` is enriched with live-price metrics
(current_price / change_pct_week / change_pct_month / momentum /
recommendation). When the snapshot is NOT available (e.g. upstream API
down — KI-11), the route falls back to static-only hints. This preserves
the "immune to KI-11" property: even with no market data, the hint table
still renders.

iter 87: Added `?lang=` query parameter. `?lang=ru` returns the parallel
Russian hint table from `_PHASE_HINTS_RU` / `_PHASE_META_RU` in
`phase_hints.py`. Default is English (for backward compatibility).
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Query

from backend.api.data_snapshot import get_snapshot, get_snapshot_manager
from backend.api.response_models import PhaseHintsResponse
from backend.api.shared import get_phase_detector
from backend.config import get_settings
from backend.economy.phase_hints import get_phase_hints

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["phase-hints"])


@router.get("/phase-hints", response_model=PhaseHintsResponse)
async def get_phase_hints_route(
    lang: str = Query("en", description="Locale: 'ru' returns the Russian hint table, default English."),
) -> dict:
    """Phase-aware advisory hints for the current league phase.

    Returns the current phase (early/mid/late) + phase_label +
    days_since_reference + a list of advisory hints (title, detail,
    action, category). The hints are static — they document well-known
    league-lifecycle patterns from PRODUCT_VISION §3.4.

    iter 110 (P9): When the DataSnapshot is available, hints with a
    ``tracked_currency`` are enriched with live-price metrics
    (current_price / change_pct_week / change_pct_month / momentum /
    recommendation). When the snapshot is not available, the hints are
    returned static-only (graceful degradation — the hint table always
    renders, even when the upstream market API is down).

    Always returns data_available=True (the hint table is hardcoded).
    On an unexpected exception, returns a minimal response with empty
    hints list and data_available=False so the frontend can show a
    graceful degraded state.

    Query params:
        lang: Locale code — "ru" returns Russian hints (iter 87),
              anything else returns English (default).
    """
    config = get_settings()

    try:
        detector = get_phase_detector()
        info = detector.get_phase_info()

        # iter 110: best-effort snapshot fetch for live-price enrichment.
        # When the snapshot manager has no data yet (last_snapshot is None)
        # we skip enrichment entirely — the hints are returned static-only.
        # This keeps the endpoint "immune to KI-11" (upstream API 404).
        snapshot = None
        try:
            snap_mgr = get_snapshot_manager()
            if snap_mgr.last_snapshot is not None:
                snapshot = await get_snapshot()
        except Exception as snap_err:
            # Snapshot fetch is best-effort — never let it break the hints.
            logger.debug("Snapshot fetch for phase-hints enrichment failed: %s", snap_err)
            snapshot = None

        return get_phase_hints(
            phase=info.phase,
            days_since_reference=info.days_since_reference,
            reference_currency=info.reference_currency,
            league_name=config.league.league_name,
            lang=lang,
            snapshot=snapshot,
        )
    except Exception as e:
        logger.error("Phase hints computation failed: %s", e)
        if lang == "ru":
            return {
                "league": config.league.league_name,
                "phase": "unknown",
                "phase_label": "Неизвестная фаза",
                "days_since_reference": 0,
                "reference_currency": "",
                "phase_summary": "Фаза лиги не определена.",
                "hints": [],
                "data_available": False,
                "fetched_at": datetime.now(timezone.utc).isoformat(),
            }
        return {
            "league": config.league.league_name,
            "phase": "unknown",
            "phase_label": "Unknown Phase",
            "days_since_reference": 0,
            "reference_currency": "",
            "phase_summary": "League phase could not be determined.",
            "hints": [],
            "data_available": False,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }
