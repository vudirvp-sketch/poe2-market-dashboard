"""
Intraday Patterns — time-of-day price pattern detector for each currency (P4).

Implements the pattern described in docs/MARKET_PLAYBOOK.md §P4 (Asia/US/EU
wake-cycle). For each currency in the snapshot, the module aggregates
price_logs by hour-of-day (UTC) over a configurable lookback window and
identifies the "buy window" (hour with the lowest mean price — typically
when Asia wakes and farmers dump loot) and "sell window" (hour with the
highest mean price — typically when US/EU wake and demand spikes).

The output powers the heatmap UI in `intraday-patterns-tab.tsx` (iter 98):
rows = currencies, columns = hours 0..23, cell color = mean price relative
to the currency's overall mean. Buy window cell is highlighted emerald,
sell window cell is highlighted amber.

This module is pure-function: it takes a DataSnapshot + AppConfig and
returns a dict. The route handler (routes_intraday_patterns.py) is a thin
wrapper. Same separation as `circuit_patterns.py` (iter 96) — the logic is
testable without spinning up FastAPI.

Design notes
------------
- We reuse the same ``_extract_price_points`` helper semantics as
  ``circuit_patterns.py`` (PascalCase / snake_case tolerance, defensive
  parsing, time-sorted output). Duplicating ~40 lines is cheaper than
  cross-module coupling — the helpers are stable and any change to one
  would need a deliberate review of the other.
- All timestamps are normalized to UTC. The hour-of-day is the UTC hour
  (0..23). The user guide talks about "Asia wakes / US wakes / EU wakes"
  in informal terms — UTC is the unambiguous timezone for storage and
  aggregation. The UI can show a UTC label or convert to the user's local
  timezone in a future iteration.
- A minimum of ``MIN_SAMPLE_SIZE`` total price points AND
  ``MIN_HOURS_COVERED`` distinct UTC hours are required to emit a currency
  in the result list. This filters out fresh currencies that have only a
  few logs in a narrow time band (e.g. a single snapshot) — the
  intraday pattern would be meaningless.
- Significance flag: ``intraday_range_pct = (max_hour_mean - min_hour_mean)
  / overall_mean * 100``. When ≥ ``SIGNIFICANT_RANGE_PCT`` (default 10%),
  we flag the currency as having a "significant" intraday pattern. The UI
  uses this to show a "Buy/Sell window" badge — below the threshold, the
  pattern is real but uninteresting (price roughly flat across hours).
- All hours 0..23 are emitted in ``hourly_stats`` for every currency (with
  ``count=0`` for hours with no data) so the UI heatmap can render a
  complete row without gap-handling logic. Mean/std for empty hours are
  ``None`` — the UI renders those cells with a muted "no data" color.
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
# circuit_patterns.py (iter 96).
# ---------------------------------------------------------------------------

MIN_SAMPLE_SIZE: int = 4
"""Minimum total number of price points required to emit a currency.

Below this the hourly aggregation is too sparse — a single noisy snapshot
could move an hour's mean dramatically. 4 points = at least 4 distinct
timestamps in the window, spread across at least 2 hours (assuming
MIN_HOURS_COVERED is also met).
"""

MIN_HOURS_COVERED: int = 2
"""Minimum number of distinct UTC hours that have ≥1 price point.

A currency with all logs in a single hour has no "intraday" pattern —
there's no variation to detect. We need at least 2 distinct hours to
compute a meaningful max-min range.
"""

SIGNIFICANT_RANGE_PCT: float = 10.0
"""Minimum |max_hour_mean - min_hour_mean| / overall_mean * 100 to flag
a currency as having a "significant" intraday pattern.

10% matches the playbook spec: "Сигнализировать, если |max - min| /
overall_mean > 10%". Below this, the buy/sell windows exist but the
edge is too thin to act on (transaction spread will eat the gain).
"""

DEFAULT_DAYS: int = 14
"""Default lookback window in days.

14 days (vs. 30 for circuit_patterns) because intraday patterns are
higher-frequency — daily logs can be aggregated by hour, but weekly
drift starts to dominate the hourly signal beyond ~2 weeks. The playbook
spec suggests "последние N дней" without pinning a value; 14 is a
reasonable default that balances signal freshness against sample size.
"""

DEFAULT_LIMIT: int = 50
"""Default cap on the number of currencies returned.

Sorted by ``intraday_range_pct`` descending — most actionable patterns
first. Same default as circuit_patterns.
"""

# ---------------------------------------------------------------------------
# Constants — no tuning needed
# ---------------------------------------------------------------------------

ALL_HOURS: tuple[int, ...] = tuple(range(24))
"""All 24 UTC hours, in ascending order. Used to emit a complete
hourly_stats list with count=0 for hours with no data."""

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
    Mirrors the helper in circuit_patterns.py — same semantics, copied
    to keep the module self-contained (cross-module helper imports for
    40 lines of stable code would add coupling cost > duplication cost).
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


def _std(values: list[float]) -> float:
    """Population std. Returns 0.0 for empty or single-element input."""
    n = len(values)
    if n == 0:
        return 0.0
    mu = _mean(values)
    var = sum((v - mu) ** 2 for v in values) / n
    return math.sqrt(var)


def _group_by_hour(
    points: list[tuple[datetime, float]],
) -> dict[int, list[float]]:
    """Group (timestamp, price) pairs by UTC hour-of-day (0..23).

    Returns a dict[hour, list[prices]]. Hours with no data are absent
    from the dict — callers that need a complete 24-hour row should
    iterate ``ALL_HOURS`` and use ``.get(hour, [])``.
    """
    by_hour: dict[int, list[float]] = {h: [] for h in ALL_HOURS}
    for ts, price in points:
        # Normalize to UTC before extracting the hour — defensive against
        # any tz-aware-but-non-UTC timestamps that slipped through.
        ts_utc = ts.astimezone(timezone.utc) if ts.tzinfo else ts.replace(tzinfo=timezone.utc)
        h = ts_utc.hour
        by_hour[h].append(price)
    return by_hour


def _hourly_stats(by_hour: dict[int, list[float]]) -> list[dict]:
    """Compute per-hour mean/std/count for all 24 UTC hours.

    Always returns a list of 24 dicts (one per hour 0..23). Hours with
    no data have ``mean=None``, ``std=None``, ``count=0``. This makes
    the UI heatmap rendering trivial — no gap-handling needed.
    """
    out: list[dict] = []
    for h in ALL_HOURS:
        prices = by_hour.get(h, [])
        if prices:
            out.append({
                "hour": h,
                "mean": round(_mean(prices), 6),
                "std": round(_std(prices), 6),
                "count": len(prices),
            })
        else:
            out.append({
                "hour": h,
                "mean": None,
                "std": None,
                "count": 0,
            })
    return out


def _overall_mean(by_hour: dict[int, list[float]]) -> float:
    """Mean of ALL prices across all hours (NOT mean of hourly means).

    This is the denominator for the significance ratio. Using all-points
    mean (not hourly-mean-of-means) gives more weight to hours with more
    data — fairer when sample sizes vary by hour (Asia-wake hours will
    typically have more farmer activity = more price logs).
    """
    all_prices: list[float] = []
    for prices in by_hour.values():
        all_prices.extend(prices)
    return _mean(all_prices) if all_prices else 0.0


def _find_buy_sell_windows(
    hourly: list[dict],
) -> tuple[int | None, int | None, float | None, float | None]:
    """Find the buy (min mean) and sell (max mean) window hours.

    Only considers hours with ``count > 0`` (i.e. ``mean is not None``).
    Returns (buy_hour, sell_hour, buy_mean, sell_mean). All four are
    ``None`` when no hour has data (defensive — shouldn't happen because
    the caller filters currencies below MIN_SAMPLE_SIZE, but defensive).

    Tie-breaking: when multiple hours share the min/max mean, the lowest
    hour index wins (deterministic for tests).
    """
    valid = [h for h in hourly if h["count"] > 0]
    if not valid:
        return None, None, None, None

    # Buy window = hour with min mean price (best hour to BUY).
    buy = min(valid, key=lambda h: (h["mean"], h["hour"]))
    # Sell window = hour with max mean price (best hour to SELL).
    sell = max(valid, key=lambda h: (h["mean"], -h["hour"]))
    return buy["hour"], sell["hour"], buy["mean"], sell["mean"]


def _intraday_range_pct(
    buy_mean: float | None,
    sell_mean: float | None,
    overall_mean: float,
) -> float:
    """|(sell_mean - buy_mean) / overall_mean| * 100.

    Returns 0.0 when any input is None or overall_mean is 0. The
    absolute value is used because the buy window is always the min —
    the range is non-negative by construction, but defensive coding
    against floating-point noise.
    """
    if buy_mean is None or sell_mean is None or overall_mean <= 0:
        return 0.0
    return abs(sell_mean - buy_mean) / overall_mean * 100.0


def _hours_covered(by_hour: dict[int, list[float]]) -> int:
    """Number of distinct UTC hours with ≥1 price point."""
    return sum(1 for prices in by_hour.values() if prices)


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------


def compute_intraday_patterns(
    snapshot: DataSnapshot,
    config,
    *,
    days: int = DEFAULT_DAYS,
    limit: int = DEFAULT_LIMIT,
    now: datetime | None = None,
) -> dict:
    """Compute intraday (hour-of-day UTC) price patterns for every currency.

    Args:
        snapshot: DataSnapshot from ``get_snapshot()`` — must have
            ``.currencies`` (dict[api_id_lower, raw_dict]).
        config: AppConfig — uses ``.league.league_name`` only.
        days: Lookback window in days. Defaults to ``DEFAULT_DAYS`` (14).
        limit: Maximum number of currencies to return. Sorted by
            ``intraday_range_pct`` descending. Defaults to ``DEFAULT_LIMIT``
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
                        "hourly_stats": [   # always 24 entries (hour 0..23)
                            {
                                "hour": int,             # 0..23
                                "mean": float | None,    # None when count=0
                                "std": float | None,     # None when count=0
                                "count": int,            # 0 when no data
                            },
                            ...24 entries total
                        ],
                        "buy_window_hour": int | None,   # 0..23, None if no data
                        "sell_window_hour": int | None,  # 0..23, None if no data
                        "buy_window_mean": float | None,
                        "sell_window_mean": float | None,
                        "overall_mean": float,
                        "intraday_range_pct": float,    # |sell-buy|/overall*100
                        "has_significant_pattern": bool, # range >= 10%
                        "sample_size": int,             # total points in window
                        "current_price": float,
                    },
                    ...
                ],
                "data_available": bool,
                "fetched_at": str (ISO 8601),
            }

        ``data_available=False`` (with empty patterns list) when the
        snapshot has no currencies or none have enough price_logs in
        enough distinct hours.

    Sorting:
        Patterns are sorted by ``intraday_range_pct`` descending (most
        actionable intraday pattern first). Ties broken by larger
        ``sample_size`` (more reliable aggregation). This matches the
        convention used by ``compute_circuit_patterns`` (sort by
        ``|total_change_pct|`` desc, ties by sample_size).
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

        window_points = _filter_to_window(all_points, days, today)
        if len(window_points) < MIN_SAMPLE_SIZE:
            continue

        by_hour = _group_by_hour(window_points)
        if _hours_covered(by_hour) < MIN_HOURS_COVERED:
            continue

        any_data = True

        hourly = _hourly_stats(by_hour)
        overall = _overall_mean(by_hour)
        buy_h, sell_h, buy_m, sell_m = _find_buy_sell_windows(hourly)
        range_pct = _intraday_range_pct(buy_m, sell_m, overall)
        significant = range_pct >= SIGNIFICANT_RANGE_PCT

        patterns.append({
            "api_id": api_id,
            "text": curr.get("Text") or curr.get("text") or api_id,
            "category": (
                curr.get("CategoryApiId")
                or curr.get("category_api_id")
                or ""
            ),
            "hourly_stats": hourly,
            "buy_window_hour": buy_h,
            "sell_window_hour": sell_h,
            "buy_window_mean": round(buy_m, 6) if buy_m is not None else None,
            "sell_window_mean": round(sell_m, 6) if sell_m is not None else None,
            "overall_mean": round(overall, 6),
            "intraday_range_pct": round(range_pct, 2),
            "has_significant_pattern": significant,
            "sample_size": len(window_points),
            "current_price": float(
                curr.get("CurrentPrice")
                or curr.get("current_price")
                or window_points[-1][1]
            ),
        })

    # Sort: most actionable intraday pattern first (largest range_pct).
    # Ties broken by larger sample_size (more reliable aggregation).
    patterns.sort(
        key=lambda p: (p["intraday_range_pct"], p["sample_size"]),
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
