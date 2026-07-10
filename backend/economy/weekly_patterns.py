"""
Weekly Patterns — weekday/weekend price pattern detector for each currency (P5).

Implements the pattern described in docs/MARKET_PLAYBOOK.md §P5 (weekday vs
weekend price divergence). For each currency in the snapshot, the module
aggregates price_logs by ISO weekday (1=Mon .. 7=Sun) over a configurable
lookback window (in weeks) and identifies the "best buy day" (weekday with
the lowest mean price — typically mid-week when supply is steady) and
"best sell day" (weekday with the highest mean price — typically weekends
when demand spikes).

The output powers the heatmap UI in `weekly-patterns-tab.tsx` (iter 99):
rows = currencies, columns = weekdays Mon..Sun, cell color = mean price
relative to the currency's overall mean. Buy day cell is highlighted
emerald, sell day cell is highlighted amber.

This module is pure-function: it takes a DataSnapshot + AppConfig and
returns a dict. The route handler (routes_weekly_patterns.py) is a thin
wrapper. Same separation as `intraday_patterns.py` (iter 98) and
`circuit_patterns.py` (iter 96) — the logic is testable without spinning
up FastAPI.

Design notes
------------
- We reuse the same ``_extract_price_points`` helper semantics as
  ``intraday_patterns.py`` (PascalCase / snake_case tolerance, defensive
  parsing, time-sorted output). Duplicating ~40 lines is cheaper than
  cross-module coupling — the helpers are stable and any change to one
  would need a deliberate review of the other.
- All timestamps are normalized to UTC. The ISO weekday is computed from
  the UTC timestamp — Python's ``datetime.isoweekday()`` returns 1=Mon
  through 7=Sun (matches the playbook spec "Mon–Sun"). We use ISO weekday
  (not ``weekday()`` which is 0=Mon..6=Sun) because 1-indexed days are
  clearer in the API contract and avoid off-by-one bugs in the UI.
- A minimum of ``MIN_SAMPLE_SIZE`` total price points AND
  ``MIN_DAYS_COVERED`` distinct weekdays are required to emit a currency
  in the result list. This filters out fresh currencies that have only a
  few logs in a narrow day band (e.g. a single snapshot) — the weekly
  pattern would be meaningless.
- Significance flag: ``weekly_range_pct = (max_day_mean - min_day_mean)
  / overall_mean * 100``. When ≥ ``SIGNIFICANT_RANGE_PCT`` (default 10%),
  we flag the currency as having a "significant" weekly pattern. The UI
  uses this to show a "Buy/Sell day" badge — below the threshold, the
  pattern is real but uninteresting (price roughly flat across weekdays).
  This matches the playbook spec: "Флаг «значимый weekday/weekend delta»
  — если |mean_weekday − mean_weekend| / mean > порог (например, 10%)".
- All 7 weekdays (Mon..Sun) are emitted in ``daily_stats`` for every
  currency (with ``count=0`` for days with no data) so the UI heatmap
  can render a complete row without gap-handling logic. Mean/std for
  empty days are ``None`` — the UI renders those cells with a muted
  "no data" color.
- ``weekday_delta_pct`` is an additional metric specific to weekly
  patterns: the signed percentage difference between the mean price on
  weekdays (Mon-Fri) vs weekends (Sat-Sun). Positive = weekends are
  MORE expensive (sell on weekend), negative = weekdays are more
  expensive (sell on weekday). This directly answers the playbook
  question "Perfect Jewelers Orb в будни на 20–30% дешевле".
"""

from __future__ import annotations

import logging
import math
from datetime import datetime, timedelta, timezone
from typing import Any

from backend.api.data_snapshot import DataSnapshot

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Tunable constants — kept here rather than in config.yaml because they are
# analysis thresholds, not deployment parameters. Same convention as
# intraday_patterns.py (iter 98).
# ---------------------------------------------------------------------------

MIN_SAMPLE_SIZE: int = 4
"""Minimum total number of price points required to emit a currency.

Below this the weekly aggregation is too sparse — a single noisy snapshot
could move a day's mean dramatically. 4 points = at least 4 distinct
timestamps in the window, spread across at least 2 weekdays (assuming
MIN_DAYS_COVERED is also met).
"""

MIN_DAYS_COVERED: int = 2
"""Minimum number of distinct ISO weekdays that have ≥1 price point.

A currency with all logs on a single day has no "weekly" pattern —
there's no variation to detect. We need at least 2 distinct days to
compute a meaningful max-min range.
"""

SIGNIFICANT_RANGE_PCT: float = 10.0
"""Minimum |max_day_mean - min_day_mean| / overall_mean * 100 to flag
a currency as having a "significant" weekly pattern.

10% matches the playbook spec: "если |mean_weekday − mean_weekend| /
mean > порог (например, 10%)". Below this, the buy/sell days exist but
the edge is too thin to act on (transaction spread will eat the gain).
"""

DEFAULT_WEEKS: int = 4
"""Default lookback window in weeks.

4 weeks = ~28 days. Weekly patterns are lower-frequency than intraday —
a single day's price is dominated by intraday noise, so we need multiple
weeks of data to average out the day-of-week signal. The playbook spec
talks about "последние N дней" without pinning a value; 4 weeks is a
reasonable default that balances signal freshness against sample size.
"""

DEFAULT_LIMIT: int = 50
"""Default cap on the number of currencies returned.

Sorted by ``weekly_range_pct`` descending — most actionable patterns
first. Same default as intraday_patterns.
"""

# ---------------------------------------------------------------------------
# Constants — no tuning needed
# ---------------------------------------------------------------------------

ALL_WEEKDAYS: tuple[int, ...] = (1, 2, 3, 4, 5, 6, 7)
"""All 7 ISO weekdays (1=Mon .. 7=Sun), in ascending order. Used to emit
a complete daily_stats list with count=0 for days with no data."""

WEEKDAY_NAMES: dict[int, str] = {
    1: "Mon",
    2: "Tue",
    3: "Wed",
    4: "Thu",
    5: "Fri",
    6: "Sat",
    7: "Sun",
}
"""Short English names for ISO weekdays. Used for logging/debugging —
the UI has its own localized names via i18n."""

WEEKDAY_IDS: tuple[int, ...] = (1, 2, 3, 4, 5)
"""ISO weekday IDs that count as "weekday" (Mon-Fri) for the
weekday_delta_pct metric."""

WEEKEND_IDS: tuple[int, ...] = (6, 7)
"""ISO weekday IDs that count as "weekend" (Sat-Sun) for the
weekday_delta_pct metric."""

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
    Mirrors the helper in intraday_patterns.py — same semantics, copied
    to keep the module self-contained.
    """
    out: list[tuple[datetime, float]] = []
    for log in price_logs:
        time_val = log.get("Time") or log.get("time")
        price_val = log.get("Price") or log.get("price")
        if time_val is None or price_val is None:
            continue

        # Parse timestamp — accept datetime objects and ISO strings.
        # Defensive: if the parsed datetime is naive (no tzinfo), attach UTC.
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


def _filter_to_weeks(
    points: list[tuple[datetime, float]],
    weeks: int,
    now: datetime,
) -> list[tuple[datetime, float]]:
    """Keep only points within the last `weeks` weeks (inclusive of `now`).

    `weeks` is converted to days (×7) for the cutoff. This matches the
    intraday_patterns convention of using `timedelta(days=...)` for the
    window filter — semantically "last N weeks" means "last N*7 days".
    """
    cutoff = now - timedelta(days=weeks * 7)
    return [(ts, p) for ts, p in points if ts >= cutoff]


def _mean(values: list[float]) -> float:
    """Population mean. Returns 0.0 for empty input (defensive)."""
    if not values:
        return 0.0
    return sum(values) / len(values)


def _std(values: list[float]) -> float:
    """Population std. Returns 0.0 for empty or single-element input."""
    n = len(values)
    if n == 0:
        return 0.0
    mu = _mean(values)
    var = sum((v - mu) ** 2 for v in values) / n
    return math.sqrt(var)


def _group_by_weekday(
    points: list[tuple[datetime, float]],
) -> dict[int, list[float]]:
    """Group (timestamp, price) pairs by ISO weekday (1=Mon .. 7=Sun).

    Returns a dict[weekday, list[prices]] with all 7 keys present (empty
    lists for days with no data). Callers that need a complete 7-day row
    can iterate ``ALL_WEEKDAYS`` and use ``.get(day, [])`` — but the
    dict is pre-initialized for convenience.
    """
    by_day: dict[int, list[float]] = {d: [] for d in ALL_WEEKDAYS}
    for ts, price in points:
        # Normalize to UTC before extracting the weekday — defensive against
        # any tz-aware-but-non-UTC timestamps that slipped through.
        ts_utc = ts.astimezone(timezone.utc) if ts.tzinfo else ts.replace(tzinfo=timezone.utc)
        d = ts_utc.isoweekday()
        by_day[d].append(price)
    return by_day


def _daily_stats(by_day: dict[int, list[float]]) -> list[dict]:
    """Compute per-weekday mean/std/count for all 7 ISO weekdays (Mon..Sun).

    Always returns a list of 7 dicts (one per weekday, in ascending ISO
    weekday order 1..7). Days with no data have ``mean=None``,
    ``std=None``, ``count=0``. This makes the UI heatmap rendering
    trivial — no gap-handling needed.
    """
    out: list[dict] = []
    for d in ALL_WEEKDAYS:
        prices = by_day.get(d, [])
        if prices:
            out.append({
                "weekday": d,
                "mean": round(_mean(prices), 6),
                "std": round(_std(prices), 6),
                "count": len(prices),
            })
        else:
            out.append({
                "weekday": d,
                "mean": None,
                "std": None,
                "count": 0,
            })
    return out


def _overall_mean(by_day: dict[int, list[float]]) -> float:
    """Mean of ALL prices across all weekdays (NOT mean of daily means).

    This is the denominator for the significance ratio. Using all-points
    mean (not daily-mean-of-means) gives more weight to days with more
    data — fairer when sample sizes vary by weekday (weekends typically
    have fewer farmer logs because of social patterns).
    """
    all_prices: list[float] = []
    for prices in by_day.values():
        all_prices.extend(prices)
    return _mean(all_prices) if all_prices else 0.0


def _find_buy_sell_days(
    daily: list[dict],
) -> tuple[int | None, int | None, float | None, float | None]:
    """Find the buy (min mean) and sell (max mean) weekday.

    Only considers days with ``count > 0`` (i.e. ``mean is not None``).
    Returns (buy_day, sell_day, buy_mean, sell_mean). All four are
    ``None`` when no day has data (defensive — shouldn't happen because
    the caller filters currencies below MIN_SAMPLE_SIZE, but defensive).

    Tie-breaking: when multiple days share the min/max mean, the lowest
    weekday index wins (deterministic for tests). For max, we negate the
    weekday in the sort key so the HIGHEST weekday wins on ties — this
    way, if Saturday and Sunday both have the same max mean, Sunday is
    chosen as the sell day (weekends are more "interesting" for the
    weekday/weekend pattern).
    """
    valid = [d for d in daily if d["count"] > 0]
    if not valid:
        return None, None, None, None

    # Buy day = weekday with min mean price (best day to BUY).
    # Tie-break: lowest weekday wins (deterministic for tests).
    buy = min(valid, key=lambda d: (d["mean"], d["weekday"]))
    # Sell day = weekday with max mean price (best day to SELL).
    # Tie-break: HIGHEST weekday wins — if Saturday and Sunday both have the
    # same max mean, Sunday is chosen as the sell day (weekends are more
    # "interesting" for the weekday/weekend pattern). Using `(mean, weekday)`
    # with max() picks the highest weekday on ties.
    sell = max(valid, key=lambda d: (d["mean"], d["weekday"]))
    return buy["weekday"], sell["weekday"], buy["mean"], sell["mean"]


def _weekly_range_pct(
    buy_mean: float | None,
    sell_mean: float | None,
    overall_mean: float,
) -> float:
    """|(sell_mean - buy_mean) / overall_mean| * 100.

    Returns 0.0 when any input is None or overall_mean is 0. The
    absolute value is used because the buy day is always the min —
    the range is non-negative by construction, but defensive coding
    against floating-point noise.
    """
    if buy_mean is None or sell_mean is None or overall_mean <= 0:
        return 0.0
    return abs(sell_mean - buy_mean) / overall_mean * 100.0


def _weekday_delta_pct(
    by_day: dict[int, list[float]],
    overall_mean: float,
) -> float:
    """Signed % difference between weekday mean and weekend mean.

    Positive = weekends are MORE expensive (sell on weekend).
    Negative = weekdays are MORE expensive (sell on weekday).
    Zero = no difference (or insufficient data).

    Computed as ``(weekend_mean - weekday_mean) / overall_mean * 100``.
    Uses overall_mean (not weekday_mean) as the denominator so the
    delta is comparable across currencies with different absolute prices.

    Returns 0.0 when either group has no data or overall_mean is 0.
    """
    if overall_mean <= 0:
        return 0.0
    weekday_prices: list[float] = []
    for d in WEEKDAY_IDS:
        weekday_prices.extend(by_day.get(d, []))
    weekend_prices: list[float] = []
    for d in WEEKEND_IDS:
        weekend_prices.extend(by_day.get(d, []))
    if not weekday_prices or not weekend_prices:
        return 0.0
    weekday_mean = _mean(weekday_prices)
    weekend_mean = _mean(weekend_prices)
    return (weekend_mean - weekday_mean) / overall_mean * 100.0


def _days_covered(by_day: dict[int, list[float]]) -> int:
    """Number of distinct ISO weekdays with ≥1 price point."""
    return sum(1 for prices in by_day.values() if prices)


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------


def compute_weekly_patterns(
    snapshot: DataSnapshot,
    config,
    *,
    weeks: int = DEFAULT_WEEKS,
    limit: int = DEFAULT_LIMIT,
    now: datetime | None = None,
) -> dict:
    """Compute weekly (weekday-of-week) price patterns for every currency.

    Args:
        snapshot: DataSnapshot from ``get_snapshot()`` — must have
            ``.currencies`` (dict[api_id_lower, raw_dict]).
        config: AppConfig — uses ``.league.league_name`` only.
        weeks: Lookback window in weeks. Defaults to ``DEFAULT_WEEKS`` (4).
            Each week = 7 days, so weeks=4 → 28-day window.
        limit: Maximum number of currencies to return. Sorted by
            ``weekly_range_pct`` descending. Defaults to ``DEFAULT_LIMIT``
            (50). Negative = no cap (used by tests).
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
                        "daily_stats": [   # always 7 entries (weekday 1..7)
                            {
                                "weekday": int,           # 1..7 (Mon..Sun)
                                "mean": float | None,     # None when count=0
                                "std": float | None,      # None when count=0
                                "count": int,             # 0 when no data
                            },
                            ...7 entries total
                        ],
                        "buy_window_day": int | None,     # 1..7, None if no data
                        "sell_window_day": int | None,    # 1..7, None if no data
                        "buy_window_mean": float | None,
                        "sell_window_mean": float | None,
                        "overall_mean": float,
                        "weekly_range_pct": float,        # |sell-buy|/overall*100
                        "weekday_delta_pct": float,       # signed: weekend vs weekday
                        "has_significant_pattern": bool,  # range >= 10%
                        "sample_size": int,               # total points in window
                        "current_price": float,
                    },
                    ...
                ],
                "data_available": bool,
                "fetched_at": str (ISO 8601),
            }

        ``data_available=False`` (with empty patterns list) when the
        snapshot has no currencies or none have enough price_logs in
        enough distinct weekdays.

    Sorting:
        Patterns are sorted by ``weekly_range_pct`` descending (most
        actionable weekly pattern first). Ties broken by larger
        ``sample_size`` (more reliable aggregation). This matches the
        convention used by ``compute_intraday_patterns`` (sort by
        ``intraday_range_pct`` desc, ties by sample_size).
    """
    today = now or datetime.now(timezone.utc)

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

        window_points = _filter_to_weeks(all_points, weeks, today)
        if len(window_points) < MIN_SAMPLE_SIZE:
            continue

        by_day = _group_by_weekday(window_points)
        if _days_covered(by_day) < MIN_DAYS_COVERED:
            continue

        any_data = True

        daily = _daily_stats(by_day)
        overall = _overall_mean(by_day)
        buy_d, sell_d, buy_m, sell_m = _find_buy_sell_days(daily)
        range_pct = _weekly_range_pct(buy_m, sell_m, overall)
        delta_pct = _weekday_delta_pct(by_day, overall)
        significant = range_pct >= SIGNIFICANT_RANGE_PCT

        patterns.append({
            "api_id": api_id,
            "text": curr.get("Text") or curr.get("text") or api_id,
            "category": (
                curr.get("CategoryApiId")
                or curr.get("category_api_id")
                or ""
            ),
            "daily_stats": daily,
            "buy_window_day": buy_d,
            "sell_window_day": sell_d,
            "buy_window_mean": round(buy_m, 6) if buy_m is not None else None,
            "sell_window_mean": round(sell_m, 6) if sell_m is not None else None,
            "overall_mean": round(overall, 6),
            "weekly_range_pct": round(range_pct, 2),
            "weekday_delta_pct": round(delta_pct, 2),
            "has_significant_pattern": significant,
            "sample_size": len(window_points),
            "current_price": float(
                curr.get("CurrentPrice")
                or curr.get("current_price")
                or window_points[-1][1]
            ),
        })

    # Sort: most actionable weekly pattern first (largest range_pct).
    # Ties broken by larger sample_size (more reliable aggregation).
    patterns.sort(
        key=lambda p: (p["weekly_range_pct"], p["sample_size"]),
        reverse=True,
    )

    # Apply limit AFTER sort so the top-N most-actionable currencies are kept.
    # limit <= 0 returns empty list. Negative limit = no cap (tests / internal).
    if limit < 0:
        pass  # negative = "no cap"
    else:
        patterns = patterns[:limit]

    return {
        "league": config.league.league_name,
        "patterns": patterns,
        "data_available": any_data,
        "fetched_at": today.isoformat(),
    }
