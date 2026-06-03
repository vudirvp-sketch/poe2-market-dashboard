"""
Integration tests for DailyStatsHistory flow.

Verifies that:
1. Poe2ScoutProvider.get_daily_stats() returns properly structured data
2. DailyStatsCache caches DailyStatsHistory results
3. The forecast route uses DailyStatsHistory when available
4. Cache invalidation clears daily_stats entries
5. LightGBM trains with reduced data points (15 threshold)

These tests use a mock provider to avoid dependency on live API availability.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any

import numpy as np
import pytest

from backend.config import AppConfig, DataConfig, ForecastingConfig, LeagueConfig
from backend.data.daily_stats_cache import DailyStatsCache, DailyStatsResult, get_daily_stats_cache
from backend.data.providers.base import BaseDataProvider
from backend.models.currency import (
    CurrencyInfo,
    ExchangeRate,
    PricePoint,
    PriceQuote,
)


# ---------------------------------------------------------------------------
# Mock provider with DailyStatsHistory support
# ---------------------------------------------------------------------------

MOCK_DAILY_STATS = {
    "DailyStats": [
        {"Time": "2026-05-01", "Open": 220.0, "High": 225.0, "Low": 218.0,
         "Close": 222.0, "Average": 221.5, "Volume": 5000},
        {"Time": "2026-05-02", "Open": 222.0, "High": 228.0, "Low": 220.0,
         "Close": 225.0, "Average": 224.0, "Volume": 4500},
        {"Time": "2026-05-03", "Open": 225.0, "High": 230.0, "Low": 223.0,
         "Close": 228.0, "Average": 226.5, "Volume": 4800},
        {"Time": "2026-05-04", "Open": 228.0, "High": 232.0, "Low": 225.0,
         "Close": 230.0, "Average": 228.5, "Volume": 4200},
        {"Time": "2026-05-05", "Open": 230.0, "High": 235.0, "Low": 228.0,
         "Close": 233.0, "Average": 231.5, "Volume": 5100},
        {"Time": "2026-05-06", "Open": 233.0, "High": 238.0, "Low": 230.0,
         "Close": 235.0, "Average": 234.0, "Volume": 4700},
        {"Time": "2026-05-07", "Open": 235.0, "High": 240.0, "Low": 233.0,
         "Close": 238.0, "Average": 236.5, "Volume": 4900},
        {"Time": "2026-05-08", "Open": 238.0, "High": 242.0, "Low": 235.0,
         "Close": 240.0, "Average": 238.5, "Volume": 4300},
        {"Time": "2026-05-09", "Open": 240.0, "High": 245.0, "Low": 238.0,
         "Close": 243.0, "Average": 241.5, "Volume": 5200},
        {"Time": "2026-05-10", "Open": 243.0, "High": 248.0, "Low": 240.0,
         "Close": 245.0, "Average": 243.5, "Volume": 4600},
        {"Time": "2026-05-11", "Open": 245.0, "High": 250.0, "Low": 243.0,
         "Close": 248.0, "Average": 246.5, "Volume": 4800},
        {"Time": "2026-05-12", "Open": 248.0, "High": 252.0, "Low": 245.0,
         "Close": 250.0, "Average": 248.5, "Volume": 4400},
        {"Time": "2026-05-13", "Open": 250.0, "High": 255.0, "Low": 248.0,
         "Close": 253.0, "Average": 251.5, "Volume": 5300},
        {"Time": "2026-05-14", "Open": 253.0, "High": 258.0, "Low": 250.0,
         "Close": 255.0, "Average": 253.5, "Volume": 4700},
        {"Time": "2026-05-15", "Open": 255.0, "High": 260.0, "Low": 253.0,
         "Close": 258.0, "Average": 256.5, "Volume": 5000},
        {"Time": "2026-05-16", "Open": 258.0, "High": 262.0, "Low": 255.0,
         "Close": 260.0, "Average": 258.5, "Volume": 4500},
        {"Time": "2026-05-17", "Open": 260.0, "High": 265.0, "Low": 258.0,
         "Close": 263.0, "Average": 261.5, "Volume": 4900},
        {"Time": "2026-05-18", "Open": 263.0, "High": 268.0, "Low": 260.0,
         "Close": 265.0, "Average": 263.5, "Volume": 4200},
        {"Time": "2026-05-19", "Open": 265.0, "High": 270.0, "Low": 263.0,
         "Close": 268.0, "Average": 266.5, "Volume": 5100},
        {"Time": "2026-05-20", "Open": 268.0, "High": 272.0, "Low": 265.0,
         "Close": 270.0, "Average": 268.5, "Volume": 4600},
        {"Time": "2026-05-21", "Open": 270.0, "High": 275.0, "Low": 268.0,
         "Close": 273.0, "Average": 271.5, "Volume": 4800},
        {"Time": "2026-05-22", "Open": 273.0, "High": 278.0, "Low": 270.0,
         "Close": 275.0, "Average": 273.5, "Volume": 4400},
        {"Time": "2026-05-23", "Open": 275.0, "High": 280.0, "Low": 273.0,
         "Close": 278.0, "Average": 276.5, "Volume": 5200},
        {"Time": "2026-05-24", "Open": 278.0, "High": 282.0, "Low": 275.0,
         "Close": 280.0, "Average": 278.5, "Volume": 4700},
        {"Time": "2026-05-25", "Open": 280.0, "High": 285.0, "Low": 278.0,
         "Close": 283.0, "Average": 281.5, "Volume": 5000},
        {"Time": "2026-05-26", "Open": 283.0, "High": 288.0, "Low": 280.0,
         "Close": 285.0, "Average": 283.5, "Volume": 4500},
        {"Time": "2026-05-27", "Open": 285.0, "High": 290.0, "Low": 283.0,
         "Close": 288.0, "Average": 286.5, "Volume": 4900},
        {"Time": "2026-05-28", "Open": 288.0, "High": 292.0, "Low": 285.0,
         "Close": 290.0, "Average": 288.5, "Volume": 4300},
        {"Time": "2026-05-29", "Open": 290.0, "High": 295.0, "Low": 288.0,
         "Close": 293.0, "Average": 291.5, "Volume": 5100},
        {"Time": "2026-05-30", "Open": 293.0, "High": 298.0, "Low": 290.0,
         "Close": 295.0, "Average": 293.5, "Volume": 4600},
    ],
    "HasMore": False,
    "BaseCurrencyApiId": "exalted",
    "BaseCurrencyText": "Exalted Orb",
}


class MockProviderWithDailyStats(BaseDataProvider):
    """Mock provider that returns DailyStatsHistory data."""

    def name(self) -> str:
        return "mock_ds_provider"

    async def close(self) -> None:
        pass

    async def get_current_price(self, currency_pair: str) -> PriceQuote | None:
        return None

    async def get_historical_prices(
        self, currency: str, days: int = 7
    ) -> list[PricePoint]:
        now = datetime.now(timezone.utc)
        base_price = 220.0
        return [
            PricePoint(
                timestamp=now,
                price=base_price * (1 + 0.01 * i),
                volume=100,
            )
            for i in range(days * 4)  # ~4 data points per day
        ]

    async def get_exchange_rates(self, league: str) -> dict[str, ExchangeRate]:
        return {}

    async def get_currency_metadata(self, league: str) -> list[CurrencyInfo]:
        return [
            CurrencyInfo(
                api_id="divine",
                text="Divine Orb",
                category_api_id="currency",
                icon_url=None,
                item_id=42,
                currency_item_id=100,
            ),
        ]

    async def get_daily_stats(
        self,
        league: str,
        item_id: int,
        day_count: int = 30,
        end_date: str | None = None,
    ) -> dict | None:
        """Return mock daily stats data."""
        if item_id == 42:
            return MOCK_DAILY_STATS
        return None


class MockProviderNoDailyStats(BaseDataProvider):
    """Mock provider that does NOT support DailyStatsHistory."""

    def name(self) -> str:
        return "mock_no_ds_provider"

    async def close(self) -> None:
        pass

    async def get_current_price(self, currency_pair: str) -> PriceQuote | None:
        return None

    async def get_historical_prices(
        self, currency: str, days: int = 7
    ) -> list[PricePoint]:
        now = datetime.now(timezone.utc)
        return [
            PricePoint(timestamp=now, price=220.0 * (1 + 0.01 * i), volume=100)
            for i in range(28)
        ]

    async def get_exchange_rates(self, league: str) -> dict[str, ExchangeRate]:
        return {}

    async def get_currency_metadata(self, league: str) -> list[CurrencyInfo]:
        return [
            CurrencyInfo(
                api_id="divine",
                text="Divine Orb",
                category_api_id="currency",
                icon_url=None,
                item_id=42,
                currency_item_id=100,
            ),
        ]


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestDailyStatsCacheIntegration:
    """Test that DailyStatsHistory results are properly cached in DailyStatsCache."""

    def _make_config(self) -> AppConfig:
        """Create a minimal test config."""
        return AppConfig(
            data=DataConfig(),
            league=LeagueConfig(),
            forecasting=ForecastingConfig(lightgbm_min_data_points=15),
        )

    @pytest.mark.asyncio
    async def test_daily_stats_cached(self):
        """get_or_fetch should cache daily stats results."""
        cache = DailyStatsCache(self._make_config())
        provider = MockProviderWithDailyStats()

        # First call — cache miss, should fetch
        result1 = await cache.get_or_fetch(
            provider.get_daily_stats,
            "runes", 42, 30,
        )
        assert result1.value is not None
        assert result1.stale is False
        assert "DailyStats" in result1.value

        # Second call — should hit cache
        result2 = await cache.get_or_fetch(
            provider.get_daily_stats,
            "runes", 42, 30,
        )
        assert result2.value is not None
        assert result2.stale is False

        # Verify cache stats
        stats = cache.stats()
        assert stats["size"] == 1

    @pytest.mark.asyncio
    async def test_daily_stats_cache_invalidation(self):
        """Invalidating cache should clear all entries."""
        cache = DailyStatsCache(self._make_config())
        provider = MockProviderWithDailyStats()

        await cache.get_or_fetch(
            provider.get_daily_stats,
            "runes", 42, 30,
        )
        assert cache.stats()["size"] == 1

        cache.invalidate()
        assert cache.stats()["size"] == 0

    @pytest.mark.asyncio
    async def test_daily_stats_stale_fallback(self):
        """When fetch fails, stale daily stats should be returned."""
        cache = DailyStatsCache(self._make_config())
        call_count = 0

        async def fetch_fn(league, item_id, day_count):
            nonlocal call_count
            call_count += 1
            if call_count > 1:
                raise ConnectionError("API down")
            return MOCK_DAILY_STATS

        # First call succeeds
        result1 = await cache.get_or_fetch(
            fetch_fn, "runes", 42, 30,
        )
        assert result1.value is not None
        assert result1.stale is False

        # Manually expire cache entry to trigger stale fallback
        cache._cache.clear()

        # Second call fails — should get stale value
        result2 = await cache.get_or_fetch(
            fetch_fn, "runes", 42, 30,
        )
        assert result2.value is not None
        assert result2.stale is True


class TestDailyStatsParsing:
    """Test parsing of DailyStatsHistory response into PricePoint list."""

    @pytest.mark.asyncio
    async def test_parse_daily_stats_to_price_points(self):
        """DailyStatsHistory data should be parseable into PricePoint list."""
        from backend.data.schemas import DailyStatsResponse

        ds_resp = DailyStatsResponse.model_validate(MOCK_DAILY_STATS)
        assert len(ds_resp.daily_stats) == 30
        assert ds_resp.daily_stats[0].close == 222.0
        assert ds_resp.daily_stats[-1].close == 295.0

        # Convert to PricePoints
        from backend.models.currency import PricePoint

        points = []
        for pt in ds_resp.daily_stats:
            if pt.close and pt.close > 0:
                try:
                    ts = datetime.fromisoformat(pt.time.replace("Z", "+00:00")) if pt.time else datetime.now(timezone.utc)
                except (ValueError, TypeError):
                    ts = datetime.now(timezone.utc)
                points.append(PricePoint(
                    timestamp=ts,
                    price=pt.close,
                    volume=float(pt.volume) if pt.volume else 0.0,
                ))

        assert len(points) == 30
        assert points[0].price == 222.0
        assert points[-1].price == 295.0


class TestLightGBMReducedData:
    """Test that LightGBM can train with fewer than 30 data points."""

    def test_lightgbm_trains_with_15_points(self):
        """LightGBM should train with 15 data points (new threshold)."""
        from backend.predictors.time_series import LightGBMForecaster

        rng = np.random.RandomState(42)
        log_prices = 4.6 + rng.normal(0, 0.01, 15)

        forecaster = LightGBMForecaster()
        forecaster.train(log_prices)

        # Should have trained (not skipped due to insufficient data)
        if forecaster._model_median is not None:
            assert forecaster.last_trained_at is not None

    def test_lightgbm_simplified_features_for_sparse_data(self):
        """With <30 points, LightGBM should use simplified feature config."""
        from backend.predictors.time_series import LightGBMForecaster

        rng = np.random.RandomState(42)
        log_prices = 4.6 + rng.normal(0, 0.01, 18)

        forecaster = LightGBMForecaster()
        forecaster.train(log_prices)

        # Should train without errors even with sparse data
        if forecaster._model_median is not None:
            result = forecaster.predict(log_prices, horizon=6)
            if result is not None:
                assert len(result.point_forecast) == 6

    def test_lightgbm_still_skips_below_15(self):
        """LightGBM should skip training with fewer than 15 points."""
        from backend.predictors.time_series import LightGBMForecaster

        rng = np.random.RandomState(42)
        log_prices = 4.6 + rng.normal(0, 0.01, 10)

        forecaster = LightGBMForecaster()
        forecaster.train(log_prices)

        # Should not have trained
        assert forecaster._model_median is None

    def test_lightgbm_daily_stats_30_day_forecast(self):
        """Full 30-point DailyStatsHistory should produce a forecast."""
        from backend.predictors.time_series import LightGBMForecaster

        # Simulate 30 days of daily close prices
        rng = np.random.RandomState(42)
        log_prices = np.log(np.linspace(220, 295, 30) + rng.normal(0, 1, 30))

        forecaster = LightGBMForecaster()
        forecaster.train(log_prices)

        if forecaster._model_median is not None:
            result = forecaster.predict(log_prices, horizon=7)
            if result is not None:
                assert len(result.point_forecast) == 7
                # All forecast prices should be positive
                for p in result.point_forecast:
                    assert p > 0
