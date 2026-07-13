"""
Leveling Uniques Lifecycle — P3 spike-then-crash price pattern detector (iter 100).

Implements the pattern described in docs/MARKET_PLAYBOOK.md §P3 (leveling uniques
lifecycle). On Day 1 of a new league, certain "leveling uniques" — items that
speed up the early leveling process (movement boots, low-tier unique weapons,
Mana Leech jewels, etc.) — are in extreme demand because players are rushing
to endgame. Prices spike on Day 2 (peak demand when the early-wave reaches
endgame and lists them), then crash on Day 3+ as supply catches up and demand
falls (more players in endgame, fewer needing leveling gear).

This module computes, for each leveling unique in a static table:
    - ``current_lifecycle_stage``: ``PRE_PEAK`` | ``AT_PEAK`` | ``POST_PEAK``
    - ``recommendation``:           ``BUY_OR_HOLD`` | ``SELL_NOW`` | ``AVOID_BUYING``
    - ``days_until_peak`` / ``days_since_peak``: relative day counters
    - ``estimated_current_price_exalted``: linear interpolation between
      Day 1 baseline and Day 7+ post-peak floor (rough heuristic — NOT a
      live price from the snapshot; this module does NOT depend on the
      DataSnapshot, only on PhaseDetector).

The output powers the Leveling Uniques widget on the Overview tab (iter 100):
    ┌──────────────────────────────────────────────────────────────────────┐
    │  Leveling Uniques · Day 2 of league · 10 items tracked               │
    │  Currently at peak demand — SELL NOW if you have any of these.       │
    │                                                                      │
    │  Item                          Stage      Est. Price    Action        │
    │  ─────────────────────────    ────────   ──────────    ────────      │
    │  Polcirkeln Sapphire Ring     AT_PEAK    15 exa         SELL NOW      │
    │  Wall of Brambles             AT_PEAK    8 exa          SELL NOW      │
    │  Mana Leech Support Gem       PRE_PEAK   3 exa          BUY/HOLD      │
    │  ...                                                                 │
    └──────────────────────────────────────────────────────────────────────┘

This module is pure-function: it takes ``phase`` + ``days_since_reference``
(from PhaseDetector) and returns a dict. The route handler
(``routes_leveling_uniques.py``) is a thin wrapper. Same separation as
``phase_hints.py`` (iter 78) — the logic is testable without spinning
up FastAPI, and the module does NOT depend on the DataSnapshot (so it's
immune to KI-11 upstream API 404 errors).

Design notes
------------
- The static table ``_LEVELING_UNIQUES`` is intentionally hardcoded. Per
  the playbook §C.5 spec: "Использует PhaseDetector + статичная таблица
  известных leveling уников с их типичным паттерном. Без GGG trade API —
  только метрика цены." Adding live price discovery would require the GGG
  trade API (separate roadmap item — see §C.9 backlog).
- ``peak_day`` is the league day on which the unique's price historically
  peaks (Day 1 = launch day). For most leveling uniques this is Day 2 —
  Day 1 prices are chaotic (low liquidity, early listings), Day 2 is when
  the early-wave reaches endgame and demand spikes.
- ``decay_pct`` is the typical % decline from peak to "post-peak floor"
  (Day 7+). Most leveling uniques lose 60-80% of their peak value by
  Day 7. This is a heuristic — actual decay varies by league meta.
- ``peak_price_exalted`` is the typical peak price in Exalted Orbs.
  During EARLY phase (Day 1-14) the economy uses Exalt as the reference
  currency (per PhaseDetector strategy table). The widget renders this
  as "exa" suffix; the user can mentally convert to Divine once MID
  phase kicks in (Divine:Exalt ratio is shown in the Exchange tab).
- The lifecycle stage thresholds are:
    - ``PRE_PEAK``:  ``days_since_reference < peak_day``
    - ``AT_PEAK``:   ``peak_day ≤ days_since_reference ≤ peak_day + 1``
                     (a 2-day window — peak day + the day after, since
                     "Day 2" peak means prices are high on both Day 2
                     and Day 3 before the crash begins)
    - ``POST_PEAK``: ``days_since_reference > peak_day + 1``
- The estimated current price is a piecewise-linear heuristic:
    - PRE_PEAK:  linearly interpolate from 0.5× peak (Day 0) to 1.0× peak (peak_day)
    - AT_PEAK:   hold at peak price
    - POST_PEAK: linearly decay from peak (peak_day+1) to (1 - decay_pct/100)×peak
                 by Day 7, then hold at floor for Day 8+
  This is NOT a live market price — it's a planning heuristic so the user
  can see "if I list now, I can expect ~X exa". The widget tooltip
  explicitly states this.
- i18n: The static table carries an EN ``name`` plus an optional curated
  ``name_ru`` field (added iter 150). The route accepts ``?lang=ru`` and
  returns Russian ``notes`` for each unique (parallel
  ``_LEVELING_UNIQUES_NOTES_RU`` table — only ``notes`` is translated).
  The ``name_ru`` field is the same regardless of ``lang`` (it's a static
  curated field, not a query-time lookup) — the frontend picks
  ``name_ru`` vs ``name`` at render time based on the active locale.
  ``id`` / ``category`` / ``peak_day`` / ``peak_price_exalted`` /
  ``decay_pct`` / ``pattern`` are identical across locales so the frontend
  can switch tables by locale without breaking cross-references. Same
  convention as ``phase_hints.py`` (iter 87).

  ``name_ru`` coverage (iter 150): 4/10 items populated from poe2db's
  official RU pages (see ``scripts/.cache/poe2db_unique_names.json``):
  ``polcirkeln-sapphire-ring`` → "Полярный круг",
  ``megalomaniac-diamond`` → "Мания величия",
  ``mind-of-the-council`` → "Разум Совета",
  ``soul-tether-amulet`` → "Оковы души". The remaining 6 items have
  ``name_ru: None`` — they have no poe2db RU page under the matching
  slug. Frontend falls back to the EN ``name`` when ``name_ru`` is
  None. To extend coverage: re-run ``scripts/sync_currency_names_from_poe2db.py
  --fetch-unique-ru`` after a poe2db update, then manually update this
  table for any new matches.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from backend.models.currency import LeaguePhase

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Tunable constants — kept here rather than in config.yaml because they are
# pattern-analysis thresholds, not deployment parameters. Same convention as
# phase_hints.py (iter 78).
# ---------------------------------------------------------------------------

POST_PEAK_FLOOR_DAY: int = 7
"""League day by which the post-peak decay has reached its floor.

Most leveling uniques bottom out by Day 7 — supply has fully caught up,
the leveling wave is in endgame, and demand for leveling gear collapses.
Used by ``_estimate_current_price`` to compute the decay slope.
"""

PRE_PEAK_DAY0_PRICE_FRACTION: float = 0.5
"""Fraction of peak price that the item sells for on Day 0 (launch day).

Day 0 prices are typically HALF of peak — low liquidity, few listings,
but also low demand (the leveling wave hasn't reached endgame yet). Used
by ``_estimate_current_price`` for the PRE_PEAK linear interpolation.
"""

# ---------------------------------------------------------------------------
# Lifecycle stage + recommendation constants
# ---------------------------------------------------------------------------

STAGE_PRE_PEAK: str = "PRE_PEAK"
STAGE_AT_PEAK: str = "AT_PEAK"
STAGE_POST_PEAK: str = "POST_PEAK"
"""Lifecycle stage identifiers — emitted as ``current_lifecycle_stage`` field.
The frontend renders these as colored badges (PRE_PEAK=blue, AT_PEAK=amber,
POST_PEAK=muted)."""

RECOMMENDATION_BUY_OR_HOLD: str = "BUY_OR_HOLD"
RECOMMENDATION_SELL_NOW: str = "SELL_NOW"
RECOMMENDATION_AVOID_BUYING: str = "AVOID_BUYING"
"""Recommendation identifiers — emitted as ``recommendation`` field.
The frontend renders these as colored action badges (BUY/HOLD=emerald,
SELL_NOW=red, AVOID=muted)."""

PATTERN_SPIKE_THEN_CRASH: str = "SPIKE_THEN_CRASH"
"""The only supported pattern for leveling uniques. Per playbook §A.3:
"Для каждого leveling-уника отслеживать форму кривой цены.
'Spike-then-crash' — пик на Day 2, затем спад."
Future iterations may add LINEAR_DECLINE / STABLE_LOW_DEMAND patterns,
but for iter 100 we ship the MVP with just SPIKE_THEN_CRASH."""


# ---------------------------------------------------------------------------
# Static leveling-uniques table — keyed by stable slug ``id``.
#
# Each entry has:
#   - "id":                    stable slug (for tests + future metric linkage)
#   - "name":                  display name (EN, matches in-game name)
#   - "name_ru":               curated Russian display name (iter 150) or None
#                              when no official poe2db RU translation exists
#                              for this item's slug. The frontend renders this
#                              when locale=ru and the field is non-None,
#                              otherwise falls back to ``name``. Sourced from
#                              ``scripts/.cache/poe2db_unique_names.json``
#                              (populated by ``--fetch-unique-ru``).
#   - "category":              POE2Scout category slug for future cross-ref
#                              (e.g. "currency" if priced as currency, "" if
#                              priced as item — most leveling uniques are
#                              priced as items, but some like Megalomaniac
#                              are tracked as currency-like)
#   - "peak_day":              league day on which price historically peaks
#                              (Day 1 = launch day; Day 2 = first full day)
#   - "peak_price_exalted":    typical peak price in Exalted Orbs
#   - "decay_pct":             typical % decline from peak by Day 7+
#   - "pattern":               always "SPIKE_THEN_CRASH" for iter 100
#   - "notes":                 short description of why this is a leveling unique
#
# Values are based on community guide analysis (docs/MARKET_PLAYBOOK.md §A.3)
# and are intentionally conservative — actual prices vary by league meta.
# Updates should be made by editing this table (no API integration needed).
#
# Order matters — uniques are rendered top-to-bottom in the UI. Sorted by
# peak_price_exalted descending (chase leveling uniques first).
# ---------------------------------------------------------------------------

_LEVELING_UNIQUES: list[dict[str, Any]] = [
    {
        "id": "polcirkeln-sapphire-ring",
        "name": "Polcirkeln Sapphire Ring",
        "name_ru": "Полярный круг",
        "category": "",
        "peak_day": 2,
        "peak_price_exalted": 15.0,
        "decay_pct": 70.0,
        "pattern": PATTERN_SPIKE_THEN_CRASH,
        "notes": (
            "Found via Unique Ring Remnants Crafting. Strong leveling ring "
            "for cold/elemental builds. Sold for 15 Exalt (half a Divine) "
            "on Day 1 in the reference guide."
        ),
    },
    {
        "id": "megalomaniac-diamond",
        "name": "Megalomaniac Diamond",
        "name_ru": "Мания величия",
        "category": "",
        "peak_day": 2,
        "peak_price_exalted": 12.0,
        "decay_pct": 65.0,
        "pattern": PATTERN_SPIKE_THEN_CRASH,
        "notes": (
            "Notable allocation jewel — 1-2 good nodes can sell for 20-40 Div "
            "in MID phase, but the leveling-tier versions (random notables) "
            "spike early when players are testing builds."
        ),
    },
    {
        "id": "wall-of-brambles",
        "name": "Wall of Brambles",
        "name_ru": None,
        "category": "",
        "peak_day": 2,
        "peak_price_exalted": 8.0,
        "decay_pct": 75.0,
        "pattern": PATTERN_SPIKE_THEN_CRASH,
        "notes": (
            "Tanky leveling chest for STR builds. High demand Day 1-2 when "
            "players are pushing campaign. Crashes hard once players reach "
            "endgame and craft their own chests."
        ),
    },
    {
        "id": "mana-leech-support",
        "name": "Mana Leech Support Gem",
        "name_ru": None,
        "category": "uncutgems",
        "peak_day": 2,
        "peak_price_exalted": 5.0,
        "decay_pct": 60.0,
        "pattern": PATTERN_SPIKE_THEN_CRASH,
        "notes": (
            "Critical for spell-casters in early campaign. Spikes Day 2 when "
            "caster builds hit mana-wall content. Decays as players find "
            "Uncut Support gems from campaign rewards."
        ),
    },
    {
        "id": "feeding-frenzy-support",
        "name": "Feeding Frenzy Support",
        "name_ru": None,
        "category": "uncutgems",
        "peak_day": 2,
        "peak_price_exalted": 5.0,
        "decay_pct": 55.0,
        "pattern": PATTERN_SPIKE_THEN_CRASH,
        "notes": (
            "Minion-build staple. High demand Day 1-2 when summoner players "
            "hit endgame. Decays slower than other leveling gems (minion "
            "builds stay popular through MID phase)."
        ),
    },
    {
        "id": "echoes-of-worldstone",
        "name": "Echoes of Worldstone",
        "name_ru": None,
        "category": "",
        "peak_day": 3,
        "peak_price_exalted": 4.0,
        "decay_pct": 50.0,
        "pattern": PATTERN_SPIKE_THEN_CRASH,
        "notes": (
            "Two-handed leveling mace. Peaks Day 3 (one day later than rings "
            "and chests) when STR-melee players reach endgame. Decays slowly "
            "because two-handed builds remain viable through MID."
        ),
    },
    {
        "id": "mind-of-the-council",
        "name": "Mind of the Council",
        "name_ru": "Разум Совета",
        "category": "",
        "peak_day": 2,
        "peak_price_exalted": 4.0,
        "decay_pct": 70.0,
        "pattern": PATTERN_SPIKE_THEN_CRASH,
        "notes": (
            "ES-based leveling helmet for casters. Spikes Day 2 when the "
            "caster wave reaches endgame. Crashes as players craft ES gear."
        ),
    },
    {
        "id": "boots-of-momentum",
        "name": "Boots of Momentum",
        "name_ru": None,
        "category": "",
        "peak_day": 2,
        "peak_price_exalted": 3.0,
        "decay_pct": 80.0,
        "pattern": PATTERN_SPIKE_THEN_CRASH,
        "notes": (
            "Movement-speed boots — universally useful for leveling. Spikes "
            "Day 2 then crashes by 80% as players find/craft better boots."
        ),
    },
    {
        "id": "wings-of-entropy",
        "name": "Wings of Entropy",
        "name_ru": None,
        "category": "",
        "peak_day": 2,
        "peak_price_exalted": 2.5,
        "decay_pct": 65.0,
        "pattern": PATTERN_SPIKE_THEN_CRASH,
        "notes": (
            "Dual-wield leveling axe. Niche demand but high prices Day 1-2 "
            "because dual-wield melee pushes through campaign fastest."
        ),
    },
    {
        "id": "soul-tether-amulet",
        "name": "Soul Tether Amulet",
        "name_ru": "Оковы души",
        "category": "",
        "peak_day": 2,
        "peak_price_exalted": 2.0,
        "decay_pct": 70.0,
        "pattern": PATTERN_SPIKE_THEN_CRASH,
        "notes": (
            "ES-leech amulet for hybrid builds. Low absolute price but very "
            "high decay — only useful in the first 3 days of a league."
        ),
    },
]

# ---------------------------------------------------------------------------
# Russian notes table — parallel to _LEVELING_UNIQUES but only ``notes``
# is translated. ``id`` / ``name`` / ``name_ru`` / ``category`` / ``peak_day`` /
# ``peak_price_exalted`` / ``decay_pct`` / ``pattern`` are identical
# (same convention as phase_hints.py iter 87). Note: ``name_ru`` is a curated
# field on the main table (iter 150), not a per-locale translation here —
# only ``notes`` is locale-sensitive and lives in this dict.
# ---------------------------------------------------------------------------

_LEVELING_UNIQUES_NOTES_RU: dict[str, str] = {
    "polcirkeln-sapphire-ring": (
        "Находится через Unique Ring Remnants Crafting. Сильный leveling-кольцо "
        "для холодных/элементальных билдов. Продан за 15 Exalt (пол-Divine) "
        "в Day 1 в референсном гайде."
    ),
    "megalomaniac-diamond": (
        "Jewel с распределением notables — 1-2 хорошие ноды могут продаваться "
        "за 20-40 Div в MID-фазе, но leveling-tier версии (случайные notables) "
        "всплески рано, когда игроки тестируют билды."
    ),
    "wall-of-brambles": (
        "Tanky leveling-броня для STR-билдов. Высокий спрос в Day 1-2, когда "
        "игроки проходят кампанию. Резко падает, когда игроки достигают endgame "
        "и крафтят свою броню."
    ),
    "mana-leech-support": (
        "Критично для заклинателей в ранней кампании. Всплеск в Day 2, когда "
        "кастеры упираются в mana-wall контент. Падает по мере нахождения "
        "Uncut Support из наград кампании."
    ),
    "feeding-frenzy-support": (
        "Стейпл для minion-билдов. Высокий спрос Day 1-2, когда саммонеры "
        "достигают endgame. Падает медленнее других leveling-камней (minion-"
        "билды остаются популярными через MID-фазу)."
    ),
    "echoes-of-worldstone": (
        "Двуручная leveling-булава. Пик Day 3 (на день позже колец и брони), "
        "когда STR-melee игроки достигают endgame. Падает медленно, т.к. "
        "двуручные билды остаются жизнеспособными через MID."
    ),
    "mind-of-the-council": (
        "ES-based leveling-шлем для кастеров. Всплеск Day 2, когда волна "
        "кастеров достигает endgame. Падает по мере крафта ES-снаряжения."
    ),
    "boots-of-momentum": (
        "Ботинки с movement-speed — универсально полезны для leveling. Пик "
        "Day 2, затем падают на 80%, когда игроки находят/крафтят лучшие ботинки."
    ),
    "wings-of-entropy": (
        "Dual-wield leveling-топор. Нишевый спрос, но высокие цены Day 1-2, "
        "потому что dual-wield melee быстрее всех проходит кампанию."
    ),
    "soul-tether-amulet": (
        "ES-leech амулет для гибридных билдов. Низкая абсолютная цена, но "
        "очень высокий спад — полезен только в первые 3 дня лиги."
    ),
}


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------


def _lifecycle_stage(peak_day: int, days_since_reference: int) -> str:
    """Determine the lifecycle stage for a unique.

    Args:
        peak_day: League day on which the unique's price historically peaks.
        days_since_reference: Current league day (from PhaseDetector).

    Returns:
        One of STAGE_PRE_PEAK / STAGE_AT_PEAK / STAGE_POST_PEAK.

    Thresholds (documented in module docstring):
        - PRE_PEAK:  days < peak_day
        - AT_PEAK:   peak_day ≤ days ≤ peak_day + 1 (2-day window)
        - POST_PEAK: days > peak_day + 1

    The 2-day AT_PEAK window covers the fact that "peak on Day 2" means
    prices are high on both Day 2 AND Day 3 (the early listings on Day 2
    set the high water mark, and Day 3 listings match before the crash
    begins on Day 4). Using a strict single-day window would miss Day 3
    sales opportunities.
    """
    # Defensive: peak_day must be ≥ 1 (Day 0 is launch day, peak can't be
    # before launch). If a malformed entry slips through, treat as PRE_PEAK
    # for any days < 1 and AT_PEAK otherwise.
    if peak_day < 1:
        peak_day = 1

    if days_since_reference < peak_day:
        return STAGE_PRE_PEAK
    elif days_since_reference <= peak_day + 1:
        return STAGE_AT_PEAK
    else:
        return STAGE_POST_PEAK


def _recommendation(stage: str) -> str:
    """Map lifecycle stage → user-facing recommendation.

    Args:
        stage: One of STAGE_PRE_PEAK / STAGE_AT_PEAK / STAGE_POST_PEAK.

    Returns:
        One of RECOMMENDATION_BUY_OR_HOLD / RECOMMENDATION_SELL_NOW /
        RECOMMENDATION_AVOID_BUYING.

    Mapping:
        - PRE_PEAK  → BUY_OR_HOLD (prices still rising toward peak)
        - AT_PEAK   → SELL_NOW (peak demand — list now for max return)
        - POST_PEAK → AVOID_BUYING (prices crashing — only buy for personal
                      use, not for resale)
    """
    if stage == STAGE_PRE_PEAK:
        return RECOMMENDATION_BUY_OR_HOLD
    elif stage == STAGE_AT_PEAK:
        return RECOMMENDATION_SELL_NOW
    else:  # STAGE_POST_PEAK
        return RECOMMENDATION_AVOID_BUYING


def _estimate_current_price(
    peak_price: float,
    decay_pct: float,
    peak_day: int,
    days_since_reference: int,
) -> float:
    """Estimate the current price in Exalted Orbs (heuristic, NOT live).

    Piecewise-linear model:
        - PRE_PEAK (days < peak_day):
              linearly interpolate from
              (Day 0, PRE_PEAK_DAY0_PRICE_FRACTION × peak_price)
              to (peak_day, peak_price).
              Slope = (1.0 - PRE_PEAK_DAY0_PRICE_FRACTION) × peak_price / peak_day
              price = PRE_PEAK_DAY0_PRICE_FRACTION × peak_price + slope × days
        - AT_PEAK (peak_day ≤ days ≤ peak_day + 1):
              hold at peak_price.
        - POST_PEAK (days > peak_day + 1):
              linearly decay from peak_price (at peak_day + 1)
              to (1 - decay_pct/100) × peak_price (at POST_PEAK_FLOOR_DAY = 7).
              For days beyond POST_PEAK_FLOOR_DAY, hold at the floor price.

    This is a planning heuristic so the user can see "if I list now, I can
    expect ~X exa". The widget tooltip explicitly states this is NOT a
    live market price.

    Defensive: returns 0.0 when peak_price ≤ 0 or decay_pct is invalid.
    """
    if peak_price <= 0:
        return 0.0
    # Clamp decay_pct to [0, 100] — defensive against malformed table entries.
    decay_clamped = max(0.0, min(100.0, decay_pct))
    # Defensive: peak_day must be ≥ 1.
    peak_day_safe = max(1, peak_day)

    stage = _lifecycle_stage(peak_day_safe, days_since_reference)

    if stage == STAGE_PRE_PEAK:
        # Linear interp from (0, 0.5*peak) to (peak_day, peak).
        slope = (1.0 - PRE_PEAK_DAY0_PRICE_FRACTION) * peak_price / peak_day_safe
        return round(
            PRE_PEAK_DAY0_PRICE_FRACTION * peak_price + slope * days_since_reference,
            2,
        )
    elif stage == STAGE_AT_PEAK:
        return round(peak_price, 2)
    else:  # POST_PEAK
        # Linear decay from (peak_day+1, peak) to (POST_PEAK_FLOOR_DAY, floor).
        floor_price = peak_price * (1.0 - decay_clamped / 100.0)
        decay_start_day = peak_day_safe + 1
        # If we're past the floor day, return the floor price.
        if days_since_reference >= POST_PEAK_FLOOR_DAY:
            return round(floor_price, 2)
        # Otherwise, linearly interpolate between decay_start_day and floor day.
        decay_span = POST_PEAK_FLOOR_DAY - decay_start_day
        if decay_span <= 0:
            # Edge case: peak_day is so late that decay window is 0 or negative.
            # Just return the floor price.
            return round(floor_price, 2)
        days_into_decay = days_since_reference - decay_start_day
        slope = (floor_price - peak_price) / decay_span
        return round(peak_price + slope * days_into_decay, 2)


def _days_until_peak(peak_day: int, days_since_reference: int) -> int:
    """Days until the unique hits its peak (negative if already past peak).

    Returns 0 during the AT_PEAK window (peak_day ≤ days ≤ peak_day + 1).
    Negative value = days since the peak window ended.
    """
    if days_since_reference < peak_day:
        return peak_day - days_since_reference
    elif days_since_reference <= peak_day + 1:
        return 0
    else:
        return days_since_reference - (peak_day + 1)


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------


def compute_leveling_uniques_lifecycle(
    phase: LeaguePhase,
    days_since_reference: int,
    *,
    reference_currency: str = "",
    league_name: str = "",
    now: datetime | None = None,
    lang: str = "en",
) -> dict[str, Any]:
    """Build the leveling-uniques lifecycle response.

    Args:
        phase: Current league phase (EARLY / MID / LATE) from PhaseDetector.
        days_since_reference: Days since league start or last major patch.
        reference_currency: Reference currency for the phase (e.g. "exalted"
            for EARLY, "divine" for MID/LATE). Empty string if unknown.
        league_name: League name from config (for display only).
        now: Optional override for "today" (for tests). Defaults to UTC now.
        lang: Locale code — "ru" returns the parallel Russian notes table
            (iter 100), anything else returns the default English notes.
            The unique ``id`` / ``name`` / ``name_ru`` / ``category`` /
            ``peak_day`` / ``peak_price_exalted`` / ``decay_pct`` / ``pattern``
            fields are identical across locales, so the frontend can safely
            switch tables by locale. The ``name_ru`` field is a curated static
            field (iter 150) — it is NOT locale-sensitive (returned for both
            ``lang=en`` and ``lang=ru``). The frontend picks ``name_ru`` vs
            ``name`` at render time based on its own locale state.

    Returns:
        Dict with shape:
            {
                "league": str,
                "phase": str,                     # "early" | "mid" | "late"
                "days_since_reference": int,
                "current_day": int,               # alias for days_since_reference
                "reference_currency": str,
                "uniques": [
                    {
                        "id": str,
                        "name": str,               # EN display name
                        "name_ru": str | None,     # curated RU name (iter 150), None if no poe2db RU
                        "category": str,
                        "peak_day": int,
                        "peak_price_exalted": float,
                        "decay_pct": float,
                        "pattern": str,           # always "SPIKE_THEN_CRASH"
                        "current_lifecycle_stage": str,  # PRE_PEAK | AT_PEAK | POST_PEAK
                        "recommendation": str,    # BUY_OR_HOLD | SELL_NOW | AVOID_BUYING
                        "estimated_current_price_exalted": float,
                        "days_until_peak": int,   # 0 during AT_PEAK, negative post-peak
                        "notes": str,             # localized via ?lang=
                    },
                    ...
                ],
                "data_available": bool,           # always True (hardcoded table)
                "fetched_at": str (ISO 8601),
            }
    """
    today = now or datetime.now(timezone.utc)

    # Defensive: days_since_reference can be negative if the league_start_datetime
    # is in the future (e.g. config not yet updated for a new league). Clamp to 0.
    days_safe = max(0, int(days_since_reference))

    uniques_out: list[dict[str, Any]] = []
    for entry in _LEVELING_UNIQUES:
        peak_day = int(entry["peak_day"])
        peak_price = float(entry["peak_price_exalted"])
        decay_pct = float(entry["decay_pct"])

        stage = _lifecycle_stage(peak_day, days_safe)
        rec = _recommendation(stage)
        est_price = _estimate_current_price(
            peak_price, decay_pct, peak_day, days_safe
        )
        days_until = _days_until_peak(peak_day, days_safe)

        # Pick the localized notes — RU table only translates ``notes``.
        if lang == "ru":
            notes = _LEVELING_UNIQUES_NOTES_RU.get(entry["id"], entry["notes"])
        else:
            notes = entry["notes"]

        uniques_out.append({
            "id": entry["id"],
            "name": entry["name"],
            "name_ru": entry.get("name_ru"),
            "category": entry["category"],
            "peak_day": peak_day,
            "peak_price_exalted": peak_price,
            "decay_pct": decay_pct,
            "pattern": entry["pattern"],
            "current_lifecycle_stage": stage,
            "recommendation": rec,
            "estimated_current_price_exalted": est_price,
            "days_until_peak": days_until,
            "notes": notes,
        })

    return {
        "league": league_name,
        "phase": phase.value,
        "days_since_reference": days_safe,
        "current_day": days_safe,
        "reference_currency": reference_currency,
        "uniques": uniques_out,
        "data_available": True,
        "fetched_at": today.isoformat(),
    }


# ---------------------------------------------------------------------------
# Helpers exposed for tests
# ---------------------------------------------------------------------------


def list_leveling_uniques() -> list[dict[str, Any]]:
    """Return the static leveling-uniques table (defensive copy).

    Used by tests to verify table integrity (e.g. all entries have required
    fields, peak_day is in [1, 14], decay_pct is in [0, 100]).
    """
    return [dict(entry) for entry in _LEVELING_UNIQUES]


def leveling_unique_count() -> int:
    """Return the number of leveling uniques in the static table."""
    return len(_LEVELING_UNIQUES)
