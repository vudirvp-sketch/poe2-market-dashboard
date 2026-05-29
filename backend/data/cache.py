"""
DEPRECATED: This module is no longer used and will be removed in a future release.

All consumers have been migrated:
  - prices/metadata/history → DataSnapshot (backend/api/data_snapshot.py)
  - daily_stats            → DailyStatsCache (backend/data/daily_stats_cache.py)

This file is kept as a reference but should NOT be imported by any active code.
Safe to delete after confirming no remaining imports exist.
"""

# The original DataCache class is preserved below for reference only.
# DO NOT import from this module — use DataSnapshot or DailyStatsCache instead.

import warnings

warnings.warn(
    "backend.data.cache is DEPRECATED. "
    "Use backend.api.data_snapshot (DataSnapshot) or "
    "backend.data.daily_stats_cache (DailyStatsCache) instead.",
    DeprecationWarning,
    stacklevel=2,
)
