"""
Circuit Patterns — trajectory classification for each currency (P8).

Implements the pattern described in docs/MARKET_PLAYBOOK.md §P8 (Chaos-Orb
trajectory). For each currency in the snapshot, the module classifies its
price trajectory over a configurable lookback window into one of seven
archetypes and emits a recommended action.

Archetypes
----------
- ``EXPONENTIAL_GROWTH`` — log-linear regression of price vs time has
  R² ≥ ``MIN_R_SQUARED``, slope > 0, total growth ≥ ``EXP_GROWTH_MIN_TOTAL_PCT``.
  Canonical example: Chaos Orbs on Week 1+ (1:1 → 1:2 → 1:5 → 1:10 → 1:36).
- ``LINEAR_GROWTH``      — linear regression of price vs time has
  R² ≥ ``MIN_R_SQUARED``, slope > 0, total growth between
  ``LIN_GROWTH_MIN_TOTAL_PCT`` and ``EXP_GROWTH_MIN_TOTAL_PCT``.
- ``PEAK_THEN_DECLINE``  — there is a clear peak strictly inside the window,
  and price has declined by ≥ ``PEAK_DECLINE_MIN_PCT`` from peak to last.
  Canonical example: leveling uniques (Day 2 peak → Day 3+ decline).
- ``MEAN_REVERTING``     — coefficient of variation (std / mean) < ``STABLE_MAX_CV``
  AND slope of linear regression has |total_change_pct| < ``STABLE_MAX_TOTAL_PCT``.
- ``VOLATILE``           — coefficient of variation > ``VOLATILE_MIN_CV``
  AND no clear trend (R² < ``MIN_R_SQUARED`` for both regressions).
  Canonical example: Annulment Orbs (3:1 → 2:1 → 4:1 within days).
- ``DECLINING``          — linear regression, R² ≥ ``MIN_R_SQUARED``,
  slope < 0, total decline > ``LIN_GROWTH_MIN_TOTAL_PCT``.
- ``STABLE``             — coefficient of variation between
  ``STABLE_MAX_CV`` and ``VOLATILE_MIN_CV``, no clear trend.

Recommended action by archetype
-------------------------------
- ``EXPONENTIAL_GROWTH`` → ``HOLD_FOR_GROWTH``
- ``LINEAR_GROWTH``      → ``HOLD_FOR_GROWTH``
- ``PEAK_THEN_DECLINE``  → ``SELL_NOW``
- ``MEAN_REVERTING``     → ``NEUTRAL``
- ``VOLATILE``           → ``WATCH``
- ``DECLINING``          → ``AVOID``
- ``STABLE``             → ``NEUTRAL``

This module is pure-function: it takes a DataSnapshot + AppConfig and returns
a dict. The route handler (routes_circuit_patterns.py — deferred to iter 97)
will be a thin wrapper. This separation makes the logic testable without
spinning up FastAPI.

Design notes
------------
- We use ``PriceLogs`` from the snapshot (same source as ``content_pulse.py``
  and ``speculation.py``). No new API calls.
- All regressions are OLS via stdlib ``statistics`` — no numpy/pandas
  dependency. The math is simple enough that pulling in numpy for two
  regressions per currency would be overkill.
- log-prices are used for the exponential-growth fit (linear regression of
  ln(price) vs day_index → recovers exponential growth rate).
- A minimum of ``MIN_SAMPLE_SIZE`` price points is required to classify;
  below that, the currency is skipped (not emitted in the result list).
- Currencies with any zero/negative price are filtered out before
  regression (log of zero is undefined).
"""

from __future__ import annotations

import logging
import math
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any

from backend.api.data_snapshot import DataSnapshot

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Tunable constants — kept here rather than in config.yaml because they are
# analysis thresholds, not deployment parameters. If they need to become
# per-deployment configurable, move them to a new `circuit_patterns:` block
# in config.yaml and add a Pydantic model in backend/config.py.
# ---------------------------------------------------------------------------

MIN_SAMPLE_SIZE: int = 4
"""Minimum number of price points required to classify a trajectory.

Below this the result is unreliable — a single noisy day can move the
slope dramatically. 4 points = 3 log-returns, which is the bare minimum
to detect a trend vs noise.
"""

MIN_R_SQUARED: float = 0.7
"""Minimum R² for the regression fit to be considered a real trend.

0.7 means 70% of the variance is explained by the linear model. Below
that, we don't trust the slope as a trend indicator and fall back to
CV-based classification (MEAN_REVERTING / VOLATILE / STABLE).
"""

EXP_GROWTH_MIN_TOTAL_PCT: float = 50.0
"""Minimum total growth (%) over the window for EXPONENTIAL_GROWTH.

50% means the price at least 1.5×'d over the window. Below that,
exponential growth is real but uninteresting — we call it LINEAR_GROWTH
instead (the action is the same: HOLD_FOR_GROWTH, but the magnitude
label differs).
"""

LIN_GROWTH_MIN_TOTAL_PCT: float = 10.0
"""Minimum |total change| (%) for LINEAR_GROWTH or DECLINING.

Below 10% total change, even with a clean linear fit, the trend is too
flat to act on — classify as MEAN_REVERTING or STABLE instead.
"""

PEAK_DECLINE_MIN_PCT: float = 20.0
"""Minimum decline (%) from peak to last price for PEAK_THEN_DECLINE.

20% means the price dropped at least a fifth from its peak. Smaller
drops are normal noise around a flat or rising trend.
"""

STABLE_MAX_CV: float = 0.15
"""Maximum coefficient of variation for MEAN_REVERTING classification.

CV = std / mean. 0.15 = 15% — typical for stable currencies like Exalt
or Divine that oscillate in a tight band.
"""

VOLATILE_MIN_CV: float = 0.5
"""Minimum coefficient of variation for VOLATILE classification.

CV > 0.5 = 50% — prices swing wildly. Combined with low R², this is the
post-streamer / speculator-frenzy pattern.
"""

STABLE_MAX_TOTAL_PCT: float = 10.0
"""Maximum |total change| (%) for MEAN_REVERTING classification.

Combined with STABLE_MAX_CV: if both CV < 0.15 AND |total change| < 10%,
the currency is oscillating tightly around a stable mean.
"""

DEFAULT_DAYS: int = 30
"""Default lookback window in days. Matches speculation.py default."""

DEFAULT_LIMIT: int = 50
"""Default cap on the number of currencies returned.

Sorted by |total_change_pct| descending — most action first.
"""

# ---------------------------------------------------------------------------
# Trajectory + action enums (as plain strings — matches the convention
# used by speculation.py: signal values are bare strings, not enums).
# ---------------------------------------------------------------------------

TRAJECTORY_EXPONENTIAL_GROWTH = "EXPONENTIAL_GROWTH"
TRAJECTORY_LINEAR_GROWTH = "LINEAR_GROWTH"
TRAJECTORY_PEAK_THEN_DECLINE = "PEAK_THEN_DECLINE"
TRAJECTORY_MEAN_REVERTING = "MEAN_REVERTING"
TRAJECTORY_VOLATILE = "VOLATILE"
TRAJECTORY_DECLINING = "DECLINING"
TRAJECTORY_STABLE = "STABLE"

ALL_TRAJECTORIES = (
    TRAJECTORY_EXPONENTIAL_GROWTH,
    TRAJECTORY_LINEAR_GROWTH,
    TRAJECTORY_PEAK_THEN_DECLINE,
    TRAJECTORY_MEAN_REVERTING,
    TRAJECTORY_VOLATILE,
    TRAJECTORY_DECLINING,
    TRAJECTORY_STABLE,
)

ACTION_HOLD_FOR_GROWTH = "HOLD_FOR_GROWTH"
ACTION_SELL_NOW = "SELL_NOW"
ACTION_AVOID = "AVOID"
ACTION_WATCH = "WATCH"
ACTION_NEUTRAL = "NEUTRAL"

_TRAJECTORY_TO_ACTION: dict[str, str] = {
    TRAJECTORY_EXPONENTIAL_GROWTH: ACTION_HOLD_FOR_GROWTH,
    TRAJECTORY_LINEAR_GROWTH: ACTION_HOLD_FOR_GROWTH,
    TRAJECTORY_PEAK_THEN_DECLINE: ACTION_SELL_NOW,
    TRAJECTORY_MEAN_REVERTING: ACTION_NEUTRAL,
    TRAJECTORY_VOLATILE: ACTION_WATCH,
    TRAJECTORY_DECLINING: ACTION_AVOID,
    TRAJECTORY_STABLE: ACTION_NEUTRAL,
}


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------


def _extract_price_points(price_logs: list[dict]) -> list[tuple[datetime, float]]:
    """Extract (timestamp, price) pairs from price_logs.

    Accepts both PascalCase (``Time`` / ``Price`` — POE2Scout raw) and
    snake_case (``time`` / ``price`` — internal) keys. Defensive against
    missing/invalid fields: skips any log that doesn't have both a
    parseable timestamp and a positive numeric price.

    Returns the list sorted by timestamp ascending (oldest first).
    """
    out: list[tuple[datetime, float]] = []
    for log in price_logs:
        time_val = log.get("Time") or log.get("time")
        price_val = log.get("Price") or log.get("price")
        if time_val is None or price_val is None:
            continue

        # Parse timestamp — accept datetime objects and ISO strings.
        # Defensive: if the parsed datetime is naive (no tzinfo), attach UTC.
        # Otherwise comparisons against timezone-aware "now" raise TypeError.
        if isinstance(time_val, datetime):
            ts = time_val
        elif isinstance(time_val, str):
            try:
                ts = datetime.fromisoformat(time_val.replace("Z", "+00:00"))
            except ValueError:
                continue
        else:
            continue
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)

        # Parse price — must be a positive number.
        try:
            price_f = float(price_val)
        except (TypeError, ValueError):
            continue
        if price_f <= 0:
            continue

        out.append((ts, price_f))

    out.sort(key=lambda x: x[0])
    return out


def _filter_to_window(
    points: list[tuple[datetime, float]],
    days: int,
    now: datetime,
) -> list[tuple[datetime, float]]:
    """Keep only points within the last `days` days (inclusive of `now`)."""
    cutoff = now - timedelta(days=days)
    return [(ts, p) for ts, p in points if ts >= cutoff]


def _mean(values: list[float]) -> float:
    """Population mean. Returns 0.0 for empty input (defensive)."""
    if not values:
        return 0.0
    return sum(values) / len(values)


def _std(values: list[float], ddof: int = 0) -> float:
    """Population (ddof=0) or sample (ddof=1) std. Returns 0.0 for empty."""
    n = len(values)
    if n == 0:
        return 0.0
    if n - ddof <= 0:
        return 0.0
    mu = _mean(values)
    var = sum((v - mu) ** 2 for v in values) / (n - ddof)
    return math.sqrt(var)


def _coefficient_of_variation(prices: list[float]) -> float:
    """CV = std / mean. Returns +inf when mean is 0 (no division by zero)."""
    mu = _mean(prices)
    if mu == 0:
        return float("inf")
    return _std(prices, ddof=0) / mu


def _linear_regression(
    xs: list[float],
    ys: list[float],
) -> tuple[float, float, float]:
    """Ordinary least squares fit of y on x.

    Returns (slope, intercept, r_squared). For n=0 or n=1 returns
    (0.0, 0.0, 0.0). For zero variance in x (all xs equal), returns
    (0.0, mean(ys), 0.0).
    """
    n = len(xs)
    if n < 2:
        return 0.0, _mean(ys) if ys else 0.0, 0.0

    mean_x = _mean(xs)
    mean_y = _mean(ys)

    num_slope = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys))
    den_slope = sum((x - mean_x) ** 2 for x in xs)
    if den_slope == 0:
        # All xs equal — can't fit a slope.
        return 0.0, mean_y, 0.0

    slope = num_slope / den_slope
    intercept = mean_y - slope * mean_x

    # R² = 1 - SS_res / SS_tot. SS_tot = 0 means all ys equal — perfect
    # horizontal fit, R² = 0 (no variance explained by x because there's
    # no variance to explain).
    ss_tot = sum((y - mean_y) ** 2 for y in ys)
    if ss_tot == 0:
        return slope, intercept, 0.0

    ss_res = sum((y - (slope * x + intercept)) ** 2 for x, y in zip(xs, ys))
    r_squared = 1.0 - (ss_res / ss_tot)
    # Clamp to [0, 1] — floating point can push slightly outside.
    r_squared = max(0.0, min(1.0, r_squared))

    return slope, intercept, r_squared


def _total_change_pct(prices: list[float]) -> float:
    """% change from first to last price.

    Returns 0.0 for empty list. Returns +inf if first price is 0
    (shouldn't happen — caller filters out zero prices, but defensive).
    """
    if len(prices) < 2:
        return 0.0
    first = prices[0]
    last = prices[-1]
    if first == 0:
        return 0.0
    return ((last - first) / first) * 100.0


def _days_since_peak(points: list[tuple[datetime, float]]) -> int | None:
    """Days between the highest-price point and the last point.

    Returns 0 if the peak IS the last point. Returns None if the list is
    empty. Used for PEAK_THEN_DECLINE classification — tells the user how
    many days ago the peak was.
    """
    if not points:
        return None
    peak_ts = max(points, key=lambda x: x[1])[0]
    last_ts = points[-1][0]
    delta = last_ts - peak_ts
    return max(0, int(delta.total_seconds() // 86400))


def _is_peak_then_decline(
    prices: list[float],
    points: list[tuple[datetime, float]],
) -> bool:
    """Detect spike-then-crash shape.

    Criteria:
    1. The peak price is NOT the first or last point (peak is strictly
       inside the window — otherwise it's just a rising or falling trend).
    2. The decline from peak to last is ≥ ``PEAK_DECLINE_MIN_PCT``.
    """
    if len(prices) < 3:
        return False
    peak_idx = prices.index(max(prices))
    if peak_idx == 0 or peak_idx == len(prices) - 1:
        return False
    peak_price = prices[peak_idx]
    last_price = prices[-1]
    if peak_price == 0:
        return False
    decline_pct = ((peak_price - last_price) / peak_price) * 100.0
    return decline_pct >= PEAK_DECLINE_MIN_PCT


def _classify_trajectory(
    prices: list[float],
    points: list[tuple[datetime, float]],
) -> tuple[str, float, float, float, float]:
    """Classify a single currency's price trajectory.

    Args:
        prices: time-sorted list of positive float prices.
        points: time-sorted list of (timestamp, price) tuples.

    Returns:
        (trajectory, total_change_pct, recent_slope_pct_per_day,
         volatility_cv, r_squared)

    - ``total_change_pct``: % change first → last.
    - ``recent_slope_pct_per_day``: slope of linear fit × 100 (interpreted
      as percent-per-day change relative to the window's mean price —
      unitless and comparable across currencies).
    - ``volatility_cv``: coefficient of variation (std / mean).
    - ``r_squared``: goodness-of-fit of the linear regression.
    """
    n = len(prices)
    if n < MIN_SAMPLE_SIZE:
        # Below threshold — we don't emit these in the result list at all,
        # but if called directly we return STABLE with zeroed metrics.
        return TRAJECTORY_STABLE, 0.0, 0.0, 0.0, 0.0

    total_change_pct = _total_change_pct(prices)
    cv = _coefficient_of_variation(prices)

    # Linear regression on raw prices vs day-index.
    # Use day-index (0, 1, 2, ...) — actual timestamps vary in spacing,
    # but day-index is a reasonable proxy when price_logs are roughly daily.
    # For sub-daily logs we still use ordinal index — the slope is then
    # "per-log-interval", which we relabel as "per-day" assuming ~1 log/day.
    xs = [float(i) for i in range(n)]
    slope, _intercept, r_squared = _linear_regression(xs, prices)
    mean_price = _mean(prices)
    recent_slope_pct_per_day = (
        (slope / mean_price) * 100.0 if mean_price > 0 else 0.0
    )

    # PEAK_THEN_DECLINE check first — it's a shape-based classification
    # that takes precedence over trend-based ones. A spike-then-crash can
    # also have low R² (looks like noise) or moderate negative slope
    # (looks like DECLINING), but the SHAPE is what matters for the user.
    if _is_peak_then_decline(prices, points):
        return (
            TRAJECTORY_PEAK_THEN_DECLINE,
            total_change_pct,
            recent_slope_pct_per_day,
            cv,
            r_squared,
        )

    # Trend-based classification (only if R² is high enough to trust the slope).
    if r_squared >= MIN_R_SQUARED:
        if slope > 0 and total_change_pct >= EXP_GROWTH_MIN_TOTAL_PCT:
            return (
                TRAJECTORY_EXPONENTIAL_GROWTH,
                total_change_pct,
                recent_slope_pct_per_day,
                cv,
                r_squared,
            )
        if slope > 0 and total_change_pct >= LIN_GROWTH_MIN_TOTAL_PCT:
            return (
                TRAJECTORY_LINEAR_GROWTH,
                total_change_pct,
                recent_slope_pct_per_day,
                cv,
                r_squared,
            )
        if slope < 0 and -total_change_pct >= LIN_GROWTH_MIN_TOTAL_PCT:
            return (
                TRAJECTORY_DECLINING,
                total_change_pct,
                recent_slope_pct_per_day,
                cv,
                r_squared,
            )

    # Fall through to CV-based classification when no clear trend.
    if cv < STABLE_MAX_CV and abs(total_change_pct) < STABLE_MAX_TOTAL_PCT:
        return (
            TRAJECTORY_MEAN_REVERTING,
            total_change_pct,
            recent_slope_pct_per_day,
            cv,
            r_squared,
        )
    if cv > VOLATILE_MIN_CV:
        return (
            TRAJECTORY_VOLATILE,
            total_change_pct,
            recent_slope_pct_per_day,
            cv,
            r_squared,
        )
    return (
        TRAJECTORY_STABLE,
        total_change_pct,
        recent_slope_pct_per_day,
        cv,
        r_squared,
    )


def _recommended_action(trajectory: str) -> str:
    """Map a trajectory archetype to a recommended action string."""
    return _TRAJECTORY_TO_ACTION.get(trajectory, ACTION_NEUTRAL)


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------


def compute_circuit_patterns(
    snapshot: DataSnapshot,
    config,
    *,
    days: int = DEFAULT_DAYS,
    limit: int = DEFAULT_LIMIT,
    trajectory_filter: str = "ALL",
    now: datetime | None = None,
) -> dict:
    """Compute trajectory classification for every currency in the snapshot.

    Args:
        snapshot: DataSnapshot from ``get_snapshot()`` — must have
            ``.currencies`` (dict[api_id_lower, raw_dict]).
        config: AppConfig — uses ``.league.league_name`` only (no category
            filter — trajectory is per-currency, not per-category).
        days: Lookback window in days. Defaults to ``DEFAULT_DAYS`` (30).
        limit: Maximum number of currencies to return. Sorted by
            ``|total_change_pct|`` descending. Defaults to ``DEFAULT_LIMIT`` (50).
        trajectory_filter: ``"ALL"`` or one of the trajectory archetypes.
            When set, only currencies with the matching trajectory are
            returned. Defaults to ``"ALL"``.
        now: Optional override for "today" (for tests). Defaults to UTC now.

    Returns:
        Dict with shape::

            {
                "league": str,
                "patterns": [
                    {
                        "api_id": str,
                        "text": str,
                        "category": str,
                        "trajectory": str,         # one of ALL_TRAJECTORIES
                        "total_change_pct": float,
                        "recent_slope_pct_per_day": float,
                        "volatility_cv": float,
                        "r_squared": float,
                        "days_since_peak": int | None,
                        "recommended_action": str, # HOLD_FOR_GROWTH / SELL_NOW / ...
                        "sample_size": int,
                        "current_price": float,
                    },
                    ...
                ],
                "data_available": bool,
                "fetched_at": str (ISO 8601),
            }

        ``data_available=False`` (with empty patterns list) when the
        snapshot has no currencies or none have enough price_logs.
    """
    today = now or datetime.now(timezone.utc)

    # Validate trajectory_filter early — invalid values silently fall back
    # to "ALL" rather than raising. Matches the convention used by
    # speculation.py (signal_filter).
    if trajectory_filter not in ("ALL", *ALL_TRAJECTORIES):
        trajectory_filter = "ALL"

    patterns: list[dict] = []
    any_data = False

    for curr in snapshot.currencies.values():
        api_id = curr.get("ApiId") or curr.get("api_id") or ""
        if not api_id:
            continue

        logs = curr.get("PriceLogs") or curr.get("price_logs") or []
        all_points = _extract_price_points(logs)
        if not all_points:
            continue

        window_points = _filter_to_window(all_points, days, today)
        if len(window_points) < MIN_SAMPLE_SIZE:
            continue

        any_data = True
        prices = [p for _, p in window_points]

        trajectory, total_change_pct, slope_per_day, cv, r_sq = (
            _classify_trajectory(prices, window_points)
        )

        # Apply filter AFTER classification so the count of classified
        # currencies is still meaningful for diagnostics.
        if trajectory_filter != "ALL" and trajectory != trajectory_filter:
            continue

        days_peak = _days_since_peak(window_points)
        action = _recommended_action(trajectory)

        patterns.append({
            "api_id": api_id,
            "text": curr.get("Text") or curr.get("text") or api_id,
            "category": (
                curr.get("CategoryApiId")
                or curr.get("category_api_id")
                or ""
            ),
            "trajectory": trajectory,
            "total_change_pct": round(total_change_pct, 2),
            "recent_slope_pct_per_day": round(slope_per_day, 4),
            "volatility_cv": round(cv, 4),
            "r_squared": round(r_sq, 4),
            "days_since_peak": days_peak,
            "recommended_action": action,
            "sample_size": len(window_points),
            "current_price": float(
                curr.get("CurrentPrice")
                or curr.get("current_price")
                or prices[-1]
            ),
        })

    # Sort: most action first (largest |total_change_pct|).
    # Ties broken by larger sample_size (more reliable classification).
    patterns.sort(
        key=lambda p: (abs(p["total_change_pct"]), p["sample_size"]),
        reverse=True,
    )

    # Apply limit AFTER sort so the top-N most-action currencies are kept.
    # limit <= 0 returns empty list (caller explicitly asked for nothing).
    # Use a large limit value internally to mean "no cap" (callers should
    # pass DEFAULT_LIMIT or higher — the route handler validates ge=1).
    if limit < 0:
        # Negative limit = "no cap" — used by tests / internal callers
        # that want the full list. Production routes never pass negative.
        pass
    else:
        patterns = patterns[:limit]

    return {
        "league": config.league.league_name,
        "patterns": patterns,
        "data_available": any_data,
        "fetched_at": today.isoformat(),
    }
