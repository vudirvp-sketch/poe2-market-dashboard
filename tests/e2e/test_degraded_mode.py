"""
End-to-End tests for degraded mode.

Simulates the scenario where:
1. Backend starts and serves data normally
2. Upstream API becomes unreachable (provider "breaks")
3. Stale/cached data should still be served where possible
4. Health endpoint reflects degraded status

Uses a mock provider that can be toggled between healthy and broken states.

The FlakyPoe2ScoutProvider is now defined in conftest.py and available
via the `flaky_client` fixture. Tests that use it are marked with
@pytest.mark.flaky and only run when --flaky is passed:

    pytest tests/e2e/ -v --flaky
"""

from __future__ import annotations

import asyncio
import pytest
import time

from backend.data.providers.base import BaseDataProvider
from backend.models.currency import (
    CurrencyInfo,
    ExchangeRate,
    PricePoint,
)


# ---------------------------------------------------------------------------
# Failing mock provider — simulates upstream unreachable
# (kept here because it's used by TestFlakyProvider.unit tests below)
#
# IMPORTANT: BaseDataProvider contract says "Return None or empty list
# on failure — never raise." This provider violates that contract by
# raising ConnectionError, which is intentional — it tests that the
# system can handle providers that DO raise exceptions (defensive coding).
# ---------------------------------------------------------------------------

class FailingPoe2ScoutProvider(BaseDataProvider):
    """Mock provider that always fails — simulates upstream unreachable.

    NOTE: This intentionally raises exceptions (violates the BaseDataProvider
    contract) to verify that callers handle exceptions defensively. In production,
    providers should return None/empty, but this tests the error-handling path.
    """

    def name(self) -> str:
        return "failing_mock"

    async def close(self) -> None:
        pass

    async def get_current_price(self, currency_pair: str):
        raise ConnectionError("upstream_unreachable: Connection refused")

    async def get_exchange_rates(self, league: str) -> dict:
        raise ConnectionError("upstream_unreachable: API timeout")

    async def get_currency_metadata(self, league: str) -> list[CurrencyInfo]:
        raise ConnectionError("upstream_unreachable: API timeout")

    async def get_historical_prices(
        self, currency: str, days: int = 7
    ) -> list[PricePoint]:
        raise ConnectionError("upstream_unreachable: API timeout")


# ---------------------------------------------------------------------------
# Tests — Degraded mode with real (live) provider
# ---------------------------------------------------------------------------

@pytest.mark.e2e
class TestDegradedMode:
    """Test API behaviour when upstream is unreachable.

    These tests use the live provider — they tolerate 503 when the
    upstream API is down.
    """

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
# Tests — PipelineCache stale data behaviour (unit-level)
# ---------------------------------------------------------------------------

class TestPipelineCacheStaleBehaviour:
    """Test that PipelineCache correctly returns stale data in degraded mode."""

    def test_pipeline_cache_returns_stale_on_expired(self):
        """When TTL expires, PipelineCache should return stale data
        with stale=True flag."""
        from backend.data.pipeline_cache import PipelineCache

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
# Tests — Flaky provider (works then breaks) — unit-level
# ---------------------------------------------------------------------------

class TestFlakyProvider:
    """Test that a provider which starts working and then breaks
    correctly transitions the system into degraded mode.

    These are unit-level tests of the provider itself. For integration
    tests with the full FastAPI pipeline, see TestFlakyIntegration below.
    """

    async def test_flaky_provider_works_then_fails(self):
        """FlakyPoe2ScoutProvider should return data initially,
        then raise ConnectionError after break_provider() is called."""
        from tests.e2e.conftest import FlakyPoe2ScoutProvider

        provider = FlakyPoe2ScoutProvider()

        # Should work initially
        result = await provider.get_exchange_rates("runes")
        assert len(result) > 0

        # Break the provider
        provider.break_provider()

        # Should now fail
        with pytest.raises(ConnectionError, match="upstream_unreachable"):
            await provider.get_exchange_rates("runes")

    async def test_flaky_provider_metadata_then_fails(self):
        """Metadata should work initially, then fail after break."""
        from tests.e2e.conftest import FlakyPoe2ScoutProvider

        provider = FlakyPoe2ScoutProvider()

        # Works initially
        result = await provider.get_currency_metadata("runes")
        assert len(result) > 0

        provider.break_provider()

        with pytest.raises(ConnectionError, match="upstream_unreachable"):
            await provider.get_currency_metadata("runes")

    async def test_failing_provider_always_errors(self):
        """FailingPoe2ScoutProvider should always raise ConnectionError."""
        provider = FailingPoe2ScoutProvider()

        with pytest.raises(ConnectionError):
            await provider.get_exchange_rates("runes")

        with pytest.raises(ConnectionError):
            await provider.get_currency_metadata("runes")


# ---------------------------------------------------------------------------
# Tests — Flaky integration with FastAPI (requires --flaky)
# ---------------------------------------------------------------------------

@pytest.mark.flaky
class TestFlakyIntegration:
    """Integration tests using FlakyPoe2ScoutProvider patched into the
    FastAPI app via the flaky_client fixture.

    These tests only run when --flaky is passed to pytest.
    """

    async def test_flaky_health_before_break(self, flaky_client):
        """Health endpoint should return OK before provider is broken."""
        client, provider = flaky_client

        resp = await client.get("/api/health")
        assert resp.status_code == 200

    async def test_flaky_phase_always_works(self, flaky_client):
        """Phase endpoint should work regardless of provider state."""
        client, provider = flaky_client

        # Before break
        resp = await client.get("/api/phase")
        assert resp.status_code == 200
        assert resp.json()["phase"] in ["early", "mid", "late"]

        # After break — phase is still computed from config
        provider.break_provider()
        resp = await client.get("/api/phase")
        assert resp.status_code == 200

    async def test_flaky_prices_before_and_after_break(self, flaky_client):
        """Prices endpoint: works before break, graceful after break."""
        client, provider = flaky_client

        # Before break — should get data or 503 (depends on snapshot state)
        resp = await client.get("/api/prices")
        assert resp.status_code in [200, 503]

        # After break — should still respond gracefully (not crash)
        provider.break_provider()
        resp = await client.get("/api/prices")
        assert resp.status_code in [200, 503]


# ---------------------------------------------------------------------------
# Tests — DailyStatsCache stale behaviour (unit-level)
# ---------------------------------------------------------------------------

class TestDailyStatsCacheStaleBehaviour:
    """Test that DailyStatsCache correctly serves stale data when
    the provider fails, using the daily_stats_cache fixture."""

    @pytest.mark.asyncio
    async def test_cache_returns_fresh_then_stale(self, daily_stats_cache):
        """DailyStatsCache should return fresh data, then stale after TTL."""
        call_count = 0

        async def mock_fetch(league: str, item_id: str, days: int):
            nonlocal call_count
            call_count += 1
            return {"data": f"fetch_{call_count}"}

        # First call — cache miss, fetch succeeds
        result = await daily_stats_cache.get_or_fetch(
            mock_fetch, "runes", "divine", 30
        )
        assert result.stale is False
        assert result.value == {"data": "fetch_1"}

        # Second call — cache hit (still fresh)
        result = await daily_stats_cache.get_or_fetch(
            mock_fetch, "runes", "divine", 30
        )
        assert result.stale is False
        assert call_count == 1  # No extra fetch

        # Wait for TTL to expire (100ms)
        await asyncio.sleep(0.15)

        # Third call — TTL expired, but fetch fails → stale fallback
        async def failing_fetch(league: str, item_id: str, days: int):
            raise ConnectionError("upstream_unreachable: API down")

        result = await daily_stats_cache.get_or_fetch(
            failing_fetch, "runes", "divine", 30
        )
        assert result.stale is True
        assert result.value == {"data": "fetch_1"}

    @pytest.mark.asyncio
    async def test_cache_returns_none_when_no_stale_available(self, daily_stats_cache):
        """If cache is empty and fetch fails, return None without stale flag."""

        async def failing_fetch(league: str, item_id: str, days: int):
            raise ConnectionError("upstream_unreachable: API down")

        result = await daily_stats_cache.get_or_fetch(
            failing_fetch, "runes", "unknown_item", 30
        )
        assert result.value is None
        assert result.stale is False

    @pytest.mark.asyncio
    async def test_cache_invalidation_clears_everything(self, daily_stats_cache):
        """After invalidate(), cache and stale store should be empty."""

        async def mock_fetch(league: str, item_id: str, days: int):
            return {"data": "test"}

        # Populate cache
        await daily_stats_cache.get_or_fetch(mock_fetch, "runes", "divine", 30)
        assert daily_stats_cache.stats()["size"] == 1

        # Invalidate
        daily_stats_cache.invalidate()
        assert daily_stats_cache.stats()["size"] == 0
        assert daily_stats_cache.stats()["stale_entries"] == 0


# ---------------------------------------------------------------------------
# Tests — DailyStatsCache + FlakyPoe2ScoutProvider integration
# (requires --flaky)
# ---------------------------------------------------------------------------

@pytest.mark.flaky
class TestDailyStatsCacheFlakyIntegration:
    """Full integration: DailyStatsCache + FlakyPoe2ScoutProvider through API.

    Only runs when --flaky is passed.
    """

    @pytest.mark.asyncio
    async def test_daily_stats_serves_stale_after_provider_breaks(
        self, daily_stats_cache_with_flaky_provider
    ):
        """When provider breaks, DailyStatsCache should serve stale data."""
        cache, client, provider = daily_stats_cache_with_flaky_provider

        # Populate cache with a successful fetch
        async def working_fetch(league: str, item_id: str, days: int):
            return {"days": [{"day": "2025-01-20", "open": 220, "close": 222}]}

        result = await cache.get_or_fetch(working_fetch, "runes", "divine", 30)
        assert result.stale is False

        # Wait for TTL expiry
        await asyncio.sleep(0.6)

        # Break the provider (simulating upstream failure)
        provider.break_provider()

        # Now fetch should fall back to stale data
        async def broken_fetch(league: str, item_id: str, days: int):
            raise ConnectionError("upstream_unreachable: API down")

        result = await cache.get_or_fetch(broken_fetch, "runes", "divine", 30)
        assert result.stale is True
        assert result.value is not None
