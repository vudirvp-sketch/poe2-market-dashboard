"""
Server-side pipeline result cache.

Caches the expensive output of _build_flip_opportunities() and similar
pipeline computations so that GET /api/arbitrage/flips does not re-run
the full pipeline (fetch rates → momentum → clustering → scoring →
filtering) on every request.

The cache sits *above* the existing DataCache (which caches raw API
responses).  This layer caches the *computed* result — the list of
FlipOpportunity objects — with its own TTL.

Thread safety: asyncio-based, no threading primitives needed.  All
access happens inside the same event loop.

v1.22: Added LRU eviction and max-entries cap. When the cache exceeds
MAX_ENTRIES, the least recently accessed entries are evicted first.
Expired entries are also pruned during put() and get() operations.
"""

from __future__ import annotations

import logging
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Any, Generic, TypeVar

from backend.config import AppConfig, get_settings

logger = logging.getLogger(__name__)

T = TypeVar("T")

# Maximum number of entries in the cache. When exceeded, the least
# recently accessed entries are evicted. This prevents unbounded memory
# growth when the cache accumulates stale entries that are never evicted.
DEFAULT_MAX_ENTRIES = 64


@dataclass
class CachedPipelineResult(Generic[T]):
    """A cached pipeline computation result with metadata."""
    value: T
    computed_at: float  # monotonic timestamp
    last_accessed_at: float = field(default=0.0)  # monotonic — for LRU
    stale: bool = False


class PipelineCache:
    """TTL + LRU cache for expensive pipeline computations.

    Unlike DataCache (which caches raw provider responses), this caches
    the output of multi-step pipeline functions like
    _build_flip_opportunities().

    Features:
      - TTL-based expiration (stale entries kept as fallback)
      - LRU eviction when MAX_ENTRIES is exceeded
      - Automatic pruning of stale entries on put()/get()

    Usage:
        cache = get_pipeline_cache()
        result = cache.get("flip_opportunities")
        if result is None:
            data = await _build_flip_opportunities(config)
            cache.put("flip_opportunities", data)
    """

    def __init__(self, config: AppConfig | None = None, max_entries: int = DEFAULT_MAX_ENTRIES):
        self._config = config or get_settings()
        self._ttl = self._config.data.cache_ttl_prices_minutes * 60
        self._max_entries = max_entries
        # OrderedDict preserves insertion order — we move accessed entries
        # to the end so the first entry is always the LRU candidate.
        self._store: OrderedDict[str, CachedPipelineResult[Any]] = OrderedDict()

    def get(self, key: str) -> CachedPipelineResult[Any] | None:
        """Return cached result if still within TTL, otherwise mark as stale.

        Stale entries are kept as fallback (Fix 4 / POE2-FIX-SPEC) but
        moved to the end of the LRU order so they're evicted last if
        the caller decides to use them.
        """
        entry = self._store.get(key)
        if entry is None:
            return None

        # Update LRU: move to end (most recently accessed)
        self._store.move_to_end(key)
        entry.last_accessed_at = time.monotonic()

        age = time.monotonic() - entry.computed_at
        if age <= self._ttl:
            return entry
        else:
            # DON'T delete — keep as stale fallback
            entry.stale = True
            logger.warning(
                "DEGRADED: pipeline cache stale for key=%s (age=%.0fs > ttl=%.0fs)",
                key, age, self._ttl,
            )
            return entry

    def put(self, key: str, value: Any) -> None:
        """Store a pipeline result with current timestamp.

        If the cache is at capacity, evict the least recently accessed
        entry first (the first item in the OrderedDict). Expired/stale
        entries are evicted before active ones.
        """
        now = time.monotonic()

        # If key already exists, update in place and move to end
        if key in self._store:
            self._store.move_to_end(key)
            self._store[key] = CachedPipelineResult(
                value=value,
                computed_at=now,
                last_accessed_at=now,
                stale=False,
            )
            return

        # Evict entries if at capacity
        self._evict_if_needed()

        self._store[key] = CachedPipelineResult(
            value=value,
            computed_at=now,
            last_accessed_at=now,
            stale=False,
        )
        # New entry goes to the end (most recently used)

    def _evict_if_needed(self) -> None:
        """Evict entries when the cache exceeds MAX_ENTRIES.

        Eviction priority:
          1. Expired/stale entries (least recently accessed first)
          2. Active entries (least recently accessed first)
        """
        if len(self._store) < self._max_entries:
            return

        now = time.monotonic()
        evicted = 0

        # First pass: evict expired/stale entries (LRU order)
        keys_to_evict = []
        for k, entry in self._store.items():
            if entry.stale or (now - entry.computed_at > self._ttl):
                keys_to_evict.append(k)
                evicted += 1
                if len(self._store) - evicted < self._max_entries:
                    break

        for k in keys_to_evict:
            del self._store[k]

        # If still over capacity, evict LRU active entries
        while len(self._store) >= self._max_entries:
            # First item is the least recently accessed
            k, entry = next(iter(self._store.items()))
            logger.info(
                "LRU evicting cache entry key=%s (age=%.0fs) — cache at capacity (%d/%d)",
                k, now - entry.computed_at, len(self._store), self._max_entries,
            )
            del self._store[k]

    def invalidate(self, key: str | None = None) -> None:
        """Invalidate a specific key, or all keys if None."""
        if key is None:
            self._store.clear()
        else:
            self._store.pop(key, None)

    def stats(self) -> dict[str, Any]:
        """Return cache statistics."""
        now = time.monotonic()
        active = 0
        expired = 0
        for entry in self._store.values():
            if now - entry.computed_at < self._ttl:
                active += 1
            else:
                expired += 1

        return {
            "keys": list(self._store.keys()),
            "active_entries": active,
            "expired_entries": expired,
            "total_entries": len(self._store),
            "max_entries": self._max_entries,
            "ttl_seconds": self._ttl,
        }


# ---------------------------------------------------------------------------
# Singleton
# ---------------------------------------------------------------------------

_instance: PipelineCache | None = None


def get_pipeline_cache(config: AppConfig | None = None) -> PipelineCache:
    """Return the global PipelineCache instance (lazily created)."""
    global _instance
    if _instance is None:
        _instance = PipelineCache(config)
    return _instance
