"""
API routes for Leveling Uniques Lifecycle — P3 spike-then-crash pattern (iter 100).

Endpoint:
    GET /api/v1/leveling-uniques — Static leveling-uniques table with per-item
        lifecycle stage (PRE_PEAK / AT_PEAK / POST_PEAK) + recommendation
        (BUY_OR_HOLD / SELL_NOW / AVOID_BUYING). Powers the widget on the
        Overview tab (iter 100).

The heavy lifting lives in `backend/economy/leveling_uniques.py` (pure
function, tests in tests/test_leveling_uniques.py) — this module is a
thin FastAPI wrapper that:
  1. Fetches the global PhaseDetector singleton (configured with the
     league_start_datetime from config.yaml).
  2. Calls `detector.get_phase_info()` to get the current phase +
     days_since_reference + reference_currency.
  3. Forwards the result to `compute_leveling_uniques_lifecycle()` (pure
     function).

This endpoint does NOT depend on the DataSnapshot — the unique table is
hardcoded in `leveling_uniques.py`. It will always return
data_available=True as long as the PhaseDetector can be constructed
(which it always can, given a league_start_datetime). This makes it
immune to KI-11 (upstream API 404 errors) — the widget renders correctly
even when the snapshot is empty.

iter 100: Added `?lang=` query parameter. `?lang=ru` returns the parallel
Russian notes table from `_LEVELING_UNIQUES_NOTES_RU` in
`leveling_uniques.py`. Default is English. Same i18n convention as
`routes_phase_hints.py` (iter 87).

iter 150: Added curated `name_ru` field to each unique in the static table
(`_LEVELING_UNIQUES` in `leveling_uniques.py`). 4/10 items populated from
poe2db's official RU pages (Polcirkeln / Megalomaniac / Mind of the Council
/ Soul Tether); the remaining 6 have `name_ru=None` and the frontend falls
back to the EN `name`. The `name_ru` field is returned for ALL locales —
the frontend picks `name_ru` vs `name` at render time based on its own
locale state. This removes the widget's dependency on the slug-based
`getUniqueDisplayName` lookup (which had ~1/10 coverage due to slug
mismatch).
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Query

from backend.api.response_models import LevelingUniquesResponse
from backend.api.shared import get_phase_detector
from backend.config import get_settings
from backend.economy.leveling_uniques import compute_leveling_uniques_lifecycle

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["leveling-uniques"])


@router.get("/leveling-uniques", response_model=LevelingUniquesResponse)
async def get_leveling_uniques_route(
    lang: str = Query(
        "en",
        description="Locale: 'ru' returns the Russian notes for each unique, "
                    "default English. The unique id/name/name_ru/category/peak_day/"
                    "peak_price_exalted/decay_pct/pattern fields are identical "
                    "across locales — only the notes field is translated. "
                    "name_ru is a curated static field (iter 150) returned for "
                    "all locales; the frontend picks name_ru vs name at render "
                    "time based on its own locale state.",
    ),
) -> dict:
    """Leveling-uniques lifecycle widget data for the Overview tab.

    Returns the current league phase + days_since_reference + a static table
    of well-known leveling uniques (Polcirkeln, Wall of Brambles, Mana Leech
    Support, etc.) with per-item:
      - peak_day / peak_price_exalted / decay_pct (static)
      - current_lifecycle_stage (PRE_PEAK / AT_PEAK / POST_PEAK)
      - recommendation (BUY_OR_HOLD / SELL_NOW / AVOID_BUYING)
      - estimated_current_price_exalted (heuristic, NOT live market price)
      - days_until_peak (positive/negative/zero)
      - name_ru (curated RU display name, iter 150; None when no poe2db RU match)
      - notes (localized via ?lang=)

    Always returns data_available=True (the table is hardcoded and always
    available). On an unexpected exception, returns a minimal response
    with an empty uniques list and data_available=False so the frontend
    can show a graceful degraded state.

    Query params:
        lang: Locale code — "ru" returns Russian notes (iter 100),
              anything else returns English (default). The curated ``name_ru``
              field (iter 150) is returned for all locales.
    """
    config = get_settings()

    try:
        detector = get_phase_detector()
        info = detector.get_phase_info()
        return compute_leveling_uniques_lifecycle(
            phase=info.phase,
            days_since_reference=info.days_since_reference,
            reference_currency=info.reference_currency,
            league_name=config.league.league_name,
            lang=lang,
        )
    except Exception as e:
        logger.error("Leveling uniques computation failed: %s", e)
        return {
            "league": config.league.league_name,
            "phase": "unknown",
            "days_since_reference": 0,
            "current_day": 0,
            "reference_currency": "",
            "uniques": [],
            "data_available": False,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }
