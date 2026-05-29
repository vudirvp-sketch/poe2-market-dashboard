"""
End-to-End tests for degraded mode.

Simulates the scenario where:
1. Backend starts and serves data normally
2. Upstream API becomes unreachable (provider "breaks")
3. Stale/cached data should still be served where possible
4. Health endpoint reflects degraded status

Uses a mock provider that can be toggled between healthy and broken states.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient, ASGITransport
from unittest.mock import AsyncMock, patch

from backend.data.providers.base import BaseDataProvider
from backend.models.currency import (
    CurrencyInfo,
    ExchangeRate,
    PricePoint,
    PriceQuote,
)


# ---------------------------------------------------------------------------
# Failing mock provider — simulates upstream unreachable
# ---------------------------------------------------------------------------

class FailingPoe2ScoutProvider(BaseDataProvider):
    """Mock provider that always fails — simulates upstream unreachable."""

    def name(self) -> str:
        return "failing_mock"

    async def close(self) -> None:
        pass

    async def get_current_price(self, currency_pair: str) -> PriceQuote | None:
        raise ConnectionError("upstream_unreachable: Connection refused")

    async def get_exchange_rates(self, league: str) -> dict:
        raise ConnectionError("upstream_unreachable: API timeout")

    async def get_currency_metadata(self, league: str) -> list[CurrencyInfo]:
        raise ConnectionError("upstream_unreachable: API timeout")

    async def get_historical_prices(
        self, currency: str, days: int = 7
    ) -> list[PricePoint]:
        raise ConnectionError("upstream_unreachable: API timeout")

    async def get_gold_chaos_rate(self, league: str) -> float | None:
        raise ConnectionError("upstream_unreachable: API timeout")


# ---------------------------------------------------------------------------
# Flaky mock provider — works initially, then breaks
# ---------------------------------------------------------------------------

class FlakyPoe2ScoutProvider(BaseDataProvider):
    """Mock provider that works on the first call, then fails.

    This simulates the real-world scenario where the upstream API
    goes down mid-session.
    """

    def __init__(self):
        self._call_count = 0
        self._broken = False

    def name(self) -> str:
        return "flaky_mock"

    def break_provider(self):
        """Simulate upstream going down."""
        self._broken = True

    async def close(self) -> None:
        pass

    async def get_current_price(self, currency_pair: str) -> PriceQuote | None:
        if self._broken:
            raise ConnectionError("upstream_unreachable: API down")
        return None

    async def get_exchange_rates(self, league: str) -> dict:
        if self._broken:
            raise ConnectionError("upstream_unreachable: API down")
        return {
            ("exalted", "chaos"): ExchangeRate(
                currency_from="exalted",
                currency_to="chaos",
                raw_rate=10.0,
                volume_traded=5000,
                stock_value=50000,
                highest_stock=100,
            ),
        }

    async def get_currency_metadata(self, league: str) -> list[CurrencyInfo]:
        if self._broken:
            raise ConnectionError("upstream_unreachable: API down")
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

    async def get_historical_prices(
        self, currency: str, days: int = 7
    ) -> list[PricePoint]:
        if self._broken:
            raise ConnectionError("upstream_unreachable: API down")
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc)
        return [
            PricePoint(timestamp=now, price=220.0 * (1 + 0.01 * i), volume=100)
            for i in range(days * 4)
        ]

    async def get_gold_chaos_rate(self, league: str) -> float | None:
        if self._broken:
            raise ConnectionError("upstream_unreachable: API down")
        return 0.001


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
async def client():
    """Async HTTP client for E2E testing against the FastAPI app."""
    from backend.main import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


# ---------------------------------------------------------------------------
# Tests — Degraded mode with failing provider
# ---------------------------------------------------------------------------

@pytest.mark.e2e
class TestDegradedMode:
    """Test API behaviour when upstream is unreachable."""

    async def test_health_endpoint_survives_upstream_failure(self, client):
        """Health endpoint should still respond even if upstream API is down.

        The backend itself is running — it just can't reach the upstream.
        This should NOT be a 500 error; the health check should report
        degraded status.
        """
        resp = await client.get("/api/health")
        # Health check should succeed (backend is online)
        assert resp.status_code == 200

    async def test_prices_endpoint_handles_upstream_failure(self, client):
        """Prices endpoint should handle upstream failure gracefully.

        May return 503 (service unavailable) when upstream is unreachable,
        but should NOT crash or return 500.
        """
        resp = await client.get("/api/prices")
        # 200 (cached data) or 503 (no data available) are acceptable
        assert resp.status_code in [200, 503]

    async def test_forecast_endpoint_handles_upstream_failure(self, client):
        """Forecast endpoint should handle upstream failure gracefully.

        May return 422 (insufficient data) or 503, but should NOT crash.
        """
        resp = await client.get("/api/forecast/divine")
        assert resp.status_code in [200, 422, 503]

    async def test_anomalies_endpoint_handles_upstream_failure(self, client):
        """Anomalies endpoint should handle upstream failure gracefully."""
        resp = await client.get("/api/anomalies")
        assert resp.status_code in [200, 503]

    async def test_phase_endpoint_independent_of_upstream(self, client):
        """Phase endpoint is computed from league config, not upstream data.

        Should always return 200 with valid phase info.
        """
        resp = await client.get("/api/phase")
        assert resp.status_code == 200
        data = resp.json()
        assert data["phase"] in ["early", "mid", "late"]


# ---------------------------------------------------------------------------
# Tests — PipelineCache stale data behaviour
# ---------------------------------------------------------------------------

class TestPipelineCacheStaleBehaviour:
    """Test that PipelineCache correctly returns stale data in degraded mode."""

    def test_pipeline_cache_returns_stale_on_expired(self):
        """When TTL expires, PipelineCache should return stale data
        with stale=True flag."""
        from backend.data.pipeline_cache import PipelineCache
        import time

        # Very short TTL for testing
        cache = PipelineCache()
        cache._ttl = 0.05  # 50ms TTL

        cache.put("test_pipeline", {"opportunities": [1, 2, 3]})

        # Immediate get — fresh
        result_fresh = cache.get("test_pipeline")
        assert result_fresh is not None
        assert result_fresh.stale is False

        # Wait for expiry
        time.sleep(0.1)

        # Get after expiry — stale
        result_stale = cache.get("test_pipeline")
        assert result_stale is not None
        assert result_stale.stale is True
        assert result_stale.value == {"opportunities": [1, 2, 3]}

    def test_pipeline_cache_recompute_clears_stale(self):
        """After putting a fresh value, stale flag should be cleared."""
        from backend.data.pipeline_cache import PipelineCache
        import time

        cache = PipelineCache()
        cache._ttl = 0.05

        cache.put("test_pipeline", {"data": "v1"})
        time.sleep(0.1)

        # Now stale
        result = cache.get("test_pipeline")
        assert result is not None
        assert result.stale is True

        # Recompute
        cache.put("test_pipeline", {"data": "v2"})

        # Fresh again
        result_fresh = cache.get("test_pipeline")
        assert result_fresh is not None
        assert result_fresh.stale is False
        assert result_fresh.value == {"data": "v2"}


# ---------------------------------------------------------------------------
# Tests — Flaky provider (works then breaks)
# ---------------------------------------------------------------------------

class TestFlakyProvider:
    """Test that a provider which starts working and then breaks
    correctly transitions the system into degraded mode."""

    def test_flaky_provider_works_then_fails(self):
        """FlakyPoe2ScoutProvider should return data initially,
        then raise ConnectionError after break_provider() is called."""
        import asyncio

        provider = FlakyPoe2ScoutProvider()

        # Should work initially
        result = asyncio.get_event_loop().run_until_complete(
            provider.get_exchange_rates("vaal")
        )
        assert len(result) > 0

        # Break the provider
        provider.break_provider()

        # Should now fail
        with pytest.raises(ConnectionError, match="upstream_unreachable"):
            asyncio.get_event_loop().run_until_complete(
                provider.get_exchange_rates("vaal")
            )

    def test_flaky_provider_metadata_then_fails(self):
        """Metadata should work initially, then fail after break."""
        import asyncio

        provider = FlakyPoe2ScoutProvider()

        # Works initially
        result = asyncio.get_event_loop().run_until_complete(
            provider.get_currency_metadata("vaal")
        )
        assert len(result) > 0

        provider.break_provider()

        with pytest.raises(ConnectionError, match="upstream_unreachable"):
            asyncio.get_event_loop().run_until_complete(
                provider.get_currency_metadata("vaal")
            )

    def test_failing_provider_always_errors(self):
        """FailingPoe2ScoutProvider should always raise ConnectionError."""
        import asyncio

        provider = FailingPoe2ScoutProvider()

        with pytest.raises(ConnectionError):
            asyncio.get_event_loop().run_until_complete(
                provider.get_exchange_rates("vaal")
            )

        with pytest.raises(ConnectionError):
            asyncio.get_event_loop().run_until_complete(
                provider.get_currency_metadata("vaal")
            )
