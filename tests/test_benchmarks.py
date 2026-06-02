"""Tests for backend.economy.benchmarks.compute_benchmarks."""

import pytest

from backend.economy.benchmarks import compute_benchmarks, HistoricalBenchmark


def _make_daily_stats(
    n: int, close: float = 1.0, high: float | None = None, low: float | None = None
) -> list[dict]:
    """Helper: build n daily-stats dicts with given close/high/low."""
    h = high if high is not None else close * 1.05
    lo = low if low is not None else close * 0.95
    return [{"close": close, "high": h, "low": lo} for _ in range(n)]


# -----------------------------------------------------------------------
# Sufficient data (30+ days)
# -----------------------------------------------------------------------

class TestSufficientData:
    def test_returns_benchmark_with_30_days(self):
        stats = _make_daily_stats(30, close=10.0, high=11.0, low=9.0)
        result = compute_benchmarks(stats, current_price=10.0)
        assert result is not None
        assert isinstance(result, HistoricalBenchmark)

    def test_low_and_high(self):
        stats = [
            {"close": 5.0 + i * 0.1, "high": 6.0 + i * 0.1, "low": 4.0 + i * 0.1}
            for i in range(30)
        ]
        result = compute_benchmarks(stats, current_price=6.0)
        assert result is not None
        assert result.low_30d == pytest.approx(4.0)
        assert result.high_30d == pytest.approx(8.9)  # 6.0 + 29*0.1

    def test_range_position_at_peak(self):
        stats = _make_daily_stats(30, close=10.0, high=12.0, low=8.0)
        result = compute_benchmarks(stats, current_price=12.0)
        assert result is not None
        assert result.range_position == pytest.approx(1.0)

    def test_range_position_at_bottom(self):
        stats = _make_daily_stats(30, close=10.0, high=12.0, low=8.0)
        result = compute_benchmarks(stats, current_price=8.0)
        assert result is not None
        assert result.range_position == pytest.approx(0.0)

    def test_range_position_in_middle(self):
        stats = _make_daily_stats(30, close=10.0, high=12.0, low=8.0)
        result = compute_benchmarks(stats, current_price=10.0)
        assert result is not None
        assert result.range_position == pytest.approx(0.5)

    def test_percentile_all_below(self):
        # All closes at 5.0, current price at 10.0 → 100th percentile
        stats = _make_daily_stats(30, close=5.0, high=6.0, low=4.0)
        result = compute_benchmarks(stats, current_price=10.0)
        assert result is not None
        assert result.percentile_30d == pytest.approx(100.0)

    def test_percentile_all_above(self):
        # All closes at 10.0, current price at 5.0 → near 0th percentile
        stats = _make_daily_stats(30, close=10.0, high=11.0, low=9.0)
        result = compute_benchmarks(stats, current_price=5.0)
        assert result is not None
        assert result.percentile_30d == pytest.approx(0.0)

    def test_current_vs_avg_positive(self):
        stats = _make_daily_stats(30, close=10.0, high=11.0, low=9.0)
        result = compute_benchmarks(stats, current_price=12.0)
        assert result is not None
        assert result.current_vs_avg > 0

    def test_current_vs_avg_negative(self):
        stats = _make_daily_stats(30, close=10.0, high=11.0, low=9.0)
        result = compute_benchmarks(stats, current_price=8.0)
        assert result is not None
        assert result.current_vs_avg < 0

    def test_current_vs_avg_at_average(self):
        stats = _make_daily_stats(30, close=10.0, high=11.0, low=9.0)
        result = compute_benchmarks(stats, current_price=10.0)
        assert result is not None
        assert result.current_vs_avg == pytest.approx(0.0)


# -----------------------------------------------------------------------
# Insufficient data
# -----------------------------------------------------------------------

class TestInsufficientData:
    def test_returns_none_with_zero_days(self):
        assert compute_benchmarks([], current_price=10.0) is None

    def test_returns_none_with_6_days(self):
        stats = _make_daily_stats(6, close=10.0, high=11.0, low=9.0)
        assert compute_benchmarks(stats, current_price=10.0) is None

    def test_returns_none_with_7_days_all_zero_closes(self):
        stats = [{"close": 0.0, "high": 1.0, "low": 0.5} for _ in range(7)]
        assert compute_benchmarks(stats, current_price=1.0) is None

    def test_returns_result_with_exactly_7_days(self):
        stats = _make_daily_stats(7, close=10.0, high=11.0, low=9.0)
        result = compute_benchmarks(stats, current_price=10.0)
        assert result is not None


# -----------------------------------------------------------------------
# Flat market (high == low, all closes equal)
# -----------------------------------------------------------------------

class TestFlatMarket:
    def test_range_position_defaults_to_half(self):
        stats = [{"close": 10.0, "high": 10.0, "low": 10.0} for _ in range(30)]
        result = compute_benchmarks(stats, current_price=10.0)
        assert result is not None
        assert result.range_position == pytest.approx(0.5)

    def test_low_and_high_equal(self):
        stats = [{"close": 10.0, "high": 10.0, "low": 10.0} for _ in range(30)]
        result = compute_benchmarks(stats, current_price=10.0)
        assert result is not None
        assert result.low_30d == pytest.approx(10.0)
        assert result.high_30d == pytest.approx(10.0)

    def test_percentile_in_flat_market(self):
        stats = [{"close": 10.0, "high": 10.0, "low": 10.0} for _ in range(30)]
        result = compute_benchmarks(stats, current_price=10.0)
        assert result is not None
        # All closes == current_price, so all are <= current_price → 100%
        assert result.percentile_30d == pytest.approx(100.0)

    def test_current_vs_avg_zero_in_flat_market(self):
        stats = [{"close": 10.0, "high": 10.0, "low": 10.0} for _ in range(30)]
        result = compute_benchmarks(stats, current_price=10.0)
        assert result is not None
        assert result.current_vs_avg == pytest.approx(0.0)
