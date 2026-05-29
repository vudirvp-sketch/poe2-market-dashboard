"""
In-memory LRU cache with TTL, using cachetools.TTLCache.

Cache key = (provider_name, method_name, args_hash)
- Current prices: TTL = 5 minutes (configurable)
- Historical snapshots: TTL = 24 hours
- Metadata: TTL = 1 hour
- Daily stats (OHLCV): TTL = 1 hour

On cache miss: fetch from provider, store, return.
On provider failure: return stale cached value if available (with stale=True flag).
"""

from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass
from typing import Any, Callable, Coroutine, TypeVar

from cachetools import TTLCache

from backend.config import AppConfig, get_settings

logger = logging.getLogger(__name__)

T = TypeVar("T")


@dataclass
class CacheResult:
    """Wrapper that indicates whether the value is stale."""
    value: Any
    stale: bool = False


class DataCache:
    """Four-tier TTL cache for data provider results."""

    def __init__(self, config: AppConfig | None = None):
        self._config = config or get_settings()

        prices_ttl = self._config.data.cache_ttl_prices_minutes * 60  # seconds
        history_ttl = self._config.data.cache_ttl_history_hours * 3600  # seconds
        metadata_ttl = self._config.data.cache_ttl_metadata_hours * 3600  # seconds

        # Daily stats cache: 1 hour TTL — daily OHLCV data changes once per day,
        # but a shorter TTL than 24h ensures forecasts react to fresh data.
        daily_stats_ttl = 3600  # 1 hour in seconds

        # Max size is generous — we want LRU eviction, not size rejection
        self._prices_cache: TTLCache = TTLCache(maxsize=512, ttl=prices_ttl)
        self._history_cache: TTLCache = TTLCache(maxsize=256, ttl=history_ttl)
        self._metadata_cache: TTLCache = TTLCache(maxsize=256, ttl=metadata_ttl)
        self._daily_stats_cache: TTLCache = TTLCache(maxsize=256, ttl=daily_stats_ttl)

        # Stale store: keeps the last known value even after TTL expires
        self._stale_store: dict[str, Any] = {}

    @staticmethod
    def _make_key(provider_name: str, method: str, *args, **kwargs) -> str:
        """Create a deterministic cache key from provider, method, and args."""
        raw = json.dumps(
            {"provider": provider_name, "method": method,
             "args": [str(a) for a in args], "kwargs": {k: str(v) for k, v in kwargs.items()}},
            sort_keys=True,
        )
        return hashlib.sha256(raw.encode()).hexdigest()[:32]

    def _select_cache(self, cache_type: str) -> TTLCache:
        if cache_type == "prices":
            return self._prices_cache
        elif cache_type == "history":
            return self._history_cache
        elif cache_type == "metadata":
            return self._metadata_cache
        elif cache_type == "daily_stats":
            return self._daily_stats_cache
        else:
            raise ValueError(f"Unknown cache type: {cache_type}")

    async def get_or_fetch(
        self,
        cache_type: str,
        provider_name: str,
        method: str,
        fetch_fn: Callable[..., Coroutine[Any, Any, T]],
        *args,
        **kwargs,
    ) -> CacheResult:
        """Get from cache or fetch from provider.

        On cache hit: return value with stale=False.
        On cache miss + successful fetch: store and return with stale=False.
        On cache miss + failed fetch: return stale value if available (stale=True),
        otherwise return CacheResult(value=None, stale=False).
        """
        key = self._make_key(provider_name, method, *args, **kwargs)
        cache = self._select_cache(cache_type)

        # Try cache hit
        if key in cache:
            return CacheResult(value=cache[key], stale=False)

        # Cache miss — try fetching
        try:
            result = await fetch_fn(*args, **kwargs)
            if result is not None:
                cache[key] = result
                self._stale_store[key] = result  # keep for stale fallback
                return CacheResult(value=result, stale=False)
        except Exception as e:
            logger.warning("Fetch failed for %s/%s: %s", provider_name, method, e)

        # Fetch failed — try stale value
        if key in self._stale_store:
            logger.info("Returning stale value for %s/%s", provider_name, method)
            return CacheResult(value=self._stale_store[key], stale=True)

        return CacheResult(value=None, stale=False)

    def invalidate(self, cache_type: str | None = None):
        """Clear cache. If cache_type is None, clear all caches."""
        if cache_type is None:
            self._prices_cache.clear()
            self._history_cache.clear()
            self._metadata_cache.clear()
            self._daily_stats_cache.clear()
            self._stale_store.clear()
        else:
            self._select_cache(cache_type).clear()

    def stats(self) -> dict[str, dict]:
        """Return cache statistics."""
        return {
            "prices": {"size": len(self._prices_cache), "max": self._prices_cache.maxsize},
            "history": {"size": len(self._history_cache), "max": self._history_cache.maxsize},
            "metadata": {"size": len(self._metadata_cache), "max": self._metadata_cache.maxsize},
            "daily_stats": {"size": len(self._daily_stats_cache), "max": self._daily_stats_cache.maxsize},
            "stale_entries": len(self._stale_store),
        }


# ---------------------------------------------------------------------------
# Singleton
# ---------------------------------------------------------------------------

_instance: DataCache | None = None


def get_cache(config: AppConfig | None = None) -> DataCache:
    """Return the global DataCache instance (lazily created)."""
    global _instance
    if _instance is None:
        _instance = DataCache(config)
    return _instance
