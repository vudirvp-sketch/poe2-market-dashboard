"""
Backward-compatible re-export module for DailyStatsCache.

All implementation has been moved to unified_cache.py (Phase 1.2).
This module re-exports the public API so existing imports continue to work:

    from backend.data.daily_stats_cache import DailyStatsCache, DailyStatsResult
    from backend.data.daily_stats_cache import get_daily_stats_cache, LRUDict
"""

from backend.data.unified_cache import (
    DailyStatsCache,
    DailyStatsResult,
    LRUDict,
    get_daily_stats_cache,
)

__all__ = [
    "DailyStatsCache",
    "DailyStatsResult",
    "LRUDict",
    "get_daily_stats_cache",
]
