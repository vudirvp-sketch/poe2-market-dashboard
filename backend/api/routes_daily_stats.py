"""
API routes for Daily Stats History (TD-5, iter 131).

Endpoint:
    GET /api/v1/items/{item_id}/daily-stats — read persisted daily OHLCV
        time-series from the ``daily_stats`` SQLite table, with a
        lazy-fetch fallback to the POE2Scout ``DailyStatsHistory``
        provider endpoint.

Design doc: docs/design/TD-3-4-5-9-persistence-gaps-design.md §5.2
strategy 1 (lazy fetch + cache) + §9 Phase 4.

Read path
---------
1. Read the latest persisted ``date`` for ``(league, item_id)`` via
   ``HistoricalStore.read_daily_stats_latest_date``.
2. If the latest row is fresh (today or yesterday — see
   ``is_daily_stats_fresh``), serve the full lookback window from
   SQLite. ``source = "sqlite"``.
3. If the latest row is stale or missing, fetch from the POE2Scout
   provider via ``provider.get_daily_stats(league, item_id,
   day_count=day_count)``, transform the response via
   ``transform_daily_stats``, persist via
   ``HistoricalStore.write_daily_stats_batch``, and serve the fetched
   rows. ``source = "provider"``.
4. If both SQLite and the provider return no data, return an empty
   response with ``source = "empty"`` + ``data_available = false``.

The lazy-fetch fallback is best-effort: a provider failure (network
error, 4xx/5xx) logs a warning and returns whatever SQLite has (which
may be empty). This matches the design doc §5.1 invariant that
persistence MUST NOT block the response — a stale SQLite row is better
than a 500.

Path param
----------
``item_id`` is a POE2Scout numeric ItemId (int), NOT an api_id string.
The caller can discover item_ids from the snapshot's
``currency_metadata`` or from the ``available_item_ids`` field in this
route's response. The route also resolves the ``api_id`` for the item
from the snapshot (if present) and populates it in each persisted row
for cross-joining with ``price_snapshots`` (design doc §4.5).

Query params
------------
day_count — Lookback window in days (default 30, max 365 — matches
    ``data.daily_stats_retention_days``).
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Path, Query

from backend.api.response_models import DailyStatsHistoryResponse
from backend.config import get_settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["daily-stats"])

DEFAULT_DAY_COUNT: int = 30
"""Default lookback window in days for the daily-stats query."""

MAX_DAY_COUNT: int = 365
"""Maximum lookback window (matches data.daily_stats_retention_days default)."""


@router.get(
    "/items/{item_id}/daily-stats",
    response_model=DailyStatsHistoryResponse,
)
async def get_daily_stats_history(
    item_id: int = Path(
        ...,
        ge=1,
        description=(
            "POE2Scout numeric ItemId. Discoverable from the snapshot's "
            "currency_metadata or from the available_item_ids field in "
            "this route's response. NOT an api_id string."
        ),
    ),
    day_count: int = Query(
        DEFAULT_DAY_COUNT,
        ge=1,
        le=MAX_DAY_COUNT,
        description=(
            "Lookback window in days. Default 30, max 365 (matches "
            "data.daily_stats_retention_days)."
        ),
    ),
) -> dict:
    """Read persisted daily_stats rows from SQLite, with provider fallback.

    Returns ``data_available=false`` with an empty ``points`` list when
    no rows match the query AND the provider fallback returns no data
    (e.g. the item_id is unknown to POE2Scout). The frontend should
    show a "no data yet" state rather than treating it as an error.
    """
    config = get_settings()
    league = config.league.league_name
    now_iso = datetime.now(timezone.utc).isoformat()

    try:
        from backend.data.historical import get_historical_store
        from backend.economy.daily_stats import (
            is_daily_stats_fresh,
            transform_daily_stats,
        )

        store = get_historical_store(config)

        # Resolve api_id from the snapshot (best-effort — may be None).
        api_id = await _resolve_api_id(item_id)

        # --- Step 1: check SQLite freshness ---
        latest_date = await store.read_daily_stats_latest_date(
            league=league, item_id=item_id,
        )

        if is_daily_stats_fresh(latest_date):
            # Serve from SQLite.
            rows = await store.read_daily_stats(
                league=league, item_id=item_id, day_count=day_count,
            )
            available = await store.read_daily_stats_items(league=league)
            available_item_ids = sorted({iid for iid, _ in available})
            return _build_response(
                league=league,
                item_id=item_id,
                api_id=api_id,
                day_count=day_count,
                rows=rows,
                available_item_ids=available_item_ids,
                source="sqlite",
                now_iso=now_iso,
            )

        # --- Step 2: lazy-fetch from provider ---
        provider_rows = await _lazy_fetch_and_persist(
            store=store,
            league=league,
            item_id=item_id,
            api_id=api_id,
            day_count=day_count,
        )

        if provider_rows:
            available = await store.read_daily_stats_items(league=league)
            available_item_ids = sorted({iid for iid, _ in available})
            return _build_response(
                league=league,
                item_id=item_id,
                api_id=api_id,
                day_count=day_count,
                rows=provider_rows,
                available_item_ids=available_item_ids,
                source="provider",
                now_iso=now_iso,
            )

        # --- Step 3: both sources empty — return whatever SQLite has ---
        rows = await store.read_daily_stats(
            league=league, item_id=item_id, day_count=day_count,
        )
        available = await store.read_daily_stats_items(league=league)
        available_item_ids = sorted({iid for iid, _ in available})
        return _build_response(
            league=league,
            item_id=item_id,
            api_id=api_id,
            day_count=day_count,
            rows=rows,
            available_item_ids=available_item_ids,
            source="empty" if not rows else "sqlite",
            now_iso=now_iso,
        )

    except Exception as e:
        logger.error(
            "items/%d/daily-stats read failed (league=%s, day_count=%d): %s",
            item_id, league, day_count, e,
        )
        return {
            "league": league,
            "item_id": item_id,
            "api_id": None,
            "day_count": day_count,
            "points": [],
            "available_item_ids": [],
            "data_available": False,
            "source": "empty",
            "fetched_at": now_iso,
        }


async def _resolve_api_id(item_id: int) -> str | None:
    """Look up the api_id for an item_id from the current snapshot.

    Returns None when the snapshot is unavailable or the item_id is not
    in the snapshot's currency_metadata (e.g. delisted item). Best-effort
    — never raises.
    """
    try:
        from backend.api.data_snapshot import get_snapshot

        snapshot = await get_snapshot()
        for meta in snapshot.currency_metadata:
            if meta.item_id == item_id and meta.api_id:
                return meta.api_id
    except Exception as e:
        logger.debug(
            "_resolve_api_id: snapshot lookup failed for item_id=%d: %s",
            item_id, e,
        )
    return None


async def _lazy_fetch_and_persist(
    *,
    store,
    league: str,
    item_id: int,
    api_id: str | None,
    day_count: int,
) -> list[dict]:
    """Fetch daily stats from the provider and persist for next time.

    Returns the transformed rows (list of dicts) on success. Returns an
    empty list when the provider returns None or the transform produces
    no rows. Never raises — a provider failure logs a warning and
    returns [] so the caller can fall back to whatever SQLite has.
    """
    try:
        from backend.api.shared import get_provider
        from backend.economy.daily_stats import transform_daily_stats

        provider = get_provider()
        raw = await provider.get_daily_stats(
            league=league, item_id=item_id, day_count=day_count,
        )
        rows = transform_daily_stats(raw, league, item_id, api_id)
        if rows:
            try:
                await store.write_daily_stats_batch(league=league, rows=rows)
                logger.debug(
                    "Lazy-fetch: persisted %d daily_stats rows for "
                    "item_id=%d league=%s",
                    len(rows), item_id, league,
                )
            except Exception as write_err:
                logger.warning(
                    "Lazy-fetch: provider fetch succeeded but SQLite write "
                    "failed for item_id=%d (non-fatal, serving fetched rows): %s",
                    item_id, write_err,
                )
        return rows
    except Exception as e:
        logger.warning(
            "Lazy-fetch: provider fetch failed for item_id=%d league=%s "
            "(non-fatal, falling back to SQLite): %s",
            item_id, league, e,
        )
        return []


def _build_response(
    *,
    league: str,
    item_id: int,
    api_id: str | None,
    day_count: int,
    rows: list[dict],
    available_item_ids: list[int],
    source: str,
    now_iso: str,
) -> dict:
    """Build the JSON response dict from the persisted rows."""
    points = [
        {
            "date": row["date"],
            "item_id": row["item_id"],
            "api_id": row.get("api_id"),
            "open": row.get("open"),
            "high": row.get("high"),
            "low": row.get("low"),
            "close": row.get("close"),
            "average": row.get("average"),
            "volume": row.get("volume"),
        }
        for row in rows
    ]
    return {
        "league": league,
        "item_id": item_id,
        "api_id": api_id,
        "day_count": day_count,
        "points": points,
        "available_item_ids": available_item_ids,
        "data_available": len(points) > 0,
        "source": source,
        "fetched_at": now_iso,
    }
