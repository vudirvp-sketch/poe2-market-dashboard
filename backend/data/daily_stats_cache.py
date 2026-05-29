"""
Lightweight TTL cache specifically for DailyStatsHistory data.

This module replaces the ``daily_stats`` tier in the legacy DataCache
(``backend/data/cache.py``).  DailyStats is the only remaining consumer
of that cache — all other tiers (prices, metadata, history) have been
migrated to DataSnapshot.

By isolating DailyStats into its own module we can safely delete
``cache.py`` without losing the caching behaviour for forecast and
WebSocket routes that rely on daily OHLCV data.

Design choices:
  - Uses ``cachetools.TTLCache`` (same as the old DataCache).
  - Key = ``(league, item_id, days)`` tuple hash — deterministic.
  - Stale fallback: if a fresh fetch fails, the last known value is
    returned with ``stale=True`` so callers can decide what to do.
  - Single responsibility: only caches DailyStats, nothing else.
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
class DailyStatsResult:
    """Wrapper that indicates whether the value is stale."""
    value: Any
    stale: bool = False


class DailyStatsCache:
    """TTL cache for daily OHLCV (DailyStatsHistory) data.

    TTL defaults to 1 hour (daily stats change once per day, but a
    shorter TTL than 24 h ensures forecasts react to fresh data).
    """

    def __init__(self, config: AppConfig | None = None):
        self._config = config or get_settings()
        self._ttl: float = 3600  # 1 hour in seconds
        self._cache: TTLCache = TTLCache(maxsize=256, ttl=self._ttl)
        self._stale_store: dict[str, Any] = {}

    @staticmethod
    def _make_key(league: str, item_id: str, days: int) -> str:
        """Deterministic cache key from (league, item_id, days)."""
        raw = json.dumps(
            {"league": league, "item_id": item_id, "days": days},
            sort_keys=True,
        )
        return hashlib.sha256(raw.encode()).hexdigest()[:32]

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
        key = self._make_key(league, item_id, days)

        # Try cache hit
        if key in self._cache:
            return DailyStatsResult(value=self._cache[key], stale=False)

        # Cache miss — try fetching
        try:
            result = await fetch_fn(league, item_id, days)
            if result is not None:
                self._cache[key] = result
                self._stale_store[key] = result
                return DailyStatsResult(value=result, stale=False)
        except Exception as e:
            logger.warning(
                "DailyStats fetch failed for %s/%s (%d days): %s",
                league, item_id, days, e,
            )

        # Fetch failed — try stale value
        if key in self._stale_store:
            logger.info(
                "Returning stale DailyStats for %s/%s", league, item_id,
            )
            return DailyStatsResult(value=self._stale_store[key], stale=True)

        return DailyStatsResult(value=None, stale=False)

    def invalidate(self) -> None:
        """Clear all cached daily stats."""
        self._cache.clear()
        self._stale_store.clear()

    def stats(self) -> dict[str, Any]:
        """Return cache statistics."""
        return {
            "size": len(self._cache),
            "max": self._cache.maxsize,
            "stale_entries": len(self._stale_store),
            "ttl_seconds": self._ttl,
        }


# ---------------------------------------------------------------------------
# Singleton
# ---------------------------------------------------------------------------

_instance: DailyStatsCache | None = None


def get_daily_stats_cache(config: AppConfig | None = None) -> DailyStatsCache:
    """Return the global DailyStatsCache instance (lazily created)."""
    global _instance
    if _instance is None:
        _instance = DailyStatsCache(config)
    return _instance
