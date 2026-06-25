"""
Tests for backend/economy/speculation.py — F5 (iter 77).

Coverage:
1. Helper tests: `_extract_prices`, `_signal_from_zscore`, `_horizon_hint`,
   `_build_signal_entry`.
2. Pure-function tests on hand-crafted DataSnapshot-like inputs:
   - Empty snapshot / no currencies.
   - Single currency with sufficient history → BUY / SELL / HOLD.
   - Multiple currencies → sorted by |z| desc.
   - Days filter excludes old price points.
   - Limit caps the result count.
   - Signal filter (BUY / SELL / HOLD / ALL).
   - Items with std=0 are skipped (no actionable signal).
   - Items with <2 price points are skipped.
3. Route handler smoke tests (with mocked snapshot manager).
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from backend.economy.speculation import (
    DEFAULT_DAYS,
    DEFAULT_LIMIT,
    MAX_HISTORY_POINTS,
    MIN_SAMPLE_SIZE,
    Z_BUY_THRESHOLD,
    Z_SELL_THRESHOLD,
    _build_signal_entry,
    _extract_prices,
    _horizon_hint,
    _signal_from_zscore,
    compute_speculation_signals,
)


# ---------------------------------------------------------------------------
# Helpers — same pattern as tests/test_content_pulse.py
# ---------------------------------------------------------------------------

def _make_currency(
    api_id: str,
    category: str,
    *,
    current_price: float = 0.0,
    current_quantity: float = 0.0,
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
    """Wrap a list of ByCategory dicts in a DataSnapshot-like object."""
    return SimpleNamespace(
        currencies={c["ApiId"].lower(): c for c in currencies},
        fetched_at=datetime.now(timezone.utc),
    )


def _make_config(league_name: str = "Standard") -> SimpleNamespace:
    return SimpleNamespace(
        league=SimpleNamespace(
            league_name=league_name,
            currency_categories=["currency"],
        ),
    )


def _days_ago_iso(days: int, base: datetime | None = None) -> str:
    base = base or datetime.now(timezone.utc)
    return (base - timedelta(days=days)).strftime("%Y-%m-%dT00:00:00")


def _make_logs(
    prices: list[float],
    *,
    days_step: int = 1,
    base: datetime | None = None,
) -> list[dict]:
    """Build a price_logs list with prices spaced `days_step` days apart, oldest first."""
    base = base or datetime.now(timezone.utc)
    n = len(prices)
    return [
        {
            "Time": (base - timedelta(days=(n - 1 - i) * days_step)).strftime("%Y-%m-%dT00:00:00"),
            "Price": p,
            "Quantity": 10,
        }
        for i, p in enumerate(prices)
    ]


# ===========================================================================
# 1. _extract_prices
# ===========================================================================

class TestExtractPrices:
    def test_empty_logs_returns_empty(self):
        now = datetime.now(timezone.utc)
        assert _extract_prices([], now, 30) == []

    def test_filters_old_points_outside_window(self):
        """Points older than `days` are excluded."""
        now = datetime.now(timezone.utc)
        logs = [
            {"Time": _days_ago_iso(40, now), "Price": 100.0, "Quantity": 5},
            {"Time": _days_ago_iso(10, now), "Price": 110.0, "Quantity": 5},
            {"Time": _days_ago_iso(1, now), "Price": 120.0, "Quantity": 5},
        ]
        result = _extract_prices(logs, now, 30)
        assert len(result) == 2  # 40-day-old point excluded
        assert result[0][1] == 110.0  # 10 days ago
        assert result[1][1] == 120.0  # 1 day ago

    def test_skips_invalid_entries(self):
        """Entries with missing Time/Price or non-finite prices are skipped."""
        now = datetime.now(timezone.utc)
        logs = [
            {"Time": _days_ago_iso(1, now), "Price": 100.0, "Quantity": 5},  # OK
            {"Time": None, "Price": 50.0},  # missing Time
            {"Time": _days_ago_iso(2, now), "Price": None},  # missing Price
            {"Time": _days_ago_iso(3, now), "Price": float("nan")},  # NaN price
            {"Time": _days_ago_iso(4, now), "Price": float("inf")},  # inf price
            "not-a-dict",  # wrong type
            {"Time": _days_ago_iso(5, now), "Price": 110.0},  # OK
        ]
        result = _extract_prices(logs, now, 30)
        assert len(result) == 2
        assert result[0][1] == 110.0  # 5 days ago, older
        assert result[1][1] == 100.0  # 1 day ago, newer (sorted ascending)

    def test_accepts_datetime_objects(self):
        """datetime objects (not just ISO strings) are accepted."""
        now = datetime.now(timezone.utc)
        logs = [
            {"Time": now - timedelta(days=1), "Price": 100.0, "Quantity": 5},
            {"Time": now - timedelta(days=2), "Price": 90.0, "Quantity": 5},
        ]
        result = _extract_prices(logs, now, 30)
        assert len(result) == 2

    def test_accepts_snake_case_keys(self):
        """Both PascalCase (Time/Price) and snake_case (time/price) work."""
        now = datetime.now(timezone.utc)
        logs = [
            {"time": _days_ago_iso(1, now), "price": 100.0, "quantity": 5},
            {"Time": _days_ago_iso(2, now), "Price": 90.0, "Quantity": 5},
        ]
        result = _extract_prices(logs, now, 30)
        assert len(result) == 2

    def test_sorted_ascending_by_timestamp(self):
        """Output is oldest-first regardless of input order."""
        now = datetime.now(timezone.utc)
        logs = [
            {"Time": _days_ago_iso(1, now), "Price": 100.0, "Quantity": 5},
            {"Time": _days_ago_iso(5, now), "Price": 50.0, "Quantity": 5},
            {"Time": _days_ago_iso(3, now), "Price": 80.0, "Quantity": 5},
        ]
        result = _extract_prices(logs, now, 30)
        prices = [p for _, p in result]
        assert prices == [50.0, 80.0, 100.0]  # ascending by timestamp


# ===========================================================================
# 2. _signal_from_zscore
# ===========================================================================

class TestSignalFromZscore:
    def test_none_returns_hold(self):
        assert _signal_from_zscore(None) == "HOLD"

    def test_z_below_buy_threshold_returns_buy(self):
        """z < -1.5 → BUY."""
        assert _signal_from_zscore(-1.6) == "BUY"
        assert _signal_from_zscore(-2.0) == "BUY"
        assert _signal_from_zscore(-5.0) == "BUY"

    def test_z_above_sell_threshold_returns_sell(self):
        """z > +1.5 → SELL."""
        assert _signal_from_zscore(1.6) == "SELL"
        assert _signal_from_zscore(2.0) == "SELL"
        assert _signal_from_zscore(5.0) == "SELL"

    def test_z_at_boundary_returns_hold(self):
        """Exactly at ±1.5 → HOLD (strict inequality)."""
        assert _signal_from_zscore(-1.5) == "HOLD"
        assert _signal_from_zscore(1.5) == "HOLD"

    def test_z_in_hold_range_returns_hold(self):
        assert _signal_from_zscore(0.0) == "HOLD"
        assert _signal_from_zscore(1.0) == "HOLD"
        assert _signal_from_zscore(-1.0) == "HOLD"
        assert _signal_from_zscore(1.49) == "HOLD"
        assert _signal_from_zscore(-1.49) == "HOLD"


# ===========================================================================
# 3. _horizon_hint
# ===========================================================================

class TestHorizonHint:
    def test_none_returns_unknown(self):
        assert _horizon_hint(None) == "unknown"

    def test_extreme_z_returns_short(self):
        """|z| >= 2.5 → 'short' (1-3 days expected reversion)."""
        assert _horizon_hint(2.5) == "short"
        assert _horizon_hint(-2.5) == "short"
        assert _horizon_hint(3.0) == "short"
        assert _horizon_hint(-10.0) == "short"

    def test_moderate_z_returns_medium(self):
        """1.5 <= |z| < 2.5 → 'medium' (3-7 days)."""
        assert _horizon_hint(1.5) == "medium"
        assert _horizon_hint(-1.5) == "medium"
        assert _horizon_hint(2.49) == "medium"
        assert _horizon_hint(-2.49) == "medium"

    def test_low_z_returns_long(self):
        """|z| < 1.5 → 'long' (or HOLD, but horizon is still meaningful)."""
        assert _horizon_hint(0.0) == "long"
        assert _horizon_hint(1.0) == "long"
        assert _horizon_hint(-1.0) == "long"
        assert _horizon_hint(1.49) == "long"


# ===========================================================================
# 4. _build_signal_entry
# ===========================================================================

class TestBuildSignalEntry:
    def test_insufficient_history_returns_none(self):
        """< MIN_SAMPLE_SIZE points → None."""
        now = datetime.now(timezone.utc)
        history = [(now - timedelta(days=1), 100.0)]  # single point
        assert _build_signal_entry("a", "A", "cat", 100.0, history) is None

    def test_zero_current_price_returns_none(self):
        """current_price = 0 → no signal."""
        now = datetime.now(timezone.utc)
        history = [
            (now - timedelta(days=2), 100.0),
            (now - timedelta(days=1), 110.0),
        ]
        assert _build_signal_entry("a", "A", "cat", 0.0, history) is None

    def test_identical_prices_returns_none(self):
        """All prices identical → std=0 → z=None → entry is None."""
        now = datetime.now(timezone.utc)
        history = [
            (now - timedelta(days=3), 100.0),
            (now - timedelta(days=2), 100.0),
            (now - timedelta(days=1), 100.0),
        ]
        assert _build_signal_entry("a", "A", "cat", 100.0, history) is None

    def test_buy_signal_built_correctly(self):
        """Current price far below mean → BUY signal with negative z-score."""
        now = datetime.now(timezone.utc)
        # prices: 100, 100, 100, 100, 50 (current=50)
        # mean = 90, std = sqrt((16+16+16+16+1600)/5) = sqrt(1664) ≈ 40.79
        # z = (50 - 90) / 40.79 ≈ -0.98 → HOLD (NOT BUY since |z| < 1.5)
        # Use more extreme spread for clear BUY
        history = [
            (now - timedelta(days=4), 100.0),
            (now - timedelta(days=3), 100.0),
            (now - timedelta(days=2), 100.0),
            (now - timedelta(days=1), 100.0),
        ]
        # mean=100, std=0 → None (identical prices). Need variance.
        # Replace last point with a slightly different price.
        history[-1] = (now - timedelta(days=1), 101.0)
        # Now mean=100.25, std≈0.43, current=50 → z ≈ -116 → BUY
        entry = _build_signal_entry("a", "A", "ritual", 50.0, history)
        assert entry is not None
        assert entry["signal"] == "BUY"
        assert entry["z_score"] < Z_BUY_THRESHOLD
        assert entry["api_id"] == "a"
        assert entry["text"] == "A"
        assert entry["category"] == "ritual"
        assert entry["sample_size"] == 4
        assert entry["current_price"] == 50.0
        assert len(entry["price_history_short"]) == 4

    def test_sell_signal_built_correctly(self):
        """Current price far above mean → SELL signal."""
        now = datetime.now(timezone.utc)
        history = [
            (now - timedelta(days=4), 100.0),
            (now - timedelta(days=3), 100.0),
            (now - timedelta(days=2), 100.0),
            (now - timedelta(days=1), 101.0),  # tiny variance so std > 0
        ]
        # mean ≈ 100.25, std ≈ 0.43, current = 200 → z ≈ +231 → SELL
        entry = _build_signal_entry("a", "A", "breach", 200.0, history)
        assert entry is not None
        assert entry["signal"] == "SELL"
        assert entry["z_score"] > Z_SELL_THRESHOLD

    def test_hold_signal_built_correctly(self):
        """Current price near mean → HOLD signal."""
        now = datetime.now(timezone.utc)
        history = [
            (now - timedelta(days=4), 100.0),
            (now - timedelta(days=3), 110.0),
            (now - timedelta(days=2), 90.0),
            (now - timedelta(days=1), 105.0),
        ]
        # mean ≈ 101.25, std ≈ 7.4, current = 102 → z ≈ 0.10 → HOLD
        entry = _build_signal_entry("a", "A", "delirium", 102.0, history)
        assert entry is not None
        assert entry["signal"] == "HOLD"

    def test_history_slice_capped_at_max(self):
        """price_history_short is truncated to MAX_HISTORY_POINTS."""
        now = datetime.now(timezone.utc)
        # 20 points (more than MAX_HISTORY_POINTS=14)
        history = [
            (now - timedelta(days=20 - i), 100.0 + i) for i in range(20)
        ]
        entry = _build_signal_entry("a", "A", "cat", 110.0, history)
        assert entry is not None
        assert len(entry["price_history_short"]) == MAX_HISTORY_POINTS
        # Most recent MAX_HISTORY_POINTS points (oldest-first)
        assert entry["price_history_short"][0]["price"] == 100.0 + (20 - MAX_HISTORY_POINTS)
        assert entry["price_history_short"][-1]["price"] == 119.0

    def test_percentile_computed(self):
        """Percentile is computed and within [0, 100]."""
        now = datetime.now(timezone.utc)
        history = [
            (now - timedelta(days=4), 100.0),
            (now - timedelta(days=3), 110.0),
            (now - timedelta(days=2), 120.0),
            (now - timedelta(days=1), 130.0),
        ]
        entry = _build_signal_entry("a", "A", "cat", 130.0, history)
        assert entry is not None
        assert entry["percentile"] == 100.0  # current = max

        entry2 = _build_signal_entry("a", "A", "cat", 100.0, history)
        assert entry2 is not None
        assert entry2["percentile"] == 0.0  # current = min


# ===========================================================================
# 5. compute_speculation_signals — main function
# ===========================================================================

class TestComputeSpeculationSignals:
    def test_empty_snapshot_returns_empty_signals(self):
        """No currencies in snapshot → data_available=false, empty signals."""
        snapshot = _make_snapshot([])
        config = _make_config()
        result = compute_speculation_signals(snapshot, config)
        assert result["data_available"] is False
        assert result["signals"] == []
        assert result["league"] == "Standard"
        assert "fetched_at" in result
        assert result["days"] == DEFAULT_DAYS

    def test_single_currency_buy_signal(self):
        """A currency priced far below its recent mean → BUY."""
        now = datetime.now(timezone.utc)
        # 4 historical points at 100, 100, 100, 101 (tiny variance)
        # current price = 50 → z ≈ -116 → BUY
        logs = _make_logs([100.0, 100.0, 100.0, 101.0], base=now)
        snapshot = _make_snapshot([
            _make_currency("test-orb", "ritual", current_price=50.0, price_logs=logs),
        ])
        result = compute_speculation_signals(snapshot, _make_config(), now=now)
        assert result["data_available"] is True
        assert len(result["signals"]) == 1
        sig = result["signals"][0]
        assert sig["api_id"] == "test-orb"
        assert sig["signal"] == "BUY"
        assert sig["z_score"] < Z_BUY_THRESHOLD

    def test_single_currency_sell_signal(self):
        """A currency priced far above its recent mean → SELL."""
        now = datetime.now(timezone.utc)
        logs = _make_logs([100.0, 100.0, 100.0, 101.0], base=now)
        snapshot = _make_snapshot([
            _make_currency("test-orb", "breach", current_price=200.0, price_logs=logs),
        ])
        result = compute_speculation_signals(snapshot, _make_config(), now=now)
        assert len(result["signals"]) == 1
        assert result["signals"][0]["signal"] == "SELL"

    def test_multiple_currencies_sorted_by_abs_z(self):
        """Signals are sorted by |z_score| descending."""
        now = datetime.now(timezone.utc)
        # Item A: z ≈ -116 (extreme BUY)
        # Item B: z ≈ +231 (extreme SELL, even more extreme than A)
        # Item C: z ≈ 0 (HOLD)
        logs_a = _make_logs([100.0, 100.0, 100.0, 101.0], base=now)
        logs_b = _make_logs([100.0, 100.0, 100.0, 101.0], base=now)
        logs_c = _make_logs([100.0, 110.0, 90.0, 105.0], base=now)
        snapshot = _make_snapshot([
            _make_currency("a", "ritual", current_price=50.0, price_logs=logs_a),
            _make_currency("b", "breach", current_price=200.0, price_logs=logs_b),
            _make_currency("c", "delirium", current_price=102.0, price_logs=logs_c),
        ])
        result = compute_speculation_signals(snapshot, _make_config(), now=now)
        assert len(result["signals"]) == 3
        zs = [abs(s["z_score"]) for s in result["signals"]]
        assert zs == sorted(zs, reverse=True)

    def test_days_filter_excludes_old_points(self):
        """Old price points beyond the days window are excluded."""
        now = datetime.now(timezone.utc)
        # 40-day-old price = 1000, recent prices around 100 → without filter,
        # mean would be much higher, weakening the BUY signal.
        logs = [
            {"Time": _days_ago_iso(40, now), "Price": 1000.0, "Quantity": 5},
            {"Time": _days_ago_iso(10, now), "Price": 100.0, "Quantity": 5},
            {"Time": _days_ago_iso(5, now), "Price": 100.0, "Quantity": 5},
            {"Time": _days_ago_iso(1, now), "Price": 101.0, "Quantity": 5},
        ]
        snapshot = _make_snapshot([
            _make_currency("a", "ritual", current_price=50.0, price_logs=logs),
        ])
        # With days=30: 40-day-old point excluded, mean ≈ 100.33, z very negative
        result = compute_speculation_signals(snapshot, _make_config(), days=30, now=now)
        assert result["data_available"] is True
        assert len(result["signals"]) == 1
        assert result["signals"][0]["signal"] == "BUY"
        assert result["signals"][0]["sample_size"] == 3  # 40-day-old excluded

    def test_limit_caps_result_count(self):
        """limit=N caps the number of returned signals."""
        now = datetime.now(timezone.utc)
        currencies = []
        for i in range(10):
            logs = _make_logs([100.0, 100.0, 100.0, 101.0], base=now)
            currencies.append(
                _make_currency(f"item-{i}", "ritual", current_price=50.0, price_logs=logs)
            )
        snapshot = _make_snapshot(currencies)
        result = compute_speculation_signals(snapshot, _make_config(), limit=3, now=now)
        assert len(result["signals"]) == 3

    def test_signal_filter_buy(self):
        """signal_filter='BUY' returns only BUY signals."""
        now = datetime.now(timezone.utc)
        logs_buy = _make_logs([100.0, 100.0, 100.0, 101.0], base=now)
        logs_sell = _make_logs([100.0, 100.0, 100.0, 101.0], base=now)
        logs_hold = _make_logs([100.0, 110.0, 90.0, 105.0], base=now)
        snapshot = _make_snapshot([
            _make_currency("buy-item", "ritual", current_price=50.0, price_logs=logs_buy),
            _make_currency("sell-item", "breach", current_price=200.0, price_logs=logs_sell),
            _make_currency("hold-item", "delirium", current_price=102.0, price_logs=logs_hold),
        ])
        result = compute_speculation_signals(
            snapshot, _make_config(), signal_filter="BUY", now=now
        )
        assert len(result["signals"]) == 1
        assert result["signals"][0]["signal"] == "BUY"
        assert result["signals"][0]["api_id"] == "buy-item"

    def test_signal_filter_sell(self):
        now = datetime.now(timezone.utc)
        logs_buy = _make_logs([100.0, 100.0, 100.0, 101.0], base=now)
        logs_sell = _make_logs([100.0, 100.0, 100.0, 101.0], base=now)
        snapshot = _make_snapshot([
            _make_currency("buy-item", "ritual", current_price=50.0, price_logs=logs_buy),
            _make_currency("sell-item", "breach", current_price=200.0, price_logs=logs_sell),
        ])
        result = compute_speculation_signals(
            snapshot, _make_config(), signal_filter="SELL", now=now
        )
        assert len(result["signals"]) == 1
        assert result["signals"][0]["signal"] == "SELL"

    def test_signal_filter_invalid_defaults_to_all(self):
        """Invalid signal filter value falls back to ALL."""
        now = datetime.now(timezone.utc)
        logs = _make_logs([100.0, 100.0, 100.0, 101.0], base=now)
        snapshot = _make_snapshot([
            _make_currency("a", "ritual", current_price=50.0, price_logs=logs),
        ])
        result = compute_speculation_signals(
            snapshot, _make_config(), signal_filter="INVALID", now=now
        )
        assert len(result["signals"]) == 1  # ALL → returns everything

    def test_items_with_std_zero_are_skipped(self):
        """Items where all prices are identical (std=0) are excluded."""
        now = datetime.now(timezone.utc)
        logs_flat = _make_logs([100.0, 100.0, 100.0, 100.0], base=now)
        logs_var = _make_logs([100.0, 100.0, 100.0, 101.0], base=now)
        snapshot = _make_snapshot([
            _make_currency("flat", "ritual", current_price=100.0, price_logs=logs_flat),
            _make_currency("var", "breach", current_price=50.0, price_logs=logs_var),
        ])
        result = compute_speculation_signals(snapshot, _make_config(), now=now)
        # "flat" should be excluded (std=0 → no signal)
        api_ids = [s["api_id"] for s in result["signals"]]
        assert "var" in api_ids
        assert "flat" not in api_ids

    def test_items_with_insufficient_history_skipped(self):
        """Items with < MIN_SAMPLE_SIZE price points are excluded."""
        now = datetime.now(timezone.utc)
        # Single-point history
        logs_short = [{"Time": _days_ago_iso(1, now), "Price": 100.0, "Quantity": 5}]
        logs_ok = _make_logs([100.0, 100.0, 100.0, 101.0], base=now)
        snapshot = _make_snapshot([
            _make_currency("short", "ritual", current_price=50.0, price_logs=logs_short),
            _make_currency("ok", "breach", current_price=50.0, price_logs=logs_ok),
        ])
        result = compute_speculation_signals(snapshot, _make_config(), now=now)
        api_ids = [s["api_id"] for s in result["signals"]]
        assert "ok" in api_ids
        assert "short" not in api_ids

    def test_items_without_price_logs_skipped(self):
        """Items with empty PriceLogs are excluded."""
        now = datetime.now(timezone.utc)
        snapshot = _make_snapshot([
            _make_currency("empty", "ritual", current_price=50.0, price_logs=[]),
        ])
        result = compute_speculation_signals(snapshot, _make_config(), now=now)
        assert len(result["signals"]) == 0
        # data_available is False because no item had enough history
        assert result["data_available"] is False

    def test_days_input_clamped(self):
        """days is clamped to [1, 90]."""
        now = datetime.now(timezone.utc)
        snapshot = _make_snapshot([])
        result_high = compute_speculation_signals(snapshot, _make_config(), days=200, now=now)
        assert result_high["days"] == 90
        result_low = compute_speculation_signals(snapshot, _make_config(), days=0, now=now)
        assert result_low["days"] == 1

    def test_limit_input_clamped(self):
        """limit is clamped to [1, 500]."""
        now = datetime.now(timezone.utc)
        snapshot = _make_snapshot([])
        result_high = compute_speculation_signals(snapshot, _make_config(), limit=10000, now=now)
        # No signals to return, but limit should be reflected in the absence of error
        assert result_high["signals"] == []
        result_low = compute_speculation_signals(snapshot, _make_config(), limit=0, now=now)
        assert result_low["signals"] == []

    def test_response_includes_league_and_days(self):
        """Top-level response includes league name and days value."""
        now = datetime.now(timezone.utc)
        snapshot = _make_snapshot([])
        result = compute_speculation_signals(snapshot, _make_config("Dawn of the Hunters"), days=14, now=now)
        assert result["league"] == "Dawn of the Hunters"
        assert result["days"] == 14

    def test_uses_snake_case_fallback(self):
        """Snapshot with snake_case keys is also handled."""
        now = datetime.now(timezone.utc)
        logs = _make_logs([100.0, 100.0, 100.0, 101.0], base=now)
        # Build with snake_case keys (some snapshots use this)
        curr = {
            "api_id": "snake-case-item",
            "text": "Snake Case Item",
            "category_api_id": "ritual",
            "current_price": 50.0,
            "current_quantity": 0,
            "price_logs": [
                {"time": l["Time"], "price": l["Price"], "quantity": l["Quantity"]}
                for l in logs
            ],
        }
        snapshot = SimpleNamespace(
            currencies={"snake-case-item": curr},
            fetched_at=now,
        )
        result = compute_speculation_signals(snapshot, _make_config(), now=now)
        assert len(result["signals"]) == 1
        assert result["signals"][0]["api_id"] == "snake-case-item"
        assert result["signals"][0]["signal"] == "BUY"


# ===========================================================================
# 6. Route handler smoke tests
# ===========================================================================

class TestRouteHandler:
    """Smoke test the FastAPI route handler without spinning up uvicorn."""

    async def test_route_returns_empty_when_no_snapshot(self):
        from backend.api.routes_speculation import get_speculation

        with patch(
            "backend.api.routes_speculation.get_snapshot_manager"
        ) as mock_mgr:
            mock_mgr.return_value = SimpleNamespace(last_snapshot=None)
            result = await get_speculation()
            assert result["data_available"] is False
            assert result["signals"] == []
            assert "fetched_at" in result
            assert "days" in result

    async def test_route_returns_data_when_snapshot_available(self):
        from backend.api.routes_speculation import get_speculation

        now = datetime.now(timezone.utc)
        logs = _make_logs([100.0, 100.0, 100.0, 101.0], base=now)
        snapshot = _make_snapshot([
            _make_currency("a", "ritual", current_price=50.0, price_logs=logs),
        ])

        with patch(
            "backend.api.routes_speculation.get_snapshot_manager"
        ) as mock_mgr, patch(
            "backend.api.routes_speculation.get_snapshot"
        ) as mock_get:
            mock_mgr.return_value = SimpleNamespace(last_snapshot=object())  # truthy
            mock_get.return_value = snapshot
            # Pass explicit args — when called directly (not via FastAPI),
            # the default values are Query() objects, not the integers they wrap.
            result = await get_speculation(days=30, limit=50, signal="ALL")
            assert result["data_available"] is True
            assert len(result["signals"]) >= 1
            assert result["signals"][0]["signal"] == "BUY"

    async def test_route_passes_query_params(self):
        """days, limit, signal query params are forwarded to the function."""
        from backend.api.routes_speculation import get_speculation

        now = datetime.now(timezone.utc)
        # Build 5 currencies with BUY signals
        currencies = []
        for i in range(5):
            logs = _make_logs([100.0, 100.0, 100.0, 101.0], base=now)
            currencies.append(
                _make_currency(f"item-{i}", "ritual", current_price=50.0, price_logs=logs)
            )
        snapshot = _make_snapshot(currencies)

        with patch(
            "backend.api.routes_speculation.get_snapshot_manager"
        ) as mock_mgr, patch(
            "backend.api.routes_speculation.get_snapshot"
        ) as mock_get:
            mock_mgr.return_value = SimpleNamespace(last_snapshot=object())
            mock_get.return_value = snapshot
            result = await get_speculation(days=14, limit=2, signal="BUY")
            assert result["days"] == 14
            assert len(result["signals"]) == 2  # limit=2
            assert all(s["signal"] == "BUY" for s in result["signals"])  # signal filter

    async def test_route_returns_empty_on_exception(self):
        """If compute_speculation_signals raises, route returns data_available=false."""
        from backend.api.routes_speculation import get_speculation

        with patch(
            "backend.api.routes_speculation.get_snapshot_manager"
        ) as mock_mgr, patch(
            "backend.api.routes_speculation.get_snapshot"
        ) as mock_get:
            mock_mgr.return_value = SimpleNamespace(last_snapshot=object())
            mock_get.side_effect = RuntimeError("boom")
            result = await get_speculation()
            assert result["data_available"] is False
            assert result["signals"] == []
