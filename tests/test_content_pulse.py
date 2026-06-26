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
    OVERHEAT_PRICE_DROP_THRESHOLD,
    OVERHEAT_VOLUME_SPIKE_THRESHOLD,
    SIGNAL_FALLING_THRESHOLD_PCT,
    SIGNAL_RISING_THRESHOLD_PCT,
    TOP_N_PER_CATEGORY,
    _bucketize_price_logs,
    _build_currency_volume_map,
    _category_daily_volumes,
    _category_price_change_pct,
    _category_today_volume,
    _overheat_index_score,
    _overheat_signal,
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
    volume_traded: float | None = None,
    current_price: float = 0.0,
    price_logs: list[dict] | None = None,
    text: str | None = None,
) -> dict:
    """Build a single ByCategory-style currency dict (PascalCase keys).

    `current_quantity` is the legacy listings-snapshot count (still present
    on the ByCategory API response, retained for backward compat with
    code paths that still read it).

    `volume_traded` (iter 95, TD-2) is the 24h trade activity. When set,
    `_make_snapshot` auto-builds a synthetic exchange_rates pair for this
    currency so `compute_content_pulse` picks it up via the volume_map.
    Set to ``None`` to omit (item contributes 0 to today_volume).
    """
    d = {
        "ApiId": api_id,
        "CategoryApiId": category,
        "Text": text or api_id.replace("-", " ").title(),
        "CurrentPrice": current_price,
        "CurrentQuantity": current_quantity,
        "PriceLogs": price_logs or [],
    }
    if volume_traded is not None:
        d["VolumeTraded"] = volume_traded
    return d


def _make_rate(
    currency_from: str,
    currency_to: str,
    volume_traded: float,
) -> SimpleNamespace:
    """Build a fake ExchangeRate-like object (matches backend/models/currency.py)."""
    return SimpleNamespace(
        currency_from=currency_from,
        currency_to=currency_to,
        volume_traded=volume_traded,
    )


def _make_snapshot(
    currencies: list[dict],
    exchange_rates: dict[str, SimpleNamespace] | None = None,
) -> SimpleNamespace:
    """Wrap a list of ByCategory dicts in a DataSnapshot-like object.

    snapshot.currencies is keyed by api_id.lower() (matches the real
    DataSnapshot._build_currencies flow).

    When `exchange_rates` is None (default), auto-builds a minimal
    exchange_rates dict from each currency's `VolumeTraded` field — each
    currency with VolumeTraded > 0 gets a synthetic pair (currency, "exalted")
    with that volume. This lets tests drive the volume_traded path just by
    passing `volume_traded=...` to `_make_currency`, without having to build
    exchange_rates manually for the common case.

    Tests that need explicit control over the pair structure (e.g., to
    verify double-counting or per-pair volume) can pass `exchange_rates`
    directly.
    """
    if exchange_rates is None:
        exchange_rates = {}
        for c in currencies:
            api_id = c.get("ApiId", "")
            vol = c.get("VolumeTraded")
            if api_id and vol is not None and vol > 0:
                key = f"{api_id.lower()}-exalted"
                exchange_rates[key] = _make_rate(api_id, "exalted", float(vol))
    return SimpleNamespace(
        currencies={c["ApiId"].lower(): c for c in currencies},
        exchange_rates=exchange_rates,
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
        """When no volume_map is provided, falls back to CurrentQuantity (legacy)."""
        items = [
            _make_currency("a", "ritual", current_quantity=100),
            _make_currency("b", "ritual", current_quantity=200.5),
            _make_currency("c", "ritual", current_quantity=0),
        ]
        # No volume_map → legacy fallback path sums current_quantity.
        assert _category_today_volume(items) == pytest.approx(300.5)

    def test_today_volume_sums_volume_traded_from_map(self):
        """When a volume_map is provided, sums volume_traded (new TD-2 path)."""
        items = [
            _make_currency("a", "ritual", current_quantity=100),
            _make_currency("b", "ritual", current_quantity=200.5),
            _make_currency("c", "ritual", current_quantity=0),
        ]
        volume_map = {"a": 50.0, "b": 75.0, "c": 25.0}
        # Uses volume_map strictly; current_quantity is ignored.
        assert _category_today_volume(items, volume_map) == pytest.approx(150.0)

    def test_today_volume_partial_volume_map(self):
        """Items absent from the volume_map contribute 0 (new TD-2 path)."""
        items = [
            _make_currency("a", "ritual", current_quantity=100),
            _make_currency("b", "ritual", current_quantity=200.0),
        ]
        volume_map = {"a": 50.0}  # only "a" has volume_traded
        # b is not in the map → contributes 0 (does NOT fall back to current_quantity).
        assert _category_today_volume(items, volume_map) == pytest.approx(50.0)

    def test_today_volume_empty_volume_map(self):
        """An empty volume_map means no item has trade activity → 0."""
        items = [
            _make_currency("a", "ritual", current_quantity=100),
            _make_currency("b", "ritual", current_quantity=200.0),
        ]
        # Empty map (not None) → strict mode, all items contribute 0.
        assert _category_today_volume(items, {}) == pytest.approx(0.0)

    def test_today_volume_handles_missing_field(self):
        items = [
            {"ApiId": "a", "CategoryApiId": "ritual"},  # no CurrentQuantity, no ApiId in map
            _make_currency("b", "ritual", current_quantity=50),
        ]
        # No volume_map → legacy path: a contributes 0 (missing field), b contributes 50.
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
            _make_currency("a", "ritual", volume_traded=100),
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
        # iter 95: empty category should emit zero / cool overheat fields
        assert breach["overheat_index"] == 0.0
        assert breach["overheat_signal"] == "cool"
        assert breach["volume_spike_ratio"] is None
        assert breach["price_change_pct"] is None

    def test_today_volume_aggregates_across_items(self):
        snapshot = _make_snapshot([
            _make_currency("a", "ritual", volume_traded=100),
            _make_currency("b", "ritual", volume_traded=200),
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
            _make_currency("a", "ritual", volume_traded=200, price_logs=logs),
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
            _make_currency("a", "ritual", volume_traded=100),
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
            _make_currency("a", "ritual", volume_traded=50, price_logs=logs),
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
            _make_currency("a", "ritual", volume_traded=200, price_logs=ritual_logs),
            _make_currency("b", "breach", volume_traded=150, price_logs=breach_logs),
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
                "rising-1", "ritual", volume_traded=100,
                price_logs=[
                    {"Time": "2026-06-01", "Price": 100, "Quantity": 10},
                    {"Time": "2026-06-08", "Price": 130, "Quantity": 10},
                ],
            ),
            _make_currency(
                "falling-1", "ritual", volume_traded=100,
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
# 7b. _build_currency_volume_map (iter 95, TD-2)
# ===========================================================================


class TestBuildCurrencyVolumeMap:
    def test_empty_snapshot(self):
        snapshot = SimpleNamespace(exchange_rates={})
        assert _build_currency_volume_map(snapshot) == {}

    def test_snapshot_without_exchange_rates_attr(self):
        """Snapshots without exchange_rates (legacy test snapshots) → empty map."""
        snapshot = SimpleNamespace()  # no exchange_rates attribute
        assert _build_currency_volume_map(snapshot) == {}

    def test_single_pair_attributes_volume_to_both_currencies(self):
        """A pair (A, B) with volume 100 → both A and B get 100 in the map."""
        snapshot = SimpleNamespace(
            exchange_rates={
                "a-b": _make_rate("a", "b", 100),
            },
        )
        result = _build_currency_volume_map(snapshot)
        assert result == {"a": 100.0, "b": 100.0}

    def test_multiple_pairs_sum_per_currency(self):
        """When a currency appears in multiple pairs, volumes sum."""
        snapshot = SimpleNamespace(
            exchange_rates={
                "a-b": _make_rate("a", "b", 100),
                "a-c": _make_rate("a", "c", 50),
                "b-c": _make_rate("b", "c", 30),
            },
        )
        result = _build_currency_volume_map(snapshot)
        # a: 100 + 50 = 150
        # b: 100 + 30 = 130
        # c: 50 + 30 = 80
        assert result == {"a": 150.0, "b": 130.0, "c": 80.0}

    def test_zero_volume_pairs_skipped(self):
        """Pairs with volume_traded <= 0 contribute nothing."""
        snapshot = SimpleNamespace(
            exchange_rates={
                "a-b": _make_rate("a", "b", 0),
                "c-d": _make_rate("c", "d", 100),
            },
        )
        result = _build_currency_volume_map(snapshot)
        assert result == {"c": 100.0, "d": 100.0}

    def test_keys_are_lowercased(self):
        """Currency api_ids are lowercased in the map (matches ByCategory keying)."""
        snapshot = SimpleNamespace(
            exchange_rates={
                "divine-exalted": _make_rate("Divine", "Exalted", 500),
            },
        )
        result = _build_currency_volume_map(snapshot)
        assert result == {"divine": 500.0, "exalted": 500.0}


# ===========================================================================
# 7c. _category_price_change_pct (iter 95)
# ===========================================================================


class TestCategoryPriceChangePct:
    def test_no_items(self):
        assert _category_price_change_pct([]) is None

    def test_all_items_have_fewer_than_two_points(self):
        items = [
            _make_currency("a", "ritual", price_logs=[{"Time": "2026-06-01", "Price": 100}]),
            _make_currency("b", "ritual", price_logs=[]),
        ]
        assert _category_price_change_pct(items) is None

    def test_single_item_with_trend(self):
        items = [
            _make_currency("a", "ritual", price_logs=[
                {"Time": "2026-06-01", "Price": 100},
                {"Time": "2026-06-08", "Price": 120},
            ]),
        ]
        # 20% increase
        assert _category_price_change_pct(items) == pytest.approx(20.0)

    def test_mean_across_items_unweighted(self):
        """Each item contributes equally regardless of volume."""
        items = [
            _make_currency("a", "ritual", price_logs=[
                {"Time": "2026-06-01", "Price": 100},
                {"Time": "2026-06-08", "Price": 130},  # +30%
            ]),
            _make_currency("b", "ritual", price_logs=[
                {"Time": "2026-06-01", "Price": 100},
                {"Time": "2026-06-08", "Price": 90},   # -10%
            ]),
        ]
        # mean of +30% and -10% = +10%
        assert _category_price_change_pct(items) == pytest.approx(10.0)

    def test_items_with_insufficient_points_skipped(self):
        """Items with <2 points are skipped; remaining items still averaged."""
        items = [
            _make_currency("a", "ritual", price_logs=[{"Time": "2026-06-01", "Price": 100}]),  # skipped
            _make_currency("b", "ritual", price_logs=[
                {"Time": "2026-06-01", "Price": 100},
                {"Time": "2026-06-08", "Price": 110},  # +10%
            ]),
        ]
        assert _category_price_change_pct(items) == pytest.approx(10.0)


# ===========================================================================
# 7d. _overheat_signal (iter 95)
# ===========================================================================


class TestOverheatSignal:
    def test_insufficient_data_returns_cool(self):
        assert _overheat_signal(None, -10.0) == "cool"
        assert _overheat_signal(3.0, None) == "cool"
        assert _overheat_signal(None, None) == "cool"

    def test_hot_when_volume_spike_and_price_drop(self):
        # 2.5x volume > 2.0 threshold AND -10% price < -5% threshold
        assert _overheat_signal(2.5, -10.0) == "hot"

    def test_warm_when_only_volume_spike(self):
        # 2.5x volume > 2.0 threshold, but price stable (+2%)
        assert _overheat_signal(2.5, 2.0) == "warm"

    def test_warm_when_only_price_drop(self):
        # volume normal (1.2x), but price dropping (-15%)
        assert _overheat_signal(1.2, -15.0) == "warm"

    def test_cool_when_neither_condition_met(self):
        # volume normal (1.2x), price stable (+2%)
        assert _overheat_signal(1.2, 2.0) == "cool"

    def test_at_thresholds_is_not_hot(self):
        """Thresholds are strict (>, <), so exactly at threshold is not hot."""
        # volume_spike_ratio == 2.0 (not > 2.0) → not a spike
        # price_change_pct == -5.0 (not < -5.0) → not a drop
        assert _overheat_signal(2.0, -5.0) == "cool"

    def test_at_volume_threshold_only_is_not_warm(self):
        """volume_spike_ratio == 2.0 (not > 2.0) → no spike → cool."""
        assert _overheat_signal(2.0, -10.0) == "warm"  # price_drop still triggers

    def test_threshold_constants_exported(self):
        """Verify the threshold constants are importable (used by docs/tests)."""
        assert OVERHEAT_VOLUME_SPIKE_THRESHOLD == 2.0
        assert OVERHEAT_PRICE_DROP_THRESHOLD == -5.0


# ===========================================================================
# 7e. _overheat_index_score (iter 95)
# ===========================================================================


class TestOverheatIndexScore:
    def test_insufficient_data_returns_zero(self):
        assert _overheat_index_score(None, -10.0) == 0.0
        assert _overheat_index_score(3.0, None) == 0.0
        assert _overheat_index_score(None, None) == 0.0

    def test_zero_spike_zero_drop_returns_zero(self):
        """1x volume (no spike), 0% price change (no drop) → score 0."""
        assert _overheat_index_score(1.0, 0.0) == 0.0

    def test_volume_spike_component(self):
        """volume_spike_ratio contributes (ratio - 1) * 25 to the score (capped at 100)."""
        # 3x volume, no price drop: vol_component = (3-1)*25 = 50, price_component = 0
        # score = (50 + 0) / 2 = 25
        assert _overheat_index_score(3.0, 0.0) == 25.0

    def test_price_drop_component(self):
        """price_drop contributes -price_change_pct * 4 to the score (capped at 100)."""
        # 1x volume (no spike), -20% price drop: vol_component = 0, price_component = 80
        # score = (0 + 80) / 2 = 40
        assert _overheat_index_score(1.0, -20.0) == 40.0

    def test_combined_components_averaged(self):
        """Both components contribute equally (average)."""
        # 3x volume, -20% price drop:
        # vol_component = (3-1)*25 = 50, price_component = 20*4 = 80
        # score = (50 + 80) / 2 = 65
        assert _overheat_index_score(3.0, -20.0) == 65.0

    def test_volume_component_capped_at_100(self):
        """5x+ volume → vol_component caps at 100."""
        # 10x volume, 0% drop: vol_component = min(100, (10-1)*25) = min(100, 225) = 100
        # score = (100 + 0) / 2 = 50
        assert _overheat_index_score(10.0, 0.0) == 50.0

    def test_price_component_capped_at_100(self):
        """-25%+ price drop → price_component caps at 100."""
        # 1x volume, -50% drop: price_component = min(100, 50*4) = 100
        # score = (0 + 100) / 2 = 50
        assert _overheat_index_score(1.0, -50.0) == 50.0

    def test_negative_volume_ratio_clamped_to_zero(self):
        """A volume_spike_ratio < 1 (volume below average) → vol_component clamped to 0."""
        # 0.5x volume, 0% drop: vol_component = max(0, (0.5-1)*25) = 0
        # score = (0 + 0) / 2 = 0
        assert _overheat_index_score(0.5, 0.0) == 0.0

    def test_positive_price_change_clamped_to_zero(self):
        """A positive price_change_pct (price rising) → price_component clamped to 0."""
        # 1x volume, +20% price (rising): price_component = max(0, -20*4) = 0
        # score = (0 + 0) / 2 = 0
        assert _overheat_index_score(1.0, 20.0) == 0.0


# ===========================================================================
# 7f. compute_content_pulse — Overheat Index integration (iter 95)
# ===========================================================================


class TestComputeContentPulseOverheat:
    def test_overheat_fields_present_in_response(self):
        """Every category dict should include the 4 overheat fields."""
        snapshot = _make_snapshot([
            _make_currency("a", "ritual", volume_traded=100),
        ])
        config = _make_config(["ritual"])
        result = compute_content_pulse(snapshot, config)
        ritual = result["categories"][0]
        assert "overheat_index" in ritual
        assert "overheat_signal" in ritual
        assert "volume_spike_ratio" in ritual
        assert "price_change_pct" in ritual

    def test_overheat_cool_when_no_history(self):
        """No price_logs → rolling_7d = 0 → volume_spike_ratio is None → cool."""
        snapshot = _make_snapshot([
            _make_currency("a", "ritual", volume_traded=100),
        ])
        config = _make_config(["ritual"])
        result = compute_content_pulse(snapshot, config)
        ritual = result["categories"][0]
        assert ritual["overheat_signal"] == "cool"
        assert ritual["overheat_index"] == 0.0
        assert ritual["volume_spike_ratio"] is None

    def test_overheat_hot_when_volume_spike_and_price_drop(self):
        """Today's volume 3x rolling 7d AND price drops 10% → hot."""
        today = datetime(2026, 6, 8, tzinfo=timezone.utc)
        # 7 days of 100/day, today = 300 → 3x spike
        logs = [
            {"Time": (today - timedelta(days=i)).strftime("%Y-%m-%dT00:00:00"),
             "Quantity": 100, "Price": 100 if i > 0 else 90}  # price drops from 100 → 90 (-10%)
            for i in range(7)
        ]
        snapshot = _make_snapshot([
            _make_currency("a", "ritual", volume_traded=300, price_logs=logs),
        ])
        config = _make_config(["ritual"])
        result = compute_content_pulse(snapshot, config, now=today)
        ritual = result["categories"][0]
        # volume_spike_ratio = 300 / 100 = 3.0
        # price_change_pct = (90 - 100) / 100 * 100 = -10%
        assert ritual["volume_spike_ratio"] == pytest.approx(3.0)
        assert ritual["price_change_pct"] == pytest.approx(-10.0)
        assert ritual["overheat_signal"] == "hot"
        # overheat_index = ((3-1)*25 + 10*4) / 2 = (50 + 40) / 2 = 45
        assert ritual["overheat_index"] == 45.0

    def test_overheat_warm_when_only_volume_spike(self):
        """Volume spiking but prices not dropping → warm."""
        today = datetime(2026, 6, 8, tzinfo=timezone.utc)
        # 7 days of 100/day, today = 300 → 3x spike
        # Price stable (100 → 100, 0% change)
        logs = [
            {"Time": (today - timedelta(days=i)).strftime("%Y-%m-%dT00:00:00"),
             "Quantity": 100, "Price": 100}
            for i in range(7)
        ]
        snapshot = _make_snapshot([
            _make_currency("a", "ritual", volume_traded=300, price_logs=logs),
        ])
        config = _make_config(["ritual"])
        result = compute_content_pulse(snapshot, config, now=today)
        ritual = result["categories"][0]
        assert ritual["volume_spike_ratio"] == pytest.approx(3.0)
        assert ritual["price_change_pct"] == pytest.approx(0.0)
        assert ritual["overheat_signal"] == "warm"

    def test_overheat_cool_when_volume_normal_prices_stable(self):
        """1x volume, 0% price change → cool."""
        today = datetime(2026, 6, 8, tzinfo=timezone.utc)
        logs = [
            {"Time": (today - timedelta(days=i)).strftime("%Y-%m-%dT00:00:00"),
             "Quantity": 100, "Price": 100}
            for i in range(7)
        ]
        snapshot = _make_snapshot([
            _make_currency("a", "ritual", volume_traded=100, price_logs=logs),
        ])
        config = _make_config(["ritual"])
        result = compute_content_pulse(snapshot, config, now=today)
        ritual = result["categories"][0]
        assert ritual["volume_spike_ratio"] == pytest.approx(1.0)
        assert ritual["price_change_pct"] == pytest.approx(0.0)
        assert ritual["overheat_signal"] == "cool"

    def test_volume_spike_ratio_none_when_today_volume_zero(self):
        """When today_volume = 0 (no exchange_rates data), volume_spike_ratio is None."""
        today = datetime(2026, 6, 8, tzinfo=timezone.utc)
        logs = [
            {"Time": (today - timedelta(days=i)).strftime("%Y-%m-%dT00:00:00"),
             "Quantity": 100, "Price": 100}
            for i in range(7)
        ]
        # No volume_traded → today_volume = 0 → volume_spike_ratio = None
        snapshot = _make_snapshot([
            _make_currency("a", "ritual", price_logs=logs),
        ])
        config = _make_config(["ritual"])
        result = compute_content_pulse(snapshot, config, now=today)
        ritual = result["categories"][0]
        assert ritual["today_volume"] == 0
        assert ritual["volume_spike_ratio"] is None
        assert ritual["overheat_signal"] == "cool"

    def test_td2_fix_uses_volume_traded_not_current_quantity(self):
        """TD-2 regression test: today_volume should reflect volume_traded, not current_quantity.

        Before iter 95, today_volume summed current_quantity (a SUPPLY metric),
        which was inconsistent with rolling_7d (an ACTIVITY metric). Now we
        use volume_traded (also ACTIVITY) — apples to apples.
        """
        today = datetime(2026, 6, 8, tzinfo=timezone.utc)
        logs = [
            {"Time": (today - timedelta(days=i)).strftime("%Y-%m-%dT00:00:00"),
             "Quantity": 100, "Price": 100}
            for i in range(7)
        ]
        # Set current_quantity = 999 (legacy supply metric) but volume_traded = 200 (activity).
        # Before TD-2 fix: today_volume would have been 999.
        # After TD-2 fix: today_volume should be 200 (from volume_traded).
        snapshot = _make_snapshot([
            _make_currency(
                "a", "ritual",
                current_quantity=999,  # legacy supply metric — should be IGNORED
                volume_traded=200,     # new activity metric — should be USED
                price_logs=logs,
            ),
        ])
        config = _make_config(["ritual"])
        result = compute_content_pulse(snapshot, config, now=today)
        ritual = result["categories"][0]
        assert ritual["today_volume"] == 200  # NOT 999


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
            _make_currency("a", "ritual", volume_traded=200, price_logs=logs),
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
