"""
Integration tests for PipelineCache degraded mode.

Verifies that:
1. PipelineCache returns fresh data when within TTL
2. PipelineCache marks entries as stale when TTL expires
3. PipelineCache logs DEGRADED warning when returning stale data
4. Stale data is preserved (not deleted) so callers can use it as fallback
5. PipelineCache correctly transitions fresh → stale → fresh after recompute
"""

from __future__ import annotations

import logging
import time

import pytest

from backend.data.daily_stats_cache import DailyStatsCache
from backend.data.pipeline_cache import PipelineCache, get_pipeline_cache
from backend.config import AppConfig, DataConfig


class TestPipelineCacheDegraded:
    """Test PipelineCache behaviour in degraded (stale) mode."""

    def _make_cache(self, ttl_minutes: float = 0.001) -> PipelineCache:
        """Create a PipelineCache with a very short TTL for testing.

        Default TTL is ~0.06s so entries expire almost immediately,
        letting us test stale fallback without long waits.
        """
        config = AppConfig(data=DataConfig(cache_ttl_prices_minutes=ttl_minutes))
        return PipelineCache(config)

    def test_fresh_entry_not_stale(self):
        """A freshly stored entry should not be marked as stale."""
        cache = self._make_cache(ttl_minutes=60)
        cache.put("test_key", {"price": 220.0})

        result = cache.get("test_key")
        assert result is not None
        assert result.stale is False
        assert result.value == {"price": 220.0}

    def test_expired_entry_marked_stale(self):
        """An expired entry should be marked as stale, not deleted."""
        cache = self._make_cache(ttl_minutes=0.001)  # ~0.06s TTL
        cache.put("test_key", {"price": 220.0})

        # Wait for TTL to expire
        time.sleep(0.1)

        result = cache.get("test_key")
        assert result is not None
        assert result.stale is True
        assert result.value == {"price": 220.0}

    def test_degraded_logs_warning(self, caplog):
        """Returning stale data should emit a DEGRADED log warning."""
        cache = self._make_cache(ttl_minutes=0.001)
        cache.put("flip_opportunities", [{"currency": "divine", "score": 0.8}])

        # Wait for TTL to expire
        time.sleep(0.1)

        with caplog.at_level(logging.WARNING, logger="backend.data.pipeline_cache"):
            result = cache.get("flip_opportunities")

        assert result is not None
        assert result.stale is True

        # Check that DEGRADED warning was logged
        degraded_logs = [
            r for r in caplog.records
            if "DEGRADED" in r.message
        ]
        assert len(degraded_logs) >= 1
        assert "flip_opportunities" in degraded_logs[0].message

    def test_stale_entry_preserved_not_deleted(self):
        """After marking an entry as stale, it should still be accessible
        on subsequent get() calls (not garbage collected)."""
        cache = self._make_cache(ttl_minutes=0.001)
        cache.put("test_key", {"price": 220.0})

        time.sleep(0.1)

        # First get — marks as stale
        result1 = cache.get("test_key")
        assert result1 is not None
        assert result1.stale is True

        # Second get — should still return stale value
        result2 = cache.get("test_key")
        assert result2 is not None
        assert result2.stale is True
        assert result2.value == {"price": 220.0}

    def test_fresh_after_recompute(self):
        """After putting a new value, the entry should be fresh again."""
        cache = self._make_cache(ttl_minutes=0.001)
        cache.put("test_key", {"price": 220.0})

        time.sleep(0.1)

        # Entry is now stale
        result_stale = cache.get("test_key")
        assert result_stale is not None
        assert result_stale.stale is True

        # Recompute and store fresh value
        cache.put("test_key", {"price": 225.0})

        # Should be fresh now
        result_fresh = cache.get("test_key")
        assert result_fresh is not None
        assert result_fresh.stale is False
        assert result_fresh.value == {"price": 225.0}

    def test_missing_key_returns_none(self):
        """Getting a key that was never stored should return None."""
        cache = self._make_cache(ttl_minutes=60)
        result = cache.get("nonexistent_key")
        assert result is None

    def test_invalidate_specific_key(self):
        """Invalidating a specific key should remove it entirely
        (no stale fallback either)."""
        cache = self._make_cache(ttl_minutes=60)
        cache.put("key_a", {"price": 1.0})
        cache.put("key_b", {"price": 2.0})

        cache.invalidate("key_a")

        assert cache.get("key_a") is None
        assert cache.get("key_b") is not None

    def test_invalidate_all_keys(self):
        """Invalidating with key=None should clear all entries."""
        cache = self._make_cache(ttl_minutes=60)
        cache.put("key_a", {"price": 1.0})
        cache.put("key_b", {"price": 2.0})

        cache.invalidate()

        assert cache.get("key_a") is None
        assert cache.get("key_b") is None

    def test_stats_reflects_expired_entries(self):
        """Cache stats should report both active and expired entries."""
        cache = self._make_cache(ttl_minutes=0.001)
        cache.put("key_a", {"price": 1.0})
        cache.put("key_b", {"price": 2.0})

        time.sleep(0.1)

        stats = cache.stats()
        assert stats["expired_entries"] == 2
        assert stats["active_entries"] == 0

    def test_degraded_warning_includes_key_name(self, caplog):
        """The DEGRADED log should include the cache key name for debugging."""
        cache = self._make_cache(ttl_minutes=0.001)
        cache.put("my_important_pipeline", [1, 2, 3])

        time.sleep(0.1)

        with caplog.at_level(logging.WARNING, logger="backend.data.pipeline_cache"):
            cache.get("my_important_pipeline")

        degraded_logs = [
            r for r in caplog.records
            if "DEGRADED" in r.message
        ]
        assert len(degraded_logs) == 1
        assert "my_important_pipeline" in degraded_logs[0].message

    def test_degraded_warning_includes_age_and_ttl(self, caplog):
        """The DEGRADED log should include the age and TTL for diagnostics."""
        cache = self._make_cache(ttl_minutes=0.001)
        cache.put("test_key", {"data": True})

        time.sleep(0.1)

        with caplog.at_level(logging.WARNING, logger="backend.data.pipeline_cache"):
            cache.get("test_key")

        degraded_logs = [
            r for r in caplog.records
            if "DEGRADED" in r.message
        ]
        assert len(degraded_logs) == 1
        # Should contain age and TTL info
        msg = degraded_logs[0].message
        assert "age=" in msg
        assert "ttl=" in msg


class TestDailyStatsCacheDegraded:
    """Test DailyStatsCache stale fallback in degraded scenarios."""

    @pytest.mark.asyncio
    async def test_stale_fallback_on_fetch_failure(self):
        """When the provider fails after a successful first call,
        the stale value from the first call should be returned."""
        cache = DailyStatsCache(config=AppConfig())
        call_count = 0

        async def fetch_fn(league, item_id, days):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return {"DailyStats": [{"Time": "2026-05-01", "Close": 220.0}]}
            raise ConnectionError("Upstream API unreachable")

        # First call succeeds
        result1 = await cache.get_or_fetch(fetch_fn, "runes", "divine", 30)
        assert result1.value is not None
        assert result1.stale is False

        # Manually expire cache to force re-fetch
        cache._cache.clear()

        # Second call fails — should get stale value
        result2 = await cache.get_or_fetch(fetch_fn, "runes", "divine", 30)
        assert result2.value is not None
        assert result2.stale is True

    @pytest.mark.asyncio
    async def test_no_stale_on_first_failure(self):
        """If the very first fetch fails, there should be no stale data
        to fall back to — result should be (value=None, stale=False)."""
        cache = DailyStatsCache(config=AppConfig())

        async def fetch_fn(league, item_id, days):
            raise ConnectionError("Upstream API unreachable")

        result = await cache.get_or_fetch(fetch_fn, "runes", "divine", 30)
        assert result.value is None
        assert result.stale is False

    @pytest.mark.asyncio
    async def test_stale_preserved_across_multiple_failures(self):
        """Stale data should persist even through multiple consecutive failures."""
        cache = DailyStatsCache(config=AppConfig())
        call_count = 0

        async def fetch_fn(league, item_id, days):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return {"DailyStats": [{"Time": "2026-05-01", "Close": 220.0}]}
            raise ConnectionError("API still down")

        # First call succeeds
        await cache.get_or_fetch(fetch_fn, "runes", "divine", 30)

        # Clear cache to force re-fetch
        cache._cache.clear()

        # Multiple failures — stale should still be available
        for _ in range(3):
            result = await cache.get_or_fetch(fetch_fn, "runes", "divine", 30)
            assert result.value is not None
            assert result.stale is True
