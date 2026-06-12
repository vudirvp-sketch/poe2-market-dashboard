"""
Backward-compatible re-export module for PipelineCache.

All implementation has been moved to unified_cache.py (Phase 1.2).
This module re-exports the public API so existing imports continue to work:

    from backend.data.pipeline_cache import PipelineCache, get_pipeline_cache
    from backend.data.pipeline_cache import CachedPipelineResult
"""

from backend.data.unified_cache import (
    CachedEntry as CachedPipelineResult,
    CachedEntry,
    PipelineCache,
    get_pipeline_cache,
)

__all__ = [
    "CachedPipelineResult",
    "CachedEntry",
    "PipelineCache",
    "get_pipeline_cache",
]
