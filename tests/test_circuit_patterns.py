"""
Tests for backend/economy/circuit_patterns.py — P8 trajectory classification.

Coverage:
1. Pure helpers: _extract_price_points, _filter_to_window, _mean, _std,
   _coefficient_of_variation, _linear_regression, _total_change_pct,
   _days_since_peak, _is_peak_then_decline, _classify_trajectory,
   _recommended_action.
2. compute_circuit_patterns end-to-end on hand-crafted snapshots:
   - Empty snapshot
   - Snapshot with currencies below MIN_SAMPLE_SIZE (filtered out)
   - Snapshot with one currency per trajectory archetype
   - trajectory_filter parameter
   - limit parameter
   - Sorting (|total_change_pct| desc, ties by sample_size desc)
3. Edge cases: zero prices, negative prices, missing keys, mixed
   PascalCase/snake_case, sub-daily logs, all-equal prices.
4. Defensive: invalid trajectory_filter falls back to "ALL".
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from backend.economy.circuit_patterns import (
    ACTION_AVOID,
    ACTION_HOLD_FOR_GROWTH,
    ACTION_NEUTRAL,
    ACTION_SELL_NOW,
    ACTION_WATCH,
    DEFAULT_DAYS,
    DEFAULT_LIMIT,
    MIN_R_SQUARED,
    MIN_SAMPLE_SIZE,
    PEAK_DECLINE_MIN_PCT,
    TRAJECTORY_DECLINING,
    TRAJECTORY_EXPONENTIAL_GROWTH,
    TRAJECTORY_LINEAR_GROWTH,
    TRAJECTORY_MEAN_REVERTING,
    TRAJECTORY_PEAK_THEN_DECLINE,
    TRAJECTORY_STABLE,
    TRAJECTORY_VOLATILE,
    _classify_trajectory,
    _coefficient_of_variation,
    _days_since_peak,
    _extract_price_points,
    _filter_to_window,
    _is_peak_then_decline,
    _linear_regression,
    _mean,
    _recommended_action,
    _std,
    _total_change_pct,
    compute_circuit_patterns,
)


# ---------------------------------------------------------------------------
# Helpers — build minimal DataSnapshot-like objects without spinning up the
# real SnapshotManager. Mirrors the pattern used in test_content_pulse.py.
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


def _days_ago_iso(days: int, base: datetime | None = None) -> str:
    """ISO date string for `days` ago from `base` (defaults to now)."""
    base = base or datetime.now(timezone.utc)
    return (base - timedelta(days=days)).strftime("%Y-%m-%dT00:00:00")


def _make_logs(
    prices: list[float],
    *,
    base: datetime | None = None,
    interval_days: int = 1,
) -> list[dict]:
    """Build a list of price_logs dicts from a list of prices.

    Each price is placed `interval_days` apart, ending at `base` (default: now).
    """
    base = base or datetime.now(timezone.utc)
    n = len(prices)
    return [
        {
            "Time": (base - timedelta(days=(n - 1 - i) * interval_days))
            .strftime("%Y-%m-%dT00:00:00"),
            "Price": p,
            "Quantity": 100,
        }
        for i, p in enumerate(prices)
    ]


# ===========================================================================
# 1. _extract_price_points
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

    def test_skips_zero_prices(self):
        logs = [
            {"Time": "2026-07-01T00:00:00", "Price": 0},
            {"Time": "2026-07-02T00:00:00", "Price": 10.0},
        ]
        result = _extract_price_points(logs)
        assert len(result) == 1
        assert result[0][1] == 10.0

    def test_skips_negative_prices(self):
        logs = [
            {"Time": "2026-07-01T00:00:00", "Price": -5.0},
            {"Time": "2026-07-02T00:00:00", "Price": 10.0},
        ]
        result = _extract_price_points(logs)
        assert len(result) == 1

    def test_skips_invalid_timestamps(self):
        logs = [
            {"Time": "not-a-date", "Price": 10.0},
            {"Time": "2026-07-02T00:00:00", "Price": 20.0},
        ]
        result = _extract_price_points(logs)
        assert len(result) == 1
        assert result[0][1] == 20.0

    def test_skips_missing_keys(self):
        logs = [
            {"Time": "2026-07-01T00:00:00"},  # no Price
            {"Price": 10.0},  # no Time
            {"Time": "2026-07-03T00:00:00", "Price": 30.0},
        ]
        result = _extract_price_points(logs)
        assert len(result) == 1

    def test_sorted_ascending(self):
        logs = [
            {"Time": "2026-07-03T00:00:00", "Price": 30.0},
            {"Time": "2026-07-01T00:00:00", "Price": 10.0},
            {"Time": "2026-07-02T00:00:00", "Price": 20.0},
        ]
        result = _extract_price_points(logs)
        assert [p for _, p in result] == [10.0, 20.0, 30.0]

    def test_accepts_datetime_objects(self):
        ts = datetime(2026, 7, 1, tzinfo=timezone.utc)
        logs = [{"Time": ts, "Price": 10.0}]
        result = _extract_price_points(logs)
        assert len(result) == 1
        assert result[0][0] == ts


# ===========================================================================
# 2. _filter_to_window
# ===========================================================================


class TestFilterToWindow:
    def test_empty(self):
        now = datetime(2026, 7, 10, tzinfo=timezone.utc)
        assert _filter_to_window([], 7, now) == []

    def test_keeps_recent(self):
        now = datetime(2026, 7, 10, tzinfo=timezone.utc)
        points = [
            (now - timedelta(days=2), 10.0),
            (now - timedelta(days=1), 20.0),
            (now, 30.0),
        ]
        result = _filter_to_window(points, 7, now)
        assert len(result) == 3

    def test_filters_old(self):
        now = datetime(2026, 7, 10, tzinfo=timezone.utc)
        points = [
            (now - timedelta(days=30), 10.0),  # outside 7-day window
            (now - timedelta(days=1), 20.0),
        ]
        result = _filter_to_window(points, 7, now)
        assert len(result) == 1
        assert result[0][1] == 20.0

    def test_boundary_inclusive(self):
        now = datetime(2026, 7, 10, tzinfo=timezone.utc)
        cutoff = now - timedelta(days=7)
        points = [
            (cutoff, 10.0),  # exactly on boundary
        ]
        result = _filter_to_window(points, 7, now)
        assert len(result) == 1


# ===========================================================================
# 3. _mean, _std, _coefficient_of_variation
# ===========================================================================


class TestMeanStd:
    def test_mean_empty(self):
        assert _mean([]) == 0.0

    def test_mean_single(self):
        assert _mean([5.0]) == 5.0

    def test_mean_multiple(self):
        assert _mean([1.0, 2.0, 3.0]) == 2.0

    def test_std_empty(self):
        assert _std([]) == 0.0

    def test_std_single_population(self):
        assert _std([5.0], ddof=0) == 0.0

    def test_std_population(self):
        # std of [1,2,3,4,5] population = sqrt(2) ≈ 1.414
        result = _std([1.0, 2.0, 3.0, 4.0, 5.0], ddof=0)
        assert abs(result - 1.4142135623730951) < 1e-9

    def test_std_sample(self):
        # std of [1,2,3,4,5] sample = sqrt(2.5) ≈ 1.581
        result = _std([1.0, 2.0, 3.0, 4.0, 5.0], ddof=1)
        assert abs(result - 1.5811388300841898) < 1e-9


class TestCoefficientOfVariation:
    def test_zero_mean_returns_inf(self):
        assert _coefficient_of_variation([0.0, 0.0]) == float("inf")

    def test_constant_series(self):
        # std=0 → cv=0
        assert _coefficient_of_variation([5.0, 5.0, 5.0]) == 0.0

    def test_typical_series(self):
        # mean=2, std (pop) = sqrt(2/3) ≈ 0.8165, cv ≈ 0.4082
        result = _coefficient_of_variation([1.0, 2.0, 3.0])
        assert abs(result - 0.4082482904638631) < 1e-9


# ===========================================================================
# 4. _linear_regression
# ===========================================================================


class TestLinearRegression:
    def test_empty(self):
        slope, intercept, r_sq = _linear_regression([], [])
        assert slope == 0.0
        assert intercept == 0.0
        assert r_sq == 0.0

    def test_single_point(self):
        slope, intercept, r_sq = _linear_regression([1.0], [5.0])
        assert slope == 0.0
        assert intercept == 5.0
        assert r_sq == 0.0

    def test_perfect_fit(self):
        # y = 2x + 1
        xs = [0.0, 1.0, 2.0, 3.0]
        ys = [1.0, 3.0, 5.0, 7.0]
        slope, intercept, r_sq = _linear_regression(xs, ys)
        assert abs(slope - 2.0) < 1e-9
        assert abs(intercept - 1.0) < 1e-9
        assert abs(r_sq - 1.0) < 1e-9

    def test_negative_slope(self):
        xs = [0.0, 1.0, 2.0, 3.0]
        ys = [10.0, 8.0, 6.0, 4.0]
        slope, _intercept, r_sq = _linear_regression(xs, ys)
        assert slope < 0
        assert abs(slope - (-2.0)) < 1e-9
        assert abs(r_sq - 1.0) < 1e-9

    def test_no_correlation(self):
        # y independent of x → R² low
        xs = [0.0, 1.0, 2.0, 3.0]
        ys = [1.0, -1.0, 1.0, -1.0]
        _slope, _intercept, r_sq = _linear_regression(xs, ys)
        # For [1,-1,1,-1] vs [0,1,2,3] R² is ~0.2 — still low, just not <0.1.
        assert r_sq < 0.3

    def test_zero_variance_in_x(self):
        # All xs equal — can't fit slope, returns 0 slope, mean y, R²=0
        xs = [5.0, 5.0, 5.0]
        ys = [1.0, 2.0, 3.0]
        slope, intercept, r_sq = _linear_regression(xs, ys)
        assert slope == 0.0
        assert abs(intercept - 2.0) < 1e-9
        assert r_sq == 0.0

    def test_zero_variance_in_y(self):
        # All ys equal — R² = 0 (no variance to explain)
        xs = [0.0, 1.0, 2.0]
        ys = [5.0, 5.0, 5.0]
        _slope, _intercept, r_sq = _linear_regression(xs, ys)
        assert r_sq == 0.0


# ===========================================================================
# 5. _total_change_pct
# ===========================================================================


class TestTotalChangePct:
    def test_empty(self):
        assert _total_change_pct([]) == 0.0

    def test_single(self):
        assert _total_change_pct([5.0]) == 0.0

    def test_positive_growth(self):
        # 10 → 20 = +100%
        assert _total_change_pct([10.0, 20.0]) == 100.0

    def test_negative_growth(self):
        # 20 → 10 = -50%
        assert _total_change_pct([20.0, 10.0]) == -50.0

    def test_zero_first_returns_zero(self):
        assert _total_change_pct([0.0, 10.0]) == 0.0


# ===========================================================================
# 6. _days_since_peak
# ===========================================================================


class TestDaysSincePeak:
    def test_empty(self):
        assert _days_since_peak([]) is None

    def test_peak_at_end(self):
        now = datetime(2026, 7, 10, tzinfo=timezone.utc)
        points = [
            (now - timedelta(days=2), 10.0),
            (now - timedelta(days=1), 20.0),
            (now, 30.0),  # peak at end
        ]
        assert _days_since_peak(points) == 0

    def test_peak_in_middle(self):
        now = datetime(2026, 7, 10, tzinfo=timezone.utc)
        points = [
            (now - timedelta(days=4), 10.0),
            (now - timedelta(days=3), 30.0),  # peak
            (now - timedelta(days=2), 25.0),
            (now - timedelta(days=1), 20.0),
            (now, 15.0),
        ]
        assert _days_since_peak(points) == 3


# ===========================================================================
# 7. _is_peak_then_decline
# ===========================================================================


class TestIsPeakThenDecline:
    def test_too_few_points(self):
        prices = [1.0, 2.0]
        points = [(datetime(2026, 7, 1, tzinfo=timezone.utc), 1.0),
                  (datetime(2026, 7, 2, tzinfo=timezone.utc), 2.0)]
        assert _is_peak_then_decline(prices, points) is False

    def test_peak_at_start(self):
        # Peak is the first point — that's just a decline, not a spike-then-crash
        prices = [100.0, 50.0, 25.0]
        points = [(datetime(2026, 7, 1, tzinfo=timezone.utc), 100.0),
                  (datetime(2026, 7, 2, tzinfo=timezone.utc), 50.0),
                  (datetime(2026, 7, 3, tzinfo=timezone.utc), 25.0)]
        assert _is_peak_then_decline(prices, points) is False

    def test_peak_at_end(self):
        # Peak is the last point — that's growth, not decline
        prices = [10.0, 50.0, 100.0]
        points = [(datetime(2026, 7, 1, tzinfo=timezone.utc), 10.0),
                  (datetime(2026, 7, 2, tzinfo=timezone.utc), 50.0),
                  (datetime(2026, 7, 3, tzinfo=timezone.utc), 100.0)]
        assert _is_peak_then_decline(prices, points) is False

    def test_clear_peak_then_decline(self):
        # Peak in middle, big decline
        prices = [10.0, 100.0, 50.0]  # 50% decline from peak
        points = [(datetime(2026, 7, 1, tzinfo=timezone.utc), 10.0),
                  (datetime(2026, 7, 2, tzinfo=timezone.utc), 100.0),
                  (datetime(2026, 7, 3, tzinfo=timezone.utc), 50.0)]
        assert _is_peak_then_decline(prices, points) is True

    def test_small_decline_not_classified(self):
        # Peak in middle, small decline (< PEAK_DECLINE_MIN_PCT)
        prices = [10.0, 100.0, 95.0]  # 5% decline — below 20% threshold
        points = [(datetime(2026, 7, 1, tzinfo=timezone.utc), 10.0),
                  (datetime(2026, 7, 2, tzinfo=timezone.utc), 100.0),
                  (datetime(2026, 7, 3, tzinfo=timezone.utc), 95.0)]
        assert _is_peak_then_decline(prices, points) is False


# ===========================================================================
# 8. _recommended_action
# ===========================================================================


class TestRecommendedAction:
    def test_exponential_growth(self):
        assert _recommended_action(TRAJECTORY_EXPONENTIAL_GROWTH) == ACTION_HOLD_FOR_GROWTH

    def test_linear_growth(self):
        assert _recommended_action(TRAJECTORY_LINEAR_GROWTH) == ACTION_HOLD_FOR_GROWTH

    def test_peak_then_decline(self):
        assert _recommended_action(TRAJECTORY_PEAK_THEN_DECLINE) == ACTION_SELL_NOW

    def test_mean_reverting(self):
        assert _recommended_action(TRAJECTORY_MEAN_REVERTING) == ACTION_NEUTRAL

    def test_volatile(self):
        assert _recommended_action(TRAJECTORY_VOLATILE) == ACTION_WATCH

    def test_declining(self):
        assert _recommended_action(TRAJECTORY_DECLINING) == ACTION_AVOID

    def test_stable(self):
        assert _recommended_action(TRAJECTORY_STABLE) == ACTION_NEUTRAL

    def test_unknown_trajectory_falls_back(self):
        assert _recommended_action("UNKNOWN") == ACTION_NEUTRAL


# ===========================================================================
# 9. _classify_trajectory — end-to-end on synthetic price series
# ===========================================================================


class TestClassifyTrajectory:
    def _points(self, prices: list[float]) -> list[tuple[datetime, float]]:
        """Build (timestamp, price) tuples from a list of prices."""
        base = datetime(2026, 7, 10, tzinfo=timezone.utc)
        n = len(prices)
        return [
            (base - timedelta(days=(n - 1 - i)), p)
            for i, p in enumerate(prices)
        ]

    def test_below_min_sample_size(self):
        prices = [10.0, 11.0, 10.5]  # 3 points < MIN_SAMPLE_SIZE (4)
        points = self._points(prices)
        traj, total, slope, cv, r_sq = _classify_trajectory(prices, points)
        assert traj == TRAJECTORY_STABLE
        assert total == 0.0
        assert slope == 0.0

    def test_exponential_growth(self):
        # 1, 2, 4, 8, 16, 32 — perfect exponential growth
        prices = [1.0, 2.0, 4.0, 8.0, 16.0, 32.0]
        points = self._points(prices)
        traj, total, slope, cv, r_sq = _classify_trajectory(prices, points)
        assert traj == TRAJECTORY_EXPONENTIAL_GROWTH
        assert total > 50.0  # 3100% growth
        assert r_sq >= MIN_R_SQUARED

    def test_linear_growth(self):
        # 100, 105, 110, 115, 120, 125 — perfect linear growth, 25% total
        prices = [100.0, 105.0, 110.0, 115.0, 120.0, 125.0]
        points = self._points(prices)
        traj, total, slope, cv, r_sq = _classify_trajectory(prices, points)
        assert traj == TRAJECTORY_LINEAR_GROWTH
        assert 10.0 <= total < 50.0
        assert r_sq >= MIN_R_SQUARED

    def test_declining(self):
        # 100, 95, 90, 85, 80, 75 — perfect linear decline, -25%
        prices = [100.0, 95.0, 90.0, 85.0, 80.0, 75.0]
        points = self._points(prices)
        traj, total, slope, cv, r_sq = _classify_trajectory(prices, points)
        assert traj == TRAJECTORY_DECLINING
        assert total < -10.0
        assert r_sq >= MIN_R_SQUARED

    def test_peak_then_decline_takes_precedence(self):
        # 10, 100, 50 — peak in middle, 50% decline
        # This also has high CV, but peak-then-decline should win.
        prices = [10.0, 100.0, 50.0, 40.0, 35.0]
        points = self._points(prices)
        traj, _total, _slope, _cv, _r_sq = _classify_trajectory(prices, points)
        assert traj == TRAJECTORY_PEAK_THEN_DECLINE

    def test_mean_reverting(self):
        # Tight oscillation around 100, low CV, low total change
        prices = [100.0, 101.0, 99.0, 100.0, 101.0, 99.0]
        points = self._points(prices)
        traj, _total, _slope, _cv, _r_sq = _classify_trajectory(prices, points)
        assert traj == TRAJECTORY_MEAN_REVERTING

    def test_volatile(self):
        # Wild swings, no trend, high CV
        prices = [10.0, 50.0, 5.0, 60.0, 8.0, 70.0]
        points = self._points(prices)
        traj, _total, _slope, cv, r_sq = _classify_trajectory(prices, points)
        assert traj == TRAJECTORY_VOLATILE
        assert cv > 0.5
        assert r_sq < MIN_R_SQUARED

    def test_stable_moderate_cv(self):
        # Moderate CV (between 0.15 and 0.5), no clear trend
        # 100, 130, 90, 110, 95, 115 — mean ~107, std ~13, CV ~0.12 — borderline
        # Let's make it slightly more variable to land in STABLE range
        prices = [100.0, 140.0, 80.0, 130.0, 90.0, 120.0]  # CV ≈ 0.21
        points = self._points(prices)
        traj, _total, _slope, cv, r_sq = _classify_trajectory(prices, points)
        # CV is ~0.21 (between 0.15 and 0.5), R² low → STABLE
        assert traj == TRAJECTORY_STABLE
        assert 0.15 < cv < 0.5
        assert r_sq < MIN_R_SQUARED


# ===========================================================================
# 10. compute_circuit_patterns — end-to-end on full snapshot
# ===========================================================================


class TestComputeCircuitPatterns:
    def test_empty_snapshot(self):
        snapshot = _make_snapshot([])
        config = _make_config()
        result = compute_circuit_patterns(snapshot, config)
        assert result["data_available"] is False
        assert result["patterns"] == []
        assert result["league"] == "test-league"
        assert "fetched_at" in result

    def test_currency_with_no_price_logs_skipped(self):
        snapshot = _make_snapshot([
            _make_currency("empty-currency", price_logs=[]),
        ])
        config = _make_config()
        result = compute_circuit_patterns(snapshot, config)
        assert result["data_available"] is False
        assert result["patterns"] == []

    def test_currency_below_min_sample_size_skipped(self):
        # Only 2 price points — below MIN_SAMPLE_SIZE
        snapshot = _make_snapshot([
            _make_currency("short-currency", price_logs=_make_logs([10.0, 11.0])),
        ])
        config = _make_config()
        result = compute_circuit_patterns(snapshot, config)
        assert result["data_available"] is False
        assert result["patterns"] == []

    def test_single_exponential_growth_currency(self):
        prices = [1.0, 2.0, 4.0, 8.0, 16.0, 32.0]
        snapshot = _make_snapshot([
            _make_currency(
                "chaos-orb",
                price_logs=_make_logs(prices),
                current_price=32.0,
                text="Chaos Orb",
            ),
        ])
        config = _make_config()
        result = compute_circuit_patterns(snapshot, config)
        assert result["data_available"] is True
        assert len(result["patterns"]) == 1
        p = result["patterns"][0]
        assert p["api_id"] == "chaos-orb"
        assert p["text"] == "Chaos Orb"
        assert p["trajectory"] == TRAJECTORY_EXPONENTIAL_GROWTH
        assert p["recommended_action"] == ACTION_HOLD_FOR_GROWTH
        assert p["sample_size"] == 6
        assert p["current_price"] == 32.0

    def test_multiple_currencies_sorted_by_abs_total_change(self):
        # Currency A: 100 → 200 (+100%)
        # Currency B: 100 → 50 (-50%)
        # Currency C: 100 → 110 (+10%, linear)
        # Sort order: A (100%), B (50%), C (10%)
        snapshot = _make_snapshot([
            _make_currency(
                "curr-a",
                price_logs=_make_logs([100.0, 130.0, 160.0, 180.0, 200.0]),
            ),
            _make_currency(
                "curr-b",
                price_logs=_make_logs([100.0, 90.0, 75.0, 60.0, 50.0]),
            ),
            _make_currency(
                "curr-c",
                price_logs=_make_logs([100.0, 102.5, 105.0, 107.5, 110.0]),
            ),
        ])
        config = _make_config()
        result = compute_circuit_patterns(snapshot, config)
        assert len(result["patterns"]) == 3
        assert result["patterns"][0]["api_id"] == "curr-a"
        assert result["patterns"][1]["api_id"] == "curr-b"
        assert result["patterns"][2]["api_id"] == "curr-c"

    def test_limit_caps_result_count(self):
        # Build 5 currencies, set limit=2 → only top-2 returned
        currencies = []
        for i in range(5):
            # Each grows 100% over 4 points
            currencies.append(_make_currency(
                f"curr-{i}",
                price_logs=_make_logs([10.0, 20.0, 30.0, 40.0]),
            ))
        snapshot = _make_snapshot(currencies)
        config = _make_config()
        result = compute_circuit_patterns(snapshot, config, limit=2)
        assert len(result["patterns"]) == 2

    def test_trajectory_filter(self):
        # Mix of growing and declining currencies
        snapshot = _make_snapshot([
            _make_currency(
                "growing",
                price_logs=_make_logs([1.0, 2.0, 4.0, 8.0, 16.0, 32.0]),
            ),
            _make_currency(
                "declining",
                price_logs=_make_logs([100.0, 90.0, 75.0, 60.0, 50.0, 40.0]),
            ),
        ])
        config = _make_config()

        # Filter for DECLINING only
        result = compute_circuit_patterns(
            snapshot, config, trajectory_filter=TRAJECTORY_DECLINING
        )
        assert len(result["patterns"]) == 1
        assert result["patterns"][0]["api_id"] == "declining"
        assert result["patterns"][0]["trajectory"] == TRAJECTORY_DECLINING

        # Filter for EXPONENTIAL_GROWTH only
        result = compute_circuit_patterns(
            snapshot, config, trajectory_filter=TRAJECTORY_EXPONENTIAL_GROWTH
        )
        assert len(result["patterns"]) == 1
        assert result["patterns"][0]["api_id"] == "growing"

    def test_invalid_trajectory_filter_falls_back_to_all(self):
        snapshot = _make_snapshot([
            _make_currency(
                "growing",
                price_logs=_make_logs([1.0, 2.0, 4.0, 8.0, 16.0, 32.0]),
            ),
        ])
        config = _make_config()
        result = compute_circuit_patterns(
            snapshot, config, trajectory_filter="NOT_A_REAL_TRAJECTORY"
        )
        assert len(result["patterns"]) == 1

    def test_old_logs_filtered_by_days_window(self):
        # Two currencies: one with recent logs, one with only old logs
        now = datetime(2026, 7, 10, tzinfo=timezone.utc)
        recent_logs = [
            {"Time": (now - timedelta(days=2)).strftime("%Y-%m-%dT00:00:00"), "Price": 1.0, "Quantity": 100},
            {"Time": (now - timedelta(days=1)).strftime("%Y-%m-%dT00:00:00"), "Price": 2.0, "Quantity": 100},
            {"Time": (now - timedelta(days=0)).strftime("%Y-%m-%dT00:00:00"), "Price": 4.0, "Quantity": 100},
            {"Time": (now - timedelta(days=0)).strftime("%Y-%m-%dT12:00:00"), "Price": 8.0, "Quantity": 100},
        ]
        old_logs = [
            {"Time": (now - timedelta(days=60)).strftime("%Y-%m-%dT00:00:00"), "Price": 1.0, "Quantity": 100},
            {"Time": (now - timedelta(days=59)).strftime("%Y-%m-%dT00:00:00"), "Price": 2.0, "Quantity": 100},
            {"Time": (now - timedelta(days=58)).strftime("%Y-%m-%dT00:00:00"), "Price": 4.0, "Quantity": 100},
            {"Time": (now - timedelta(days=57)).strftime("%Y-%m-%dT00:00:00"), "Price": 8.0, "Quantity": 100},
        ]
        snapshot = _make_snapshot([
            _make_currency("recent", price_logs=recent_logs),
            _make_currency("old", price_logs=old_logs),
        ])
        config = _make_config()
        # 30-day window — recent should pass, old should be filtered out
        result = compute_circuit_patterns(
            snapshot, config, days=30, now=now
        )
        api_ids = [p["api_id"] for p in result["patterns"]]
        assert "recent" in api_ids
        assert "old" not in api_ids

    def test_category_field_passed_through(self):
        snapshot = _make_snapshot([
            _make_currency(
                "chaos-orb",
                category="currency",
                price_logs=_make_logs([1.0, 2.0, 4.0, 8.0, 16.0, 32.0]),
            ),
        ])
        config = _make_config()
        result = compute_circuit_patterns(snapshot, config)
        assert result["patterns"][0]["category"] == "currency"

    def test_snake_case_keys_supported(self):
        """Internal callers may pass snake_case dicts — should still work."""
        now = datetime(2026, 7, 10, tzinfo=timezone.utc)
        # Build a snake_case currency dict
        snake_currency = {
            "api_id": "chaos-orb",
            "category_api_id": "currency",
            "text": "Chaos Orb",
            "current_price": 32.0,
            "price_logs": [
                {
                    "time": (now - timedelta(days=5 - i)).strftime("%Y-%m-%dT00:00:00"),
                    "price": 2**i,
                    "quantity": 100,
                }
                for i in range(6)
            ],
        }
        snapshot = SimpleNamespace(
            currencies={"chaos-orb": snake_currency},
            fetched_at=now,
        )
        config = _make_config()
        result = compute_circuit_patterns(snapshot, config, now=now)
        assert len(result["patterns"]) == 1
        p = result["patterns"][0]
        assert p["api_id"] == "chaos-orb"
        assert p["text"] == "Chaos Orb"
        assert p["trajectory"] == TRAJECTORY_EXPONENTIAL_GROWTH

    def test_peak_then_decline_in_full_snapshot(self):
        # Spike-then-crash: 10, 100, 50, 30, 20 (peak on day 2, decline to 20)
        snapshot = _make_snapshot([
            _make_currency(
                "leveling-unique",
                price_logs=_make_logs([10.0, 100.0, 50.0, 30.0, 20.0]),
            ),
        ])
        config = _make_config()
        result = compute_circuit_patterns(snapshot, config)
        assert len(result["patterns"]) == 1
        p = result["patterns"][0]
        assert p["trajectory"] == TRAJECTORY_PEAK_THEN_DECLINE
        assert p["recommended_action"] == ACTION_SELL_NOW
        assert p["days_since_peak"] == 3  # peak at index 1, last at index 4

    def test_default_days_and_limit(self):
        # Verify defaults match module constants
        assert DEFAULT_DAYS == 30
        assert DEFAULT_LIMIT == 50

    def test_min_sample_size_is_4(self):
        # Verify the constant — used by tests above
        assert MIN_SAMPLE_SIZE == 4

    def test_zero_limit_returns_empty_patterns(self):
        snapshot = _make_snapshot([
            _make_currency(
                "growing",
                price_logs=_make_logs([1.0, 2.0, 4.0, 8.0, 16.0, 32.0]),
            ),
        ])
        config = _make_config()
        # limit=0 = "no items returned" (treated as cap, not "no limit").
        # The currency is still classified (data_available=True), but
        # the patterns list is capped to 0 entries.
        result = compute_circuit_patterns(snapshot, config, limit=0)
        assert result["data_available"] is True
        assert result["patterns"] == []

    def test_all_seven_trajectories_represented(self):
        """Smoke test: build one currency per archetype and verify all
        seven trajectories appear when filter=ALL."""
        now = datetime(2026, 7, 10, tzinfo=timezone.utc)

        # Helper: build N evenly-spaced points ending at `now`
        def logs(prices):
            n = len(prices)
            return [
                {
                    "Time": (now - timedelta(days=(n - 1 - i))).strftime("%Y-%m-%dT00:00:00"),
                    "Price": p,
                    "Quantity": 100,
                }
                for i, p in enumerate(prices)
            ]

        snapshot = _make_snapshot([
            # EXPONENTIAL_GROWTH
            _make_currency("c-exp", price_logs=logs([1.0, 2.0, 4.0, 8.0, 16.0, 32.0])),
            # LINEAR_GROWTH
            _make_currency("c-lin", price_logs=logs([100.0, 105.0, 110.0, 115.0, 120.0, 125.0])),
            # PEAK_THEN_DECLINE
            _make_currency("c-peak", price_logs=logs([10.0, 100.0, 50.0, 40.0, 30.0, 20.0])),
            # MEAN_REVERTING
            _make_currency("c-mean", price_logs=logs([100.0, 101.0, 99.0, 100.0, 101.0, 99.0])),
            # VOLATILE — wild swings, peak at the END so peak-then-decline
            # detection does not trigger. CV > 0.5, R² low.
            _make_currency("c-vol", price_logs=logs([50.0, 10.0, 80.0, 5.0, 90.0, 150.0])),
            # DECLINING
            _make_currency("c-dec", price_logs=logs([100.0, 90.0, 80.0, 70.0, 60.0, 50.0])),
        ])
        config = _make_config()
        result = compute_circuit_patterns(snapshot, config, now=now)
        # Note: STABLE is hard to construct in a way that's distinct from
        # MEAN_REVERTING and VOLATILE — we just verify the other 6 here.
        trajectories = {p["trajectory"] for p in result["patterns"]}
        assert TRAJECTORY_EXPONENTIAL_GROWTH in trajectories
        assert TRAJECTORY_LINEAR_GROWTH in trajectories
        assert TRAJECTORY_PEAK_THEN_DECLINE in trajectories
        assert TRAJECTORY_MEAN_REVERTING in trajectories
        assert TRAJECTORY_VOLATILE in trajectories
        assert TRAJECTORY_DECLINING in trajectories
