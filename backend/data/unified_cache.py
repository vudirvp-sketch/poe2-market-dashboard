"""
Unified backend cache — merges PipelineCache + DailyStatsCache.

Replaces the two separate cache modules (pipeline_cache.py and
daily_stats_cache.py) with a single UnifiedCache that shares one
LRU-ordered store and one stale-fallback store across all namespaces.

Architecture
------------
Two access patterns coexist:

1. **Sync get/put** (pipeline pattern):
   Callers check the cache, compute a result, and store it:
       entry = cache.get("flip_opportunities")
       if entry is None or entry.stale:
           data = await expensive_computation()
           cache.put("flip_opportunities", data)

2. **Async get_or_fetch** (daily stats pattern):
   The cache handles fetching and fallback transparently:
       result = await cache.get_or_fetch(fetch_fn, league, item_id, days)

Both patterns share the same underlying OrderedDict (LRU) + LRUDict
(stale fallback).  Namespace-scoped TTL and max_entries keep the
behaviour of the original separate caches.

Backward compatibility
----------------------
PipelineCache and DailyStatsCache are thin facades over UnifiedCache.
Old import paths (pipeline_cache.py, daily_stats_cache.py) still work
because those modules re-export from unified_cache.

Migration: pipeline_cache.py + daily_stats_cache.py → unified_cache.py
Phase 1.2 of REFACTOR_PLAN.
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Any, Callable, Coroutine, Generic, TypeVar

from backend.config import AppConfig, get_settings

logger = logging.getLogger(__name__)

T = TypeVar("T")


# ---------------------------------------------------------------------------
# Shared data structures
# ---------------------------------------------------------------------------

class LRUDict(OrderedDict):
    """Bounded dict with automatic LRU eviction when maxsize is exceeded."""

    def __init__(self, maxsize: int = 512):
        super().__init__()
        self._maxsize = maxsize

    def __setitem__(self, key: Any, value: Any) -> None:
        if key in self:
            self.move_to_end(key)
        super().__setitem__(key, value)
        if len(self) > self._maxsize:
            oldest = next(iter(self))
            del self[oldest]


@dataclass
class CachedEntry(Generic[T]):
    """A cached computation result with metadata.

    Replaces the old CachedPipelineResult — same fields, plus namespace.
    """
    value: T
    computed_at: float  # monotonic timestamp
    last_accessed_at: float = field(default=0.0)  # monotonic — for LRU
    stale: bool = False
    namespace: str = "pipeline"


# Backward-compatible alias
CachedPipelineResult = CachedEntry


@dataclass
class DailyStatsResult:
    """Wrapper that indicates whether the value is stale."""
    value: Any
    stale: bool = False


# ---------------------------------------------------------------------------
# Namespace defaults
# ---------------------------------------------------------------------------

DEFAULT_PIPELINE_MAX_ENTRIES = 64
DEFAULT_DAILY_STATS_MAX_ENTRIES = 256
DEFAULT_DAILY_STATS_TTL = 3600.0  # 1 hour
DEFAULT_STALE_STORE_MAXSIZE = 512


# ---------------------------------------------------------------------------
# UnifiedCache
# ---------------------------------------------------------------------------

class UnifiedCache:
    """Single TTL + LRU cache supporting both sync and async access patterns.

    All entries live in one OrderedDict (LRU-ordered) with namespace-scoped
    TTL and max_entries.  Expired entries are kept as stale fallback (Fix 4 /
    POE2-FIX-SPEC) and moved to a separate LRUDict when overwritten.

    Namespaces:
      - "pipeline":    TTL from config, max 64 entries
      - "daily_stats": TTL 3600s, max 256 entries

    Usage (sync — pipeline pattern):
        cache = get_unified_cache()
        entry = cache.get("flip_opportunities")
        if entry is None or entry.stale:
            data = await compute()
            cache.put("flip_opportunities", data)

    Usage (async — daily stats pattern):
        cache = get_unified_cache()
        result = await cache.get_or_fetch(fetch_fn, "runes", "divine", 30)
    """

    def __init__(self, config: AppConfig | None = None):
        self._config = config or get_settings()

        # Single LRU store for all namespaces
        self._store: OrderedDict[str, CachedEntry[Any]] = OrderedDict()

        # Stale fallback store (for daily_stats pattern)
        self._stale_store: LRUDict = LRUDict(maxsize=DEFAULT_STALE_STORE_MAXSIZE)

        # Namespace-specific configuration
        self._namespaces: dict[str, dict[str, Any]] = {
            "pipeline": {
                "ttl": self._config.data.cache_ttl_prices_minutes * 60,
                "max_entries": DEFAULT_PIPELINE_MAX_ENTRIES,
            },
            "daily_stats": {
                "ttl": DEFAULT_DAILY_STATS_TTL,
                "max_entries": DEFAULT_DAILY_STATS_MAX_ENTRIES,
            },
        }

    # -------------------------------------------------------------------
    # Internal helpers
    # -------------------------------------------------------------------

    def _make_key(self, key: str, namespace: str) -> str:
        """Namespaced key to avoid collisions between namespaces."""
        return f"{namespace}:{key}"

    @staticmethod
    def _make_daily_stats_key(league: str, item_id: str, days: int) -> str:
        """Deterministic cache key from (league, item_id, days)."""
        raw = json.dumps(
            {"league": league, "item_id": item_id, "days": days},
            sort_keys=True,
        )
        return hashlib.sha256(raw.encode()).hexdigest()[:32]

    def _namespace_config(self, namespace: str) -> dict[str, Any]:
        """Return config dict for a namespace, creating it if needed."""
        if namespace not in self._namespaces:
            # Default config for unknown namespaces
            self._namespaces[namespace] = {
                "ttl": 300.0,
                "max_entries": 64,
            }
        return self._namespaces[namespace]

    def _count_entries(self, namespace: str) -> int:
        """Count entries belonging to a specific namespace."""
        prefix = f"{namespace}:"
        return sum(1 for k in self._store if k.startswith(prefix))

    # -------------------------------------------------------------------
    # Sync access: get / put (pipeline pattern)
    # -------------------------------------------------------------------

    def get(self, key: str, namespace: str = "pipeline") -> CachedEntry[Any] | None:
        """Return cached result if still within TTL, otherwise mark as stale.

        Stale entries are kept as fallback (Fix 4 / POE2-FIX-SPEC) but
        moved to the end of the LRU order so they're evicted last if
        the caller decides to use them.
        """
        full_key = self._make_key(key, namespace)
        entry = self._store.get(full_key)
        if entry is None:
            return None

        # Update LRU: move to end (most recently accessed)
        self._store.move_to_end(full_key)
        entry.last_accessed_at = time.monotonic()

        ns_config = self._namespace_config(namespace)
        ttl = ns_config["ttl"]
        age = time.monotonic() - entry.computed_at
        if age <= ttl:
            return entry
        else:
            # DON'T delete — keep as stale fallback
            entry.stale = True
            logger.warning(
                "DEGRADED: %s cache stale for key=%s (age=%.0fs > ttl=%.0fs)",
                namespace, key, age, ttl,
            )
            return entry

    def put(self, key: str, value: Any, namespace: str = "pipeline") -> None:
        """Store a result with current timestamp.

        If the cache is at capacity for this namespace, evict the least
        recently accessed entry first. Expired/stale entries are evicted
        before active ones.
        """
        full_key = self._make_key(key, namespace)
        now = time.monotonic()

        # If key already exists, update in place and move to end
        if full_key in self._store:
            self._store.move_to_end(full_key)
            self._store[full_key] = CachedEntry(
                value=value,
                computed_at=now,
                last_accessed_at=now,
                stale=False,
                namespace=namespace,
            )
            # Also update stale store for daily_stats
            if namespace == "daily_stats":
                self._stale_store[full_key] = value
            return

        # Evict entries if at capacity
        self._evict_if_needed(namespace)

        self._store[full_key] = CachedEntry(
            value=value,
            computed_at=now,
            last_accessed_at=now,
            stale=False,
            namespace=namespace,
        )
        # Also update stale store for daily_stats
        if namespace == "daily_stats":
            self._stale_store[full_key] = value

    def _evict_if_needed(self, namespace: str) -> None:
        """Evict entries when a namespace exceeds its max_entries.

        Eviction priority:
          1. Expired/stale entries in this namespace (LRU order)
          2. Active entries in this namespace (LRU order)
        """
        ns_config = self._namespace_config(namespace)
        max_entries = ns_config["max_entries"]
        ttl = ns_config["ttl"]

        current_count = self._count_entries(namespace)
        if current_count < max_entries:
            return

        now = time.monotonic()
        prefix = f"{namespace}:"

        # First pass: evict expired/stale entries (LRU order)
        keys_to_evict: list[str] = []
        for k in list(self._store.keys()):
            if not k.startswith(prefix):
                continue
            entry = self._store[k]
            if entry.stale or (now - entry.computed_at > ttl):
                keys_to_evict.append(k)
                if current_count - len(keys_to_evict) < max_entries:
                    break

        for k in keys_to_evict:
            del self._store[k]

        # If still over capacity, evict LRU active entries
        while self._count_entries(namespace) >= max_entries:
            # Find the first entry in this namespace
            for k in list(self._store.keys()):
                if k.startswith(prefix):
                    entry = self._store[k]
                    logger.info(
                        "LRU evicting %s cache entry key=%s (age=%.0fs) — "
                        "cache at capacity",
                        namespace,
                        k[len(prefix):],  # strip namespace prefix for logging
                        now - entry.computed_at,
                    )
                    del self._store[k]
                    break
            else:
                break  # no entries in this namespace

    # -------------------------------------------------------------------
    # Async access: get_or_fetch (daily stats pattern)
    # -------------------------------------------------------------------

    async def get_or_fetch(
        self,
        fetch_fn: Callable[..., Coroutine[Any, Any, T]],
        league: str,
        item_id: str,
        days: int = 30,
    ) -> DailyStatsResult:
        """Get daily stats from cache or fetch from provider.

        On cache hit: return value with stale=False.
        On cache miss + successful fetch: store and return with stale=False.
        On cache miss + failed fetch: return stale value if available
        (stale=True), otherwise DailyStatsResult(value=None, stale=False).
        """
        ds_key = self._make_daily_stats_key(league, item_id, days)
        full_key = self._make_key(ds_key, "daily_stats")

        # Try cache hit — check TTL directly
        if full_key in self._store:
            entry = self._store[full_key]
            self._store.move_to_end(full_key)
            entry.last_accessed_at = time.monotonic()
            ttl = self._namespace_config("daily_stats")["ttl"]
            age = time.monotonic() - entry.computed_at
            if age <= ttl:
                return DailyStatsResult(value=entry.value, stale=False)
            # Expired — will try to re-fetch below

        # Cache miss — try fetching
        try:
            result = await fetch_fn(league, item_id, days)
            if result is not None:
                self.put(ds_key, result, namespace="daily_stats")
                return DailyStatsResult(value=result, stale=False)
        except Exception as e:
            logger.warning(
                "DailyStats fetch failed for %s/%s (%d days): %s",
                league, item_id, days, e,
            )

        # Fetch failed — try stale value from stale store
        if full_key in self._stale_store:
            logger.info(
                "Returning stale DailyStats for %s/%s", league, item_id,
            )
            return DailyStatsResult(value=self._stale_store[full_key], stale=True)

        # Also check main store for expired entries
        if full_key in self._store:
            entry = self._store[full_key]
            if entry.value is not None:
                logger.info(
                    "Returning expired DailyStats from main store for %s/%s",
                    league, item_id,
                )
                return DailyStatsResult(value=entry.value, stale=True)

        return DailyStatsResult(value=None, stale=False)

    # -------------------------------------------------------------------
    # Invalidation
    # -------------------------------------------------------------------

    def invalidate(self, key: str | None = None, namespace: str | None = None) -> None:
        """Invalidate a specific key, all keys in a namespace, or all keys.

        Args:
            key: Specific key to invalidate. If None, invalidate all in namespace.
            namespace: Namespace to invalidate. If None, invalidate all namespaces.
        """
        if key is not None and namespace is not None:
            # Invalidate a specific key in a specific namespace
            full_key = self._make_key(key, namespace)
            self._store.pop(full_key, None)
            self._stale_store.pop(full_key, None)
        elif key is None and namespace is not None:
            # Invalidate all keys in a specific namespace
            prefix = f"{namespace}:"
            keys_to_remove = [k for k in self._store if k.startswith(prefix)]
            for k in keys_to_remove:
                del self._store[k]
            # Also clear stale store entries for this namespace
            stale_keys = [k for k in self._stale_store if k.startswith(prefix)]
            for k in stale_keys:
                del self._stale_store[k]
        elif key is None and namespace is None:
            # Invalidate everything
            self._store.clear()
            self._stale_store.clear()
        else:
            # key specified but namespace is None — this is ambiguous
            # Search all namespaces for the key
            for ns in self._namespaces:
                full_key = self._make_key(key, ns)
                self._store.pop(full_key, None)
                self._stale_store.pop(full_key, None)

    # -------------------------------------------------------------------
    # Stats
    # -------------------------------------------------------------------

    def stats(self, namespace: str | None = None) -> dict[str, Any]:
        """Return cache statistics.

        If namespace is specified, returns stats for that namespace only.
        If namespace is None, returns combined stats for all namespaces.
        """
        if namespace is not None:
            return self._namespace_stats(namespace)
        return self._combined_stats()

    def _namespace_stats(self, namespace: str) -> dict[str, Any]:
        """Stats for a single namespace."""
        ns_config = self._namespace_config(namespace)
        ttl = ns_config["ttl"]
        max_entries = ns_config["max_entries"]
        prefix = f"{namespace}:"
        now = time.monotonic()

        active = 0
        expired = 0
        keys: list[str] = []

        for k, entry in self._store.items():
            if not k.startswith(prefix):
                continue
            # Strip namespace prefix for the keys list
            keys.append(k[len(prefix):])
            if now - entry.computed_at < ttl:
                active += 1
            else:
                expired += 1

        # Stale store count for this namespace
        stale_count = sum(1 for k in self._stale_store if k.startswith(prefix))

        if namespace == "pipeline":
            return {
                "keys": keys,
                "active_entries": active,
                "expired_entries": expired,
                "total_entries": active + expired,
                "max_entries": max_entries,
                "ttl_seconds": ttl,
            }
        else:
            # DailyStatsCache-style stats for backward compat
            return {
                "size": active + expired,
                "max": max_entries,
                "stale_entries": stale_count,
                "ttl_seconds": ttl,
            }

    def _combined_stats(self) -> dict[str, Any]:
        """Combined stats across all namespaces."""
        now = time.monotonic()
        total_active = 0
        total_expired = 0

        for ns_name, ns_config in self._namespaces.items():
            prefix = f"{ns_name}:"
            ttl = ns_config["ttl"]
            for k, entry in self._store.items():
                if not k.startswith(prefix):
                    continue
                if now - entry.computed_at < ttl:
                    total_active += 1
                else:
                    total_expired += 1

        return {
            "total_entries": len(self._store),
            "active_entries": total_active,
            "expired_entries": total_expired,
            "stale_store_entries": len(self._stale_store),
            "namespaces": {
                ns: self._namespace_stats(ns) for ns in self._namespaces
            },
        }


# ---------------------------------------------------------------------------
# Backward-compatible facades
# ---------------------------------------------------------------------------

class PipelineCache:
    """Facade over UnifiedCache for pipeline-specific operations.

    Provides the same interface as the old PipelineCache, delegating
    to a UnifiedCache instance with namespace="pipeline".

    When config is provided, a new UnifiedCache is created (for tests).
    When config is None, the global singleton is used (for production).
    """

    def __init__(self, config: AppConfig | None = None, max_entries: int = DEFAULT_PIPELINE_MAX_ENTRIES):
        if config is not None:
            # Test mode: create a fresh isolated UnifiedCache
            self._unified = UnifiedCache(config)
            self._unified._namespaces["pipeline"]["max_entries"] = max_entries
        else:
            # Production mode: use the global singleton
            self._unified = get_unified_cache(config)
            if max_entries != DEFAULT_PIPELINE_MAX_ENTRIES:
                self._unified._namespaces["pipeline"]["max_entries"] = max_entries

    @property
    def _store(self) -> OrderedDict[str, CachedEntry[Any]]:
        """Backward compatibility: direct access to underlying store.

        NOTE: This returns the full unified store (all namespaces).
        Use stats() for namespace-filtered counts.
        """
        return self._unified._store

    @property
    def _ttl(self) -> float:
        return self._unified._namespaces["pipeline"]["ttl"]

    @_ttl.setter
    def _ttl(self, value: float) -> None:
        self._unified._namespaces["pipeline"]["ttl"] = value

    def get(self, key: str) -> CachedEntry[Any] | None:
        """Return cached result if still within TTL, otherwise mark as stale."""
        return self._unified.get(key, namespace="pipeline")

    def put(self, key: str, value: Any) -> None:
        """Store a pipeline result with current timestamp."""
        self._unified.put(key, value, namespace="pipeline")

    def invalidate(self, key: str | None = None) -> None:
        """Invalidate a specific key, or all pipeline keys if None."""
        self._unified.invalidate(key=key, namespace="pipeline")

    def stats(self) -> dict[str, Any]:
        """Return pipeline cache statistics."""
        return self._unified.stats(namespace="pipeline")


class DailyStatsCache:
    """Facade over UnifiedCache for daily stats-specific operations.

    Provides the same interface as the old DailyStatsCache, delegating
    to a UnifiedCache instance with namespace="daily_stats".

    When config is provided, a new UnifiedCache is created (for tests).
    When config is None, the global singleton is used (for production).
    """

    def __init__(self, config: AppConfig | None = None):
        if config is not None:
            # Test mode: create a fresh isolated UnifiedCache
            self._unified = UnifiedCache(config)
        else:
            # Production mode: use the global singleton
            self._unified = get_unified_cache(config)

    @property
    def _cache(self):
        """Backward compatibility: access to the cachetools-like cache.

        NOTE: This is a compatibility shim. The actual storage is the
        unified OrderedDict. This property returns a namespace-filtered
        view proxy for test compatibility (cache._cache.clear() etc.).
        """
        return _DailyStatsCacheProxy(self._unified)

    @property
    def _stale_store(self) -> LRUDict:
        """Backward compatibility: direct access to stale store."""
        return self._unified._stale_store

    @property
    def _ttl(self) -> float:
        return self._unified._namespaces["daily_stats"]["ttl"]

    @_ttl.setter
    def _ttl(self, value: float) -> None:
        self._unified._namespaces["daily_stats"]["ttl"] = value

    @staticmethod
    def _make_key(league: str, item_id: str, days: int) -> str:
        """Deterministic cache key from (league, item_id, days)."""
        return UnifiedCache._make_daily_stats_key(league, item_id, days)

    async def get_or_fetch(
        self,
        fetch_fn: Callable[..., Coroutine[Any, Any, T]],
        league: str,
        item_id: str,
        days: int = 30,
    ) -> DailyStatsResult:
        """Get daily stats from cache or fetch from provider."""
        return await self._unified.get_or_fetch(fetch_fn, league, item_id, days)

    def invalidate(self) -> None:
        """Clear all cached daily stats."""
        self._unified.invalidate(namespace="daily_stats")

    def stats(self) -> dict[str, Any]:
        """Return daily stats cache statistics."""
        return self._unified.stats(namespace="daily_stats")


class _DailyStatsCacheProxy:
    """Compatibility proxy for tests that do cache._cache.clear().

    The old DailyStatsCache had a `cachetools.TTLCache` as `_cache`.
    Some tests call `cache._cache.clear()` to expire entries. This
    proxy provides a `.clear()` method that removes daily_stats
    entries from the unified store.
    """

    def __init__(self, unified: UnifiedCache):
        self._unified = unified

    @property
    def maxsize(self) -> int:
        return self._unified._namespaces["daily_stats"]["max_entries"]

    def clear(self) -> None:
        """Remove all daily_stats entries from the main store (not stale store).

        This simulates TTLCache.clear() which was used in tests to
        force cache misses without losing stale data.
        """
        prefix = "daily_stats:"
        keys_to_remove = [k for k in self._unified._store if k.startswith(prefix)]
        for k in keys_to_remove:
            del self._unified._store[k]

    def __contains__(self, key: str) -> bool:
        full_key = f"daily_stats:{key}"
        return full_key in self._unified._store

    def __len__(self) -> int:
        prefix = "daily_stats:"
        return sum(1 for k in self._unified._store if k.startswith(prefix))


# ---------------------------------------------------------------------------
# Singletons
# ---------------------------------------------------------------------------

_unified_instance: UnifiedCache | None = None


def get_unified_cache(config: AppConfig | None = None) -> UnifiedCache:
    """Return the global UnifiedCache instance (lazily created)."""
    global _unified_instance
    if _unified_instance is None:
        _unified_instance = UnifiedCache(config)
    return _unified_instance


_pipeline_cache_instance: PipelineCache | None = None


def get_pipeline_cache(config: AppConfig | None = None) -> PipelineCache:
    """Return the global PipelineCache facade (lazily created).

    Backward-compatible with the old get_pipeline_cache() function.
    """
    global _pipeline_cache_instance
    if _pipeline_cache_instance is None:
        _pipeline_cache_instance = PipelineCache(config)
    return _pipeline_cache_instance


_daily_stats_cache_instance: DailyStatsCache | None = None


def get_daily_stats_cache(config: AppConfig | None = None) -> DailyStatsCache:
    """Return the global DailyStatsCache facade (lazily created).

    Backward-compatible with the old get_daily_stats_cache() function.
    """
    global _daily_stats_cache_instance
    if _daily_stats_cache_instance is None:
        _daily_stats_cache_instance = DailyStatsCache(config)
    return _daily_stats_cache_instance
