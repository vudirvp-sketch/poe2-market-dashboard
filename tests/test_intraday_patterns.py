"""
Tests for backend/economy/intraday_patterns.py — P4 time-of-day pattern
detector.

Coverage:
1. Pure helpers: _extract_price_points, _filter_to_window, _mean, _std,
   _group_by_hour, _hourly_stats, _overall_mean, _find_buy_sell_windows,
   _intraday_range_pct, _hours_covered.
2. compute_intraday_patterns end-to-end on hand-crafted snapshots:
   - Empty snapshot
   - Snapshot with currencies below MIN_SAMPLE_SIZE (filtered out)
   - Snapshot with currencies in < MIN_HOURS_COVERED hours (filtered out)
   - Single currency with clear intraday pattern (Asia-wake dump + US-wake spike)
   - Multiple currencies sorted by intraday_range_pct desc
   - limit parameter
   - Days window filtering
   - Category field passthrough
   - snake_case keys supported
3. Edge cases: zero/negative prices, missing keys, mixed PascalCase/snake_case,
   sub-hour timestamps, all-equal prices (range_pct = 0).
4. Route handler smoke tests: empty snapshot, success path, exception path,
   days param echo.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from backend.economy.intraday_patterns import (
    ALL_HOURS,
    DEFAULT_DAYS,
    DEFAULT_LIMIT,
    MIN_HOURS_COVERED,
    MIN_SAMPLE_SIZE,
    SIGNIFICANT_RANGE_PCT,
    _extract_price_points,
    _filter_to_window,
    _find_buy_sell_windows,
    _group_by_hour,
    _hours_covered,
    _hourly_stats,
    _intraday_range_pct,
    _mean,
    _overall_mean,
    _std,
    compute_intraday_patterns,
)


# ---------------------------------------------------------------------------
# Helpers — build minimal DataSnapshot-like objects without spinning up the
# real SnapshotManager. Mirrors the pattern used in test_circuit_patterns.py.
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
    hour: int,
    days_ago: int = 0,
    base: datetime | None = None,
) -> dict:
    """Build a single price_log dict at the given UTC hour and days_ago.

    The timestamp is constructed as ``base - days_ago days, at the given
    UTC hour, minute=0, second=0``. This makes it easy to construct
    snapshots that span multiple days at specific hours.
    """
    base = base or datetime.now(timezone.utc)
    ts = (base - timedelta(days=days_ago)).replace(
        hour=hour, minute=0, second=0, microsecond=0
    )
    return {
        "Time": ts.strftime("%Y-%m-%dT%H:%M:%S"),
        "Price": price,
        "Quantity": 100,
    }


def _make_logs_at_hours(
    prices_by_hour: dict[int, float],
    *,
    days_ago: int = 0,
    base: datetime | None = None,
) -> list[dict]:
    """Build price_logs at specific UTC hours (single day).

    Example: ``_make_logs_at_hours({0: 10.0, 12: 20.0, 23: 15.0})`` produces
    3 logs at hours 0, 12, 23 of the day ``days_ago`` days ago.
    """
    return [
        _make_log(price, hour=hour, days_ago=days_ago, base=base)
        for hour, price in sorted(prices_by_hour.items())
    ]


# ===========================================================================
# 1. _extract_price_points (mirrors circuit_patterns tests — same helper)
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

    def test_skips_invalid_timestamp_string(self):
        logs = [{"Time": "not-a-date", "Price": 10.0}]
        assert _extract_price_points(logs) == []

    def test_accepts_datetime_object(self):
        ts = datetime(2026, 7, 1, 12, 0, 0, tzinfo=timezone.utc)
        logs = [{"Time": ts, "Price": 10.0}]
        result = _extract_price_points(logs)
        assert len(result) == 1
        assert result[0][0] == ts

    def test_naive_datetime_gets_utc_attached(self):
        """A timezone-naive datetime must be normalized to UTC so that
        comparisons against timezone-aware "now" don't raise TypeError."""
        ts_naive = datetime(2026, 7, 1, 12, 0, 0)
        logs = [{"Time": ts_naive, "Price": 10.0}]
        result = _extract_price_points(logs)
        assert len(result) == 1
        assert result[0][0].tzinfo is not None  # UTC attached

    def test_iso_string_with_z_suffix(self):
        """ISO 8601 strings with 'Z' suffix must parse correctly."""
        logs = [{"Time": "2026-07-01T12:00:00Z", "Price": 10.0}]
        result = _extract_price_points(logs)
        assert len(result) == 1
        assert result[0][0].hour == 12

    def test_sorted_ascending_by_timestamp(self):
        """Output must be sorted oldest-first, regardless of input order."""
        logs = [
            {"Time": "2026-07-03T00:00:00", "Price": 30.0},
            {"Time": "2026-07-01T00:00:00", "Price": 10.0},
            {"Time": "2026-07-02T00:00:00", "Price": 20.0},
        ]
        result = _extract_price_points(logs)
        assert [p for _, p in result] == [10.0, 20.0, 30.0]

    def test_skips_non_datetime_time_type(self):
        """Integer / float / list time values must be skipped (not crash)."""
        logs = [
            {"Time": 1234567890, "Price": 10.0},  # int — invalid
            {"Time": ["2026-07-01"], "Price": 10.0},  # list — invalid
        ]
        assert _extract_price_points(logs) == []


# ===========================================================================
# 2. _filter_to_window
# ===========================================================================


class TestFilterToWindow:
    def test_empty_input(self):
        now = datetime(2026, 7, 15, tzinfo=timezone.utc)
        assert _filter_to_window([], days=14, now=now) == []

    def test_keeps_points_within_window(self):
        now = datetime(2026, 7, 15, 12, 0, 0, tzinfo=timezone.utc)
        points = [
            (now - timedelta(days=5), 10.0),   # within 14d
            (now - timedelta(days=13), 20.0),  # within 14d
        ]
        result = _filter_to_window(points, days=14, now=now)
        assert len(result) == 2

    def test_filters_old_points(self):
        now = datetime(2026, 7, 15, 12, 0, 0, tzinfo=timezone.utc)
        points = [
            (now - timedelta(days=5), 10.0),    # within 14d — kept
            (now - timedelta(days=20), 20.0),   # outside 14d — dropped
            (now - timedelta(days=30), 30.0),   # outside 14d — dropped
        ]
        result = _filter_to_window(points, days=14, now=now)
        assert len(result) == 1
        assert result[0][1] == 10.0

    def test_boundary_inclusive(self):
        """A point exactly `days` ago must be kept (>= cutoff, not >)."""
        now = datetime(2026, 7, 15, 12, 0, 0, tzinfo=timezone.utc)
        boundary = now - timedelta(days=14)
        points = [(boundary, 10.0)]
        result = _filter_to_window(points, days=14, now=now)
        assert len(result) == 1

    def test_days_1_keeps_only_today(self):
        now = datetime(2026, 7, 15, 12, 0, 0, tzinfo=timezone.utc)
        points = [
            (now - timedelta(hours=12), 10.0),  # within 1d — kept
            (now - timedelta(days=2), 20.0),    # outside 1d — dropped
        ]
        result = _filter_to_window(points, days=1, now=now)
        assert len(result) == 1


# ===========================================================================
# 3. _mean, _std
# ===========================================================================


class TestMeanStd:
    def test_mean_empty(self):
        assert _mean([]) == 0.0

    def test_mean_single(self):
        assert _mean([5.0]) == 5.0

    def test_mean_multiple(self):
        assert _mean([1.0, 2.0, 3.0, 4.0]) == 2.5

    def test_std_empty(self):
        assert _std([]) == 0.0

    def test_std_single(self):
        """Population std of a single element is 0 (no variance)."""
        assert _std([5.0]) == 0.0

    def test_std_population(self):
        """Population std (ddof=0) — divides by N, not N-1."""
        # std([2, 4, 4, 4, 5, 5, 7, 9]) = 2.0 (population)
        result = _std([2.0, 4.0, 4.0, 4.0, 5.0, 5.0, 7.0, 9.0])
        assert abs(result - 2.0) < 1e-9

    def test_std_all_equal(self):
        """All-equal values → std = 0."""
        assert _std([5.0, 5.0, 5.0, 5.0]) == 0.0


# ===========================================================================
# 4. _group_by_hour
# ===========================================================================


class TestGroupByHour:
    def test_empty(self):
        result = _group_by_hour([])
        # All 24 hours present as empty lists
        assert set(result.keys()) == set(ALL_HOURS)
        assert all(v == [] for v in result.values())

    def test_single_point(self):
        ts = datetime(2026, 7, 1, 12, 0, 0, tzinfo=timezone.utc)
        result = _group_by_hour([(ts, 10.0)])
        assert result[12] == [10.0]
        assert result[0] == []
        assert result[23] == []

    def test_multiple_points_same_hour(self):
        """Two points at hour 5 → both in result[5]."""
        ts1 = datetime(2026, 7, 1, 5, 0, 0, tzinfo=timezone.utc)
        ts2 = datetime(2026, 7, 2, 5, 30, 0, tzinfo=timezone.utc)
        result = _group_by_hour([(ts1, 10.0), (ts2, 20.0)])
        assert result[5] == [10.0, 20.0]
        assert result[6] == []

    def test_points_across_hours(self):
        ts0 = datetime(2026, 7, 1, 0, 0, 0, tzinfo=timezone.utc)
        ts12 = datetime(2026, 7, 1, 12, 0, 0, tzinfo=timezone.utc)
        ts23 = datetime(2026, 7, 1, 23, 0, 0, tzinfo=timezone.utc)
        result = _group_by_hour([(ts0, 1.0), (ts12, 2.0), (ts23, 3.0)])
        assert result[0] == [1.0]
        assert result[12] == [2.0]
        assert result[23] == [3.0]

    def test_naive_datetime_treated_as_utc(self):
        """A timezone-naive datetime must be treated as UTC (defensive)."""
        ts_naive = datetime(2026, 7, 1, 15, 0, 0)  # no tzinfo
        result = _group_by_hour([(ts_naive, 10.0)])
        assert result[15] == [10.0]

    def test_non_utc_timezone_normalized(self):
        """A timezone-aware non-UTC datetime must be converted to UTC
        before extracting the hour."""
        # 2026-07-01 12:00:00 UTC+3 = 2026-07-01 09:00:00 UTC
        from datetime import timezone as tz
        ts_utc_plus_3 = datetime(2026, 7, 1, 12, 0, 0, tzinfo=tz(timedelta(hours=3)))
        result = _group_by_hour([(ts_utc_plus_3, 10.0)])
        assert result[9] == [10.0]
        assert result[12] == []


# ===========================================================================
# 5. _hourly_stats
# ===========================================================================


class TestHourlyStats:
    def test_always_24_entries(self):
        """Output must always be a list of exactly 24 dicts."""
        result = _hourly_stats({})
        assert len(result) == 24
        assert [h["hour"] for h in result] == list(range(24))

    def test_empty_hours_have_none_mean(self):
        result = _hourly_stats({})
        for h in result:
            assert h["mean"] is None
            assert h["std"] is None
            assert h["count"] == 0

    def test_single_hour_with_data(self):
        by_hour = {5: [10.0, 20.0, 30.0]}
        result = _hourly_stats(by_hour)
        assert len(result) == 24
        h5 = result[5]
        assert h5["mean"] == 20.0
        assert h5["count"] == 3
        # Population std of [10, 20, 30]: mean=20, var=(100+0+100)/3=66.67, std≈8.165
        assert abs(h5["std"] - 8.1649658) < 1e-6
        # All other hours empty
        for i, h in enumerate(result):
            if i != 5:
                assert h["mean"] is None
                assert h["count"] == 0

    def test_rounding_to_6_decimals(self):
        """Means and stds must be rounded to 6 decimal places (defensive
        against floating-point noise in the JSON output)."""
        by_hour = {0: [1.0, 2.0, 3.0]}
        result = _hourly_stats(by_hour)
        # mean = 2.0 (exact), std = sqrt(2/3) ≈ 0.8164966
        assert result[0]["mean"] == 2.0
        assert result[0]["std"] == round(0.816496580927726, 6)

    def test_hours_in_ascending_order(self):
        """Output hours must be 0, 1, 2, ..., 23 in order."""
        by_hour = {23: [1.0], 0: [2.0], 12: [3.0]}
        result = _hourly_stats(by_hour)
        assert [h["hour"] for h in result] == list(range(24))


# ===========================================================================
# 6. _overall_mean
# ===========================================================================


class TestOverallMean:
    def test_empty(self):
        assert _overall_mean({}) == 0.0
        assert _overall_mean({h: [] for h in ALL_HOURS}) == 0.0

    def test_single_hour_single_point(self):
        by_hour = {5: [10.0]}
        assert _overall_mean(by_hour) == 10.0

    def test_weighted_by_count(self):
        """Overall mean weights hours with more points higher.

        Hour 0: [1.0, 1.0] (mean=1, count=2)
        Hour 12: [10.0] (mean=10, count=1)
        Overall mean = (1+1+10) / 3 = 4.0 (NOT (1+10)/2 = 5.5)
        """
        by_hour = {0: [1.0, 1.0], 12: [10.0]}
        assert _overall_mean(by_hour) == 4.0

    def test_all_hours_equal(self):
        by_hour = {h: [5.0] for h in ALL_HOURS}
        assert _overall_mean(by_hour) == 5.0


# ===========================================================================
# 7. _find_buy_sell_windows
# ===========================================================================


class TestFindBuySellWindows:
    def test_empty_hourly(self):
        """All 24 hours with count=0 → buy/sell both None."""
        hourly = _hourly_stats({})
        buy, sell, buy_m, sell_m = _find_buy_sell_windows(hourly)
        assert buy is None
        assert sell is None
        assert buy_m is None
        assert sell_m is None

    def test_single_hour(self):
        """Only one hour has data → that hour is both buy and sell window."""
        hourly = _hourly_stats({5: [10.0]})
        buy, sell, buy_m, sell_m = _find_buy_sell_windows(hourly)
        assert buy == 5
        assert sell == 5
        assert buy_m == 10.0
        assert sell_m == 10.0

    def test_clear_buy_sell(self):
        """Hour 5 has min mean, hour 20 has max mean."""
        hourly = _hourly_stats({5: [10.0], 20: [50.0], 12: [30.0]})
        buy, sell, buy_m, sell_m = _find_buy_sell_windows(hourly)
        assert buy == 5
        assert sell == 20
        assert buy_m == 10.0
        assert sell_m == 50.0

    def test_tie_break_lowest_hour_wins_for_buy(self):
        """When multiple hours share the min mean, the lowest hour wins."""
        hourly = _hourly_stats({10: [10.0], 5: [10.0]})
        buy, sell, _, _ = _find_buy_sell_windows(hourly)
        assert buy == 5  # lowest hour wins

    def test_tie_break_lowest_hour_wins_for_sell(self):
        """When multiple hours share the max mean, the lowest hour wins
        (deterministic tie-break — sell uses (mean, -hour) so the lowest
        hour index has the highest sort key for max())."""
        hourly = _hourly_stats({10: [50.0], 5: [50.0]})
        _, sell, _, _ = _find_buy_sell_windows(hourly)
        assert sell == 5  # lowest hour wins


# ===========================================================================
# 8. _intraday_range_pct
# ===========================================================================


class TestIntradayRangePct:
    def test_none_inputs(self):
        assert _intraday_range_pct(None, 50.0, 30.0) == 0.0
        assert _intraday_range_pct(10.0, None, 30.0) == 0.0

    def test_zero_overall_mean(self):
        assert _intraday_range_pct(10.0, 50.0, 0.0) == 0.0

    def test_negative_overall_mean(self):
        """Defensive: negative overall_mean (shouldn't happen with positive
        prices, but defensive) → 0.0."""
        assert _intraday_range_pct(10.0, 50.0, -5.0) == 0.0

    def test_simple_case(self):
        """buy=10, sell=50, overall=30 → |40|/30*100 = 133.33..."""
        result = _intraday_range_pct(10.0, 50.0, 30.0)
        assert abs(result - 133.3333) < 1e-3

    def test_zero_range(self):
        """buy == sell → range = 0 (no intraday pattern)."""
        result = _intraday_range_pct(30.0, 30.0, 30.0)
        assert result == 0.0

    def test_absolute_value(self):
        """Range is always non-negative (defensive — buy is always min,
        so sell-buy >= 0 by construction, but the abs() guards against
        any caller passing them swapped)."""
        # Caller passes buy=50, sell=10 (swapped) — abs handles it
        result = _intraday_range_pct(50.0, 10.0, 30.0)
        assert result > 0  # still positive due to abs()


# ===========================================================================
# 9. _hours_covered
# ===========================================================================


class TestHoursCovered:
    def test_empty(self):
        assert _hours_covered({}) == 0
        assert _hours_covered({h: [] for h in ALL_HOURS}) == 0

    def test_single_hour(self):
        assert _hours_covered({5: [10.0]}) == 1

    def test_multiple_hours(self):
        assert _hours_covered({5: [10.0], 12: [20.0], 23: [30.0]}) == 3

    def test_ignores_empty_lists(self):
        """Hours with empty price lists don't count toward coverage."""
        by_hour = {5: [10.0], 12: [], 23: []}
        assert _hours_covered(by_hour) == 1


# ===========================================================================
# 10. compute_intraday_patterns — end-to-end
# ===========================================================================


class TestComputeIntradayPatterns:
    def test_empty_snapshot(self):
        """Snapshot with no currencies → data_available=false, empty patterns."""
        snapshot = _make_snapshot([])
        result = compute_intraday_patterns(snapshot, _make_config())
        assert result["data_available"] is False
        assert result["patterns"] == []
        assert result["league"] == "test-league"
        assert "fetched_at" in result

    def test_currency_below_min_sample_size_skipped(self):
        """Currency with < MIN_SAMPLE_SIZE total points → not emitted."""
        # Only 2 points (below MIN_SAMPLE_SIZE=4)
        logs = _make_logs_at_hours({0: 10.0, 12: 20.0})
        snapshot = _make_snapshot([_make_currency("c1", price_logs=logs)])
        result = compute_intraday_patterns(snapshot, _make_config())
        assert result["data_available"] is False
        assert result["patterns"] == []

    def test_currency_below_min_hours_covered_skipped(self):
        """Currency with all points in a single hour → not emitted
        (no intraday variation to detect)."""
        # 4 points all at hour 5 across 4 different days
        base = datetime(2026, 7, 15, 5, 0, 0, tzinfo=timezone.utc)
        logs = [
            _make_log(10.0, hour=5, days_ago=0, base=base),
            _make_log(11.0, hour=5, days_ago=1, base=base),
            _make_log(12.0, hour=5, days_ago=2, base=base),
            _make_log(13.0, hour=5, days_ago=3, base=base),
        ]
        snapshot = _make_snapshot([_make_currency("c1", price_logs=logs)])
        result = compute_intraday_patterns(snapshot, _make_config())
        assert result["data_available"] is False
        assert result["patterns"] == []

    def test_single_currency_with_clear_pattern(self):
        """Currency with Asia-wake dump (hour 0 = low) and US-wake spike
        (hour 20 = high) → buy_window=0, sell_window=20, significant=True."""
        # 2 days, hour 0 = 10.0 (low), hour 20 = 30.0 (high) — 4 points total
        base = datetime(2026, 7, 15, 0, 0, 0, tzinfo=timezone.utc)
        logs = [
            _make_log(10.0, hour=0, days_ago=0, base=base),
            _make_log(30.0, hour=20, days_ago=0, base=base),
            _make_log(10.0, hour=0, days_ago=1, base=base),
            _make_log(30.0, hour=20, days_ago=1, base=base),
        ]
        snapshot = _make_snapshot([_make_currency("c1", price_logs=logs)])
        result = compute_intraday_patterns(snapshot, _make_config(), now=base)
        assert result["data_available"] is True
        assert len(result["patterns"]) == 1
        p = result["patterns"][0]
        assert p["api_id"] == "c1"
        assert p["buy_window_hour"] == 0
        assert p["sell_window_hour"] == 20
        assert p["buy_window_mean"] == 10.0
        assert p["sell_window_mean"] == 30.0
        assert p["overall_mean"] == 20.0  # (10+30+10+30)/4
        # range = |30-10|/20*100 = 100%
        assert p["intraday_range_pct"] == 100.0
        assert p["has_significant_pattern"] is True
        assert p["sample_size"] == 4

    def test_insignificant_pattern_flagged(self):
        """Currency with all hours within ±5% → range < 10% → not significant."""
        # Hour 0 = 19.0, hour 12 = 21.0 → range = |2|/20*100 = 10% (boundary)
        # Slightly below to test the < threshold
        base = datetime(2026, 7, 15, 0, 0, 0, tzinfo=timezone.utc)
        logs = [
            _make_log(19.5, hour=0, days_ago=0, base=base),
            _make_log(20.5, hour=12, days_ago=0, base=base),
            _make_log(19.5, hour=0, days_ago=1, base=base),
            _make_log(20.5, hour=12, days_ago=1, base=base),
        ]
        snapshot = _make_snapshot([_make_currency("c1", price_logs=logs)])
        result = compute_intraday_patterns(snapshot, _make_config(), now=base)
        p = result["patterns"][0]
        # range = |20.5 - 19.5| / 20.0 * 100 = 5.0
        assert p["intraday_range_pct"] == 5.0
        assert p["has_significant_pattern"] is False

    def test_significance_threshold_is_inclusive(self):
        """At exactly SIGNIFICANT_RANGE_PCT (10%) → significant=True (>=)."""
        # Hour 0 = 19.0, hour 12 = 21.0 → range = 2/20*100 = 10.0 exactly
        base = datetime(2026, 7, 15, 0, 0, 0, tzinfo=timezone.utc)
        logs = [
            _make_log(19.0, hour=0, days_ago=0, base=base),
            _make_log(21.0, hour=12, days_ago=0, base=base),
            _make_log(19.0, hour=0, days_ago=1, base=base),
            _make_log(21.0, hour=12, days_ago=1, base=base),
        ]
        snapshot = _make_snapshot([_make_currency("c1", price_logs=logs)])
        result = compute_intraday_patterns(snapshot, _make_config(), now=base)
        p = result["patterns"][0]
        assert p["intraday_range_pct"] == 10.0
        assert p["has_significant_pattern"] is True

    def test_multiple_currencies_sorted_by_range_desc(self):
        """Currencies with larger intraday range come first."""
        base = datetime(2026, 7, 15, 0, 0, 0, tzinfo=timezone.utc)
        # c-low: range = 5% (insignificant)
        c_low_logs = [
            _make_log(19.5, hour=0, days_ago=0, base=base),
            _make_log(20.5, hour=12, days_ago=0, base=base),
            _make_log(19.5, hour=0, days_ago=1, base=base),
            _make_log(20.5, hour=12, days_ago=1, base=base),
        ]
        # c-high: range = 100% (significant)
        c_high_logs = [
            _make_log(10.0, hour=0, days_ago=0, base=base),
            _make_log(30.0, hour=20, days_ago=0, base=base),
            _make_log(10.0, hour=0, days_ago=1, base=base),
            _make_log(30.0, hour=20, days_ago=1, base=base),
        ]
        snapshot = _make_snapshot([
            _make_currency("c-low", price_logs=c_low_logs),
            _make_currency("c-high", price_logs=c_high_logs),
        ])
        result = compute_intraday_patterns(snapshot, _make_config(), now=base)
        assert len(result["patterns"]) == 2
        # c-high (100% range) must come first
        assert result["patterns"][0]["api_id"] == "c-high"
        assert result["patterns"][1]["api_id"] == "c-low"

    def test_ties_broken_by_sample_size_desc(self):
        """When two currencies have the same range_pct, the one with more
        sample points comes first (more reliable aggregation)."""
        base = datetime(2026, 7, 15, 0, 0, 0, tzinfo=timezone.utc)
        # Both have range 100% (10→30), but c-big has 6 points, c-small has 4
        c_small_logs = [
            _make_log(10.0, hour=0, days_ago=0, base=base),
            _make_log(30.0, hour=20, days_ago=0, base=base),
            _make_log(10.0, hour=0, days_ago=1, base=base),
            _make_log(30.0, hour=20, days_ago=1, base=base),
        ]
        c_big_logs = [
            _make_log(10.0, hour=0, days_ago=0, base=base),
            _make_log(30.0, hour=20, days_ago=0, base=base),
            _make_log(10.0, hour=0, days_ago=1, base=base),
            _make_log(30.0, hour=20, days_ago=1, base=base),
            _make_log(10.0, hour=0, days_ago=2, base=base),
            _make_log(30.0, hour=20, days_ago=2, base=base),
        ]
        snapshot = _make_snapshot([
            _make_currency("c-small", price_logs=c_small_logs),
            _make_currency("c-big", price_logs=c_big_logs),
        ])
        result = compute_intraday_patterns(snapshot, _make_config(), now=base)
        assert result["patterns"][0]["api_id"] == "c-big"  # more samples
        assert result["patterns"][1]["api_id"] == "c-small"

    def test_limit_caps_result_count(self):
        """limit=N caps the patterns list at N entries."""
        base = datetime(2026, 7, 15, 0, 0, 0, tzinfo=timezone.utc)
        currencies = []
        for i in range(5):
            logs = [
                _make_log(10.0, hour=0, days_ago=0, base=base),
                _make_log(30.0, hour=20, days_ago=0, base=base),
                _make_log(10.0, hour=0, days_ago=1, base=base),
                _make_log(30.0, hour=20, days_ago=1, base=base),
            ]
            currencies.append(_make_currency(f"c{i}", price_logs=logs))
        snapshot = _make_snapshot(currencies)
        result = compute_intraday_patterns(
            snapshot, _make_config(), now=base, limit=3
        )
        assert len(result["patterns"]) == 3

    def test_zero_limit_returns_empty_patterns(self):
        """limit=0 → empty patterns list (but data_available still True
        if currencies had enough data — the flag reflects whether ANY
        currency was classifiable, not whether it survived the limit)."""
        base = datetime(2026, 7, 15, 0, 0, 0, tzinfo=timezone.utc)
        logs = [
            _make_log(10.0, hour=0, days_ago=0, base=base),
            _make_log(30.0, hour=20, days_ago=0, base=base),
            _make_log(10.0, hour=0, days_ago=1, base=base),
            _make_log(30.0, hour=20, days_ago=1, base=base),
        ]
        snapshot = _make_snapshot([_make_currency("c1", price_logs=logs)])
        result = compute_intraday_patterns(
            snapshot, _make_config(), now=base, limit=0
        )
        assert result["patterns"] == []
        assert result["data_available"] is True  # currency WAS classifiable

    def test_negative_limit_no_cap(self):
        """limit<0 → no cap (used by tests / internal callers)."""
        base = datetime(2026, 7, 15, 0, 0, 0, tzinfo=timezone.utc)
        currencies = []
        for i in range(10):
            logs = [
                _make_log(10.0, hour=0, days_ago=0, base=base),
                _make_log(30.0, hour=20, days_ago=0, base=base),
                _make_log(10.0, hour=0, days_ago=1, base=base),
                _make_log(30.0, hour=20, days_ago=1, base=base),
            ]
            currencies.append(_make_currency(f"c{i}", price_logs=logs))
        snapshot = _make_snapshot(currencies)
        result = compute_intraday_patterns(
            snapshot, _make_config(), now=base, limit=-1
        )
        assert len(result["patterns"]) == 10

    def test_old_logs_filtered_by_days_window(self):
        """Logs older than `days` are filtered out before aggregation."""
        base = datetime(2026, 7, 15, 0, 0, 0, tzinfo=timezone.utc)
        # 4 points at hour 0/20: 2 within 14d, 2 outside (20 days ago)
        logs = [
            _make_log(10.0, hour=0, days_ago=5, base=base),
            _make_log(30.0, hour=20, days_ago=5, base=base),
            _make_log(10.0, hour=0, days_ago=20, base=base),
            _make_log(30.0, hour=20, days_ago=20, base=base),
        ]
        snapshot = _make_snapshot([_make_currency("c1", price_logs=logs)])
        result = compute_intraday_patterns(
            snapshot, _make_config(), days=14, now=base
        )
        # Only 2 points survive → below MIN_SAMPLE_SIZE (4) → filtered out
        assert result["data_available"] is False
        assert result["patterns"] == []

    def test_days_window_includes_recent_logs(self):
        """With days=30, logs from 20 days ago survive the window."""
        base = datetime(2026, 7, 15, 0, 0, 0, tzinfo=timezone.utc)
        logs = [
            _make_log(10.0, hour=0, days_ago=5, base=base),
            _make_log(30.0, hour=20, days_ago=5, base=base),
            _make_log(10.0, hour=0, days_ago=20, base=base),
            _make_log(30.0, hour=20, days_ago=20, base=base),
        ]
        snapshot = _make_snapshot([_make_currency("c1", price_logs=logs)])
        result = compute_intraday_patterns(
            snapshot, _make_config(), days=30, now=base
        )
        assert result["data_available"] is True
        assert len(result["patterns"]) == 1
        assert result["patterns"][0]["sample_size"] == 4

    def test_category_field_passed_through(self):
        """The `category` field from the currency dict is echoed in the
        pattern output (used by the UI for display + filtering)."""
        base = datetime(2026, 7, 15, 0, 0, 0, tzinfo=timezone.utc)
        logs = [
            _make_log(10.0, hour=0, days_ago=0, base=base),
            _make_log(30.0, hour=20, days_ago=0, base=base),
            _make_log(10.0, hour=0, days_ago=1, base=base),
            _make_log(30.0, hour=20, days_ago=1, base=base),
        ]
        snapshot = _make_snapshot([
            _make_currency("c1", category="ritual", price_logs=logs),
        ])
        result = compute_intraday_patterns(snapshot, _make_config(), now=base)
        assert result["patterns"][0]["category"] == "ritual"

    def test_snake_case_keys_supported(self):
        """snake_case keys (api_id, text, category_api_id, price_logs,
        current_price) must work — defensive against internal callers
        that build snapshots in snake_case."""
        base = datetime(2026, 7, 15, 0, 0, 0, tzinfo=timezone.utc)
        logs = [
            _make_log(10.0, hour=0, days_ago=0, base=base),
            _make_log(30.0, hour=20, days_ago=0, base=base),
            _make_log(10.0, hour=0, days_ago=1, base=base),
            _make_log(30.0, hour=20, days_ago=1, base=base),
        ]
        # snake_case currency dict
        snake_currency = {
            "api_id": "c1",
            "text": "C One",
            "category_api_id": "breach",
            "current_price": 25.0,
            "price_logs": logs,
        }
        snapshot = SimpleNamespace(
            currencies={"c1": snake_currency},
            fetched_at=datetime.now(timezone.utc),
        )
        result = compute_intraday_patterns(snapshot, _make_config(), now=base)
        assert result["data_available"] is True
        p = result["patterns"][0]
        assert p["api_id"] == "c1"
        assert p["text"] == "C One"
        assert p["category"] == "breach"
        assert p["current_price"] == 25.0

    def test_text_falls_back_to_api_id_when_missing(self):
        """When `Text`/`text` is missing or empty, fall back to api_id."""
        base = datetime(2026, 7, 15, 0, 0, 0, tzinfo=timezone.utc)
        logs = [
            _make_log(10.0, hour=0, days_ago=0, base=base),
            _make_log(30.0, hour=20, days_ago=0, base=base),
            _make_log(10.0, hour=0, days_ago=1, base=base),
            _make_log(30.0, hour=20, days_ago=1, base=base),
        ]
        currency = {
            "ApiId": "c1",
            "CategoryApiId": "currency",
            # No "Text" key
            "CurrentPrice": 0.0,
            "PriceLogs": logs,
        }
        snapshot = SimpleNamespace(
            currencies={"c1": currency},
            fetched_at=datetime.now(timezone.utc),
        )
        result = compute_intraday_patterns(snapshot, _make_config(), now=base)
        assert result["patterns"][0]["text"] == "c1"

    def test_hourly_stats_always_24_entries_in_output(self):
        """The hourly_stats list in the output must always have 24 entries
        (one per UTC hour 0..23), even for hours with no data."""
        base = datetime(2026, 7, 15, 0, 0, 0, tzinfo=timezone.utc)
        logs = [
            _make_log(10.0, hour=0, days_ago=0, base=base),
            _make_log(30.0, hour=20, days_ago=0, base=base),
            _make_log(10.0, hour=0, days_ago=1, base=base),
            _make_log(30.0, hour=20, days_ago=1, base=base),
        ]
        snapshot = _make_snapshot([_make_currency("c1", price_logs=logs)])
        result = compute_intraday_patterns(snapshot, _make_config(), now=base)
        hourly = result["patterns"][0]["hourly_stats"]
        assert len(hourly) == 24
        assert [h["hour"] for h in hourly] == list(range(24))
        # Hours 0 and 20 have data; all others have count=0
        assert hourly[0]["count"] == 2
        assert hourly[20]["count"] == 2
        assert hourly[12]["count"] == 0
        assert hourly[12]["mean"] is None

    def test_current_price_falls_back_to_last_window_point(self):
        """When CurrentPrice is 0/missing, fall back to the last price
        point in the window (most recent)."""
        base = datetime(2026, 7, 15, 0, 0, 0, tzinfo=timezone.utc)
        logs = [
            _make_log(10.0, hour=0, days_ago=2, base=base),
            _make_log(30.0, hour=20, days_ago=2, base=base),
            _make_log(10.0, hour=0, days_ago=1, base=base),
            _make_log(50.0, hour=20, days_ago=0, base=base),  # most recent
        ]
        # CurrentPrice = 0 (falsy) → fall back to last window point = 50.0
        snapshot = _make_snapshot([
            _make_currency("c1", price_logs=logs, current_price=0.0),
        ])
        result = compute_intraday_patterns(snapshot, _make_config(), now=base)
        assert result["patterns"][0]["current_price"] == 50.0

    def test_default_days_and_limit(self):
        """Defaults: days=DEFAULT_DAYS (14), limit=DEFAULT_LIMIT (50)."""
        # Just check the function accepts defaults without raising
        snapshot = _make_snapshot([])
        result = compute_intraday_patterns(snapshot, _make_config())
        assert result["data_available"] is False
        # Defaults are module-level constants
        assert DEFAULT_DAYS == 14
        assert DEFAULT_LIMIT == 50

    def test_min_sample_size_is_4(self):
        """MIN_SAMPLE_SIZE constant must be 4 (matches playbook spec)."""
        assert MIN_SAMPLE_SIZE == 4

    def test_min_hours_covered_is_2(self):
        """MIN_HOURS_COVERED constant must be 2 (need ≥2 distinct hours
        to detect any intraday variation)."""
        assert MIN_HOURS_COVERED == 2

    def test_significant_range_pct_is_10(self):
        """SIGNIFICANT_RANGE_PCT constant must be 10.0 (matches playbook
        spec: |max - min| / overall_mean > 10%)."""
        assert SIGNIFICANT_RANGE_PCT == 10.0

    def test_all_hours_constant(self):
        """ALL_HOURS must be a tuple of 0..23 in ascending order."""
        assert ALL_HOURS == tuple(range(24))

    def test_league_name_passed_through(self):
        """The `league` field in the response must match the config's
        league_name."""
        snapshot = _make_snapshot([])
        result = compute_intraday_patterns(
            snapshot, _make_config("Standard-2026")
        )
        assert result["league"] == "Standard-2026"

    def test_fetched_at_is_iso_string(self):
        """The `fetched_at` field must be an ISO 8601 string."""
        snapshot = _make_snapshot([])
        result = compute_intraday_patterns(snapshot, _make_config())
        # Must parse as ISO 8601
        parsed = datetime.fromisoformat(result["fetched_at"])
        assert parsed is not None

    def test_now_override_respected(self):
        """The `now` kwarg overrides datetime.now() for the window cutoff."""
        base = datetime(2025, 1, 1, 0, 0, 0, tzinfo=timezone.utc)
        # Logs at hour 0/20 from 5 days before base (i.e. late Dec 2024)
        logs = [
            _make_log(10.0, hour=0, days_ago=5, base=base),
            _make_log(30.0, hour=20, days_ago=5, base=base),
            _make_log(10.0, hour=0, days_ago=6, base=base),
            _make_log(30.0, hour=20, days_ago=6, base=base),
        ]
        snapshot = _make_snapshot([_make_currency("c1", price_logs=logs)])
        result = compute_intraday_patterns(
            snapshot, _make_config(), days=14, now=base
        )
        assert result["data_available"] is True
        assert len(result["patterns"]) == 1

    def test_insignificant_currency_still_emitted(self):
        """A currency below the SIGNIFICANT_RANGE_PCT threshold is still
        emitted in the patterns list (just with has_significant_pattern=False).
        The UI uses this flag to show/hide the Buy/Sell badge — the data
        is still useful for the heatmap."""
        base = datetime(2026, 7, 15, 0, 0, 0, tzinfo=timezone.utc)
        # Hour 0 = 19.9, hour 12 = 20.1 → range = 0.2/20*100 = 1% (way below 10%)
        logs = [
            _make_log(19.9, hour=0, days_ago=0, base=base),
            _make_log(20.1, hour=12, days_ago=0, base=base),
            _make_log(19.9, hour=0, days_ago=1, base=base),
            _make_log(20.1, hour=12, days_ago=1, base=base),
        ]
        snapshot = _make_snapshot([_make_currency("c1", price_logs=logs)])
        result = compute_intraday_patterns(snapshot, _make_config(), now=base)
        assert len(result["patterns"]) == 1
        assert result["patterns"][0]["has_significant_pattern"] is False

    def test_zero_price_logs_filtered(self):
        """A price_log with Price=0 must be skipped (not counted in any hour)."""
        base = datetime(2026, 7, 15, 0, 0, 0, tzinfo=timezone.utc)
        # 4 valid points at hour 0/20, plus 1 zero-price log at hour 5
        logs = [
            _make_log(10.0, hour=0, days_ago=0, base=base),
            _make_log(30.0, hour=20, days_ago=0, base=base),
            _make_log(10.0, hour=0, days_ago=1, base=base),
            _make_log(30.0, hour=20, days_ago=1, base=base),
            _make_log(0.0, hour=5, days_ago=0, base=base),  # zero — skipped
        ]
        snapshot = _make_snapshot([_make_currency("c1", price_logs=logs)])
        result = compute_intraday_patterns(snapshot, _make_config(), now=base)
        p = result["patterns"][0]
        # Hour 5 should NOT have data (zero-price log was filtered)
        assert p["hourly_stats"][5]["count"] == 0
        # sample_size = 4 (the zero-price log doesn't count)
        assert p["sample_size"] == 4


# ===========================================================================
# 11. Route handler smoke tests
# ===========================================================================


class TestRouteHandler:
    """Smoke tests for the FastAPI route handler in routes_intraday_patterns."""

    async def test_route_returns_empty_when_no_snapshot(self):
        """When the snapshot manager hasn't fetched data yet, the route
        must return data_available=false with an empty patterns list and
        the requested `days` echoed back (for client cache keys)."""
        from backend.api.routes_intraday_patterns import get_intraday_patterns

        with patch(
            "backend.api.routes_intraday_patterns.get_snapshot_manager"
        ) as mock_mgr:
            mock_mgr.return_value = SimpleNamespace(last_snapshot=None)
            result = await get_intraday_patterns(days=14, limit=50)
            assert result["data_available"] is False
            assert result["patterns"] == []
            assert result["days"] == 14
            assert "fetched_at" in result

    async def test_route_returns_data_when_snapshot_available(self):
        """When the snapshot has data, the route returns the computed
        patterns list (sorted by intraday_range_pct desc) and echoes days."""
        from backend.api.routes_intraday_patterns import get_intraday_patterns

        base = datetime(2026, 7, 15, 0, 0, 0, tzinfo=timezone.utc)
        logs = [
            _make_log(10.0, hour=0, days_ago=0, base=base),
            _make_log(30.0, hour=20, days_ago=0, base=base),
            _make_log(10.0, hour=0, days_ago=1, base=base),
            _make_log(30.0, hour=20, days_ago=1, base=base),
        ]
        snapshot = _make_snapshot([
            _make_currency("c1", price_logs=logs),
        ])

        with patch(
            "backend.api.routes_intraday_patterns.get_snapshot_manager"
        ) as mock_mgr, patch(
            "backend.api.routes_intraday_patterns.get_snapshot"
        ) as mock_get:
            mock_mgr.return_value = SimpleNamespace(last_snapshot=object())  # truthy
            mock_get.return_value = snapshot
            result = await get_intraday_patterns(days=14, limit=50)
            assert result["data_available"] is True
            assert result["days"] == 14
            assert len(result["patterns"]) == 1
            p = result["patterns"][0]
            assert p["api_id"] == "c1"
            assert p["buy_window_hour"] == 0
            assert p["sell_window_hour"] == 20
            assert p["has_significant_pattern"] is True

    async def test_route_returns_empty_on_exception(self):
        """If compute_intraday_patterns raises, the route must return
        data_available=false (not propagate the exception)."""
        from backend.api.routes_intraday_patterns import get_intraday_patterns

        with patch(
            "backend.api.routes_intraday_patterns.get_snapshot_manager"
        ) as mock_mgr, patch(
            "backend.api.routes_intraday_patterns.get_snapshot"
        ) as mock_get:
            mock_mgr.return_value = SimpleNamespace(last_snapshot=object())  # truthy
            mock_get.side_effect = RuntimeError("boom")
            result = await get_intraday_patterns(days=7, limit=10)
            assert result["data_available"] is False
            assert result["patterns"] == []
            assert result["days"] == 7

    async def test_route_echoes_days_param(self):
        """The `days` query param is echoed in the response even on the
        success path — needed by the frontend's React Query cache key."""
        from backend.api.routes_intraday_patterns import get_intraday_patterns

        base = datetime(2026, 7, 15, 0, 0, 0, tzinfo=timezone.utc)
        logs = [
            _make_log(10.0, hour=0, days_ago=0, base=base),
            _make_log(30.0, hour=20, days_ago=0, base=base),
            _make_log(10.0, hour=0, days_ago=1, base=base),
            _make_log(30.0, hour=20, days_ago=1, base=base),
        ]
        snapshot = _make_snapshot([
            _make_currency("c1", price_logs=logs),
        ])

        with patch(
            "backend.api.routes_intraday_patterns.get_snapshot_manager"
        ) as mock_mgr, patch(
            "backend.api.routes_intraday_patterns.get_snapshot"
        ) as mock_get:
            mock_mgr.return_value = SimpleNamespace(last_snapshot=object())
            mock_get.return_value = snapshot
            result = await get_intraday_patterns(days=30, limit=5)
            assert result["days"] == 30
            assert result["data_available"] is True
            assert len(result["patterns"]) == 1
