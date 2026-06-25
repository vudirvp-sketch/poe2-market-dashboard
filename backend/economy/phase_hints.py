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

Future extension
----------------
- Pull hints from `config.yaml` instead of hardcoding them.
- Add per-pattern metrics (e.g. "Temporalis price +X% over last 7d") by
  cross-referencing the snapshot's `price_histories`.
- Filter hints based on actual market state (e.g. only show "Temporalis
  near peak" if its 7d momentum is positive).

For iter 78 we ship the MVP: hardcoded hint table + static info banner.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from backend.models.currency import LeaguePhase

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Hint table — keyed by phase. Each hint has:
#   - "id":         stable slug for tests / future metric linkage
#   - "title":      short label
#   - "detail":     one-sentence explanation
#   - "action":     what the user should do (imperative)
#   - "category":   optional POE2Scout category slug for future cross-ref
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
        },
    ],
}


# ---------------------------------------------------------------------------
# Russian parallel table (iter 87 — i18n leakage fix).
# Same `id`/`category` keys so the frontend can swap tables by locale without
# losing the stable slugs used for tests + future metric linkage.
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
            The hint `id` / `category` slugs are identical across locales,
            so the frontend can safely switch tables by locale.

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
    hints = list(hints_table.get(phase, []))

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
