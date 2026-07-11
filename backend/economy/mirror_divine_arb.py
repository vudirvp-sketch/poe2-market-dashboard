"""
Mirror/Divine Arbitrage Detector (P7).

Implements the pattern described in docs/MARKET_PLAYBOOK.md §P7 (Mirror ↔
Divine arbitrage on chase uniques). The detector analyses the historical
Mirror:Divine exchange rate and flags windows where the rate deviates far
enough from its rolling mean to make a "swap-then-swap-back" arbitrage
profitable for items priced at ≥ 1 Mirror.

Pattern recap (from the video guide)
------------------------------------
For chase uniques (1+ Mirror): sell for 1 Mirror → buy back for Divines
(or vice versa) → 100–200 Div profit from Mirror:Divine rate swings.

Example: bought 49% Adored for 8700 Div → sold for 2 Mirror → sold 2
Mirror for 9200 Div (+500 Div).

What this module computes
-------------------------
Given a DataSnapshot, we look up the price histories of `mirror` and
`divine` in base currency (typically Exalted). For each timestamp in the
mirror history we find the nearest divine price (24h tolerance — same
convention as `storage_value_history.py`) and compute the
`mirror_price / divine_price` rate. We then aggregate the rate series
over the lookback window:

- ``current_rate``  — most recent rate in the window (Div per Mirror)
- ``mean_rate``     — historical mean of the rate
- ``std_rate``      — historical std (ddof=1) of the rate
- ``min_rate`` /
  ``max_rate``      — observed range
- ``z_score``       — ``(current - mean) / std`` (None when std == 0)
- ``deviation_pct`` — signed ``(current - mean) / mean * 100``
- ``profit_potential_per_mirror_div`` — ``|current - mean|`` in Div units
- ``signal``        — ``SELL_MIRROR_BUY_DIVINE`` (z ≥ Z_SELL) /
                      ``SELL_DIVINE_BUY_MIRROR`` (z ≤ Z_BUY) /
                      ``NEUTRAL``
- ``is_actionable`` — ``profit_potential_per_mirror_div ≥
                      PROFIT_THRESHOLD_DIV``
- ``recommended_action`` — ``EXECUTE_ARB`` (actionable AND |z| ≥
                            Z_SELL) / ``WATCH`` (actionable AND |z| ∈
                            [Z_WATCH, Z_SELL)) / ``HOLD`` (not actionable)
- ``price_history_short`` — up to 14 most-recent rate points (oldest-first)
                            for UI sparkline, ``{"date", "rate"}`` dicts.

Tunable constants live at the top of this module (same convention as
``circuit_patterns.py`` and ``speculation.py``): they are analysis
thresholds, not deployment parameters.

This module is pure-function: it takes a DataSnapshot + AppConfig and
returns a dict. The route handler (``routes_mirror_divine_arb.py``) is a
thin wrapper. This separation makes the logic testable without spinning
up FastAPI.

Design notes
------------
- We reuse the existing `_find_nearest_price` helper from
  ``storage_value_history.py`` rather than duplicating the nearest-
  neighbour logic. The 24h tolerance matches the storage-value history
  chart so the two views of the data stay consistent.
- The detector emits a single record (Mirror:Divine is one market), not
  a per-currency list. The shape of the response is therefore a flat
  object rather than ``{patterns: [...]}``.
- We DO NOT attempt to compute "implied" Mirror:Divine rates from item
  listings — POE2Scout does not expose per-item alt-currency pricing.
  The detector is purely about the *rate itself* swinging away from
  its historical mean. The actionable interpretation ("sell item for
  Mirror, convert Mirror → Divines, buy back the item for Divines")
  lives in the UI / playbook.
- ``MIN_SAMPLE_SIZE`` is set to 4 (same as ``circuit_patterns.py``):
  below 4 rate points the mean/std are too noisy to trust a z-score.
- ``PROFIT_THRESHOLD_DIV = 100.0`` matches the P7 playbook description
  ("when difference > 100 Div → flag"). Adjust here if the market
  regime shifts.
"""

from __future__ import annotations

import logging
import math
import statistics
from datetime import datetime, timedelta, timezone
from typing import Any

from backend.api.data_snapshot import DataSnapshot
from backend.economy.storage_value_history import (
    DEFAULT_MIRROR_API_ID,
    NEAREST_NEIGHBOR_TOLERANCE_HOURS,
    _find_nearest_price,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Tunable constants — kept here rather than in config.yaml because they are
# analysis thresholds, not deployment parameters. See module docstring.
# ---------------------------------------------------------------------------

DEFAULT_DIVINE_API_ID: str = "divine"
"""Default api_id for Divine Orb in the POE2Scout currency schema."""

DEFAULT_DAYS: int = 30
"""Default lookback window in days for the rate series."""

MAX_DAYS: int = 90
"""Maximum lookback window (matches historical_retention_days)."""

MIN_SAMPLE_SIZE: int = 4
"""Minimum number of rate points required to emit a signal.

Below 4 points the mean/std are dominated by noise — a single outlier
can swing the z-score arbitrarily. 4 = 3 returns, the bare minimum to
distinguish signal from noise (same threshold as circuit_patterns.py).
"""

PROFIT_THRESHOLD_DIV: float = 100.0
"""Minimum |current_rate - mean_rate| in Div per Mirror for the
opportunity to be considered "actionable".

100 Div matches the P7 playbook description ("when difference > 100 Div
→ flag"). At typical Mirror:Divine rates (~150-300 Div per Mirror), 100
Div is ~30-65% deviation — large enough to be a real arb window, not
just noise."""

Z_BUY_THRESHOLD: float = -1.5
"""Z-score below which the rate is "cheap" (Mirror undervalued vs Div).

Triggers ``SELL_DIVINE_BUY_MIRROR``: sell chase unique for Divines,
convert Divines → Mirror at favourable rate, rebuy unique later when
rate reverts. Mirrors the speculation.py BUY threshold convention
(z < -1.5 → BUY)."""

Z_SELL_THRESHOLD: float = 1.5
"""Z-score above which the rate is "expensive" (Mirror overvalued vs Div).

Triggers ``SELL_MIRROR_BUY_DIVINE``: sell chase unique for Mirror,
convert Mirror → Divines at favourable rate, rebuy unique later when
rate reverts. Mirrors the speculation.py SELL threshold convention
(z > +1.5 → SELL)."""

Z_WATCH_THRESHOLD: float = 1.0
"""Z-score magnitude at which the rate is "interesting but not yet
actionable". Used to escalate ``recommended_action`` from HOLD → WATCH
when the profit threshold is met but |z| is still below Z_SELL."""

MAX_HISTORY_POINTS: int = 14
"""Number of recent rate points to include in ``price_history_short``
for UI sparkline rendering. 14 = ~2 weeks of daily snapshots."""

SIGNAL_SELL_MIRROR_BUY_DIVINE: str = "SELL_MIRROR_BUY_DIVINE"
"""Signal: current rate is high (z ≥ Z_SELL). Sell item for Mirror,
convert Mirror → Divines at favourable rate."""

SIGNAL_SELL_DIVINE_BUY_MIRROR: str = "SELL_DIVINE_BUY_MIRROR"
"""Signal: current rate is low (z ≤ Z_BUY). Sell item for Divines,
convert Divines → Mirror at favourable rate."""

SIGNAL_NEUTRAL: str = "NEUTRAL"
"""Signal: rate within normal range — no arb opportunity."""

ACTION_EXECUTE_ARB: str = "EXECUTE_ARB"
"""Recommended action: profit threshold met AND |z| ≥ Z_SELL — execute
the swap-then-swap-back arb now."""

ACTION_WATCH: str = "WATCH"
"""Recommended action: profit threshold met but |z| in [Z_WATCH, Z_SELL)
— rate is moving but not yet at an extreme. Watch for escalation."""

ACTION_HOLD: str = "HOLD"
"""Recommended action: profit threshold not met OR rate is stable. No
action warranted."""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_rate_series(
    mirror_history: list,
    divine_history: list,
    *,
    tolerance_hours: float = NEAREST_NEIGHBOR_TOLERANCE_HOURS,
) -> list[tuple[datetime, float]]:
    """Build a time-series of `(timestamp, mirror_price / divine_price)`.

    Walks `mirror_history` in chronological order. For each mirror price
    point, finds the nearest divine price point (within `tolerance_hours`)
    and computes the rate. Mirror points with no divine match within
    tolerance are skipped (the rate is undefined).

    Args:
        mirror_history: List of PricePoint-like objects with `.timestamp`
            and `.price` attributes. Assumed to be the raw POE2Scout
            price_logs for the mirror currency.
        divine_history: Same shape as mirror_history, for divine.
        tolerance_hours: Max acceptable gap between mirror and divine
            price timestamps. Defaults to 24h (matches
            `storage_value_history.py`).

    Returns:
        List of `(timestamp, rate)` tuples sorted ascending by timestamp.
        Empty when either input is empty or no timestamp pairs fall
        within tolerance.
    """
    if not mirror_history or not divine_history:
        return []

    rates: list[tuple[datetime, float]] = []
    for point in mirror_history:
        try:
            ts = point.timestamp
            mirror_price = point.price
        except (TypeError, AttributeError):
            continue
        if not isinstance(ts, datetime) or mirror_price is None:
            continue
        try:
            mirror_price = float(mirror_price)
        except (TypeError, ValueError):
            continue
        if mirror_price <= 0:
            continue

        divine_price, _ = _find_nearest_price(
            ts, divine_history, tolerance_hours=tolerance_hours
        )
        if not divine_price or divine_price <= 0:
            continue
        try:
            divine_price = float(divine_price)
        except (TypeError, ValueError):
            continue

        rates.append((ts, mirror_price / divine_price))

    rates.sort(key=lambda x: x[0])
    return rates


def _filter_to_window(
    rates: list[tuple[datetime, float]],
    days: int,
    now: datetime,
) -> list[tuple[datetime, float]]:
    """Drop rate points older than `now - days` or in the future.

    Args:
        rates: List of `(timestamp, rate)` tuples.
        days: Lookback window in days (clamped to [1, MAX_DAYS]).
        now: Reference "today" timestamp.

    Returns:
        Filtered list, preserving sort order.
    """
    days = max(1, min(MAX_DAYS, int(days)))
    cutoff = now - timedelta(days=days)
    future_limit = now + timedelta(hours=1)
    return [
        (ts, rate)
        for ts, rate in rates
        if cutoff <= ts <= future_limit
    ]


def _mean(values: list[float]) -> float:
    """Arithmetic mean of a non-empty list. Returns 0.0 for empty input."""
    return statistics.fmean(values) if values else 0.0


def _std(values: list[float], ddof: int = 1) -> float:
    """Sample std (ddof=1) of a non-empty list. Returns 0.0 if < 2 points.

    Args:
        values: Non-empty list of floats.
        ddof: Delta degrees of freedom. 1 = sample std (default), 0 =
            population std. We use sample std for z-score computation
            (same convention as speculation.py).
    """
    if len(values) < ddof + 1:
        return 0.0
    if ddof == 0:
        return statistics.pstdev(values)
    return statistics.stdev(values)


def _z_score(current: float, mean: float, std: float) -> float | None:
    """Standardised score `(current - mean) / std`.

    Returns None when std == 0 (degenerate distribution — every observed
    rate was identical, so the current rate is by definition at the
    mean and there is no signal).
    """
    if std <= 0:
        return None
    return (current - mean) / std


def _signal_from_zscore(z: float | None) -> str:
    """Map a z-score to a signal label.

    Args:
        z: The z-score, or None when std == 0.

    Returns:
        One of SIGNAL_SELL_MIRROR_BUY_DIVINE / SIGNAL_SELL_DIVINE_BUY_MIRROR
        / SIGNAL_NEUTRAL. None z → NEUTRAL.
    """
    if z is None:
        return SIGNAL_NEUTRAL
    if z >= Z_SELL_THRESHOLD:
        return SIGNAL_SELL_MIRROR_BUY_DIVINE
    if z <= Z_BUY_THRESHOLD:
        return SIGNAL_SELL_DIVINE_BUY_MIRROR
    return SIGNAL_NEUTRAL


def _recommended_action(
    is_actionable: bool,
    z: float | None,
) -> str:
    """Decide the recommended action from actionability + z-score.

    - ACTION_EXECUTE_ARB: actionable AND |z| ≥ Z_SELL.
    - ACTION_WATCH: actionable AND |z| ≥ Z_WATCH (but < Z_SELL).
    - ACTION_HOLD: not actionable OR |z| < Z_WATCH.
    """
    if not is_actionable or z is None:
        return ACTION_HOLD
    abs_z = abs(z)
    if abs_z >= Z_SELL_THRESHOLD:
        return ACTION_EXECUTE_ARB
    if abs_z >= Z_WATCH_THRESHOLD:
        return ACTION_WATCH
    return ACTION_HOLD


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def compute_mirror_divine_arb(
    snapshot: DataSnapshot,
    config: Any,
    *,
    days: int = DEFAULT_DAYS,
    mirror_api_id: str = DEFAULT_MIRROR_API_ID,
    divine_api_id: str = DEFAULT_DIVINE_API_ID,
    now: datetime | None = None,
) -> dict:
    """Compute the Mirror:Divine arbitrage opportunity detector output.

    Args:
        snapshot: DataSnapshot from ``get_snapshot()`` — must have
            ``.price_histories`` (dict[api_id_lower, list[PricePoint]]).
        config: AppConfig — used for ``.league.league_name`` only.
        days: Lookback window in days (default 30, clamped to [1, 90]).
        mirror_api_id: Override the mirror currency api_id (default
            ``"mirror"``).
        divine_api_id: Override the divine currency api_id (default
            ``"divine"``).
        now: Optional override for "today" (for tests). Defaults to UTC
            now.

    Returns:
        Dict with shape::

            {
                "league": str,
                "mirror_currency": str,
                "divine_currency": str,
                "current_rate": float | None,
                "mean_rate": float | None,
                "std_rate": float | None,
                "min_rate": float | None,
                "max_rate": float | None,
                "z_score": float | None,
                "deviation_pct": float | None,
                "profit_potential_per_mirror_div": float | None,
                "signal": str,         # SELL_MIRROR_BUY_DIVINE /
                                       # SELL_DIVINE_BUY_MIRROR / NEUTRAL
                "is_actionable": bool,
                "recommended_action": str,  # EXECUTE_ARB / WATCH / HOLD
                "sample_size": int,
                "price_history_short": [
                    {"date": str (ISO 8601), "rate": float},
                    ...up to 14 most-recent points (oldest-first)
                ],
                "data_available": bool,
                "fetched_at": str (ISO 8601),
                "days": int,
            }

        ``data_available=False`` (with ``current_rate=None`` and an empty
        ``price_history_short``) when the snapshot lacks mirror or divine
        history, or when fewer than ``MIN_SAMPLE_SIZE`` rate points fall
        inside the lookback window.
    """
    today = now or datetime.now(timezone.utc)
    days = max(1, min(MAX_DAYS, int(days)))

    league = getattr(getattr(config, "league", None), "league_name", "") or ""

    mirror_lower = mirror_api_id.lower()
    divine_lower = divine_api_id.lower()

    mirror_history = snapshot.price_histories.get(mirror_lower, [])
    divine_history = snapshot.price_histories.get(divine_lower, [])

    # Build the full rate series, then filter to the lookback window.
    all_rates = _extract_rate_series(mirror_history, divine_history)
    window_rates = _filter_to_window(all_rates, days, today)

    empty_result: dict[str, Any] = {
        "league": league,
        "mirror_currency": mirror_api_id,
        "divine_currency": divine_api_id,
        "current_rate": None,
        "mean_rate": None,
        "std_rate": None,
        "min_rate": None,
        "max_rate": None,
        "z_score": None,
        "deviation_pct": None,
        "profit_potential_per_mirror_div": None,
        "signal": SIGNAL_NEUTRAL,
        "is_actionable": False,
        "recommended_action": ACTION_HOLD,
        "sample_size": 0,
        "price_history_short": [],
        "data_available": False,
        "fetched_at": today.isoformat(),
        "days": days,
    }

    if len(window_rates) < MIN_SAMPLE_SIZE:
        return empty_result

    rates_only = [r for _, r in window_rates]
    current_rate = rates_only[-1]
    mean_rate = _mean(rates_only)
    std_rate = _std(rates_only, ddof=1)
    min_rate = min(rates_only)
    max_rate = max(rates_only)
    z = _z_score(current_rate, mean_rate, std_rate)
    deviation_pct = (
        ((current_rate - mean_rate) / mean_rate) * 100.0
        if mean_rate > 0
        else None
    )
    profit_potential = abs(current_rate - mean_rate)
    is_actionable = profit_potential >= PROFIT_THRESHOLD_DIV
    signal = _signal_from_zscore(z)
    action = _recommended_action(is_actionable, z)

    # Trim to the most-recent MAX_HISTORY_POINTS for the UI sparkline.
    recent = window_rates[-MAX_HISTORY_POINTS:]
    price_history_short = [
        {"date": ts.isoformat(), "rate": round(float(rate), 8)}
        for ts, rate in recent
    ]

    def _round_or_none(v: float | None, ndigits: int = 8) -> float | None:
        if v is None:
            return None
        try:
            return round(float(v), ndigits)
        except (TypeError, ValueError):
            return None

    return {
        "league": league,
        "mirror_currency": mirror_api_id,
        "divine_currency": divine_api_id,
        "current_rate": _round_or_none(current_rate),
        "mean_rate": _round_or_none(mean_rate),
        "std_rate": _round_or_none(std_rate),
        "min_rate": _round_or_none(min_rate),
        "max_rate": _round_or_none(max_rate),
        "z_score": _round_or_none(z, ndigits=6),
        "deviation_pct": _round_or_none(deviation_pct, ndigits=6),
        "profit_potential_per_mirror_div": _round_or_none(profit_potential, ndigits=6),
        "signal": signal,
        "is_actionable": is_actionable,
        "recommended_action": action,
        "sample_size": len(window_rates),
        "price_history_short": price_history_short,
        "data_available": True,
        "fetched_at": today.isoformat(),
        "days": days,
    }
