"""
API routes for Market Spreads History (TD-4, iter 128).

Endpoint:
    GET /api/v1/market-spreads/history — read persisted per-pair spread
        time-series from the ``market_spreads`` SQLite table. Used by the
        future backtest / trend UI to model slippage evolution.

The write path lives in ``SnapshotManager._refresh()`` (best-effort, every
5 min). This route is read-only and does NOT trigger a refresh — it
returns whatever has already been persisted.

Query params:
    pair — Optional pair filter (e.g. "exalted/divine"). When omitted, all
           pairs in the league are returned (may be a large response —
           ~46 pairs × 288 rows/day × 30 days ≈ 400 KB JSON).
    days — Lookback window in days (default 30, max 90 — matches
           historical_retention_days).

Design doc: docs/design/TD-3-4-5-9-persistence-gaps-design.md §9 Phase 2.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Query

from backend.api.response_models import MarketSpreadsHistoryResponse
from backend.config import get_settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["market-spreads"])

DEFAULT_DAYS: int = 30
"""Default lookback window in days for the spread history query."""

MAX_DAYS: int = 90
"""Maximum lookback window (matches historical_retention_days)."""


@router.get("/market-spreads/history", response_model=MarketSpreadsHistoryResponse)
async def get_market_spreads_history(
    pair: str | None = Query(
        None,
        description=(
            "Optional pair filter, e.g. 'exalted/divine'. Directional — "
            "'exalted/divine' is NOT the same as 'divine/exalted'. When "
            "omitted, all pairs in the league are returned."
        ),
    ),
    days: int = Query(
        DEFAULT_DAYS,
        ge=1,
        le=MAX_DAYS,
        description=(
            "Lookback window in days. Default 30, max 90 (matches "
            "historical_retention_days)."
        ),
    ),
) -> dict:
    """Read persisted market_spreads rows from SQLite.

    Returns ``data_available=false`` with an empty ``points`` list when no
    rows match the query (e.g. the feature just shipped and the first
    snapshot hasn't persisted yet, or the pair filter doesn't match any
    persisted pair). The frontend should show a "no data yet" state rather
    than treating it as an error.
    """
    config = get_settings()
    league = config.league.league_name

    try:
        from backend.data.historical import get_historical_store

        store = get_historical_store(config)
        rows = await store.read_market_spreads(
            league=league,
            pair_key=pair,
            days=days,
        )
        available_pairs = await store.read_market_spreads_pairs(league=league)

        points = [
            {
                "timestamp": row["timestamp"],
                "pair_key": row["pair_key"],
                "currency_from": row["currency_from"],
                "currency_to": row["currency_to"],
                "raw_rate": row["raw_rate"],
                "volume_24h": row["volume_24h"],
                "market_spread": row["market_spread"],
                "total_spread": row["total_spread"],
                "momentum_factor": row["momentum_factor"],
                "bfs_widening_factor": row["bfs_widening_factor"],
            }
            for row in rows
        ]

        return {
            "league": league,
            "pair": pair,
            "days": days,
            "points": points,
            "available_pairs": available_pairs,
            "data_available": len(points) > 0,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as e:
        logger.error(
            "market-spreads/history read failed (league=%s, pair=%s, days=%d): %s",
            league, pair, days, e,
        )
        return {
            "league": league,
            "pair": pair,
            "days": days,
            "points": [],
            "available_pairs": [],
            "data_available": False,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }
