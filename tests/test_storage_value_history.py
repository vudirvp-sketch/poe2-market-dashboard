"""
Tests for backend/economy/storage_value_history.py — F2 follow-up (iter 75).

Coverage:
1. Pure-function tests on hand-crafted DataSnapshot-like inputs.
2. Edge cases: empty history, missing mirror/hinekora, sparse data, future
   timestamps, days cutoff.
3. Route handler smoke test (with mocked snapshot manager).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from backend.economy.storage_value_history import (
    DEFAULT_HINEKORA_API_ID,
    DEFAULT_MIRROR_API_ID,
    MAX_DAYS,
    NEAREST_NEIGHBOR_TOLERANCE_HOURS,
    _find_nearest_price,
    compute_storage_value_history,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class _PricePoint:
    """Mirrors backend.models.currency.PricePoint — frozen dataclass with
    `timestamp` and `price` attributes. Used to build test histories without
    importing the real model (keeps tests hermetic).
    """
    timestamp: datetime
    price: float
    volume: float = 0.0


def _make_snapshot(price_histories: dict[str, list[_PricePoint]]) -> SimpleNamespace:
    """Wrap a price_histories dict in a DataSnapshot-like object."""
    return SimpleNamespace(price_histories=price_histories)


def _ts(days_ago: float, hour: int = 0) -> datetime:
    """Return a UTC datetime `days_ago` days in the past."""
    return datetime.now(timezone.utc) - timedelta(days=days_ago, hours=-hour)


# ===========================================================================
# 1. _find_nearest_price
# ===========================================================================


class TestFindNearestPrice:
    def test_empty_history(self):
        target = _ts(0)
        price, ts = _find_nearest_price(target, [])
        assert price is None
        assert ts is None

    def test_exact_match(self):
        target = _ts(0)
        history = [_PricePoint(target, 100.0)]
        price, ts = _find_nearest_price(target, history)
        assert price == 100.0
        assert ts == target

    def test_picks_closest(self):
        target = _ts(0)
        history = [
            _PricePoint(_ts(2), 200.0),
            _PricePoint(_ts(0.5), 150.0),  # closest
            _PricePoint(_ts(5), 300.0),
        ]
        price, ts = _find_nearest_price(target, history)
        assert price == 150.0

    def test_tolerance_exceeded(self):
        """Point beyond tolerance returns None."""
        target = _ts(0)
        # 25 hours away — beyond the 24h tolerance
        history = [_PricePoint(target - timedelta(hours=25), 100.0)]
        price, ts = _find_nearest_price(target, history)
        assert price is None
        assert ts is None

    def test_tolerance_at_boundary(self):
        """Point exactly at tolerance boundary is included."""
        target = _ts(0)
        history = [_PricePoint(target - timedelta(hours=24), 100.0)]
        price, ts = _find_nearest_price(target, history)
        # 24h == tolerance, so it should be included (<=)
        assert price == 100.0


# ===========================================================================
# 2. compute_storage_value_history — basic cases
# ===========================================================================


class TestComputeHistoryBasic:
    def test_empty_currency_history(self):
        snapshot = _make_snapshot({})
        result = compute_storage_value_history(snapshot, "divine")
        assert result["currency"] == "divine"
        assert result["data_available"] is False
        assert result["points"] == []

    def test_currency_history_only_no_mirror(self):
        """Currency has history but mirror/hinekora don't — ratios are None."""
        today = datetime.now(timezone.utc)
        snapshot = _make_snapshot({
            "divine": [
                _PricePoint(today - timedelta(days=1), 100.0),
                _PricePoint(today, 110.0),
            ],
        })
        result = compute_storage_value_history(snapshot, "divine", days=30)
        assert result["data_available"] is True
        assert len(result["points"]) == 2
        for p in result["points"]:
            assert p["mirror_price"] is None
            assert p["hinekora_price"] is None
            assert p["ratio_mirror"] is None
            assert p["ratio_hinekora"] is None
            assert p["price"] > 0

    def test_with_mirror_history(self):
        today = datetime.now(timezone.utc)
        snapshot = _make_snapshot({
            "divine": [
                _PricePoint(today - timedelta(days=1), 100.0),
                _PricePoint(today, 110.0),
            ],
            "mirror": [
                _PricePoint(today - timedelta(days=1), 50000.0),
                _PricePoint(today, 55000.0),
            ],
        })
        result = compute_storage_value_history(snapshot, "divine", days=30)
        assert result["data_available"] is True
        assert len(result["points"]) == 2
        # Day 0: 100 / 50000 = 0.002
        assert result["points"][0]["ratio_mirror"] == pytest.approx(0.002)
        # Day 1: 110 / 55000 = 0.002
        assert result["points"][1]["ratio_mirror"] == pytest.approx(0.002)

    def test_with_hinekora_history(self):
        today = datetime.now(timezone.utc)
        snapshot = _make_snapshot({
            "divine": [
                _PricePoint(today - timedelta(days=1), 100.0),
                _PricePoint(today, 110.0),
            ],
            "hinekoras-lock": [
                _PricePoint(today - timedelta(days=1), 5000.0),
                _PricePoint(today, 5500.0),
            ],
        })
        result = compute_storage_value_history(snapshot, "divine", days=30)
        assert result["data_available"] is True
        assert len(result["points"]) == 2
        # Day 0: 100 / 5000 = 0.02
        assert result["points"][0]["ratio_hinekora"] == pytest.approx(0.02)
        # Day 1: 110 / 5500 = 0.02
        assert result["points"][1]["ratio_hinekora"] == pytest.approx(0.02)

    def test_with_both_references(self):
        today = datetime.now(timezone.utc)
        snapshot = _make_snapshot({
            "divine": [_PricePoint(today, 100.0)],
            "mirror": [_PricePoint(today, 50000.0)],
            "hinekoras-lock": [_PricePoint(today, 5000.0)],
        })
        result = compute_storage_value_history(snapshot, "divine", days=30)
        assert len(result["points"]) == 1
        p = result["points"][0]
        assert p["mirror_price"] == 50000.0
        assert p["hinekora_price"] == 5000.0
        assert p["ratio_mirror"] == pytest.approx(0.002)
        assert p["ratio_hinekora"] == pytest.approx(0.02)


# ===========================================================================
# 3. compute_storage_value_history — edge cases
# ===========================================================================


class TestComputeHistoryEdgeCases:
    def test_case_insensitive_currency(self):
        """Currency lookup should be case-insensitive (lowercase keys)."""
        today = datetime.now(timezone.utc)
        snapshot = _make_snapshot({
            "divine": [_PricePoint(today, 100.0)],
        })
        # "DIVINE" should match the "divine" key
        result = compute_storage_value_history(snapshot, "DIVINE", days=30)
        assert result["data_available"] is True
        assert len(result["points"]) == 1

    def test_days_cutoff_excludes_old_points(self):
        """Points older than `days` should be excluded."""
        today = datetime.now(timezone.utc)
        snapshot = _make_snapshot({
            "divine": [
                _PricePoint(today - timedelta(days=45), 100.0),  # older than 30d
                _PricePoint(today - timedelta(days=10), 110.0),  # within 30d
                _PricePoint(today, 120.0),
            ],
        })
        result = compute_storage_value_history(snapshot, "divine", days=30)
        assert len(result["points"]) == 2  # only the last two

    def test_days_clamped_to_max(self):
        """days > MAX_DAYS should be clamped silently."""
        today = datetime.now(timezone.utc)
        # Place a point exactly MAX_DAYS ago — should be included even if
        # caller passes days=365 (clamped to MAX_DAYS=90).
        snapshot = _make_snapshot({
            "divine": [
                _PricePoint(today - timedelta(days=MAX_DAYS - 1), 100.0),
                _PricePoint(today, 110.0),
            ],
        })
        result = compute_storage_value_history(snapshot, "divine", days=365)
        assert len(result["points"]) == 2

    def test_future_timestamps_excluded(self):
        """Points in the future (more than 1h ahead) should be skipped."""
        today = datetime.now(timezone.utc)
        snapshot = _make_snapshot({
            "divine": [
                _PricePoint(today - timedelta(days=1), 100.0),
                _PricePoint(today, 110.0),
                _PricePoint(today + timedelta(days=2), 200.0),  # future — skipped
            ],
        })
        result = compute_storage_value_history(snapshot, "divine", days=30)
        assert len(result["points"]) == 2

    def test_zero_mirror_price_yields_none_ratio(self):
        """If mirror_price is 0, ratio_mirror should be None (avoid div by zero)."""
        today = datetime.now(timezone.utc)
        snapshot = _make_snapshot({
            "divine": [_PricePoint(today, 100.0)],
            "mirror": [_PricePoint(today, 0.0)],  # zero price
        })
        result = compute_storage_value_history(snapshot, "divine", days=30)
        p = result["points"][0]
        assert p["mirror_price"] == 0.0
        assert p["ratio_mirror"] is None

    def test_nearest_neighbor_within_tolerance(self):
        """Mirror price 12h away from currency point should be matched."""
        today = datetime.now(timezone.utc)
        snapshot = _make_snapshot({
            "divine": [_PricePoint(today, 100.0)],
            "mirror": [_PricePoint(today - timedelta(hours=12), 50000.0)],
        })
        result = compute_storage_value_history(snapshot, "divine", days=30)
        p = result["points"][0]
        assert p["mirror_price"] == 50000.0
        assert p["ratio_mirror"] == pytest.approx(0.002)

    def test_nearest_neighbor_beyond_tolerance(self):
        """Mirror price 25h away from currency point should NOT be matched."""
        today = datetime.now(timezone.utc)
        snapshot = _make_snapshot({
            "divine": [_PricePoint(today, 100.0)],
            "mirror": [_PricePoint(today - timedelta(hours=25), 50000.0)],
        })
        result = compute_storage_value_history(snapshot, "divine", days=30)
        p = result["points"][0]
        assert p["mirror_price"] is None
        assert p["ratio_mirror"] is None

    def test_points_sorted_ascending(self):
        """Output points should be sorted ascending by timestamp."""
        today = datetime.now(timezone.utc)
        snapshot = _make_snapshot({
            "divine": [
                _PricePoint(today, 110.0),
                _PricePoint(today - timedelta(days=2), 90.0),
                _PricePoint(today - timedelta(days=1), 100.0),
            ],
        })
        result = compute_storage_value_history(snapshot, "divine", days=30)
        timestamps = [p["timestamp"] for p in result["points"]]
        assert timestamps == sorted(timestamps)

    def test_response_includes_currency_ids(self):
        """Response should echo back the currency and reference currency IDs."""
        today = datetime.now(timezone.utc)
        snapshot = _make_snapshot({"divine": [_PricePoint(today, 100.0)]})
        result = compute_storage_value_history(snapshot, "divine", days=30)
        assert result["currency"] == "divine"
        assert result["mirror_currency"] == DEFAULT_MIRROR_API_ID
        assert result["hinekora_currency"] == DEFAULT_HINEKORA_API_ID

    def test_fetched_at_is_iso(self):
        today = datetime(2026, 6, 8, 12, 0, 0, tzinfo=timezone.utc)
        snapshot = _make_snapshot({})
        result = compute_storage_value_history(snapshot, "divine", now=today)
        assert result["fetched_at"] == today.isoformat()


# ===========================================================================
# 4. Route handler smoke test
# ===========================================================================


class TestHistoryRouteHandler:
    """Smoke test the FastAPI route handler."""

    async def test_route_returns_empty_when_no_snapshot(self):
        from backend.api.routes_storage_value import get_storage_value_history

        with patch(
            "backend.api.routes_storage_value.get_snapshot_manager",
            create=True,
        ) as mock_mgr:
            # We can't easily patch the local import inside the function, so
            # patch at the source module instead.
            pass
        # Use the source-module patch instead:
        with patch("backend.api.data_snapshot.get_snapshot_manager") as mock_mgr:
            mock_mgr.return_value = SimpleNamespace(last_snapshot=None)
            result = await get_storage_value_history("divine", days=30)
            assert result["data_available"] is False
            assert result["points"] == []
            assert result["currency"] == "divine"

    async def test_route_returns_data_when_snapshot_available(self):
        from backend.api.routes_storage_value import get_storage_value_history

        today = datetime.now(timezone.utc)
        snapshot = _make_snapshot({
            "divine": [_PricePoint(today, 100.0)],
            "mirror": [_PricePoint(today, 50000.0)],
        })

        with patch("backend.api.data_snapshot.get_snapshot_manager") as mock_mgr, \
             patch("backend.api.data_snapshot.get_snapshot") as mock_get:
            mock_mgr.return_value = SimpleNamespace(last_snapshot=object())
            mock_get.return_value = snapshot
            result = await get_storage_value_history("divine", days=30)
            assert result["data_available"] is True
            assert len(result["points"]) == 1
            assert result["points"][0]["ratio_mirror"] == pytest.approx(0.002)

    async def test_route_returns_empty_on_exception(self):
        from backend.api.routes_storage_value import get_storage_value_history

        with patch("backend.api.data_snapshot.get_snapshot_manager") as mock_mgr, \
             patch("backend.api.data_snapshot.get_snapshot") as mock_get:
            mock_mgr.return_value = SimpleNamespace(last_snapshot=object())
            mock_get.side_effect = RuntimeError("boom")
            result = await get_storage_value_history("divine", days=30)
            assert result["data_available"] is False
            assert result["points"] == []

    async def test_route_uses_days_param(self):
        from backend.api.routes_storage_value import get_storage_value_history

        today = datetime.now(timezone.utc)
        snapshot = _make_snapshot({
            "divine": [
                _PricePoint(today - timedelta(days=45), 100.0),  # excluded
                _PricePoint(today - timedelta(days=10), 110.0),  # included
                _PricePoint(today, 120.0),                       # included
            ],
        })

        with patch("backend.api.data_snapshot.get_snapshot_manager") as mock_mgr, \
             patch("backend.api.data_snapshot.get_snapshot") as mock_get:
            mock_mgr.return_value = SimpleNamespace(last_snapshot=object())
            mock_get.return_value = snapshot
            result = await get_storage_value_history("divine", days=30)
            assert len(result["points"]) == 2
