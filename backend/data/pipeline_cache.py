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
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Any, Generic, TypeVar

from backend.config import AppConfig, get_settings

logger = logging.getLogger(__name__)

T = TypeVar("T")


@dataclass
class CachedPipelineResult(Generic[T]):
    """A cached pipeline computation result with metadata."""
    value: T
    computed_at: float  # monotonic timestamp
    stale: bool = False


class PipelineCache:
    """TTL cache for expensive pipeline computations.

    Unlike DataCache (which caches raw provider responses), this caches
    the output of multi-step pipeline functions like
    _build_flip_opportunities().

    Usage:
        cache = get_pipeline_cache()
        result = cache.get("flip_opportunities")
        if result is None:
            data = await _build_flip_opportunities(config)
            cache.put("flip_opportunities", data)
    """

    def __init__(self, config: AppConfig | None = None):
        self._config = config or get_settings()
        # TTL in seconds — same as prices cache since the pipeline output
        # depends on price data freshness.
        self._ttl = self._config.data.cache_ttl_prices_minutes * 60
        self._store: dict[str, CachedPipelineResult[Any]] = {}

    def get(self, key: str) -> CachedPipelineResult[Any] | None:
        """Return cached result if still within TTL, otherwise None."""
        entry = self._store.get(key)
        if entry is None:
            return None

        age = time.monotonic() - entry.computed_at
        if age < self._ttl:
            return entry

        # Expired — mark as stale (still returnable as fallback) and delete
        entry.stale = True
        del self._store[key]

        # Return stale entry so caller can decide to use it
        return entry

    def put(self, key: str, value: Any) -> None:
        """Store a pipeline result with current timestamp."""
        self._store[key] = CachedPipelineResult(
            value=value,
            computed_at=time.monotonic(),
            stale=False,
        )

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
