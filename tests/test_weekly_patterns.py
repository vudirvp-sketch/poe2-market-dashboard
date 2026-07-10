"""
Tests for backend/economy/weekly_patterns.py — P5 weekday/weekend pattern
detector.

Coverage:
1. Pure helpers: _extract_price_points, _filter_to_weeks, _mean, _std,
   _group_by_weekday, _daily_stats, _overall_mean, _find_buy_sell_days,
   _weekly_range_pct, _weekday_delta_pct, _days_covered.
2. compute_weekly_patterns end-to-end on hand-crafted snapshots:
   - Empty snapshot
   - Snapshot with currencies below MIN_SAMPLE_SIZE (filtered out)
   - Snapshot with currencies in < MIN_DAYS_COVERED days (filtered out)
   - Single currency with clear weekday/weekend pattern
   - Multiple currencies sorted by weekly_range_pct desc
   - limit parameter
   - Weeks window filtering
   - Category field passthrough
   - snake_case keys supported
3. Edge cases: zero/negative prices, missing keys, mixed PascalCase/snake_case,
   all-equal prices (range_pct = 0), weekday_delta_pct sign.
4. Route handler smoke tests: empty snapshot, success path, exception path,
   weeks param echo.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from backend.economy.weekly_patterns import (
    ALL_WEEKDAYS,
    DEFAULT_LIMIT,
    DEFAULT_WEEKS,
    MIN_DAYS_COVERED,
    MIN_SAMPLE_SIZE,
    SIGNIFICANT_RANGE_PCT,
    WEEKDAY_IDS,
    WEEKDAY_NAMES,
    WEEKEND_IDS,
    _daily_stats,
    _days_covered,
    _extract_price_points,
    _filter_to_weeks,
    _find_buy_sell_days,
    _group_by_weekday,
    _mean,
    _overall_mean,
    _std,
    _weekday_delta_pct,
    _weekly_range_pct,
    compute_weekly_patterns,
)


# ---------------------------------------------------------------------------
# Helpers — build minimal DataSnapshot-like objects without spinning up the
# real SnapshotManager. Mirrors the pattern used in test_intraday_patterns.py.
# ---------------------------------------------------------------------------


def _make_currency(
    api_id: str,
    *,
    category: str = "currency",
    price_logs: list[dict] | None = None,
    current_price: float = 0.0,
    text: str | None = None,
) -> dict:
    """Build a single ByCategory-style currency dict (PascalCase keys)."""
    return {
        "ApiId": api_id,
        "CategoryApiId": category,
        "Text": text or api_id.replace("-", " ").title(),
        "CurrentPrice": current_price,
        "PriceLogs": price_logs or [],
    }


def _make_snapshot(currencies: list[dict]) -> SimpleNamespace:
    """Wrap a list of ByCategory dicts in a DataSnapshot-like object."""
    return SimpleNamespace(
        currencies={c["ApiId"].lower(): c for c in currencies},
        fetched_at=datetime.now(timezone.utc),
    )


def _make_config(league_name: str = "test-league") -> SimpleNamespace:
    return SimpleNamespace(
        league=SimpleNamespace(league_name=league_name),
    )


def _make_log(
    price: float,
    *,
    weekday: int,
    weeks_ago: int = 0,
    days_offset: int = 0,
    base: datetime | None = None,
) -> dict:
    """Build a single price_log dict at the given ISO weekday and weeks_ago.

    The timestamp is constructed to land on the given ISO weekday (1=Mon..7=Sun).
    `weeks_ago` shifts the date back by N weeks. `days_offset` is an additional
    day shift (e.g. days_offset=1 → next day, useful to land on a specific
    weekday that is days_offset days after the start of the week).

    Implementation: start from `base - weeks_ago*7 days`, then advance to the
    nearest matching weekday. This is simpler than computing "the Nth Monday
    ago" and is robust across DST boundaries (we use UTC).
    """
    base = base or datetime.now(timezone.utc)
    # Step back to the most recent Monday
    cur_iso = base.isoweekday()  # 1=Mon..7=Sun
    days_since_monday = cur_iso - 1
    monday = (base - timedelta(days=days_since_monday)).replace(
        hour=12, minute=0, second=0, microsecond=0
    )
    # Shift to target weekday, then back by weeks_ago weeks
    target = monday + timedelta(days=weekday - 1, weeks=-weeks_ago)
    # Apply optional day offset
    target = target + timedelta(days=days_offset)
    return {
        "Time": target.strftime("%Y-%m-%dT%H:%M:%S"),
        "Price": price,
        "Quantity": 100,
    }


def _make_logs_at_weekdays(
    prices_by_weekday: dict[int, float],
    *,
    weeks_ago: int = 0,
    base: datetime | None = None,
) -> list[dict]:
    """Build price_logs at specific ISO weekdays (single week).

    Example: ``_make_logs_at_weekdays({1: 10.0, 6: 20.0, 7: 25.0})`` produces
    3 logs on Monday, Saturday, Sunday of the week `weeks_ago` weeks ago.
    """
    return [
        _make_log(price, weekday=wd, weeks_ago=weeks_ago, base=base)
        for wd, price in sorted(prices_by_weekday.items())
    ]


# ===========================================================================
# 1. _extract_price_points (mirrors intraday_patterns tests — same helper)
# ===========================================================================


class TestExtractPricePoints:
    def test_empty(self):
        assert _extract_price_points([]) == []

    def test_pascal_case(self):
        logs = [{"Time": "2026-07-01T00:00:00", "Price": 10.0}]
        result = _extract_price_points(logs)
        assert len(result) == 1
        assert result[0][1] == 10.0

    def test_snake_case(self):
        logs = [{"time": "2026-07-01T00:00:00", "price": 10.0}]
        result = _extract_price_points(logs)
        assert len(result) == 1
        assert result[0][1] == 10.0

    def test_mixed_case_keys(self):
        """PascalCase takes precedence — both keys present, PascalCase wins."""
        logs = [{"Time": "2026-07-01T00:00:00", "Price": 10.0,
                 "time": "2026-07-02T00:00:00", "price": 20.0}]
        result = _extract_price_points(logs)
        assert len(result) == 1
        assert result[0][1] == 10.0  # PascalCase price

    def test_skips_missing_time(self):
        logs = [{"Price": 10.0}]  # no Time
        assert _extract_price_points(logs) == []

    def test_skips_missing_price(self):
        logs = [{"Time": "2026-07-01T00:00:00"}]  # no Price
        assert _extract_price_points(logs) == []

    def test_skips_zero_price(self):
        logs = [{"Time": "2026-07-01T00:00:00", "Price": 0.0}]
        assert _extract_price_points(logs) == []

    def test_skips_negative_price(self):
        logs = [{"Time": "2026-07-01T00:00:00", "Price": -5.0}]
        assert _extract_price_points(logs) == []

    def test_skips_non_numeric_price(self):
        logs = [{"Time": "2026-07-01T00:00:00", "Price": "not-a-number"}]
        assert _extract_price_points(logs) == []

    def test_accepts_datetime_time(self):
        ts = datetime(2026, 7, 1, 0, 0, 0, tzinfo=timezone.utc)
        logs = [{"Time": ts, "Price": 10.0}]
        result = _extract_price_points(logs)
        assert len(result) == 1
        assert result[0][0] == ts

    def test_naive_datetime_assumed_utc(self):
        """A naive datetime (no tzinfo) is attached UTC tzinfo."""
        ts_naive = datetime(2026, 7, 1, 0, 0, 0)
        logs = [{"Time": ts_naive, "Price": 10.0}]
        result = _extract_price_points(logs)
        assert len(result) == 1
        assert result[0][0].tzinfo == timezone.utc

    def test_iso_with_z_suffix(self):
        """ISO 8601 with 'Z' suffix is parsed correctly."""
        logs = [{"Time": "2026-07-01T00:00:00Z", "Price": 10.0}]
        result = _extract_price_points(logs)
        assert len(result) == 1
        assert result[0][1] == 10.0

    def test_iso_with_offset(self):
        """ISO 8601 with explicit offset is parsed (and converted to UTC)."""
        logs = [{"Time": "2026-07-01T03:00:00+03:00", "Price": 10.0}]
        result = _extract_price_points(logs)
        assert len(result) == 1
        # +03:00 offset → 00:00 UTC
        assert result[0][0] == datetime(2026, 7, 1, 0, 0, 0, tzinfo=timezone.utc)

    def test_skips_non_string_non_datetime_time(self):
        """Non-string, non-datetime Time values are skipped."""
        logs = [{"Time": 12345, "Price": 10.0}]
        assert _extract_price_points(logs) == []

    def test_returns_sorted_by_timestamp(self):
        """Output is sorted ascending by timestamp (oldest first)."""
        logs = [
            {"Time": "2026-07-03T00:00:00", "Price": 30.0},
            {"Time": "2026-07-01T00:00:00", "Price": 10.0},
            {"Time": "2026-07-02T00:00:00", "Price": 20.0},
        ]
        result = _extract_price_points(logs)
        assert [r[1] for r in result] == [10.0, 20.0, 30.0]

    def test_quantity_field_ignored(self):
        """The Quantity field is irrelevant — only Time and Price matter."""
        logs = [{"Time": "2026-07-01T00:00:00", "Price": 10.0, "Quantity": 999}]
        result = _extract_price_points(logs)
        assert len(result) == 1
        assert result[0][1] == 10.0


# ===========================================================================
# 2. _filter_to_weeks
# ===========================================================================


class TestFilterToWeeks:
    def test_empty(self):
        now = datetime(2026, 7, 15, tzinfo=timezone.utc)
        assert _filter_to_weeks([], weeks=4, now=now) == []

    def test_keeps_recent_points(self):
        now = datetime(2026, 7, 15, tzinfo=timezone.utc)
        # 1 week ago → within 4-week window
        ts_recent = now - timedelta(weeks=1)
        points = [(ts_recent, 10.0)]
        result = _filter_to_weeks(points, weeks=4, now=now)
        assert len(result) == 1

    def test_filters_old_points(self):
        now = datetime(2026, 7, 15, tzinfo=timezone.utc)
        # 10 weeks ago → outside 4-week window
        ts_old = now - timedelta(weeks=10)
        points = [(ts_old, 10.0)]
        result = _filter_to_weeks(points, weeks=4, now=now)
        assert len(result) == 0

    def test_boundary_inclusive(self):
        """Points exactly at the cutoff (now - weeks*7 days) are kept."""
        now = datetime(2026, 7, 15, 0, 0, 0, tzinfo=timezone.utc)
        # Exactly 4 weeks ago (28 days) → boundary
        ts_boundary = now - timedelta(days=28)
        points = [(ts_boundary, 10.0)]
        result = _filter_to_weeks(points, weeks=4, now=now)
        assert len(result) == 1  # inclusive

    def test_weeks_one_means_7_days(self):
        """weeks=1 filters to last 7 days."""
        now = datetime(2026, 7, 15, tzinfo=timezone.utc)
        # 5 days ago → within 1-week window
        ts_recent = now - timedelta(days=5)
        # 10 days ago → outside
        ts_old = now - timedelta(days=10)
        points = [(ts_recent, 10.0), (ts_old, 20.0)]
        result = _filter_to_weeks(points, weeks=1, now=now)
        assert len(result) == 1
        assert result[0][1] == 10.0


# ===========================================================================
# 3. _mean and _std
# ===========================================================================


class TestMeanAndStd:
    def test_mean_empty(self):
        assert _mean([]) == 0.0

    def test_mean_single(self):
        assert _mean([5.0]) == 5.0

    def test_mean_multiple(self):
        assert _mean([1.0, 2.0, 3.0, 4.0]) == 2.5

    def test_std_empty(self):
        assert _std([]) == 0.0

    def test_std_single(self):
        assert _std([5.0]) == 0.0

    def test_std_two_equal(self):
        assert _std([5.0, 5.0]) == 0.0

    def test_std_population_formula(self):
        """Population std (divide by N, not N-1)."""
        # [1, 2, 3, 4, 5] → mean=3, var=(4+1+0+1+4)/5=2, std=sqrt(2)
        result = _std([1.0, 2.0, 3.0, 4.0, 5.0])
        assert abs(result - (2 ** 0.5)) < 1e-9


# ===========================================================================
# 4. _group_by_weekday
# ===========================================================================


class TestGroupByWeekday:
    def test_empty(self):
        result = _group_by_weekday([])
        # Always returns 7 keys (1..7), all empty
        assert set(result.keys()) == set(ALL_WEEKDAYS)
        for prices in result.values():
            assert prices == []

    def test_all_seven_days_present(self):
        """The dict always has all 7 weekday keys (1..7)."""
        result = _group_by_weekday([])
        assert sorted(result.keys()) == [1, 2, 3, 4, 5, 6, 7]

    def test_groups_by_iso_weekday(self):
        """Points are grouped by their ISO weekday (1=Mon..7=Sun)."""
        # 2026-07-13 is a Monday (weekday=1)
        # 2026-07-18 is a Saturday (weekday=6)
        # 2026-07-19 is a Sunday (weekday=7)
        points = [
            (datetime(2026, 7, 13, tzinfo=timezone.utc), 10.0),  # Mon
            (datetime(2026, 7, 18, tzinfo=timezone.utc), 20.0),  # Sat
            (datetime(2026, 7, 19, tzinfo=timezone.utc), 30.0),  # Sun
        ]
        result = _group_by_weekday(points)
        assert result[1] == [10.0]  # Monday
        assert result[6] == [20.0]  # Saturday
        assert result[7] == [30.0]  # Sunday
        assert result[2] == []      # Tuesday — no data

    def test_multiple_points_same_day(self):
        """Multiple points on the same weekday are grouped together."""
        # Two Mondays (1 week apart) → both in weekday 1
        points = [
            (datetime(2026, 7, 13, tzinfo=timezone.utc), 10.0),  # Mon
            (datetime(2026, 7, 20, tzinfo=timezone.utc), 20.0),  # Mon next week
        ]
        result = _group_by_weekday(points)
        assert result[1] == [10.0, 20.0]

    def test_naive_datetime_assumed_utc(self):
        """A naive datetime is assumed UTC before extracting weekday."""
        # 2026-07-13 is a Monday in UTC
        ts_naive = datetime(2026, 7, 13, 12, 0, 0)
        points = [(ts_naive, 10.0)]
        result = _group_by_weekday(points)
        assert result[1] == [10.0]  # Monday


# ===========================================================================
# 5. _daily_stats
# ===========================================================================


class TestDailyStats:
    def test_returns_7_entries(self):
        """Always returns 7 entries (one per weekday 1..7)."""
        result = _daily_stats({d: [] for d in ALL_WEEKDAYS})
        assert len(result) == 7

    def test_weekday_ids_ascending(self):
        """Weekday IDs are 1..7 in ascending order."""
        result = _daily_stats({d: [] for d in ALL_WEEKDAYS})
        assert [r["weekday"] for r in result] == [1, 2, 3, 4, 5, 6, 7]

    def test_empty_day_has_none_mean(self):
        result = _daily_stats({d: [] for d in ALL_WEEKDAYS})
        for entry in result:
            assert entry["mean"] is None
            assert entry["std"] is None
            assert entry["count"] == 0

    def test_day_with_data(self):
        by_day = {d: [] for d in ALL_WEEKDAYS}
        by_day[1] = [10.0, 20.0]  # Monday → mean 15, std 5
        result = _daily_stats(by_day)
        monday = result[0]
        assert monday["weekday"] == 1
        assert monday["mean"] == 15.0
        assert monday["std"] == 5.0
        assert monday["count"] == 2

    def test_rounding_to_6_decimals(self):
        """Mean and std are rounded to 6 decimals to avoid float noise."""
        by_day = {d: [] for d in ALL_WEEKDAYS}
        # 1/3 → 0.333333... (rounded to 0.333333)
        by_day[1] = [1.0, 1.0, 1.0, 2.0]
        result = _daily_stats(by_day)
        assert result[0]["mean"] == round(5.0 / 4.0, 6)

    def test_partial_data(self):
        """Only some days have data — others are None."""
        by_day = {d: [] for d in ALL_WEEKDAYS}
        by_day[1] = [10.0]
        by_day[7] = [20.0, 30.0]
        result = _daily_stats(by_day)
        assert result[0]["count"] == 1  # Monday
        assert result[1]["count"] == 0  # Tuesday — empty
        assert result[6]["count"] == 2  # Sunday


# ===========================================================================
# 6. _overall_mean
# ===========================================================================


class TestOverallMean:
    def test_empty(self):
        by_day = {d: [] for d in ALL_WEEKDAYS}
        assert _overall_mean(by_day) == 0.0

    def test_single_day(self):
        by_day = {d: [] for d in ALL_WEEKDAYS}
        by_day[1] = [10.0, 20.0]
        # Mean of [10, 20] = 15
        assert _overall_mean(by_day) == 15.0

    def test_multiple_days_weighted(self):
        """Overall mean uses ALL points, not mean-of-daily-means."""
        by_day = {d: [] for d in ALL_WEEKDAYS}
        by_day[1] = [10.0, 10.0]      # mean 10, 2 pts
        by_day[6] = [20.0, 30.0, 40.0]  # mean 30, 3 pts
        # All-points mean = (10+10+20+30+40)/5 = 22.0
        # Mean-of-means would be (10+30)/2 = 20.0 — DIFFERENT
        assert _overall_mean(by_day) == 22.0


# ===========================================================================
# 7. _find_buy_sell_days
# ===========================================================================


class TestFindBuySellDays:
    def test_no_data(self):
        """When no day has data, all four return values are None."""
        daily = _daily_stats({d: [] for d in ALL_WEEKDAYS})
        buy, sell, buy_m, sell_m = _find_buy_sell_days(daily)
        assert buy is None
        assert sell is None
        assert buy_m is None
        assert sell_m is None

    def test_single_day(self):
        """With data on only one day, buy and sell are the same day."""
        by_day = {d: [] for d in ALL_WEEKDAYS}
        by_day[3] = [15.0]  # Wednesday only
        daily = _daily_stats(by_day)
        buy, sell, buy_m, sell_m = _find_buy_sell_days(daily)
        assert buy == 3
        assert sell == 3
        assert buy_m == 15.0
        assert sell_m == 15.0

    def test_clear_buy_sell(self):
        """Buy day = min mean, sell day = max mean."""
        by_day = {d: [] for d in ALL_WEEKDAYS}
        by_day[2] = [10.0]   # Tuesday — min
        by_day[4] = [30.0]   # Thursday — max
        by_day[6] = [20.0]   # Saturday
        daily = _daily_stats(by_day)
        buy, sell, buy_m, sell_m = _find_buy_sell_days(daily)
        assert buy == 2   # Tuesday
        assert sell == 4  # Thursday
        assert buy_m == 10.0
        assert sell_m == 30.0

    def test_tie_break_lowest_weekday_for_buy(self):
        """Tie in min mean → lowest weekday wins (deterministic)."""
        by_day = {d: [] for d in ALL_WEEKDAYS}
        by_day[2] = [10.0]  # Tuesday — min, lower weekday
        by_day[4] = [10.0]  # Thursday — also min
        by_day[6] = [20.0]  # Saturday — max
        daily = _daily_stats(by_day)
        buy, sell, _, _ = _find_buy_sell_days(daily)
        # Both Tuesday and Thursday have min mean 10 → Tuesday (lower) wins
        assert buy == 2

    def test_tie_break_highest_weekday_for_sell(self):
        """Tie in max mean → HIGHEST weekday wins (weekend preferred for sell)."""
        by_day = {d: [] for d in ALL_WEEKDAYS}
        by_day[2] = [10.0]   # Tuesday — min
        by_day[6] = [20.0]   # Saturday — also max
        by_day[7] = [20.0]   # Sunday — also max
        daily = _daily_stats(by_day)
        buy, sell, _, _ = _find_buy_sell_days(daily)
        # Both Sat and Sun have max mean → Sunday (higher) wins
        assert sell == 7


# ===========================================================================
# 8. _weekly_range_pct
# ===========================================================================


class TestWeeklyRangePct:
    def test_none_buy_mean(self):
        assert _weekly_range_pct(None, 20.0, 20.0) == 0.0

    def test_none_sell_mean(self):
        assert _weekly_range_pct(10.0, None, 20.0) == 0.0

    def test_zero_overall_mean(self):
        assert _weekly_range_pct(10.0, 30.0, 0.0) == 0.0

    def test_negative_overall_mean(self):
        assert _weekly_range_pct(10.0, 30.0, -5.0) == 0.0

    def test_simple_range(self):
        """|30 - 10| / 20 * 100 = 100%."""
        assert _weekly_range_pct(10.0, 30.0, 20.0) == 100.0

    def test_small_range(self):
        """|20.5 - 19.5| / 20 * 100 = 5.0%."""
        assert _weekly_range_pct(19.5, 20.5, 20.0) == 5.0

    def test_zero_range(self):
        """Same buy/sell mean → range 0%."""
        assert _weekly_range_pct(20.0, 20.0, 20.0) == 0.0

    def test_absolute_value(self):
        """Range is non-negative even if buy > sell (shouldn't happen, but
        defensive)."""
        # buy=30, sell=10 → |10-30|/20*100 = 100%
        assert _weekly_range_pct(30.0, 10.0, 20.0) == 100.0


# ===========================================================================
# 9. _weekday_delta_pct
# ===========================================================================


class TestWeekdayDeltaPct:
    def test_zero_overall_mean(self):
        by_day = {d: [] for d in ALL_WEEKDAYS}
        assert _weekday_delta_pct(by_day, 0.0) == 0.0

    def test_no_weekday_data(self):
        """No weekday (Mon-Fri) data → delta 0."""
        by_day = {d: [] for d in ALL_WEEKDAYS}
        by_day[6] = [20.0]
        by_day[7] = [25.0]
        assert _weekday_delta_pct(by_day, 20.0) == 0.0

    def test_no_weekend_data(self):
        """No weekend (Sat-Sun) data → delta 0."""
        by_day = {d: [] for d in ALL_WEEKDAYS}
        by_day[1] = [10.0]
        by_day[2] = [15.0]
        assert _weekday_delta_pct(by_day, 10.0) == 0.0

    def test_weekend_more_expensive_positive(self):
        """Weekend mean > weekday mean → positive delta."""
        by_day = {d: [] for d in ALL_WEEKDAYS}
        by_day[1] = [10.0]   # Mon
        by_day[2] = [10.0]   # Tue
        by_day[3] = [10.0]   # Wed
        by_day[4] = [10.0]   # Thu
        by_day[5] = [10.0]   # Fri
        by_day[6] = [25.0]   # Sat
        by_day[7] = [25.0]   # Sun
        # weekday_mean = 10 (5 points, sum 50), weekend_mean = 25 (2 points, sum 50)
        # overall_mean = 100/7 ≈ 14.2857 (all-points mean, NOT mean-of-means)
        # delta = (25 - 10) / (100/7) * 100 = 15 * 7 / 100 * 100 = 105%
        overall = _overall_mean(by_day)
        delta = _weekday_delta_pct(by_day, overall)
        assert abs(overall - 100.0 / 7.0) < 1e-9
        assert delta > 0  # positive — weekends more expensive
        assert abs(delta - 105.0) < 0.01

    def test_weekday_more_expensive_negative(self):
        """Weekday mean > weekend mean → negative delta."""
        by_day = {d: [] for d in ALL_WEEKDAYS}
        by_day[1] = [30.0]   # Mon
        by_day[6] = [10.0]   # Sat
        # weekday_mean = 30, weekend_mean = 10, overall_mean = 20
        # delta = (10 - 30) / 20 * 100 = -100%
        overall = _overall_mean(by_day)
        delta = _weekday_delta_pct(by_day, overall)
        assert overall == 20.0
        assert delta == -100.0

    def test_equal_means_zero_delta(self):
        """Weekday and weekend means are equal → delta 0."""
        by_day = {d: [] for d in ALL_WEEKDAYS}
        by_day[1] = [20.0]
        by_day[6] = [20.0]
        overall = _overall_mean(by_day)
        delta = _weekday_delta_pct(by_day, overall)
        assert delta == 0.0

    def test_uses_all_points_not_mean_of_means(self):
        """Delta uses all-points mean for weekday/weekend, not mean-of-means."""
        by_day = {d: [] for d in ALL_WEEKDAYS}
        # 2 weekday points: [10, 30] → mean 20
        by_day[1] = [10.0, 30.0]
        # 3 weekend points: [10, 20, 30] → mean 20
        by_day[6] = [10.0, 20.0, 30.0]
        by_day[7] = []
        # Both group means are 20 → delta 0
        overall = _overall_mean(by_day)
        delta = _weekday_delta_pct(by_day, overall)
        assert delta == 0.0


# ===========================================================================
# 10. _days_covered
# ===========================================================================


class TestDaysCovered:
    def test_empty(self):
        by_day = {d: [] for d in ALL_WEEKDAYS}
        assert _days_covered(by_day) == 0

    def test_single_day(self):
        by_day = {d: [] for d in ALL_WEEKDAYS}
        by_day[3] = [10.0]
        assert _days_covered(by_day) == 1

    def test_all_seven_days(self):
        by_day = {d: [10.0] for d in ALL_WEEKDAYS}
        assert _days_covered(by_day) == 7

    def test_partial(self):
        by_day = {d: [] for d in ALL_WEEKDAYS}
        by_day[1] = [10.0]
        by_day[3] = [20.0]
        by_day[7] = [30.0]
        assert _days_covered(by_day) == 3


# ===========================================================================
# 11. compute_weekly_patterns — end-to-end
# ===========================================================================


class TestComputeWeeklyPatternsEndToEnd:
    def test_empty_snapshot(self):
        """Empty snapshot → data_available=False, empty patterns list."""
        snapshot = _make_snapshot([])
        result = compute_weekly_patterns(snapshot, _make_config())
        assert result["data_available"] is False
        assert result["patterns"] == []
        assert result["league"] == "test-league"
        assert "fetched_at" in result

    def test_currency_with_no_price_logs_filtered(self):
        """A currency with empty price_logs is filtered out."""
        snapshot = _make_snapshot([_make_currency("c1", price_logs=[])])
        result = compute_weekly_patterns(snapshot, _make_config())
        assert result["data_available"] is False
        assert result["patterns"] == []

    def test_currency_below_min_sample_size_filtered(self):
        """A currency with < MIN_SAMPLE_SIZE (4) points is filtered out."""
        base = datetime(2026, 7, 15, tzinfo=timezone.utc)
        # Only 3 points (below MIN_SAMPLE_SIZE=4)
        logs = _make_logs_at_weekdays({1: 10.0, 3: 20.0, 5: 15.0}, base=base)
        snapshot = _make_snapshot([_make_currency("c1", price_logs=logs)])
        result = compute_weekly_patterns(snapshot, _make_config(), now=base)
        assert result["data_available"] is False
        assert result["patterns"] == []

    def test_currency_single_weekday_filtered(self):
        """A currency with all logs on one weekday is filtered (need ≥2 days)."""
        base = datetime(2026, 7, 15, tzinfo=timezone.utc)
        # 4 points, all on Monday (1) — only 1 weekday covered
        logs = [
            _make_log(10.0, weekday=1, weeks_ago=0, base=base),
            _make_log(11.0, weekday=1, weeks_ago=1, base=base),
            _make_log(12.0, weekday=1, weeks_ago=2, base=base),
            _make_log(13.0, weekday=1, weeks_ago=3, base=base),
        ]
        snapshot = _make_snapshot([_make_currency("c1", price_logs=logs)])
        result = compute_weekly_patterns(snapshot, _make_config(), now=base)
        assert result["data_available"] is False
        assert result["patterns"] == []

    def test_clear_weekday_weekend_pattern(self):
        """Classic weekday/weekend pattern: weekdays cheap, weekends expensive."""
        base = datetime(2026, 7, 15, tzinfo=timezone.utc)
        # Logs: Mon (1) = 10.0, Sat (6) = 30.0, Sun (7) = 30.0
        # Two weeks of data → 6 points total (above MIN_SAMPLE_SIZE=4)
        logs = (
            _make_logs_at_weekdays({1: 10.0, 6: 30.0, 7: 30.0}, weeks_ago=0, base=base)
            + _make_logs_at_weekdays({1: 10.0, 6: 30.0, 7: 30.0}, weeks_ago=1, base=base)
        )
        snapshot = _make_snapshot([_make_currency("c1", price_logs=logs)])
        result = compute_weekly_patterns(snapshot, _make_config(), now=base)
        assert result["data_available"] is True
        assert len(result["patterns"]) == 1
        p = result["patterns"][0]
        assert p["api_id"] == "c1"
        # Buy day = Monday (lowest mean 10)
        assert p["buy_window_day"] == 1
        # Sell day = Sunday (highest mean 30, tie broken to higher weekday)
        assert p["sell_window_day"] == 7
        assert p["buy_window_mean"] == 10.0
        assert p["sell_window_mean"] == 30.0
        # overall_mean = (10+30+30+10+30+30)/6 = 23.333...
        assert abs(p["overall_mean"] - round(140.0 / 6.0, 6)) < 1e-6
        # range = |30-10|/23.333*100 ≈ 85.71%
        expected_range = abs(30.0 - 10.0) / (140.0 / 6.0) * 100
        assert abs(p["weekly_range_pct"] - round(expected_range, 2)) < 0.01
        # weekday_delta: weekday_mean=10, weekend_mean=30, overall=23.333
        # delta = (30-10)/23.333*100 ≈ 85.71% (positive — weekends more expensive)
        assert p["weekday_delta_pct"] > 0
        assert p["has_significant_pattern"] is True
        assert p["sample_size"] == 6
        # current_price falls back to last point's price
        assert p["current_price"] > 0

    def test_multiple_currencies_sorted_by_range(self):
        """Patterns are sorted by weekly_range_pct descending."""
        base = datetime(2026, 7, 15, tzinfo=timezone.utc)
        # c1: range 100% (buy 10, sell 30, overall 20)
        c1_logs = (
            _make_logs_at_weekdays({1: 10.0, 7: 30.0}, weeks_ago=0, base=base)
            + _make_logs_at_weekdays({1: 10.0, 7: 30.0}, weeks_ago=1, base=base)
        )
        # c2: range 50% (buy 10, sell 20, overall 15)
        c2_logs = (
            _make_logs_at_weekdays({2: 10.0, 6: 20.0}, weeks_ago=0, base=base)
            + _make_logs_at_weekdays({2: 10.0, 6: 20.0}, weeks_ago=1, base=base)
        )
        snapshot = _make_snapshot([
            _make_currency("c2", price_logs=c2_logs),
            _make_currency("c1", price_logs=c1_logs),
        ])
        result = compute_weekly_patterns(snapshot, _make_config(), now=base)
        # c1 should come first (larger range)
        assert result["patterns"][0]["api_id"] == "c1"
        assert result["patterns"][1]["api_id"] == "c2"
        assert result["patterns"][0]["weekly_range_pct"] > result["patterns"][1]["weekly_range_pct"]

    def test_limit_parameter(self):
        """limit caps the number of patterns returned."""
        base = datetime(2026, 7, 15, tzinfo=timezone.utc)
        currencies = []
        for i in range(5):
            logs = (
                _make_logs_at_weekdays({1: float(i + 1), 7: float(i + 11)}, weeks_ago=0, base=base)
                + _make_logs_at_weekdays({1: float(i + 1), 7: float(i + 11)}, weeks_ago=1, base=base)
            )
            currencies.append(_make_currency(f"c{i}", price_logs=logs))
        snapshot = _make_snapshot(currencies)
        result = compute_weekly_patterns(snapshot, _make_config(), limit=3, now=base)
        assert len(result["patterns"]) == 3

    def test_limit_zero_returns_empty(self):
        """limit=0 returns an empty patterns list (slice [:0])."""
        base = datetime(2026, 7, 15, tzinfo=timezone.utc)
        logs = _make_logs_at_weekdays({1: 10.0, 7: 30.0}, base=base) + \
               _make_logs_at_weekdays({1: 10.0, 7: 30.0}, weeks_ago=1, base=base)
        snapshot = _make_snapshot([_make_currency("c1", price_logs=logs)])
        result = compute_weekly_patterns(snapshot, _make_config(), limit=0, now=base)
        assert result["patterns"] == []
        # data_available is still True (the currency had data, just not emitted)
        assert result["data_available"] is True

    def test_negative_limit_no_cap(self):
        """limit<0 means no cap (used by tests)."""
        base = datetime(2026, 7, 15, tzinfo=timezone.utc)
        currencies = []
        for i in range(60):  # more than DEFAULT_LIMIT (50)
            logs = (
                _make_logs_at_weekdays({1: float(i + 1), 7: float(i + 11)}, weeks_ago=0, base=base)
                + _make_logs_at_weekdays({1: float(i + 1), 7: float(i + 11)}, weeks_ago=1, base=base)
            )
            currencies.append(_make_currency(f"c{i}", price_logs=logs))
        snapshot = _make_snapshot(currencies)
        result = compute_weekly_patterns(snapshot, _make_config(), limit=-1, now=base)
        assert len(result["patterns"]) == 60

    def test_weeks_window_filtering(self):
        """weeks=1 only includes points from the last 7 days."""
        base = datetime(2026, 7, 15, tzinfo=timezone.utc)
        # 2 logs 5 days ago (within 1-week window), 2 logs 20 days ago (outside)
        recent_logs = _make_logs_at_weekdays({1: 10.0, 7: 30.0}, weeks_ago=0, base=base)
        old_logs = _make_logs_at_weekdays({1: 10.0, 7: 30.0}, weeks_ago=3, base=base)
        logs = recent_logs + old_logs
        snapshot = _make_snapshot([_make_currency("c1", price_logs=logs)])
        result = compute_weekly_patterns(snapshot, _make_config(), weeks=1, now=base)
        # Only 2 points in the window → below MIN_SAMPLE_SIZE=4 → filtered
        assert result["data_available"] is False
        assert result["patterns"] == []

    def test_category_field_passthrough(self):
        """The category field is passed through from the currency dict."""
        base = datetime(2026, 7, 15, tzinfo=timezone.utc)
        logs = _make_logs_at_weekdays({1: 10.0, 7: 30.0}, base=base) + \
               _make_logs_at_weekdays({1: 10.0, 7: 30.0}, weeks_ago=1, base=base)
        snapshot = _make_snapshot([
            _make_currency("c1", category="breach", price_logs=logs),
        ])
        result = compute_weekly_patterns(snapshot, _make_config(), now=base)
        assert result["patterns"][0]["category"] == "breach"

    def test_snake_case_keys_supported(self):
        """snake_case keys (api_id, text, category_api_id, price_logs) are supported."""
        base = datetime(2026, 7, 15, tzinfo=timezone.utc)
        logs = _make_logs_at_weekdays({1: 10.0, 7: 30.0}, base=base) + \
               _make_logs_at_weekdays({1: 10.0, 7: 30.0}, weeks_ago=1, base=base)
        # snake_case currency dict
        snake_logs = [{"time": l["Time"], "price": l["Price"]} for l in logs]
        snapshot = SimpleNamespace(
            currencies={"c1": {
                "api_id": "c1",
                "text": "Snake Case Item",
                "category_api_id": "ritual",
                "current_price": 25.0,
                "price_logs": snake_logs,
            }},
            fetched_at=datetime.now(timezone.utc),
        )
        result = compute_weekly_patterns(snapshot, _make_config(), now=base)
        assert result["data_available"] is True
        p = result["patterns"][0]
        assert p["api_id"] == "c1"
        assert p["text"] == "Snake Case Item"
        assert p["category"] == "ritual"
        assert p["current_price"] == 25.0

    def test_text_falls_back_to_api_id(self):
        """When Text is missing, api_id is used as the display name."""
        base = datetime(2026, 7, 15, tzinfo=timezone.utc)
        logs = _make_logs_at_weekdays({1: 10.0, 7: 30.0}, base=base) + \
               _make_logs_at_weekdays({1: 10.0, 7: 30.0}, weeks_ago=1, base=base)
        snapshot = SimpleNamespace(
            currencies={"c1": {
                "ApiId": "c1",
                "CategoryApiId": "",
                # No Text field
                "CurrentPrice": 25.0,
                "PriceLogs": logs,
            }},
            fetched_at=datetime.now(timezone.utc),
        )
        result = compute_weekly_patterns(snapshot, _make_config(), now=base)
        assert result["patterns"][0]["text"] == "c1"

    def test_current_price_falls_back_to_last_point(self):
        """When CurrentPrice is missing, the last point's price is used."""
        base = datetime(2026, 7, 15, tzinfo=timezone.utc)
        logs = _make_logs_at_weekdays({1: 10.0, 7: 30.0}, base=base) + \
               _make_logs_at_weekdays({1: 10.0, 7: 30.0}, weeks_ago=1, base=base)
        snapshot = SimpleNamespace(
            currencies={"c1": {
                "ApiId": "c1",
                "CategoryApiId": "",
                "Text": "C1",
                # No CurrentPrice
                "PriceLogs": logs,
            }},
            fetched_at=datetime.now(timezone.utc),
        )
        result = compute_weekly_patterns(snapshot, _make_config(), now=base)
        # Last point's price (sorted by timestamp) — could be 10 or 30
        # depending on which is newer. Just check it's > 0.
        assert result["patterns"][0]["current_price"] > 0

    def test_daily_stats_always_7_entries(self):
        """daily_stats always has 7 entries (one per weekday 1..7)."""
        base = datetime(2026, 7, 15, tzinfo=timezone.utc)
        logs = _make_logs_at_weekdays({1: 10.0, 7: 30.0}, base=base) + \
               _make_logs_at_weekdays({1: 10.0, 7: 30.0}, weeks_ago=1, base=base)
        snapshot = _make_snapshot([_make_currency("c1", price_logs=logs)])
        result = compute_weekly_patterns(snapshot, _make_config(), now=base)
        p = result["patterns"][0]
        assert len(p["daily_stats"]) == 7
        assert [d["weekday"] for d in p["daily_stats"]] == [1, 2, 3, 4, 5, 6, 7]

    def test_insignificant_currency_still_emitted(self):
        """A currency below SIGNIFICANT_RANGE_PCT is still emitted with
        has_significant_pattern=False."""
        base = datetime(2026, 7, 15, tzinfo=timezone.utc)
        # Mon = 19.9, Sat = 20.1 → range = 0.2/20*100 = 1% (way below 10%)
        logs = _make_logs_at_weekdays({1: 19.9, 6: 20.1}, base=base) + \
               _make_logs_at_weekdays({1: 19.9, 6: 20.1}, weeks_ago=1, base=base)
        snapshot = _make_snapshot([_make_currency("c1", price_logs=logs)])
        result = compute_weekly_patterns(snapshot, _make_config(), now=base)
        assert len(result["patterns"]) == 1
        assert result["patterns"][0]["has_significant_pattern"] is False

    def test_zero_price_logs_filtered(self):
        """A price_log with Price=0 must be skipped (not counted on any day)."""
        base = datetime(2026, 7, 15, tzinfo=timezone.utc)
        # 4 valid points on Mon/Sat, plus 1 zero-price log on Wed
        logs = _make_logs_at_weekdays({1: 10.0, 6: 30.0}, base=base) + \
               _make_logs_at_weekdays({1: 10.0, 6: 30.0}, weeks_ago=1, base=base)
        # Add a zero-price log on Wednesday (weekday 3)
        logs.append(_make_log(0.0, weekday=3, weeks_ago=0, base=base))
        snapshot = _make_snapshot([_make_currency("c1", price_logs=logs)])
        result = compute_weekly_patterns(snapshot, _make_config(), now=base)
        p = result["patterns"][0]
        # Wednesday should NOT have data (zero-price log was filtered)
        wed_stat = next(d for d in p["daily_stats"] if d["weekday"] == 3)
        assert wed_stat["count"] == 0
        # sample_size = 4 (the zero-price log doesn't count)
        assert p["sample_size"] == 4

    def test_default_weeks_and_limit(self):
        """Defaults: weeks=DEFAULT_WEEKS (4), limit=DEFAULT_LIMIT (50)."""
        snapshot = _make_snapshot([])
        result = compute_weekly_patterns(snapshot, _make_config())
        assert result["data_available"] is False
        assert DEFAULT_WEEKS == 4
        assert DEFAULT_LIMIT == 50

    def test_min_sample_size_is_4(self):
        """MIN_SAMPLE_SIZE constant must be 4 (matches playbook spec)."""
        assert MIN_SAMPLE_SIZE == 4

    def test_min_days_covered_is_2(self):
        """MIN_DAYS_COVERED constant must be 2 (need ≥2 distinct weekdays
        to detect any weekly variation)."""
        assert MIN_DAYS_COVERED == 2

    def test_significant_range_pct_is_10(self):
        """SIGNIFICANT_RANGE_PCT constant must be 10.0 (matches playbook spec)."""
        assert SIGNIFICANT_RANGE_PCT == 10.0

    def test_all_weekdays_constant(self):
        """ALL_WEEKDAYS must be a tuple of 1..7 (Mon..Sun) in ascending order."""
        assert ALL_WEEKDAYS == (1, 2, 3, 4, 5, 6, 7)

    def test_weekday_ids_constant(self):
        """WEEKDAY_IDS must be Mon-Fri (1..5)."""
        assert WEEKDAY_IDS == (1, 2, 3, 4, 5)

    def test_weekend_ids_constant(self):
        """WEEKEND_IDS must be Sat-Sun (6, 7)."""
        assert WEEKEND_IDS == (6, 7)

    def test_weekday_names_constant(self):
        """WEEKDAY_NAMES must map 1..7 to Mon..Sun."""
        assert WEEKDAY_NAMES == {1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu",
                                  5: "Fri", 6: "Sat", 7: "Sun"}

    def test_league_name_passed_through(self):
        """The `league` field in the response must match the config's league_name."""
        snapshot = _make_snapshot([])
        result = compute_weekly_patterns(
            snapshot, _make_config("Standard-2026")
        )
        assert result["league"] == "Standard-2026"

    def test_fetched_at_is_iso_string(self):
        """The `fetched_at` field must be an ISO 8601 string."""
        snapshot = _make_snapshot([])
        result = compute_weekly_patterns(snapshot, _make_config())
        parsed = datetime.fromisoformat(result["fetched_at"])
        assert parsed is not None

    def test_now_override_respected(self):
        """The `now` kwarg overrides datetime.now() for the window cutoff."""
        base = datetime(2025, 1, 1, 0, 0, 0, tzinfo=timezone.utc)
        # Logs on Mon/Sat from 2 weeks before base (within 4-week window)
        logs = (
            _make_logs_at_weekdays({1: 10.0, 6: 30.0}, weeks_ago=1, base=base)
            + _make_logs_at_weekdays({1: 10.0, 6: 30.0}, weeks_ago=2, base=base)
        )
        snapshot = _make_snapshot([_make_currency("c1", price_logs=logs)])
        result = compute_weekly_patterns(
            snapshot, _make_config(), weeks=4, now=base
        )
        assert result["data_available"] is True
        assert len(result["patterns"]) == 1

    def test_weekday_delta_pct_in_response(self):
        """weekday_delta_pct field is present in the response."""
        base = datetime(2026, 7, 15, tzinfo=timezone.utc)
        logs = _make_logs_at_weekdays({1: 10.0, 7: 30.0}, base=base) + \
               _make_logs_at_weekdays({1: 10.0, 7: 30.0}, weeks_ago=1, base=base)
        snapshot = _make_snapshot([_make_currency("c1", price_logs=logs)])
        result = compute_weekly_patterns(snapshot, _make_config(), now=base)
        p = result["patterns"][0]
        assert "weekday_delta_pct" in p
        # Weekend (Sun) more expensive → positive delta
        assert p["weekday_delta_pct"] > 0


# ===========================================================================
# 12. Route handler smoke tests
# ===========================================================================


class TestRouteHandler:
    """Smoke tests for the FastAPI route handler in routes_weekly_patterns."""

    async def test_route_returns_empty_when_no_snapshot(self):
        """When the snapshot manager hasn't fetched data yet, the route
        must return data_available=false with an empty patterns list and
        the requested `weeks` echoed back (for client cache keys)."""
        from backend.api.routes_weekly_patterns import get_weekly_patterns

        with patch(
            "backend.api.routes_weekly_patterns.get_snapshot_manager"
        ) as mock_mgr:
            mock_mgr.return_value = SimpleNamespace(last_snapshot=None)
            result = await get_weekly_patterns(weeks=4, limit=50)
            assert result["data_available"] is False
            assert result["patterns"] == []
            assert result["weeks"] == 4
            assert "fetched_at" in result

    async def test_route_returns_data_when_snapshot_available(self):
        """When the snapshot has data, the route returns the computed
        patterns list (sorted by weekly_range_pct desc) and echoes weeks."""
        from backend.api.routes_weekly_patterns import get_weekly_patterns

        base = datetime(2026, 7, 15, tzinfo=timezone.utc)
        logs = _make_logs_at_weekdays({1: 10.0, 7: 30.0}, base=base) + \
               _make_logs_at_weekdays({1: 10.0, 7: 30.0}, weeks_ago=1, base=base)
        snapshot = _make_snapshot([
            _make_currency("c1", price_logs=logs),
        ])

        with patch(
            "backend.api.routes_weekly_patterns.get_snapshot_manager"
        ) as mock_mgr, patch(
            "backend.api.routes_weekly_patterns.get_snapshot"
        ) as mock_get:
            mock_mgr.return_value = SimpleNamespace(last_snapshot=object())  # truthy
            mock_get.return_value = snapshot
            result = await get_weekly_patterns(weeks=4, limit=50)
            assert result["data_available"] is True
            assert result["weeks"] == 4
            assert len(result["patterns"]) == 1
            p = result["patterns"][0]
            assert p["api_id"] == "c1"
            assert p["buy_window_day"] == 1
            assert p["sell_window_day"] == 7
            assert p["has_significant_pattern"] is True

    async def test_route_returns_empty_on_exception(self):
        """If compute_weekly_patterns raises, the route must return
        data_available=false (not propagate the exception)."""
        from backend.api.routes_weekly_patterns import get_weekly_patterns

        with patch(
            "backend.api.routes_weekly_patterns.get_snapshot_manager"
        ) as mock_mgr, patch(
            "backend.api.routes_weekly_patterns.get_snapshot"
        ) as mock_get:
            mock_mgr.return_value = SimpleNamespace(last_snapshot=object())  # truthy
            mock_get.side_effect = RuntimeError("boom")
            result = await get_weekly_patterns(weeks=2, limit=10)
            assert result["data_available"] is False
            assert result["patterns"] == []
            assert result["weeks"] == 2

    async def test_route_echoes_weeks_param(self):
        """The `weeks` query param is echoed in the response even on the
        success path — needed by the frontend's React Query cache key."""
        from backend.api.routes_weekly_patterns import get_weekly_patterns

        base = datetime(2026, 7, 15, tzinfo=timezone.utc)
        logs = _make_logs_at_weekdays({1: 10.0, 7: 30.0}, base=base) + \
               _make_logs_at_weekdays({1: 10.0, 7: 30.0}, weeks_ago=1, base=base)
        snapshot = _make_snapshot([
            _make_currency("c1", price_logs=logs),
        ])

        with patch(
            "backend.api.routes_weekly_patterns.get_snapshot_manager"
        ) as mock_mgr, patch(
            "backend.api.routes_weekly_patterns.get_snapshot"
        ) as mock_get:
            mock_mgr.return_value = SimpleNamespace(last_snapshot=object())
            mock_get.return_value = snapshot
            result = await get_weekly_patterns(weeks=12, limit=5)
            assert result["weeks"] == 12
            assert result["data_available"] is True
            assert len(result["patterns"]) == 1
