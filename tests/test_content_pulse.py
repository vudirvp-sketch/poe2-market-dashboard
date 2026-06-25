"""
Tests for backend/economy/content_pulse.py — F3 (iter 75).

Coverage:
1. Pure-function tests on hand-crafted DataSnapshot-like inputs.
2. Edge cases: empty snapshot, category with no items, single-item category,
   sparse price_logs (only 1 day), items with zero quantity.
3. Signal thresholds (rising/falling/stable).
4. Top movers sorting and filtering.
5. Route handler smoke test (with mocked snapshot manager).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from backend.economy.content_pulse import (
    SIGNAL_FALLING_THRESHOLD_PCT,
    SIGNAL_RISING_THRESHOLD_PCT,
    TOP_N_PER_CATEGORY,
    _bucketize_price_logs,
    _category_daily_volumes,
    _category_today_volume,
    _price_trend_pct,
    _rolling_mean,
    _signal_from_delta,
    _top_movers,
    compute_content_pulse,
)


# ---------------------------------------------------------------------------
# Helpers — build minimal DataSnapshot-like objects without spinning up the
# real SnapshotManager. We use SimpleNamespace to avoid coupling tests to
# the dataclass internals of DataSnapshot (which may evolve).
# ---------------------------------------------------------------------------


def _make_currency(
    api_id: str,
    category: str,
    *,
    current_quantity: float = 0.0,
    current_price: float = 0.0,
    price_logs: list[dict] | None = None,
    text: str | None = None,
) -> dict:
    """Build a single ByCategory-style currency dict (PascalCase keys)."""
    return {
        "ApiId": api_id,
        "CategoryApiId": category,
        "Text": text or api_id.replace("-", " ").title(),
        "CurrentPrice": current_price,
        "CurrentQuantity": current_quantity,
        "PriceLogs": price_logs or [],
    }


def _make_snapshot(currencies: list[dict]) -> SimpleNamespace:
    """Wrap a list of ByCategory dicts in a DataSnapshot-like object.

    snapshot.currencies is keyed by api_id.lower() (matches the real
    DataSnapshot._build_currencies flow).
    """
    return SimpleNamespace(
        currencies={c["ApiId"].lower(): c for c in currencies},
        fetched_at=datetime.now(timezone.utc),
    )


def _make_config(categories: list[str], league_name: str = "runes") -> SimpleNamespace:
    return SimpleNamespace(
        league=SimpleNamespace(
            league_name=league_name,
            currency_categories=categories,
        ),
    )


def _days_ago_iso(days: int, base: datetime | None = None) -> str:
    """ISO date string for `days` ago from `base` (defaults to now)."""
    base = base or datetime.now(timezone.utc)
    return (base - timedelta(days=days)).strftime("%Y-%m-%dT00:00:00")


# ===========================================================================
# 1. _bucketize_price_logs
# ===========================================================================


class TestBucketizePriceLogs:
    def test_empty(self):
        assert _bucketize_price_logs([]) == {}

    def test_single_log(self):
        logs = [{"Time": "2026-06-08T00:00:00", "Quantity": 100}]
        result = _bucketize_price_logs(logs)
        assert result == {"2026-06-08": 100.0}

    def test_multiple_logs_same_day_sums(self):
        logs = [
            {"Time": "2026-06-08T00:00:00", "Quantity": 100},
            {"Time": "2026-06-08T12:00:00", "Quantity": 50},
        ]
        result = _bucketize_price_logs(logs)
        assert result == {"2026-06-08": 150.0}

    def test_multiple_days(self):
        logs = [
            {"Time": "2026-06-08T00:00:00", "Quantity": 100},
            {"Time": "2026-06-09T00:00:00", "Quantity": 200},
        ]
        result = _bucketize_price_logs(logs)
        assert result == {"2026-06-08": 100.0, "2026-06-09": 200.0}

    def test_snake_case_keys_supported(self):
        """Some internal callers pass snake_case dicts — should still work."""
        logs = [{"time": "2026-06-08T00:00:00", "quantity": 100}]
        result = _bucketize_price_logs(logs)
        assert result == {"2026-06-08": 100.0}

    def test_invalid_quantity_skipped(self):
        logs = [
            {"Time": "2026-06-08T00:00:00", "Quantity": "not-a-number"},
            {"Time": "2026-06-08T12:00:00", "Quantity": 50},
        ]
        result = _bucketize_price_logs(logs)
        assert result == {"2026-06-08": 50.0}


# ===========================================================================
# 2. _rolling_mean
# ===========================================================================


class TestRollingMean:
    def test_empty(self):
        assert _rolling_mean({}, 7, datetime.now(timezone.utc)) == 0.0

    def test_single_day(self):
        today = datetime(2026, 6, 8, tzinfo=timezone.utc)
        daily = {"2026-06-08": 100.0}
        # 7-day window: only 1 day has data, others are 0 → mean = 100/7
        result = _rolling_mean(daily, 7, today)
        assert result == pytest.approx(100.0 / 7)

    def test_full_window(self):
        today = datetime(2026, 6, 8, tzinfo=timezone.utc)
        # Fill all 7 days with 100
        daily = {
            (today - timedelta(days=i)).strftime("%Y-%m-%d"): 100.0
            for i in range(7)
        }
        result = _rolling_mean(daily, 7, today)
        assert result == pytest.approx(100.0)

    def test_partial_window(self):
        today = datetime(2026, 6, 8, tzinfo=timezone.utc)
        # 3 days of 100, 4 days missing (treated as 0) → mean = 300/7
        daily = {
            (today - timedelta(days=i)).strftime("%Y-%m-%d"): 100.0
            for i in range(3)
        }
        result = _rolling_mean(daily, 7, today)
        assert result == pytest.approx(300.0 / 7)


# ===========================================================================
# 3. _price_trend_pct
# ===========================================================================


class TestPriceTrendPct:
    def test_empty(self):
        assert _price_trend_pct([]) is None

    def test_single_point(self):
        assert _price_trend_pct([{"Price": 100}]) is None

    def test_two_points_positive(self):
        logs = [
            {"Time": "2026-06-01", "Price": 100},
            {"Time": "2026-06-08", "Price": 120},
        ]
        result = _price_trend_pct(logs)
        assert result == pytest.approx(20.0)

    def test_two_points_negative(self):
        logs = [
            {"Time": "2026-06-01", "Price": 100},
            {"Time": "2026-06-08", "Price": 80},
        ]
        result = _price_trend_pct(logs)
        assert result == pytest.approx(-20.0)

    def test_first_price_zero(self):
        logs = [
            {"Time": "2026-06-01", "Price": 0},
            {"Time": "2026-06-08", "Price": 100},
        ]
        assert _price_trend_pct(logs) is None

    def test_unsorted_logs_sorted_defensively(self):
        """If logs come in reverse order, we should still compute the right trend."""
        logs = [
            {"Time": "2026-06-08", "Price": 120},
            {"Time": "2026-06-01", "Price": 100},
        ]
        result = _price_trend_pct(logs)
        assert result == pytest.approx(20.0)

    def test_snake_case_keys_supported(self):
        logs = [
            {"time": "2026-06-01", "price": 100},
            {"time": "2026-06-08", "price": 110},
        ]
        result = _price_trend_pct(logs)
        assert result == pytest.approx(10.0)


# ===========================================================================
# 4. _signal_from_delta
# ===========================================================================


class TestSignalFromDelta:
    def test_none(self):
        assert _signal_from_delta(None) == "stable"

    def test_rising_above_threshold(self):
        assert _signal_from_delta(SIGNAL_RISING_THRESHOLD_PCT + 0.01) == "rising"

    def test_rising_at_threshold(self):
        """Exactly at the threshold is NOT rising (strict >)."""
        assert _signal_from_delta(SIGNAL_RISING_THRESHOLD_PCT) == "stable"

    def test_falling_below_threshold(self):
        assert _signal_from_delta(SIGNAL_FALLING_THRESHOLD_PCT - 0.01) == "falling"

    def test_falling_at_threshold(self):
        """Exactly at the threshold is NOT falling (strict <)."""
        assert _signal_from_delta(SIGNAL_FALLING_THRESHOLD_PCT) == "stable"

    def test_stable_in_band(self):
        assert _signal_from_delta(5.0) == "stable"
        assert _signal_from_delta(-5.0) == "stable"
        assert _signal_from_delta(0.0) == "stable"


# ===========================================================================
# 5. _category_today_volume + _category_daily_volumes
# ===========================================================================


class TestCategoryAggregation:
    def test_today_volume_sums_quantities(self):
        items = [
            _make_currency("a", "ritual", current_quantity=100),
            _make_currency("b", "ritual", current_quantity=200.5),
            _make_currency("c", "ritual", current_quantity=0),
        ]
        assert _category_today_volume(items) == pytest.approx(300.5)

    def test_today_volume_handles_missing_field(self):
        items = [
            {"ApiId": "a", "CategoryApiId": "ritual"},  # no CurrentQuantity
            _make_currency("b", "ritual", current_quantity=50),
        ]
        assert _category_today_volume(items) == pytest.approx(50.0)

    def test_daily_volumes_sums_across_items(self):
        items = [
            _make_currency(
                "a", "ritual",
                price_logs=[{"Time": "2026-06-08", "Quantity": 100}],
            ),
            _make_currency(
                "b", "ritual",
                price_logs=[{"Time": "2026-06-08", "Quantity": 50}],
            ),
        ]
        result = _category_daily_volumes(items)
        assert result == {"2026-06-08": 150.0}

    def test_daily_volumes_handles_no_logs(self):
        items = [_make_currency("a", "ritual")]  # no price_logs
        assert _category_daily_volumes(items) == {}


# ===========================================================================
# 6. _top_movers
# ===========================================================================


class TestTopMovers:
    def test_rising_filters_negative(self):
        items = [
            _make_currency(
                "a", "ritual",
                price_logs=[{"Time": "2026-06-01", "Price": 100}, {"Time": "2026-06-08", "Price": 120}],
            ),
            _make_currency(
                "b", "ritual",
                price_logs=[{"Time": "2026-06-01", "Price": 100}, {"Time": "2026-06-08", "Price": 80}],
            ),
        ]
        rising = _top_movers(items, rising=True)
        assert len(rising) == 1
        assert rising[0]["api_id"] == "a"
        assert rising[0]["trend_pct"] == pytest.approx(20.0)

    def test_falling_filters_positive(self):
        items = [
            _make_currency(
                "a", "ritual",
                price_logs=[{"Time": "2026-06-01", "Price": 100}, {"Time": "2026-06-08", "Price": 120}],
            ),
            _make_currency(
                "b", "ritual",
                price_logs=[{"Time": "2026-06-01", "Price": 100}, {"Time": "2026-06-08", "Price": 80}],
            ),
        ]
        falling = _top_movers(items, rising=False)
        assert len(falling) == 1
        assert falling[0]["api_id"] == "b"
        assert falling[0]["trend_pct"] == pytest.approx(-20.0)

    def test_top_n_limit(self):
        """More candidates than TOP_N_PER_CATEGORY — only top N returned."""
        items = [
            _make_currency(
                f"item-{i}", "ritual",
                price_logs=[
                    {"Time": "2026-06-01", "Price": 100},
                    {"Time": "2026-06-08", "Price": 100 + i * 10},
                ],
            )
            for i in range(TOP_N_PER_CATEGORY + 2)
        ]
        rising = _top_movers(items, rising=True)
        assert len(rising) == TOP_N_PER_CATEGORY
        # Should be sorted descending by trend_pct
        trends = [r["trend_pct"] for r in rising]
        assert trends == sorted(trends, reverse=True)

    def test_skips_items_with_fewer_than_two_points(self):
        items = [
            _make_currency("a", "ritual", price_logs=[{"Time": "2026-06-01", "Price": 100}]),
            _make_currency(
                "b", "ritual",
                price_logs=[{"Time": "2026-06-01", "Price": 100}, {"Time": "2026-06-08", "Price": 110}],
            ),
        ]
        rising = _top_movers(items, rising=True)
        assert len(rising) == 1
        assert rising[0]["api_id"] == "b"


# ===========================================================================
# 7. compute_content_pulse — integration
# ===========================================================================


class TestComputeContentPulse:
    def test_empty_snapshot(self):
        snapshot = _make_snapshot([])
        config = _make_config(["ritual", "breach"])
        result = compute_content_pulse(snapshot, config)
        assert result["data_available"] is False
        assert len(result["categories"]) == 2  # both categories emit empty rows
        assert all(c["today_volume"] == 0 for c in result["categories"])
        assert all(c["signal"] == "stable" for c in result["categories"])

    def test_category_not_in_snapshot_emits_empty_row(self):
        """A configured category with no items in the snapshot still gets a row."""
        snapshot = _make_snapshot([
            _make_currency("a", "ritual", current_quantity=100),
        ])
        config = _make_config(["ritual", "breach"])  # breach has no items
        result = compute_content_pulse(snapshot, config)
        assert len(result["categories"]) == 2
        ritual = next(c for c in result["categories"] if c["category"] == "ritual")
        breach = next(c for c in result["categories"] if c["category"] == "breach")
        assert ritual["item_count"] == 1
        assert ritual["today_volume"] == 100
        assert breach["item_count"] == 0
        assert breach["today_volume"] == 0
        assert breach["delta_7d_pct"] is None
        assert breach["signal"] == "stable"

    def test_today_volume_aggregates_across_items(self):
        snapshot = _make_snapshot([
            _make_currency("a", "ritual", current_quantity=100),
            _make_currency("b", "ritual", current_quantity=200),
        ])
        config = _make_config(["ritual"])
        result = compute_content_pulse(snapshot, config)
        ritual = result["categories"][0]
        assert ritual["today_volume"] == 300
        assert ritual["item_count"] == 2

    def test_delta_7d_pct_when_history_available(self):
        """With 7 days of history at 100/day and today at 200 → +100%."""
        today = datetime(2026, 6, 8, tzinfo=timezone.utc)
        # Build 7 days of price_logs ending today, each with Quantity=100
        logs = [
            {"Time": (today - timedelta(days=i)).strftime("%Y-%m-%dT00:00:00"), "Quantity": 100, "Price": 50}
            for i in range(7)
        ]
        snapshot = _make_snapshot([
            _make_currency("a", "ritual", current_quantity=200, price_logs=logs),
        ])
        config = _make_config(["ritual"])
        result = compute_content_pulse(snapshot, config, now=today)
        ritual = result["categories"][0]
        # rolling_7d = mean of 100 over 7 days = 100
        assert ritual["rolling_7d"] == pytest.approx(100.0)
        # delta_7d_pct = (200/100 - 1) * 100 = 100
        assert ritual["delta_7d_pct"] == pytest.approx(100.0)
        assert ritual["signal"] == "rising"

    def test_delta_none_when_no_history(self):
        """No price_logs → rolling_7d = 0 → delta_7d_pct is None."""
        snapshot = _make_snapshot([
            _make_currency("a", "ritual", current_quantity=100),
        ])
        config = _make_config(["ritual"])
        result = compute_content_pulse(snapshot, config)
        ritual = result["categories"][0]
        assert ritual["delta_7d_pct"] is None
        assert ritual["delta_30d_pct"] is None
        assert ritual["signal"] == "stable"

    def test_falling_signal(self):
        """today < rolling_7d by > 10% → falling."""
        today = datetime(2026, 6, 8, tzinfo=timezone.utc)
        # 7 days of 100/day, today = 50 → delta = -50%
        logs = [
            {"Time": (today - timedelta(days=i)).strftime("%Y-%m-%dT00:00:00"), "Quantity": 100, "Price": 50}
            for i in range(7)
        ]
        snapshot = _make_snapshot([
            _make_currency("a", "ritual", current_quantity=50, price_logs=logs),
        ])
        config = _make_config(["ritual"])
        result = compute_content_pulse(snapshot, config, now=today)
        ritual = result["categories"][0]
        assert ritual["delta_7d_pct"] == pytest.approx(-50.0)
        assert ritual["signal"] == "falling"

    def test_categories_sorted_by_abs_delta_desc(self):
        """Largest |delta_7d_pct| should come first."""
        today = datetime(2026, 6, 8, tzinfo=timezone.utc)
        # ritual: +100% (delta=100), breach: +50% (delta=50)
        ritual_logs = [
            {"Time": (today - timedelta(days=i)).strftime("%Y-%m-%dT00:00:00"), "Quantity": 100, "Price": 50}
            for i in range(7)
        ]
        breach_logs = [
            {"Time": (today - timedelta(days=i)).strftime("%Y-%m-%dT00:00:00"), "Quantity": 100, "Price": 50}
            for i in range(7)
        ]
        snapshot = _make_snapshot([
            _make_currency("a", "ritual", current_quantity=200, price_logs=ritual_logs),
            _make_currency("b", "breach", current_quantity=150, price_logs=breach_logs),
        ])
        config = _make_config(["ritual", "breach"])
        result = compute_content_pulse(snapshot, config, now=today)
        # ritual (+100%) should come before breach (+50%)
        assert result["categories"][0]["category"] == "ritual"
        assert result["categories"][1]["category"] == "breach"

    def test_top_rising_and_falling_populated(self):
        today = datetime(2026, 6, 8, tzinfo=timezone.utc)
        snapshot = _make_snapshot([
            _make_currency(
                "rising-1", "ritual", current_quantity=100,
                price_logs=[
                    {"Time": "2026-06-01", "Price": 100, "Quantity": 10},
                    {"Time": "2026-06-08", "Price": 130, "Quantity": 10},
                ],
            ),
            _make_currency(
                "falling-1", "ritual", current_quantity=100,
                price_logs=[
                    {"Time": "2026-06-01", "Price": 100, "Quantity": 10},
                    {"Time": "2026-06-08", "Price": 70, "Quantity": 10},
                ],
            ),
        ])
        config = _make_config(["ritual"])
        result = compute_content_pulse(snapshot, config, now=today)
        ritual = result["categories"][0]
        assert len(ritual["top_rising"]) == 1
        assert ritual["top_rising"][0]["api_id"] == "rising-1"
        assert len(ritual["top_falling"]) == 1
        assert ritual["top_falling"][0]["api_id"] == "falling-1"

    def test_league_name_from_config(self):
        snapshot = _make_snapshot([])
        config = _make_config(["ritual"], league_name="hunt")
        result = compute_content_pulse(snapshot, config)
        assert result["league"] == "hunt"

    def test_fetched_at_is_iso(self):
        snapshot = _make_snapshot([])
        config = _make_config(["ritual"])
        now = datetime(2026, 6, 8, 12, 0, 0, tzinfo=timezone.utc)
        result = compute_content_pulse(snapshot, config, now=now)
        assert result["fetched_at"] == now.isoformat()


# ===========================================================================
# 8. Route handler smoke test — mock the snapshot manager
# ===========================================================================


class TestRouteHandler:
    """Smoke test the FastAPI route handler without spinning up uvicorn.

    We patch `get_snapshot_manager` and `get_snapshot` so the route returns
    deterministic data, then call the handler function directly.
    """

    async def test_route_returns_empty_when_no_snapshot(self):
        from backend.api.routes_content_pulse import get_content_pulse

        with patch(
            "backend.api.routes_content_pulse.get_snapshot_manager"
        ) as mock_mgr:
            mock_mgr.return_value = SimpleNamespace(last_snapshot=None)
            result = await get_content_pulse()
            assert result["data_available"] is False
            assert result["categories"] == []
            assert "fetched_at" in result

    async def test_route_returns_data_when_snapshot_available(self):
        from backend.api.routes_content_pulse import get_content_pulse

        # Use today's actual date so the rolling-7d window catches the logs.
        today = datetime.now(timezone.utc)
        logs = [
            {"Time": (today - timedelta(days=i)).strftime("%Y-%m-%dT00:00:00"), "Quantity": 100, "Price": 50}
            for i in range(7)
        ]
        snapshot = _make_snapshot([
            _make_currency("a", "ritual", current_quantity=200, price_logs=logs),
        ])

        with patch(
            "backend.api.routes_content_pulse.get_snapshot_manager"
        ) as mock_mgr, patch(
            "backend.api.routes_content_pulse.get_snapshot"
        ) as mock_get:
            mock_mgr.return_value = SimpleNamespace(last_snapshot=object())  # truthy
            mock_get.return_value = snapshot
            result = await get_content_pulse()
            assert result["data_available"] is True
            assert len(result["categories"]) >= 1
            ritual = next(c for c in result["categories"] if c["category"] == "ritual")
            assert ritual["today_volume"] == 200
            assert ritual["signal"] == "rising"

    async def test_route_returns_empty_on_exception(self):
        """If compute_content_pulse raises, the route should return data_available=false."""
        from backend.api.routes_content_pulse import get_content_pulse

        with patch(
            "backend.api.routes_content_pulse.get_snapshot_manager"
        ) as mock_mgr, patch(
            "backend.api.routes_content_pulse.get_snapshot"
        ) as mock_get:
            mock_mgr.return_value = SimpleNamespace(last_snapshot=object())  # truthy
            mock_get.side_effect = RuntimeError("boom")
            result = await get_content_pulse()
            assert result["data_available"] is False
            assert result["categories"] == []
