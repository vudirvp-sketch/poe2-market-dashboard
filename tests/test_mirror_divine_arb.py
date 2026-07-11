"""
Tests for backend/economy/mirror_divine_arb.py — P7 Mirror/Divine arb detector.

Coverage:
1. Pure helpers: _extract_rate_series, _filter_to_window, _mean, _std,
   _z_score, _signal_from_zscore, _recommended_action.
2. compute_mirror_divine_arb end-to-end on hand-crafted snapshots:
   - Empty snapshot (no mirror, no divine)
   - Mirror present but divine missing (and vice versa)
   - History shorter than MIN_SAMPLE_SIZE → data_available=False
   - Steady rate (std == 0) → z_score=None, signal=NEUTRAL
   - Rate spike at end → SELL_MIRROR_BUY_DIVINE / EXECUTE_ARB
   - Rate dip at end → SELL_DIVINE_BUY_MIRROR / EXECUTE_ARB
   - Modest deviation (actionable but |z| in [1.0, 1.5)) → WATCH
   - Small deviation (below PROFIT_THRESHOLD_DIV) → HOLD
   - price_history_short capped at MAX_HISTORY_POINTS
3. Edge cases: zero/negative prices, malformed points, future timestamps,
   out-of-tolerance divine matches, days clamping.
4. Defensive: invalid days (0, negative, > MAX_DAYS) is clamped, not raised.
5. Route handler smoke test (with mocked snapshot manager).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from backend.economy.mirror_divine_arb import (
    ACTION_EXECUTE_ARB,
    ACTION_HOLD,
    ACTION_WATCH,
    DEFAULT_DAYS,
    DEFAULT_DIVINE_API_ID,
    DEFAULT_MIRROR_API_ID,
    MAX_DAYS,
    MAX_HISTORY_POINTS,
    MIN_SAMPLE_SIZE,
    PROFIT_THRESHOLD_DIV,
    SIGNAL_NEUTRAL,
    SIGNAL_SELL_DIVINE_BUY_MIRROR,
    SIGNAL_SELL_MIRROR_BUY_DIVINE,
    Z_BUY_THRESHOLD,
    Z_SELL_THRESHOLD,
    Z_WATCH_THRESHOLD,
    _extract_rate_series,
    _filter_to_window,
    _mean,
    _recommended_action,
    _signal_from_zscore,
    _std,
    _z_score,
    compute_mirror_divine_arb,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class _PricePoint:
    """Mirrors backend.models.currency.PricePoint — frozen dataclass with
    `timestamp` and `price` attributes. Used to build test histories without
    importing the real model (keeps tests hermetic)."""
    timestamp: datetime
    price: float
    volume: float = 0.0


def _make_snapshot(price_histories: dict[str, list[_PricePoint]]) -> SimpleNamespace:
    """Wrap a price_histories dict in a DataSnapshot-like object."""
    return SimpleNamespace(price_histories=price_histories)


def _make_config(league: str = "runes") -> SimpleNamespace:
    """Build a minimal config stub with .league.league_name."""
    return SimpleNamespace(league=SimpleNamespace(league_name=league))


def _ts(days_ago: float, hour: int = 0) -> datetime:
    """Return a UTC datetime `days_ago` days in the past."""
    return datetime.now(timezone.utc) - timedelta(days=days_ago, hours=-hour)


def _pair(
    days_ago_list: list[float],
    mirror_price: float,
    divine_price: float,
) -> tuple[list[_PricePoint], list[_PricePoint]]:
    """Build mirror & divine histories where every timestamp aligns exactly.

    Both histories get one point per `days_ago` value, with the supplied
    constant prices. Used to construct clean test fixtures without
    worrying about nearest-neighbour tolerance.
    """
    mirror = [_PricePoint(timestamp=_ts(d), price=mirror_price) for d in days_ago_list]
    divine = [_PricePoint(timestamp=_ts(d), price=divine_price) for d in days_ago_list]
    return mirror, divine


# ===========================================================================
# 1. _extract_rate_series
# ===========================================================================


class TestExtractRateSeries:
    def test_empty_mirror_returns_empty(self):
        divine = [_PricePoint(timestamp=_ts(1), price=10.0)]
        assert _extract_rate_series([], divine) == []

    def test_empty_divine_returns_empty(self):
        mirror = [_PricePoint(timestamp=_ts(1), price=10.0)]
        assert _extract_rate_series(mirror, []) == []

    def test_both_empty_returns_empty(self):
        assert _extract_rate_series([], []) == []

    def test_aligned_timestamps(self):
        mirror, divine = _pair([1, 2, 3, 4], mirror_price=200.0, divine_price=2.0)
        rates = _extract_rate_series(mirror, divine)
        assert len(rates) == 4
        for _, rate in rates:
            assert rate == pytest.approx(100.0)

    def test_sorted_ascending_by_timestamp(self):
        # Build mirror history in reverse chronological order; output should
        # be ascending.
        days = [4, 1, 3, 2]
        mirror = [_PricePoint(timestamp=_ts(d), price=200.0) for d in days]
        divine = [_PricePoint(timestamp=_ts(d), price=2.0) for d in days]
        rates = _extract_rate_series(mirror, divine)
        timestamps = [ts for ts, _ in rates]
        assert timestamps == sorted(timestamps)

    def test_zero_mirror_price_skipped(self):
        mirror = [
            _PricePoint(timestamp=_ts(1), price=0.0),
            _PricePoint(timestamp=_ts(2), price=200.0),
        ]
        divine = [_PricePoint(timestamp=_ts(d), price=2.0) for d in (1, 2)]
        rates = _extract_rate_series(mirror, divine)
        assert len(rates) == 1

    def test_negative_mirror_price_skipped(self):
        mirror = [
            _PricePoint(timestamp=_ts(1), price=-1.0),
            _PricePoint(timestamp=_ts(2), price=200.0),
        ]
        divine = [_PricePoint(timestamp=_ts(d), price=2.0) for d in (1, 2)]
        rates = _extract_rate_series(mirror, divine)
        assert len(rates) == 1

    def test_zero_divine_price_skipped(self):
        mirror = [_PricePoint(timestamp=_ts(d), price=200.0) for d in (1, 2)]
        divine = [
            _PricePoint(timestamp=_ts(1), price=0.0),
            _PricePoint(timestamp=_ts(2), price=2.0),
        ]
        rates = _extract_rate_series(mirror, divine)
        assert len(rates) == 1

    def test_divine_outside_tolerance_skipped(self):
        # Mirror point at days_ago=1, divine point at days_ago=10 → 9 days
        # apart, exceeds 24h tolerance.
        mirror = [_PricePoint(timestamp=_ts(1), price=200.0)]
        divine = [_PricePoint(timestamp=_ts(10), price=2.0)]
        rates = _extract_rate_series(mirror, divine)
        assert rates == []

    def test_malformed_point_skipped(self):
        # Point missing .price or .timestamp → skipped, not raised.
        mirror = [
            "not-a-point",  # type: ignore[list-item]
            _PricePoint(timestamp=_ts(1), price=200.0),
        ]
        divine = [_PricePoint(timestamp=_ts(1), price=2.0)]
        rates = _extract_rate_series(mirror, divine)
        assert len(rates) == 1

    def test_naive_datetime_skipped(self):
        # Mirror point has naive datetime (no tzinfo) → skipped.
        mirror = [
            _PricePoint(timestamp=datetime(2026, 1, 1), price=200.0),
            _PricePoint(timestamp=_ts(1), price=200.0),
        ]
        divine = [_PricePoint(timestamp=_ts(1), price=2.0)]
        rates = _extract_rate_series(mirror, divine)
        assert len(rates) == 1


# ===========================================================================
# 2. _filter_to_window
# ===========================================================================


class TestFilterToWindow:
    def test_empty_input(self):
        now = _ts(0)
        assert _filter_to_window([], days=30, now=now) == []

    def test_all_points_in_window(self):
        now = _ts(0)
        rates = [(_ts(d), 100.0) for d in (1, 5, 10, 20)]
        result = _filter_to_window(rates, days=30, now=now)
        assert len(result) == 4

    def test_old_points_filtered(self):
        now = _ts(0)
        rates = [(_ts(d), 100.0) for d in (1, 5, 60)]
        result = _filter_to_window(rates, days=30, now=now)
        assert len(result) == 2  # 60 days ago is outside

    def test_future_points_filtered(self):
        now = _ts(0)
        rates = [
            (_ts(1), 100.0),
            (_ts(-2), 100.0),  # 2 days in the future
        ]
        result = _filter_to_window(rates, days=30, now=now)
        assert len(result) == 1

    def test_days_clamped_to_max(self):
        now = _ts(0)
        rates = [(_ts(1), 100.0)]
        # days=999 should be clamped to MAX_DAYS, not raise.
        result = _filter_to_window(rates, days=999, now=now)
        assert len(result) == 1

    def test_days_clamped_to_min(self):
        now = _ts(0)
        rates = [(_ts(1), 100.0)]
        # days=0 should be clamped to 1, not raise.
        result = _filter_to_window(rates, days=0, now=now)
        # 1 day ago is within a 1-day window.
        assert len(result) == 1


# ===========================================================================
# 3. _mean / _std / _z_score
# ===========================================================================


class TestMeanStdZscore:
    def test_mean_empty(self):
        assert _mean([]) == 0.0

    def test_mean_single(self):
        assert _mean([42.0]) == 42.0

    def test_mean_multiple(self):
        assert _mean([1.0, 2.0, 3.0]) == pytest.approx(2.0)

    def test_std_empty(self):
        assert _std([]) == 0.0

    def test_std_single(self):
        # Sample std with ddof=1 needs at least 2 points.
        assert _std([42.0]) == 0.0

    def test_std_two_points(self):
        # Sample std (ddof=1) of [1, 3] = sqrt(((1-2)^2 + (3-2)^2) / 1) = sqrt(2)
        assert _std([1.0, 3.0]) == pytest.approx(2.0 ** 0.5)

    def test_std_population(self):
        # ddof=0 → population std of [1, 2, 3] = sqrt(((1-2)^2 + 0 + (3-2)^2) / 3) = sqrt(2/3)
        assert _std([1.0, 2.0, 3.0], ddof=0) == pytest.approx((2.0 / 3.0) ** 0.5)

    def test_z_score_zero_std_returns_none(self):
        assert _z_score(current=10.0, mean=10.0, std=0.0) is None

    def test_z_score_negative_std_returns_none(self):
        # Defensive: std should never be negative, but guard anyway.
        assert _z_score(current=10.0, mean=10.0, std=-1.0) is None

    def test_z_score_at_mean(self):
        assert _z_score(current=10.0, mean=10.0, std=2.0) == pytest.approx(0.0)

    def test_z_score_above_mean(self):
        assert _z_score(current=13.0, mean=10.0, std=2.0) == pytest.approx(1.5)

    def test_z_score_below_mean(self):
        assert _z_score(current=7.0, mean=10.0, std=2.0) == pytest.approx(-1.5)


# ===========================================================================
# 4. _signal_from_zscore
# ===========================================================================


class TestSignalFromZscore:
    def test_none_z_returns_neutral(self):
        assert _signal_from_zscore(None) == SIGNAL_NEUTRAL

    def test_zero_z_returns_neutral(self):
        assert _signal_from_zscore(0.0) == SIGNAL_NEUTRAL

    def test_moderate_positive_z_returns_neutral(self):
        assert _signal_from_zscore(1.0) == SIGNAL_NEUTRAL

    def test_sell_threshold_returns_sell_mirror(self):
        assert _signal_from_zscore(Z_SELL_THRESHOLD) == SIGNAL_SELL_MIRROR_BUY_DIVINE

    def test_above_sell_threshold_returns_sell_mirror(self):
        assert _signal_from_zscore(2.5) == SIGNAL_SELL_MIRROR_BUY_DIVINE

    def test_buy_threshold_returns_sell_divine(self):
        assert _signal_from_zscore(Z_BUY_THRESHOLD) == SIGNAL_SELL_DIVINE_BUY_MIRROR

    def test_below_buy_threshold_returns_sell_divine(self):
        assert _signal_from_zscore(-2.5) == SIGNAL_SELL_DIVINE_BUY_MIRROR


# ===========================================================================
# 5. _recommended_action
# ===========================================================================


class TestRecommendedAction:
    def test_not_actionable_returns_hold(self):
        assert _recommended_action(is_actionable=False, z=2.5) == ACTION_HOLD

    def test_none_z_returns_hold(self):
        assert _recommended_action(is_actionable=True, z=None) == ACTION_HOLD

    def test_actionable_high_z_returns_execute(self):
        assert _recommended_action(is_actionable=True, z=2.5) == ACTION_EXECUTE_ARB

    def test_actionable_low_z_returns_execute(self):
        assert _recommended_action(is_actionable=True, z=-2.5) == ACTION_EXECUTE_ARB

    def test_actionable_moderate_z_returns_watch(self):
        # |z| = 1.2 is in [Z_WATCH, Z_SELL) = [1.0, 1.5)
        assert _recommended_action(is_actionable=True, z=1.2) == ACTION_WATCH
        assert _recommended_action(is_actionable=True, z=-1.2) == ACTION_WATCH

    def test_actionable_low_abs_z_returns_hold(self):
        # |z| < Z_WATCH → HOLD even if actionable.
        assert _recommended_action(is_actionable=True, z=0.5) == ACTION_HOLD

    def test_actionable_at_watch_threshold_returns_watch(self):
        assert _recommended_action(is_actionable=True, z=Z_WATCH_THRESHOLD) == ACTION_WATCH

    def test_actionable_at_sell_threshold_returns_execute(self):
        assert _recommended_action(is_actionable=True, z=Z_SELL_THRESHOLD) == ACTION_EXECUTE_ARB


# ===========================================================================
# 6. compute_mirror_divine_arb — end-to-end
# ===========================================================================


class TestComputeMirrorDivineArbEmpty:
    def test_no_histories_returns_empty(self):
        snap = _make_snapshot({})
        result = compute_mirror_divine_arb(snap, _make_config())
        assert result["data_available"] is False
        assert result["current_rate"] is None
        assert result["signal"] == SIGNAL_NEUTRAL
        assert result["recommended_action"] == ACTION_HOLD
        assert result["is_actionable"] is False
        assert result["sample_size"] == 0
        assert result["price_history_short"] == []

    def test_mirror_only_returns_empty(self):
        mirror = [_PricePoint(timestamp=_ts(d), price=200.0) for d in (1, 2, 3, 4)]
        snap = _make_snapshot({"mirror": mirror})
        result = compute_mirror_divine_arb(snap, _make_config())
        assert result["data_available"] is False

    def test_divine_only_returns_empty(self):
        divine = [_PricePoint(timestamp=_ts(d), price=2.0) for d in (1, 2, 3, 4)]
        snap = _make_snapshot({"divine": divine})
        result = compute_mirror_divine_arb(snap, _make_config())
        assert result["data_available"] is False

    def test_below_min_sample_size_returns_empty(self):
        # Only 2 rate points (< MIN_SAMPLE_SIZE = 4).
        mirror, divine = _pair([1, 2], mirror_price=200.0, divine_price=2.0)
        snap = _make_snapshot({"mirror": mirror, "divine": divine})
        result = compute_mirror_divine_arb(snap, _make_config())
        assert result["data_available"] is False
        assert result["sample_size"] == 0


class TestComputeMirrorDivineArbSteady:
    def test_constant_rate_returns_neutral_signal(self):
        # All rate points are 100.0 → std = 0 → z = None → NEUTRAL.
        mirror, divine = _pair([1, 2, 3, 4, 5], mirror_price=200.0, divine_price=2.0)
        snap = _make_snapshot({"mirror": mirror, "divine": divine})
        result = compute_mirror_divine_arb(snap, _make_config())
        assert result["data_available"] is True
        assert result["current_rate"] == pytest.approx(100.0)
        assert result["mean_rate"] == pytest.approx(100.0)
        assert result["std_rate"] == pytest.approx(0.0)
        assert result["z_score"] is None
        assert result["signal"] == SIGNAL_NEUTRAL
        assert result["recommended_action"] == ACTION_HOLD
        assert result["is_actionable"] is False
        assert result["sample_size"] == 5

    def test_price_history_short_populated(self):
        mirror, divine = _pair([1, 2, 3, 4, 5], mirror_price=200.0, divine_price=2.0)
        snap = _make_snapshot({"mirror": mirror, "divine": divine})
        result = compute_mirror_divine_arb(snap, _make_config())
        assert len(result["price_history_short"]) == 5
        # Each entry should have date + rate.
        for pt in result["price_history_short"]:
            assert "date" in pt
            assert "rate" in pt
            assert pt["rate"] == pytest.approx(100.0)


class TestComputeMirrorDivineArbSpike:
    def test_rate_spike_at_end_triggers_sell_mirror(self):
        # 4 stable points at rate=100, then 1 spike at rate=200.
        # mean = (100*4 + 200)/5 = 120
        # sample var (ddof=1) = (4*(100-120)^2 + (200-120)^2) / 4 = (1600 + 6400)/4 = 2000
        # std = sqrt(2000) ≈ 44.721
        # z = (200 - 120) / 44.721 ≈ 1.789 (≥ Z_SELL_THRESHOLD = 1.5)
        # profit_potential = |200 - 120| = 80 < PROFIT_THRESHOLD_DIV (100) → not actionable
        days = [5, 4, 3, 2, 1]
        mirror = [
            _PricePoint(timestamp=_ts(d), price=200.0 if d != 1 else 400.0)
            for d in days
        ]
        divine = [_PricePoint(timestamp=_ts(d), price=2.0) for d in days]
        snap = _make_snapshot({"mirror": mirror, "divine": divine})
        result = compute_mirror_divine_arb(snap, _make_config())
        assert result["data_available"] is True
        assert result["current_rate"] == pytest.approx(200.0)
        assert result["mean_rate"] == pytest.approx(120.0)
        assert result["std_rate"] == pytest.approx((2000.0) ** 0.5)
        assert result["z_score"] == pytest.approx(80.0 / (2000.0 ** 0.5))
        assert result["signal"] == SIGNAL_SELL_MIRROR_BUY_DIVINE
        # profit_potential = 80 < 100 → not actionable → HOLD
        assert result["is_actionable"] is False
        assert result["recommended_action"] == ACTION_HOLD

    def test_large_spike_triggers_execute_arb(self):
        # 4 stable points at rate=100, then 1 spike at rate=400.
        # mean = (100*4 + 400)/5 = 160
        # sample var (ddof=1) = (4*(100-160)^2 + (400-160)^2) / 4 = (14400 + 57600)/4 = 18000
        # std = sqrt(18000) ≈ 134.164
        # z = (400 - 160) / 134.164 ≈ 1.789 (≥ Z_SELL_THRESHOLD = 1.5)
        # profit_potential = |400 - 160| = 240 > 100 → actionable
        days = [5, 4, 3, 2, 1]
        mirror = [
            _PricePoint(timestamp=_ts(d), price=200.0 if d != 1 else 800.0)
            for d in days
        ]
        divine = [_PricePoint(timestamp=_ts(d), price=2.0) for d in days]
        snap = _make_snapshot({"mirror": mirror, "divine": divine})
        result = compute_mirror_divine_arb(snap, _make_config())
        assert result["current_rate"] == pytest.approx(400.0)
        assert result["mean_rate"] == pytest.approx(160.0)
        assert result["z_score"] == pytest.approx(240.0 / (18000.0 ** 0.5))
        assert result["signal"] == SIGNAL_SELL_MIRROR_BUY_DIVINE
        assert result["is_actionable"] is True
        assert result["recommended_action"] == ACTION_EXECUTE_ARB
        assert result["profit_potential_per_mirror_div"] == pytest.approx(240.0)

    def test_rate_dip_at_end_triggers_sell_divine(self):
        # 4 stable points at rate=200, then 1 dip at rate=50.
        # mean = (200*4 + 50)/5 = 170, std = sqrt(((30)^2*4 + (-120)^2)/4) = sqrt((3600+14400)/4) = sqrt(4500) ≈ 67.08
        # z = (50 - 170) / 67.08 ≈ -1.789
        # profit_potential = |50 - 170| = 120 > 100 → actionable
        days = [5, 4, 3, 2, 1]
        mirror = [
            _PricePoint(timestamp=_ts(d), price=400.0 if d != 1 else 100.0)
            for d in days
        ]
        divine = [_PricePoint(timestamp=_ts(d), price=2.0) for d in days]
        snap = _make_snapshot({"mirror": mirror, "divine": divine})
        result = compute_mirror_divine_arb(snap, _make_config())
        assert result["current_rate"] == pytest.approx(50.0)
        assert result["z_score"] is not None
        assert result["z_score"] < Z_BUY_THRESHOLD
        assert result["signal"] == SIGNAL_SELL_DIVINE_BUY_MIRROR
        assert result["is_actionable"] is True
        assert result["recommended_action"] == ACTION_EXECUTE_ARB


class TestComputeMirrorDivineArbWatch:
    def test_actionable_but_moderate_z_returns_watch(self):
        # Construct a series where |z| is in [1.0, 1.5) but
        # profit_potential >= PROFIT_THRESHOLD_DIV.
        # We want z = 1.2 → (current - mean) / std = 1.2
        # → current - mean = 1.2 * std
        # We also want |current - mean| >= 100 (actionable).
        # Let mean = 200, std = 100, current = 320 → z = 1.2, profit = 120.
        # Sample of [200, 200, 200, 200, 320] → mean = 224, std ≈ 53.67, not what we want.
        # Easier: hand-craft 4 points such that mean/std are predictable.
        # Use [100, 100, 100, 100, 300]: mean = 140, std = sqrt(((40)^2*4 + (160)^2)/4) = sqrt((6400+25600)/4) = sqrt(8000) ≈ 89.44
        # z = (300-140)/89.44 ≈ 1.79 → EXECUTE_ARB, not WATCH.
        #
        # Try [100, 100, 100, 100, 250]: mean = 130, std = sqrt(((30)^2*4 + (120)^2)/4) = sqrt((3600+14400)/4) = sqrt(4500) ≈ 67.08
        # z = (250-130)/67.08 ≈ 1.79 → still EXECUTE.
        #
        # Try [200, 200, 200, 200, 250]: mean = 210, std = sqrt(((10)^2*4 + (40)^2)/4) = sqrt((400+1600)/4) = sqrt(500) ≈ 22.36
        # z = (250-210)/22.36 ≈ 1.79 → still EXECUTE.
        #
        # To get z = 1.2 with profit >= 100, we need:
        # |current - mean| = 1.2 * std AND |current - mean| >= 100
        # → std >= 100/1.2 ≈ 83.33
        # Let std = 100, mean = 200, current = 320 → z = 1.2, profit = 120.
        # We need a sample with mean=200, std=100, last=320.
        # [100, 200, 200, 200, 320]: mean = 204, std = sqrt(((104)^2 + (4)^2*3 + (116)^2)/4) = sqrt((10816 + 48 + 13456)/4) = sqrt(6080) ≈ 77.97
        # Not quite.
        #
        # Use a simpler approach: 4 points where std is computed cleanly.
        # [100, 300, 100, 300, 420]: mean = 244, var = ((144)^2 + (56)^2 + (144)^2 + (56)^2 + (176)^2)/4 = (20736+3136+20736+3136+30976)/4 = 78720/4 = 19680, std ≈ 140.29
        # z = (420-244)/140.29 ≈ 1.255 → in [1.0, 1.5). profit = |420-244| = 176 > 100. ✓
        days = [5, 4, 3, 2, 1]
        mirror_prices = [100.0, 300.0, 100.0, 300.0, 420.0]
        divine_prices = [1.0] * 5  # rate = mirror_price
        mirror = [_PricePoint(timestamp=_ts(d), price=p) for d, p in zip(days, mirror_prices)]
        divine = [_PricePoint(timestamp=_ts(d), price=p) for d, p in zip(days, divine_prices)]
        snap = _make_snapshot({"mirror": mirror, "divine": divine})
        result = compute_mirror_divine_arb(snap, _make_config())
        assert result["is_actionable"] is True
        assert result["z_score"] is not None
        assert Z_WATCH_THRESHOLD <= abs(result["z_score"]) < Z_SELL_THRESHOLD
        assert result["recommended_action"] == ACTION_WATCH


class TestComputeMirrorDivineArbPriceHistoryShort:
    def test_capped_at_max_history_points(self):
        # Provide 20 rate points — only the last MAX_HISTORY_POINTS (14)
        # should appear in price_history_short.
        days = list(range(20, 0, -1))  # 20, 19, ..., 1
        mirror = [_PricePoint(timestamp=_ts(d), price=200.0) for d in days]
        divine = [_PricePoint(timestamp=_ts(d), price=2.0) for d in days]
        snap = _make_snapshot({"mirror": mirror, "divine": divine})
        result = compute_mirror_divine_arb(snap, _make_config())
        assert len(result["price_history_short"]) == MAX_HISTORY_POINTS

    def test_price_history_short_oldest_first(self):
        # The most-recent MAX_HISTORY_POINTS points should be in
        # ascending timestamp order (oldest-first).
        days = list(range(20, 0, -1))
        mirror = [_PricePoint(timestamp=_ts(d), price=200.0) for d in days]
        divine = [_PricePoint(timestamp=_ts(d), price=2.0) for d in days]
        snap = _make_snapshot({"mirror": mirror, "divine": divine})
        result = compute_mirror_divine_arb(snap, _make_config())
        timestamps = [pt["date"] for pt in result["price_history_short"]]
        assert timestamps == sorted(timestamps)


# ===========================================================================
# 7. Defensive / config
# ===========================================================================


class TestComputeMirrorDivineArbDefensive:
    def test_invalid_days_zero_clamped(self):
        mirror, divine = _pair([1, 2, 3, 4], mirror_price=200.0, divine_price=2.0)
        snap = _make_snapshot({"mirror": mirror, "divine": divine})
        # days=0 should be clamped to 1, not raise. But points at 1,2,3,4
        # days ago are outside a 1-day window → data_available=False.
        result = compute_mirror_divine_arb(snap, _make_config(), days=0)
        # Either clamped to 1 (and 4-day-old points filtered) → False,
        # or clamped to 1 and all points filtered out → False.
        assert result["data_available"] is False

    def test_invalid_days_negative_clamped(self):
        mirror, divine = _pair([1, 2, 3, 4], mirror_price=200.0, divine_price=2.0)
        snap = _make_snapshot({"mirror": mirror, "divine": divine})
        result = compute_mirror_divine_arb(snap, _make_config(), days=-5)
        assert result["data_available"] is False

    def test_days_above_max_clamped(self):
        mirror, divine = _pair([1, 2, 3, 4], mirror_price=200.0, divine_price=2.0)
        snap = _make_snapshot({"mirror": mirror, "divine": divine})
        # days=999 → clamped to MAX_DAYS (90). All points within 90 days
        # → data_available=True.
        result = compute_mirror_divine_arb(snap, _make_config(), days=999)
        assert result["data_available"] is True
        assert result["days"] == MAX_DAYS

    def test_custom_mirror_api_id(self):
        # Use "mirror-of-kalandra" instead of "mirror".
        mirror, divine = _pair([1, 2, 3, 4], mirror_price=200.0, divine_price=2.0)
        snap = _make_snapshot({
            "mirror-of-kalandra": mirror,
            "divine": divine,
        })
        result = compute_mirror_divine_arb(
            snap, _make_config(),
            mirror_api_id="mirror-of-kalandra",
        )
        assert result["data_available"] is True
        assert result["mirror_currency"] == "mirror-of-kalandra"

    def test_custom_divine_api_id(self):
        mirror, divine = _pair([1, 2, 3, 4], mirror_price=200.0, divine_price=2.0)
        snap = _make_snapshot({
            "mirror": mirror,
            "divine-orb": divine,
        })
        result = compute_mirror_divine_arb(
            snap, _make_config(),
            divine_api_id="divine-orb",
        )
        assert result["data_available"] is True
        assert result["divine_currency"] == "divine-orb"

    def test_case_insensitive_api_id(self):
        # Snapshot keys are lowercased internally by DataSnapshot; the
        # detector should also lowercase the api_id args.
        mirror, divine = _pair([1, 2, 3, 4], mirror_price=200.0, divine_price=2.0)
        snap = _make_snapshot({"mirror": mirror, "divine": divine})
        result = compute_mirror_divine_arb(
            snap, _make_config(),
            mirror_api_id="MIRROR",
            divine_api_id="Divine",
        )
        assert result["data_available"] is True

    def test_league_name_in_response(self):
        mirror, divine = _pair([1, 2, 3, 4], mirror_price=200.0, divine_price=2.0)
        snap = _make_snapshot({"mirror": mirror, "divine": divine})
        result = compute_mirror_divine_arb(snap, _make_config(league="standard"))
        assert result["league"] == "standard"

    def test_response_shape_empty(self):
        snap = _make_snapshot({})
        result = compute_mirror_divine_arb(snap, _make_config())
        # Verify all expected keys are present even in empty result.
        expected_keys = {
            "league", "mirror_currency", "divine_currency", "current_rate",
            "mean_rate", "std_rate", "min_rate", "max_rate", "z_score",
            "deviation_pct", "profit_potential_per_mirror_div", "signal",
            "is_actionable", "recommended_action", "sample_size",
            "price_history_short", "data_available", "fetched_at", "days",
        }
        assert set(result.keys()) == expected_keys

    def test_response_shape_populated(self):
        mirror, divine = _pair([1, 2, 3, 4, 5], mirror_price=200.0, divine_price=2.0)
        snap = _make_snapshot({"mirror": mirror, "divine": divine})
        result = compute_mirror_divine_arb(snap, _make_config())
        expected_keys = {
            "league", "mirror_currency", "divine_currency", "current_rate",
            "mean_rate", "std_rate", "min_rate", "max_rate", "z_score",
            "deviation_pct", "profit_potential_per_mirror_div", "signal",
            "is_actionable", "recommended_action", "sample_size",
            "price_history_short", "data_available", "fetched_at", "days",
        }
        assert set(result.keys()) == expected_keys

    def test_days_echoed_in_response(self):
        mirror, divine = _pair([1, 2, 3, 4, 5], mirror_price=200.0, divine_price=2.0)
        snap = _make_snapshot({"mirror": mirror, "divine": divine})
        result = compute_mirror_divine_arb(snap, _make_config(), days=14)
        assert result["days"] == 14

    def test_min_max_rate_populated(self):
        # Rates: 100, 100, 100, 100, 200
        days = [5, 4, 3, 2, 1]
        mirror = [
            _PricePoint(timestamp=_ts(d), price=200.0 if d != 1 else 400.0)
            for d in days
        ]
        divine = [_PricePoint(timestamp=_ts(d), price=2.0) for d in days]
        snap = _make_snapshot({"mirror": mirror, "divine": divine})
        result = compute_mirror_divine_arb(snap, _make_config())
        assert result["min_rate"] == pytest.approx(100.0)
        assert result["max_rate"] == pytest.approx(200.0)

    def test_deviation_pct_computed(self):
        # Stable rate 100, then spike to 200. mean = 120, current = 200.
        # deviation_pct = (200-120)/120 * 100 = 66.67%
        days = [5, 4, 3, 2, 1]
        mirror = [
            _PricePoint(timestamp=_ts(d), price=200.0 if d != 1 else 400.0)
            for d in days
        ]
        divine = [_PricePoint(timestamp=_ts(d), price=2.0) for d in days]
        snap = _make_snapshot({"mirror": mirror, "divine": divine})
        result = compute_mirror_divine_arb(snap, _make_config())
        assert result["deviation_pct"] == pytest.approx(66.666667, rel=1e-4)


# ===========================================================================
# 8. Route handler smoke test
# ===========================================================================


class TestRouteHandler:
    """Smoke-test the FastAPI route handler with a mocked snapshot manager.

    The route is a thin wrapper around `compute_mirror_divine_arb` — we
    only verify the happy path and the no-snapshot path.
    """

    @pytest.mark.asyncio
    async def test_route_returns_data_when_snapshot_available(self):
        # Import the handler function directly and call it with explicit
        # kwargs — bypassing FastAPI's Query() default substitution.
        # Same pattern as test_circuit_patterns.py::TestRouteHandler.
        from backend.api.routes_mirror_divine_arb import get_mirror_divine_arb

        # Build a snapshot with enough rate points.
        mirror, divine = _pair([1, 2, 3, 4, 5], mirror_price=200.0, divine_price=2.0)
        snap = _make_snapshot({"mirror": mirror, "divine": divine})

        with patch(
            "backend.api.routes_mirror_divine_arb.get_snapshot_manager"
        ) as mock_mgr, patch(
            "backend.api.routes_mirror_divine_arb.get_snapshot"
        ) as mock_get, patch(
            "backend.api.routes_mirror_divine_arb.get_settings"
        ) as mock_cfg:
            mock_mgr.return_value = SimpleNamespace(last_snapshot=snap)
            mock_get.return_value = snap
            mock_cfg.return_value = _make_config()
            result = await get_mirror_divine_arb(days=30)
            assert result["data_available"] is True
            assert result["current_rate"] == pytest.approx(100.0)
            assert "league" in result
            assert result["days"] == 30

    @pytest.mark.asyncio
    async def test_route_returns_empty_when_no_snapshot(self):
        from backend.api.routes_mirror_divine_arb import get_mirror_divine_arb

        with patch(
            "backend.api.routes_mirror_divine_arb.get_snapshot_manager"
        ) as mock_mgr, patch(
            "backend.api.routes_mirror_divine_arb.get_settings"
        ) as mock_cfg:
            mock_mgr.return_value = SimpleNamespace(last_snapshot=None)
            mock_cfg.return_value = _make_config()
            result = await get_mirror_divine_arb(days=30)
            assert result["data_available"] is False
            assert result["current_rate"] is None
            assert result["signal"] == SIGNAL_NEUTRAL
            assert result["days"] == 30
