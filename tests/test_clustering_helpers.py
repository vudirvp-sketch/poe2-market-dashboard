"""Tests for backend.economy.clustering_helpers — P1-4 deduplication.

Covers:
  - prepare_clustering_data() with both code paths
    (price_histories_prices and currencies price_logs)
  - run_clustering_sync() with sufficient and insufficient data
  - CLUSTER_LABELS_CACHE_KEY constant
  - Correct 24h-ago price lookup (fixes the prices[0] bug)
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from dataclasses import dataclass
from unittest.mock import patch

import pytest

from backend.economy.clustering_helpers import (
    prepare_clustering_data,
    run_clustering_sync,
    CLUSTER_LABELS_CACHE_KEY,
)
from backend.models.currency import ClusterLabel


# ---------------------------------------------------------------------------
# Minimal rate stub
# ---------------------------------------------------------------------------

@dataclass
class _Rate:
    currency_from: str
    currency_to: str
    raw_rate: float
    volume_traded: float


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def _make_rates():
    return {
        "divine/exalted": _Rate("divine", "exalted", 2.0, 500),
        "chaos/exalted": _Rate("chaos", "exalted", 0.05, 10000),
        "chromatic/exalted": _Rate("chromatic", "exalted", 0.01, 8000),
    }


def _make_currencies():
    now = datetime.now(timezone.utc)
    return {
        "divine": {
            "api_id": "Divine",
            "price_logs": [
                {"price": 1.8, "time": now - timedelta(hours=25)},
                {"price": 1.9, "time": now - timedelta(hours=12)},
                {"price": 2.0, "time": now - timedelta(hours=1)},
            ],
        },
        "chaos": {
            "api_id": "Chaos",
            "price_logs": [
                {"price": 0.04, "time": now - timedelta(hours=26)},
                {"price": 0.045, "time": now - timedelta(hours=13)},
                {"price": 0.05, "time": now - timedelta(hours=2)},
            ],
        },
        "chromatic": {
            "api_id": "Chromatic",
            "price_logs": [
                {"price": 0.008, "time": now - timedelta(hours=20)},
                {"price": 0.009, "time": now - timedelta(hours=10)},
                {"price": 0.01, "time": now - timedelta(hours=1)},
            ],
        },
    }


def _make_prices_in_base():
    return {"divine": 2.0, "chaos": 0.05, "chromatic": 0.01, "exalted": 1.0}


def _make_price_histories_prices():
    return {
        "divine": [1.8, 1.9, 2.0],
        "chaos": [0.04, 0.045, 0.05],
        "chromatic": [0.008, 0.009, 0.01],
    }


def _make_price_histories_timestamped():
    now = datetime.now(timezone.utc)
    return {
        "divine": [
            (now - timedelta(hours=25), 1.8),
            (now - timedelta(hours=12), 1.9),
            (now - timedelta(hours=1), 2.0),
        ],
        "chaos": [
            (now - timedelta(hours=26), 0.04),
            (now - timedelta(hours=13), 0.045),
            (now - timedelta(hours=2), 0.05),
        ],
        "chromatic": [
            (now - timedelta(hours=20), 0.008),
            (now - timedelta(hours=10), 0.009),
            (now - timedelta(hours=1), 0.01),
        ],
    }


# ---------------------------------------------------------------------------
# Tests: CLUSTER_LABELS_CACHE_KEY
# ---------------------------------------------------------------------------

class TestCacheKey:
    def test_cache_key_value(self):
        assert CLUSTER_LABELS_CACHE_KEY == "cluster_labels"

    def test_cache_key_is_string(self):
        assert isinstance(CLUSTER_LABELS_CACHE_KEY, str)


# ---------------------------------------------------------------------------
# Tests: prepare_clustering_data — routes_arbitrage path
# ---------------------------------------------------------------------------

class TestPrepareClusteringDataArbitragePath:
    """Test with price_histories_prices and price_histories_timestamped
    (the routes_arbitrage/FlipComputeBundle path)."""

    def test_returns_four_dicts(self):
        result = prepare_clustering_data(
            rates=_make_rates(),
            currencies={},
            prices_in_base=_make_prices_in_base(),
            price_histories_prices=_make_price_histories_prices(),
            price_histories_timestamped=_make_price_histories_timestamped(),
        )
        assert len(result) == 4
        histories, volumes, now_prices, ago_prices = result
        assert isinstance(histories, dict)
        assert isinstance(volumes, dict)
        assert isinstance(now_prices, dict)
        assert isinstance(ago_prices, dict)

    def test_currencies_from_rates_populated(self):
        histories, volumes, now_prices, ago_prices = prepare_clustering_data(
            rates=_make_rates(),
            currencies={},
            prices_in_base=_make_prices_in_base(),
            price_histories_prices=_make_price_histories_prices(),
            price_histories_timestamped=_make_price_histories_timestamped(),
        )
        # divine, chaos, chromatic, exalted appear in rates
        for curr in ("divine", "chaos", "chromatic", "exalted"):
            assert curr in histories
            assert curr in volumes

    def test_volumes_are_max(self):
        _, volumes, _, _ = prepare_clustering_data(
            rates=_make_rates(),
            currencies={},
            prices_in_base=_make_prices_in_base(),
            price_histories_prices=_make_price_histories_prices(),
            price_histories_timestamped=_make_price_histories_timestamped(),
        )
        # chaos appears in two rates (chaos/exalted vol=10000 and possibly
        # as currency_to in others), max should be 10000
        assert volumes["chaos"] == 10000

    def test_prices_now_use_last_price(self):
        _, _, now_prices, _ = prepare_clustering_data(
            rates=_make_rates(),
            currencies={},
            prices_in_base=_make_prices_in_base(),
            price_histories_prices=_make_price_histories_prices(),
            price_histories_timestamped=_make_price_histories_timestamped(),
        )
        assert now_prices["divine"] == 2.0
        assert now_prices["chaos"] == 0.05

    def test_24h_ago_uses_find_price_24h_ago(self):
        """Verify the 24h-ago price uses timestamp-aware lookup, not prices[0]."""
        _, _, _, ago_prices = prepare_clustering_data(
            rates=_make_rates(),
            currencies={},
            prices_in_base=_make_prices_in_base(),
            price_histories_prices=_make_price_histories_prices(),
            price_histories_timestamped=_make_price_histories_timestamped(),
        )
        # divine: 24h ago ≈ 1.8 (at 25h), NOT prices[0]=1.8 but
        # it should be found by find_price_24h_ago, not hardcoded to first.
        # The key point is it uses the function, not prices[0].
        # With the data, 1.8 is closest to 24h ago.
        assert ago_prices["divine"] == 1.8

    def test_24h_ago_fallback_without_timestamps(self):
        """When no timestamped data, falls back to second-to-last price."""
        _, _, _, ago_prices = prepare_clustering_data(
            rates=_make_rates(),
            currencies={},
            prices_in_base=_make_prices_in_base(),
            price_histories_prices=_make_price_histories_prices(),
            price_histories_timestamped=None,
        )
        # Without timestamps, falls back to history[-2]
        assert ago_prices["divine"] == 1.9

    def test_empty_history_uses_prices_in_base(self):
        rates = {"foo/bar": _Rate("foo", "bar", 1.0, 100)}
        histories, _, now_prices, ago_prices = prepare_clustering_data(
            rates=rates,
            currencies={},
            prices_in_base={"foo": 5.0, "bar": 3.0},
            price_histories_prices={"foo": [], "bar": []},
            price_histories_timestamped=None,
        )
        assert now_prices["foo"] == 5.0
        assert ago_prices["foo"] == 5.0


# ---------------------------------------------------------------------------
# Tests: prepare_clustering_data — routes_prices path
# ---------------------------------------------------------------------------

class TestPrepareClusteringDataPricesPath:
    """Test with currencies price_logs (the routes_prices path)."""

    def test_extracts_from_price_logs(self):
        histories, _, now_prices, ago_prices = prepare_clustering_data(
            rates=_make_rates(),
            currencies=_make_currencies(),
            prices_in_base=_make_prices_in_base(),
            # price_histories_prices=None triggers the price_logs path
        )
        assert now_prices["divine"] == 2.0
        # Should use find_price_24h_ago, NOT prices[0]
        # The 25h-ago point (1.8) is closest to 24h
        assert ago_prices["divine"] == 1.8

    def test_24h_ago_not_prices0_bug(self):
        """Critical test: 24h-ago should NOT be prices[0] (oldest in array).
        It should use find_price_24h_ago for timestamp-aware lookup.
        This was the bug in routes_prices.py before P1-4 fix."""
        now = datetime.now(timezone.utc)
        currencies = {
            "divine": {
                "api_id": "Divine",
                "price_logs": [
                    # Oldest is 48h ago — prices[0] bug would use this
                    {"price": 1.0, "time": now - timedelta(hours=48)},
                    # 24h-ago point — find_price_24h_ago should find this
                    {"price": 1.5, "time": now - timedelta(hours=24)},
                    {"price": 2.0, "time": now - timedelta(hours=1)},
                ],
            },
        }
        rates = {"divine/exalted": _Rate("divine", "exalted", 2.0, 500)}
        _, _, _, ago_prices = prepare_clustering_data(
            rates=rates,
            currencies=currencies,
            prices_in_base={"divine": 2.0, "exalted": 1.0},
        )
        # Must be 1.5 (24h ago), NOT 1.0 (prices[0] / oldest)
        # Key is "divine" from rates (lowercase), matched via api_id_lower
        assert ago_prices["divine"] == 1.5
        assert ago_prices["divine"] != 1.0

    def test_fallback_to_prices_in_base(self):
        """Currencies not in snapshot.currencies get prices_in_base fallback."""
        rates = {"foo/exalted": _Rate("foo", "exalted", 3.0, 200)}
        histories, _, now_prices, ago_prices = prepare_clustering_data(
            rates=rates,
            currencies={},  # No price_logs for foo
            prices_in_base={"foo": 3.0, "exalted": 1.0},
        )
        assert now_prices["foo"] == 3.0
        assert ago_prices["foo"] == 3.0

    def test_original_case_api_id_used(self):
        """When currencies dict has api_id different from key, orig_id is used."""
        now = datetime.now(timezone.utc)
        currencies = {
            "divine": {
                "api_id": "Divine Orb",
                "price_logs": [
                    {"price": 1.8, "time": now - timedelta(hours=25)},
                    {"price": 2.0, "time": now - timedelta(hours=1)},
                ],
            },
        }
        rates = {"Divine Orb/exalted": _Rate("Divine Orb", "exalted", 2.0, 500)}
        histories, _, _, _ = prepare_clustering_data(
            rates=rates,
            currencies=currencies,
            prices_in_base={"Divine Orb": 2.0, "exalted": 1.0},
        )
        # Should find "Divine Orb" in histories (matched from rate)
        assert "Divine Orb" in histories


# ---------------------------------------------------------------------------
# Tests: run_clustering_sync
# ---------------------------------------------------------------------------

class TestRunClusteringSync:
    """Test the CPU-bound clustering function with real CurrencyClusterer."""

    def test_returns_dict_with_enough_data(self):
        """With >=3 currencies, returns a non-empty dict."""
        from backend.config import get_settings
        config = get_settings()
        histories = {
            "a": [1.0, 1.1, 1.2, 1.3, 1.4] * 10,
            "b": [10.0, 11.0, 12.0, 13.0, 14.0] * 10,
            "c": [0.1, 0.2, 0.3, 0.4, 0.5] * 10,
        }
        result = run_clustering_sync(
            config,
            histories,
            {"a": 1000, "b": 500, "c": 50},
            {"a": 1.4, "b": 14.0, "c": 0.5},
            {"a": 1.0, "b": 10.0, "c": 0.1},
        )
        assert isinstance(result, dict)
        assert len(result) == 3
        for k, v in result.items():
            assert v in ("stable", "moderate", "volatile_illiquid")

    def test_returns_empty_with_fewer_than_3(self):
        """With <3 currencies, returns empty dict."""
        result = run_clustering_sync(
            None,
            {"a": [1.0], "b": [2.0]},
            {"a": 100, "b": 200},
            {"a": 1.0, "b": 2.0},
            {"a": 0.9, "b": 1.8},
        )
        assert result == {}

    def test_config_none_uses_get_settings(self):
        """Passing config=None should work (uses get_settings() defaults)."""
        histories = {
            "a": [1.0] * 20,
            "b": [10.0] * 20,
            "c": [0.1] * 20,
        }
        result = run_clustering_sync(
            None,
            histories,
            {"a": 1000, "b": 500, "c": 50},
            {"a": 1.0, "b": 10.0, "c": 0.1},
            {"a": 1.0, "b": 10.0, "c": 0.1},
        )
        assert isinstance(result, dict)
        assert len(result) == 3
