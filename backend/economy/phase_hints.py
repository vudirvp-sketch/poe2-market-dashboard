"""
Phase-aware hints — Temporalis / skill gems / Breach catalysts / etc. (F6).

Implements PRODUCT_VISION.md §3.4. The dashboard must automatically surface
which league-mechanic patterns are likely to be active right now, based on
the current league phase (EARLY / MID / LATE) detected by `PhaseDetector`.

Design
------
This module is a **pure function** (no I/O, no side effects). It takes a
`PhaseInfo` (or just `phase` + `days_since_reference`) and returns a dict
with the current phase + a list of phase-relevant hints. The route handler
in `routes_phase_hints.py` is a thin wrapper that fetches the snapshot,
calls `PhaseDetector.get_phase_info()`, and forwards the result here.

The hint table is hardcoded — it documents well-known PoE2 league-lifecycle
patterns that hold across leagues (per PRODUCT_VISION §3.4):

| Phase   | Pattern                                                |
|---------|--------------------------------------------------------|
| EARLY   | Quick flips on Chaos/Exalted, base currency is volatile |
| EARLY   | Skill gems 1-17 lvl abundant, low demand                |
| EARLY   | Vault keys cheap — players still leveling               |
| MID     | Skill gems 18-20 lvl demand rising (builds stabilizing) |
| MID     | Temporalis price rising — first wave of buyers          |
| MID     | Breach/Ritual catalysts in equilibrium                  |
| LATE    | Temporalis near peak — sell into strength               |
| LATE    | Ritual/Breach catalysts may be scarce if volume dropped  |
| LATE    | Vault keys usually cheap — market saturated             |

These patterns are **advisory** — they're surfaced as a static banner so
the user knows what to look out for, NOT as automated buy/sell signals.
The actual quantitative signals come from F5 Speculation (z-score) and
F4 Content Pulse (volume deltas). This module complements those by
providing phase-aware *context* — "right now is a good time to check X".

iter 110 — P9 Phase-aware Investment Advisor (live-price binding)
-----------------------------------------------------------------
The hint table is now optionally enriched with **live price metrics** when
a `DataSnapshot` is passed to `get_phase_hints()`. Each hint may declare a
`tracked_currency` (an api_id like "exalted" / "divine") — when the
snapshot contains price history for that currency, the hint is enriched
with:

- ``current_price``     — most recent price in base currency (Exalted)
- ``change_pct_week``   — signed % change over ~7d (None when <7d history)
- ``change_pct_month``  — signed % change over ~30d (None when <30d history)
- ``momentum``          — "UP" (≥+5%) | "DOWN" (≤-5%) | "FLAT" (between)
- ``recommendation``    — phase-aware: BUY_OPPORTUNITY / HOLD / WATCH /
                          SELL_INTO_STRENGTH / SELL_NOW / NEUTRAL

When `snapshot` is None (the default), or the tracked currency has no
price data, these fields are absent and the hint renders as before
(static-only). This preserves backward compatibility — all 58 pre-iter-110
tests remain green without modification.

**Recommendation matrix** (phase × momentum):

| Phase | UP            | DOWN              | FLAT     |
|-------|---------------|-------------------|----------|
| EARLY | HOLD          | BUY_OPPORTUNITY   | WATCH    |
| MID   | HOLD          | WATCH             | NEUTRAL  |
| LATE  | SELL_INTO_STRENGTH | SELL_NOW      | NEUTRAL  |

Rationale: in EARLY league, a price dip is a buying opportunity (the
currency will recover as the league matures). In LATE league, a price
spike is a sell signal (sell into strength before the league ends). MID
is hold-and-watch. This mirrors the playbook's lifecycle narrative.

**Tracked currencies (iter 110):** only 3 of 12 hints declare a
`tracked_currency` — the major reference currencies we are confident are
in the snapshot ("exalted", "divine"). Hints about unique items
(Temporalis) or category-level items (vault keys, breach catalysts) are
left untracked because their api_ids are not reliably in the currency
snapshot. Future iterations can extend coverage.

Future extension
----------------
- Pull hints from `config.yaml` instead of hardcoding them.
- Add per-pattern metrics for ALL hints (not just tracked ones).
- Filter hints based on actual market state (e.g. only show "Temporalis
  near peak" if its 7d momentum is positive).

For iter 78 we shipped the MVP: hardcoded hint table + static info banner.
For iter 110 we add live-price binding for 3 tracked hints (P9).
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, TYPE_CHECKING

from backend.models.currency import LeaguePhase

if TYPE_CHECKING:
    from backend.api.data_snapshot import DataSnapshot

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Tunable constants — iter 110 live-price enrichment
# ---------------------------------------------------------------------------

MOMENTUM_UP_THRESHOLD_PCT: float = 5.0
"""% change over 7d at or above which momentum is "UP"."""

MOMENTUM_DOWN_THRESHOLD_PCT: float = -5.0
"""% change over 7d at or below which momentum is "DOWN"."""

CHANGE_WEEK_DAYS: int = 7
"""Lookback for change_pct_week."""

CHANGE_MONTH_DAYS: int = 30
"""Lookback for change_pct_month."""

NEAREST_PRICE_TOLERANCE_HOURS: float = 24.0
"""Tolerance for matching a historical price to (now - N days).
Matches the convention in storage_value_history.py and mirror_divine_arb.py."""


# ---------------------------------------------------------------------------
# Recommendation enum-like constants (iter 110)
# ---------------------------------------------------------------------------

REC_BUY_OPPORTUNITY: str = "BUY_OPPORTUNITY"
"""EARLY + DOWN — price dipping in early league = good entry point."""

REC_HOLD: str = "HOLD"
"""EARLY/MID + UP — let the trend ride."""

REC_WATCH: str = "WATCH"
"""EARLY + FLAT or MID + DOWN — potential movement, monitor."""

REC_SELL_INTO_STRENGTH: str = "SELL_INTO_STRENGTH"
"""LATE + UP — sell into the rally before league ends."""

REC_SELL_NOW: str = "SELL_NOW"
"""LATE + DOWN — exit before further decline."""

REC_NEUTRAL: str = "NEUTRAL"
"""MID/LATE + FLAT — no clear signal."""


# ---------------------------------------------------------------------------
# Hint table — keyed by phase. Each hint has:
#   - "id":                stable slug for tests / future metric linkage
#   - "title":             short label
#   - "detail":            one-sentence explanation
#   - "action":            what the user should do (imperative)
#   - "category":          optional POE2Scout category slug for future cross-ref
#   - "tracked_currency":  optional api_id for live-price binding (iter 110).
#                          Empty string = untracked hint (static only).
#
# Order matters — hints are rendered top-to-bottom in the UI.
# ---------------------------------------------------------------------------

_PHASE_HINTS: dict[LeaguePhase, list[dict[str, str]]] = {
    LeaguePhase.EARLY: [
        {
            "id": "early-quick-flips",
            "title": "Quick flips on Chaos / Exalted",
            "detail": (
                "Base currency is highly volatile in the first 2 weeks — "
                "spreads are wide and arbitrage windows close in hours, not days."
            ),
            "action": "Focus on high-volume pairs; hold times ≤ 2 hours.",
            "category": "currency",
            "tracked_currency": "exalted",
        },
        {
            "id": "early-skill-gems-low-demand",
            "title": "Skill gems 1-17 lvl — low demand",
            "detail": (
                "Players are still leveling; demand for endgame gems hasn't "
                "kicked in yet. Prices for 18-20 lvl gems will rise in MID phase."
            ),
            "action": "Stockpile 18-20 lvl gems if you find them cheap.",
            "category": "uncutgems",
            "tracked_currency": "",
        },
        {
            "id": "early-vault-keys-cheap",
            "title": "Reliquary keys are cheap",
            "detail": (
                "Most players haven't reached endgame content yet — vault keys "
                "are abundant and underpriced. Prices usually rise MID then fall LATE."
            ),
            "action": "Buy keys for personal use; do not hoard for resale yet.",
            "category": "vaultkeys",
            "tracked_currency": "",
        },
        {
            "id": "early-temporalis-floor",
            "title": "Temporalis near price floor",
            "detail": (
                "Temporalis (chase unique) prices are typically at their lowest "
                "in the first 2 weeks as early finders undercut each other."
            ),
            "action": "If you have liquid currency, watch for sub-200c listings.",
            "category": "",
            "tracked_currency": "",
        },
    ],
    LeaguePhase.MID: [
        {
            "id": "mid-skill-gems-18-20",
            "title": "Skill gems 18-20 lvl — demand rising",
            "detail": (
                "Builds are stabilizing and players are min-maxing — demand for "
                "high-level skill gems typically peaks in MID phase."
            ),
            "action": "List 18-20 lvl gems at market; check z-score in Speculation tab.",
            "category": "uncutgems",
            "tracked_currency": "",
        },
        {
            "id": "mid-temporalis-rising",
            "title": "Temporalis price rising",
            "detail": (
                "First wave of dedicated farmers reaches endgame — Temporalis "
                "prices typically climb through MID phase as supply tightens."
            ),
            "action": "Hold Temporalis if you have it; do not sell into weakness yet.",
            "category": "",
            "tracked_currency": "",
        },
        {
            "id": "mid-triangular-arb",
            "title": "Triangular arbitrage window",
            "detail": (
                "Mid-league has the deepest liquidity across all currency tiers — "
                "spreads are tight enough for triangular arb to be profitable after fees."
            ),
            "action": "Check the Arbitrage → Triangular tab for 3-hop cycles.",
            "category": "currency",
            "tracked_currency": "divine",
        },
        {
            "id": "mid-breach-ritual-equilibrium",
            "title": "Breach / Ritual catalysts in equilibrium",
            "detail": (
                "Mechanic popularity is balanced — neither Breach nor Ritual "
                "catalysts are scarce. Prices track overall inflation."
            ),
            "action": "Watch Content Pulse for the first sign of volume divergence.",
            "category": "breach",
            "tracked_currency": "",
        },
    ],
    LeaguePhase.LATE: [
        {
            "id": "late-temporalis-peak",
            "title": "Temporalis near peak — sell into strength",
            "detail": (
                "Late-league is when Temporalis prices typically peak as "
                "completionist buyers enter the market. Sell if you've been holding."
            ),
            "action": "List Temporalis at market or slightly above; do not hold for next league.",
            "category": "",
            "tracked_currency": "",
        },
        {
            "id": "late-catalyst-scarcity",
            "title": "Ritual / Breach catalysts may be scarce",
            "detail": (
                "If Content Pulse shows volume dropping in Ritual / Breach, "
                "catalysts (Xoph's, Omni Rune, etc.) are likely in deficit — "
                "prices rise as supply shrinks."
            ),
            "action": "Check Content Pulse + Speculation tab for SELL signals on catalysts.",
            "category": "breach",
            "tracked_currency": "",
        },
        {
            "id": "late-vault-keys-saturated",
            "title": "Vault keys — market saturated",
            "detail": (
                "By late league most players have run their keys; the market is "
                "flooded and prices usually grind down toward vendor floor."
            ),
            "action": "Do not hoard vault keys for resale. Use them or convert now.",
            "category": "vaultkeys",
            "tracked_currency": "",
        },
        {
            "id": "late-portfolio-hold",
            "title": "Portfolio holding (risk parity)",
            "detail": (
                "Late-league spreads on quick flips narrow to unprofitability. "
                "Switch to portfolio holding: store value in Divine / Mirror / Hinekora."
            ),
            "action": "Use the Storage Value tab to pick the best store-of-value currency.",
            "category": "",
            "tracked_currency": "divine",
        },
    ],
}


# ---------------------------------------------------------------------------
# Russian parallel table (iter 87 — i18n leakage fix).
# Same `id`/`category`/`tracked_currency` keys so the frontend can swap tables
# by locale without losing the stable slugs used for tests + metric linkage.
# ---------------------------------------------------------------------------

_PHASE_HINTS_RU: dict[LeaguePhase, list[dict[str, str]]] = {
    LeaguePhase.EARLY: [
        {
            "id": "early-quick-flips",
            "title": "Быстрые флипы на Хаосе / Благородных",
            "detail": (
                "Базовая валюта максимально волатильна в первые 2 недели — "
                "спреды широкие, арбитражные окна закрываются за часы, не дни."
            ),
            "action": "Фокусируйтесь на высокообъёмных парах; время удержания ≤ 2 часа.",
            "category": "currency",
            "tracked_currency": "exalted",
        },
        {
            "id": "early-skill-gems-low-demand",
            "title": "Камни умений 1-17 ур. — низкий спрос",
            "detail": (
                "Игроки ещё прокачиваются; спрос на эндгейм-камни ещё не вырос. "
                "Цены на камни 18-20 ур. поднимутся в MID-фазе."
            ),
            "action": "Скупайте камни 18-20 ур., если нашли дёшево.",
            "category": "uncutgems",
            "tracked_currency": "",
        },
        {
            "id": "early-vault-keys-cheap",
            "title": "Ключи реликвария дешёвые",
            "detail": (
                "Большинство игроков ещё не дошли до эндгейм-контента — ключей "
                "много и они недооценены. Цены обычно растут в MID, падают в LATE."
            ),
            "action": "Покупайте ключи для личного использования; не копите на перепродажу.",
            "category": "vaultkeys",
            "tracked_currency": "",
        },
        {
            "id": "early-temporalis-floor",
            "title": "Temporalis у ценового дна",
            "detail": (
                "Цены на Temporalis (чейс-уник) обычно на минимуме в первые "
                "2 недели, пока ранние находчики демпингуют друг друга."
            ),
            "action": "Если есть ликвидная валюта — следите за листами ниже 200с.",
            "category": "",
            "tracked_currency": "",
        },
    ],
    LeaguePhase.MID: [
        {
            "id": "mid-skill-gems-18-20",
            "title": "Камни умений 18-20 ур. — спрос растёт",
            "detail": (
                "Билды стабилизируются, игроки занимаются мин-максом — спрос "
                "на высокоуровневые камни обычно пиковый в MID-фазе."
            ),
            "action": "Выставляйте камни 18-20 ур. по рынку; проверьте z-score во вкладке Спекуляции.",
            "category": "uncutgems",
            "tracked_currency": "",
        },
        {
            "id": "mid-temporalis-rising",
            "title": "Цена Temporalis растёт",
            "detail": (
                "Первая волна целенаправленных фармилок доходит до эндгейма — "
                "цена Temporalis обычно растёт через MID-фазу по мере ужесточения предложения."
            ),
            "action": "Держите Temporalis если он у вас есть; пока не продавайте на слабости.",
            "category": "",
            "tracked_currency": "",
        },
        {
            "id": "mid-triangular-arb",
            "title": "Окно треугольного арбитража",
            "detail": (
                "В середине лиги самая глубокая ликвидность по всем тирам валют — "
                "спреды достаточно узкие, чтобы треугольный арбитраж был прибыльным после комиссий."
            ),
            "action": "Проверьте вкладку Арбитраж → Треугольный для 3-хоп циклов.",
            "category": "currency",
            "tracked_currency": "divine",
        },
        {
            "id": "mid-breach-ritual-equilibrium",
            "title": "Катализаторы Разлома / Ритуала в равновесии",
            "detail": (
                "Популярность механик сбалансирована — ни катализаторы Разлома, "
                "ни Ритуала не в дефиците. Цены следуют за общей инфляцией."
            ),
            "action": "Следите за Content Pulse для первого признака расхождения объёмов.",
            "category": "breach",
            "tracked_currency": "",
        },
    ],
    LeaguePhase.LATE: [
        {
            "id": "late-temporalis-peak",
            "title": "Temporalis у пика — продавайте на силе",
            "detail": (
                "Конец лиги — когда цена Temporalis обычно достигает пика, "
                "т.к. выходят коллекционеры. Продавайте, если держали."
            ),
            "action": "Выставляйте Temporalis по рынку или чуть выше; не держите до следующей лиги.",
            "category": "",
            "tracked_currency": "",
        },
        {
            "id": "late-catalyst-scarcity",
            "title": "Катализаторы Ритуала / Разлома могут быть в дефиците",
            "detail": (
                "Если Content Pulse показывает падение объёмов в Ритуале / Разломе, "
                "катализаторы (Ксофа, Omni Rune и т.д.) вероятно в дефиците — "
                "цены растут по мере сокращения предложения."
            ),
            "action": "Проверьте Content Pulse + Спекуляции для SELL-сигналов по катализаторам.",
            "category": "breach",
            "tracked_currency": "",
        },
        {
            "id": "late-vault-keys-saturated",
            "title": "Ключи реликвария — рынок насыщен",
            "detail": (
                "К концу лиги большинство игроков уже открыли ключи; рынок "
                "затоварен и цены обычно сползают к вендинговому минимуму."
            ),
            "action": "Не копите ключи на перепродажу. Используйте или конвертируйте сейчас.",
            "category": "vaultkeys",
            "tracked_currency": "",
        },
        {
            "id": "late-portfolio-hold",
            "title": "Удержание портфеля (parity рисков)",
            "detail": (
                "Спреды на быстрые флипы в конце лиги сужаются до убыточности. "
                "Переходите к удержанию портфеля: храните ценность в Divine / Mirror / Hinekora."
            ),
            "action": "Используйте вкладку Ценность хранения для выбора лучшей валюты.",
            "category": "",
            "tracked_currency": "divine",
        },
    ],
}


# ---------------------------------------------------------------------------
# Phase metadata — for the banner header
# ---------------------------------------------------------------------------

_PHASE_META: dict[LeaguePhase, dict[str, str]] = {
    LeaguePhase.EARLY: {
        "label": "Early League",
        "summary": (
            "First 2 weeks since league start or major patch. High volatility, "
            "wide spreads, abundant opportunities for quick flips."
        ),
    },
    LeaguePhase.MID: {
        "label": "Mid League",
        "summary": (
            "Weeks 3-6. Liquidity deepens, spreads tighten. Best window for "
            "triangular arbitrage and scaling into high-level skill gems."
        ),
    },
    LeaguePhase.LATE: {
        "label": "Late League",
        "summary": (
            "Week 7+. Spreads narrow, quick flips become unprofitable. Switch "
            "to portfolio holding and watch for sell-signals on chase uniques."
        ),
    },
}

# Russian parallel metadata (iter 87).
_PHASE_META_RU: dict[LeaguePhase, dict[str, str]] = {
    LeaguePhase.EARLY: {
        "label": "Ранняя лига",
        "summary": (
            "Первые 2 недели с момента старта лиги или крупного патча. "
            "Высокая волатильность, широкие спреды, много возможностей для быстрых флипов."
        ),
    },
    LeaguePhase.MID: {
        "label": "Середина лиги",
        "summary": (
            "Недели 3-6. Ликвидность углубляется, спреды сужаются. Лучшее окно "
            "для треугольного арбитража и накопления высокоуровневых камней умений."
        ),
    },
    LeaguePhase.LATE: {
        "label": "Конец лиги",
        "summary": (
            "Неделя 7+. Спреды сужаются, быстрые флипы становятся убыточными. "
            "Переходите к удержанию портфеля и следите за сигналами на продажу чейс-уников."
        ),
    },
}


# ---------------------------------------------------------------------------
# Live-price enrichment helpers (iter 110 — P9)
# ---------------------------------------------------------------------------

def _find_price_near(
    history: list,
    target_ts: datetime,
    *,
    tolerance_hours: float = NEAREST_PRICE_TOLERANCE_HOURS,
) -> float | None:
    """Find the price closest to ``target_ts`` in ``history``.

    Reuses the same nearest-neighbour-with-tolerance convention as
    ``storage_value_history._find_nearest_price`` and
    ``mirror_divine_arb._extract_rate_series`` — 24h tolerance by default.

    Args:
        history: List of PricePoint-like objects (``.timestamp``, ``.price``).
        target_ts: The timestamp to match.
        tolerance_hours: Max acceptable gap. Defaults to 24h.

    Returns:
        The closest price within tolerance, or None.
    """
    if not history:
        return None

    best_price: float | None = None
    best_delta = timedelta.max
    tolerance = timedelta(hours=tolerance_hours)

    for point in history:
        try:
            delta = abs(point.timestamp - target_ts)
        except (TypeError, AttributeError):
            continue
        if delta < best_delta:
            best_delta = delta
            best_price = point.price

    if best_delta > tolerance or best_price is None:
        return None
    try:
        return float(best_price)
    except (TypeError, ValueError):
        return None


def _compute_change_pct(
    current_price: float,
    history: list,
    days: int,
    now: datetime,
    *,
    tolerance_hours: float = NEAREST_PRICE_TOLERANCE_HOURS,
) -> float | None:
    """Compute signed % change over the last ``days`` days.

    Finds the price nearest to (now - days) within tolerance, then computes
    ``(current - old) / old * 100``. Returns None when no historical price
    is within tolerance (i.e. the history is shorter than ``days``).

    Args:
        current_price: The current price (must be > 0).
        history: Price history list (PricePoint-like).
        days: Lookback window in days.
        now: Reference "now" timestamp.
        tolerance_hours: Nearest-neighbour tolerance.

    Returns:
        Signed % change (e.g. +12.5 for a 12.5% rise), or None.
    """
    if not history or current_price <= 0:
        return None
    target_ts = now - timedelta(days=days)
    old_price = _find_price_near(history, target_ts, tolerance_hours=tolerance_hours)
    if old_price is None or old_price <= 0:
        return None
    return (current_price - old_price) / old_price * 100.0


def _momentum_from_change(change_pct_week: float | None) -> str | None:
    """Classify 7d change into UP / DOWN / FLAT.

    - ``UP``   — change ≥ +5%
    - ``DOWN`` — change ≤ -5%
    - ``FLAT`` — change in (-5%, +5%)
    - ``None`` — when change_pct_week is None (insufficient data)
    """
    if change_pct_week is None:
        return None
    if change_pct_week >= MOMENTUM_UP_THRESHOLD_PCT:
        return "UP"
    if change_pct_week <= MOMENTUM_DOWN_THRESHOLD_PCT:
        return "DOWN"
    return "FLAT"


def _recommendation_from_phase_momentum(
    phase: LeaguePhase,
    momentum: str | None,
) -> str | None:
    """Phase-aware recommendation from phase + momentum.

    See the recommendation matrix in the module docstring:
    | Phase | UP                 | DOWN            | FLAT     |
    |-------|--------------------|-----------------|----------|
    | EARLY | HOLD               | BUY_OPPORTUNITY | WATCH    |
    | MID   | HOLD               | WATCH           | NEUTRAL  |
    | LATE  | SELL_INTO_STRENGTH | SELL_NOW        | NEUTRAL  |

    Returns None when momentum is None (no 7d data to base a call on).
    """
    if momentum is None:
        return None
    if phase is LeaguePhase.EARLY:
        if momentum == "UP":
            return REC_HOLD
        if momentum == "DOWN":
            return REC_BUY_OPPORTUNITY
        return REC_WATCH
    if phase is LeaguePhase.MID:
        if momentum == "UP":
            return REC_HOLD
        if momentum == "DOWN":
            return REC_WATCH
        return REC_NEUTRAL
    if phase is LeaguePhase.LATE:
        if momentum == "UP":
            return REC_SELL_INTO_STRENGTH
        if momentum == "DOWN":
            return REC_SELL_NOW
        return REC_NEUTRAL
    # Unknown phase — no recommendation
    return None


def _enrich_hint_with_live_price(
    hint: dict[str, Any],
    snapshot: "DataSnapshot",
    phase: LeaguePhase,
    *,
    now: datetime,
) -> None:
    """Enrich a single hint dict with live-price fields (in-place).

    Reads ``hint["tracked_currency"]`` (an api_id). When it's empty or the
    snapshot has no data for that currency, the hint is left unchanged
    (no live fields added). Otherwise adds:
        - ``current_price``     (float | None)
        - ``change_pct_week``   (float | None — 7d signed % change)
        - ``change_pct_month``  (float | None — 30d signed % change)
        - ``momentum``          (str | None — "UP" / "DOWN" / "FLAT")
        - ``recommendation``    (str | None — phase-aware recommendation)

    The enrichment is **additive** — existing hint fields (id, title, detail,
    action, category, tracked_currency) are never modified. When data is
    missing, the live fields are set to None so the pydantic model + TS type
    always see the same shape (simpler frontend logic).
    """
    tracked = hint.get("tracked_currency", "")
    # Always set the live fields so the response shape is consistent.
    # Default to None — overwritten below if data is available.
    hint.setdefault("current_price", None)
    hint.setdefault("change_pct_week", None)
    hint.setdefault("change_pct_month", None)
    hint.setdefault("momentum", None)
    hint.setdefault("recommendation", None)

    if not tracked:
        return

    try:
        history = snapshot.get_price_history(tracked)
    except (AttributeError, TypeError):
        history = []

    try:
        current_price = snapshot.get_current_price(tracked)
    except (AttributeError, TypeError):
        current_price = None

    if current_price is None or not history:
        return

    try:
        current_price = float(current_price)
    except (TypeError, ValueError):
        return
    if current_price <= 0:
        return

    hint["current_price"] = current_price
    hint["change_pct_week"] = _compute_change_pct(
        current_price, history, CHANGE_WEEK_DAYS, now
    )
    hint["change_pct_month"] = _compute_change_pct(
        current_price, history, CHANGE_MONTH_DAYS, now
    )
    hint["momentum"] = _momentum_from_change(hint["change_pct_week"])
    hint["recommendation"] = _recommendation_from_phase_momentum(
        phase, hint["momentum"]
    )


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def get_phase_hints(
    phase: LeaguePhase,
    days_since_reference: int,
    *,
    reference_currency: str = "",
    league_name: str = "",
    now: datetime | None = None,
    lang: str = "en",
    snapshot: "DataSnapshot | None" = None,
) -> dict[str, Any]:
    """Build the phase-aware hints response.

    Args:
        phase: Current league phase (EARLY / MID / LATE) from PhaseDetector.
        days_since_reference: Days since league start or last major patch.
        reference_currency: Reference currency for the phase (e.g. "exalted"
            for EARLY, "divine" for MID/LATE). Empty string if unknown.
        league_name: League name from config (for display only).
        now: Optional override for "today" (for tests). Defaults to UTC now.
        lang: Locale code — "ru" returns the parallel Russian hint table
            (iter 87), anything else returns the default English table.
            The hint `id` / `category` / `tracked_currency` slugs are
            identical across locales, so the frontend can safely switch
            tables by locale.
        snapshot: Optional DataSnapshot for live-price enrichment (iter 110).
            When provided, each hint with a non-empty ``tracked_currency``
            is enriched with ``current_price`` / ``change_pct_week`` /
            ``change_pct_month`` / ``momentum`` / ``recommendation``.
            When None (the default), hints are returned static-only
            (backward-compatible with pre-iter-110 callers).

    Returns:
        Dict with shape:
            {
                "league": str,
                "phase": str,                     # "early" | "mid" | "late"
                "phase_label": str,               # "Early League" etc.
                "days_since_reference": int,
                "reference_currency": str,
                "phase_summary": str,             # 1-2 sentence phase overview
                "hints": [
                    {
                        "id": str,                # stable slug
                        "title": str,
                        "detail": str,
                        "action": str,
                        "category": str,          # "" if no specific category
                        "tracked_currency": str,  # "" if untracked (iter 110)
                        # --- live-price fields (iter 110, only present when
                        #     snapshot was passed AND hint has a tracked
                        #     currency). When snapshot is None these keys
                        #     are absent (backward-compat). ---
                        "current_price": float | None,
                        "change_pct_week": float | None,   # 7d signed %
                        "change_pct_month": float | None,  # 30d signed %
                        "momentum": str | None,            # UP/DOWN/FLAT
                        "recommendation": str | None,      # phase-aware rec
                    },
                    ...
                ],
                "data_available": bool,           # always True (hardcoded table)
                "fetched_at": str (ISO 8601),
            }
    """
    today = now or datetime.now(timezone.utc)
    if lang == "ru":
        hints_table = _PHASE_HINTS_RU
        meta_table = _PHASE_META_RU
        fallback_meta = {"label": "Неизвестная фаза", "summary": "Фаза лиги не определена."}
    else:
        hints_table = _PHASE_HINTS
        meta_table = _PHASE_META
        fallback_meta = {"label": "Unknown Phase", "summary": "League phase could not be determined."}
    meta = meta_table.get(phase, fallback_meta)
    # Deep-copy each hint dict so we never mutate the module-level table.
    hints = [dict(h) for h in hints_table.get(phase, [])]

    # iter 110: enrich tracked hints with live prices when snapshot is provided.
    if snapshot is not None:
        for hint in hints:
            _enrich_hint_with_live_price(hint, snapshot, phase, now=today)

    return {
        "league": league_name,
        "phase": phase.value,
        "phase_label": meta["label"],
        "days_since_reference": int(days_since_reference),
        "reference_currency": reference_currency,
        "phase_summary": meta["summary"],
        "hints": hints,
        "data_available": True,
        "fetched_at": today.isoformat(),
    }


# ---------------------------------------------------------------------------
# Helpers exposed for tests
# ---------------------------------------------------------------------------

def list_phases_with_hints() -> list[LeaguePhase]:
    """Return the list of phases that have at least one hint defined."""
    return [p for p in LeaguePhase if _PHASE_HINTS.get(p)]


def hint_count_for_phase(phase: LeaguePhase) -> int:
    """Return the number of hints defined for a given phase."""
    return len(_PHASE_HINTS.get(phase, []))


def list_tracked_hints() -> list[tuple[LeaguePhase, str, str]]:
    """Return ``(phase, hint_id, tracked_currency)`` for every hint that
    declares a non-empty ``tracked_currency``.

    Exposed for tests so we can verify the iter-110 live-binding coverage
    without hardcoding the ids in the test file.
    """
    out: list[tuple[LeaguePhase, str, str]] = []
    for phase in LeaguePhase:
        for hint in _PHASE_HINTS.get(phase, []):
            tracked = hint.get("tracked_currency", "")
            if tracked:
                out.append((phase, hint["id"], tracked))
    return out
