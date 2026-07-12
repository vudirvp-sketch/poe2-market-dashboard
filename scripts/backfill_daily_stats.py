#!/usr/bin/env python3
"""
TD-5 (iter 131) — One-shot backfill script for the daily_stats SQLite table.

Fetches daily OHLCV from POE2Scout ``DailyStatsHistory`` for every item in
the snapshot's ``currency_metadata`` (or the top-N by volume) and persists
the rows to ``historical.db:daily_stats`` via
``HistoricalStore.write_daily_stats_batch``. Idempotent: ``INSERT OR REPLACE``
means reruns are safe (design doc §6.3).

Usage
-----
Run from the project root (where ``config.yaml`` lives)::

    # Backfill all items in the current league's snapshot (default 90 days)
    python scripts/backfill_daily_stats.py

    # Dry run — print league + item count, write nothing
    python scripts/backfill_daily_stats.py --dry-run

    # Backfill only the top-50 items by 24h volume
    python scripts/backfill_daily_stats.py --top-n 50

    # Backfill a different league (override config.yaml)
    python scripts/backfill_daily_stats.py --league vaal

    # Shorter window (faster)
    python scripts/backfill_daily_stats.py --day-count 30

Rate limit
----------
1 request/sec (matches POE2Scout polite policy — design doc §6.3 + §8.3).
For 1000 items at 1 req/sec = ~17 min. The script prints progress every
10 items so you can monitor it.

Design doc: docs/design/TD-3-4-5-9-persistence-gaps-design.md §6.3 + §8.3.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from pathlib import Path

# Ensure project root is on sys.path so `import backend...` works when
# running the script directly (e.g. `python scripts/backfill_daily_stats.py`).
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from backend.config import get_settings  # noqa: E402
from backend.data.historical import get_historical_store  # noqa: E402
from backend.economy.daily_stats import transform_daily_stats  # noqa: E402

logger = logging.getLogger("backfill_daily_stats")

DEFAULT_DAY_COUNT = 90
"""Default lookback — POE2Scout's DailyStatsHistory DayCount max is 90."""

RATE_LIMIT_SLEEP_SEC = 1.0
"""Seconds between provider requests (polite policy)."""

PROGRESS_EVERY = 10
"""Print a progress line every N items."""


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Backfill the daily_stats SQLite table from POE2Scout "
            "DailyStatsHistory. Idempotent (INSERT OR REPLACE)."
        ),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print league + item count, write nothing to SQLite.",
    )
    parser.add_argument(
        "--league",
        default=None,
        help=(
            "League to backfill (overrides config.yaml:league.league_name). "
            "Use for one-off backfills of a specific league."
        ),
    )
    parser.add_argument(
        "--day-count",
        type=int,
        default=DEFAULT_DAY_COUNT,
        help=(
            f"DayCount for the DailyStatsHistory request (default {DEFAULT_DAY_COUNT}, "
            "max 90 per POE2Scout). Each item gets one request."
        ),
    )
    parser.add_argument(
        "--top-n",
        type=int,
        default=0,
        help=(
            "If > 0, backfill only the top-N items by 24h trade volume "
            "from the current snapshot. 0 (default) = backfill ALL items "
            "in the snapshot's currency_metadata."
        ),
    )
    return parser.parse_args()


async def _get_items_to_backfill(
    league: str,
    top_n: int,
) -> list[tuple[int, str]]:
    """Return the list of (item_id, api_id) pairs to backfill.

    When ``top_n > 0``, uses ``pick_top_items_by_volume`` from the latest
    snapshot. Otherwise, enumerates ALL items in the snapshot's
    ``currency_metadata`` that have a non-zero ``item_id``.
    """
    from backend.api.data_snapshot import get_snapshot
    from backend.economy.daily_stats import pick_top_items_by_volume

    snapshot = await get_snapshot()
    if top_n > 0:
        return pick_top_items_by_volume(snapshot, n=top_n)

    # All items with item_id > 0.
    seen: set[int] = set()
    items: list[tuple[int, str]] = []
    for meta in snapshot.currency_metadata:
        if not meta.api_id or not meta.item_id or meta.item_id <= 0:
            continue
        if meta.item_id in seen:
            continue
        items.append((int(meta.item_id), meta.api_id))
        seen.add(int(meta.item_id))
    return items


async def main() -> int:
    args = _parse_args()
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    config = get_settings()
    league = args.league or config.league.league_name
    day_count = max(1, min(args.day_count, 90))

    logger.info(
        "Backfill daily_stats: league=%s, day_count=%d, top_n=%s, dry_run=%s",
        league, day_count, args.top_n or "ALL", args.dry_run,
    )

    # Resolve items to backfill.
    try:
        items = await _get_items_to_backfill(league=league, top_n=args.top_n)
    except Exception as e:
        logger.error("Failed to resolve items from snapshot: %s", e)
        return 1

    if not items:
        logger.warning(
            "No items to backfill (snapshot may be empty or have no "
            "currency_metadata with item_id). Aborting."
        )
        return 0

    logger.info("Items to backfill: %d", len(items))
    if args.dry_run:
        logger.info("--dry-run: printing first 10 items, writing nothing.")
        for item_id, api_id in items[:10]:
            logger.info("  item_id=%d api_id=%s", item_id, api_id)
        return 0

    # Initialize HistoricalStore.
    store = get_historical_store(config)
    await store.init()

    # Get provider.
    from backend.api.shared import get_provider
    provider = get_provider()

    total_rows = 0
    total_items_ok = 0
    total_items_fail = 0

    try:
        for idx, (item_id, api_id) in enumerate(items, start=1):
            try:
                raw = await provider.get_daily_stats(
                    league=league,
                    item_id=item_id,
                    day_count=day_count,
                )
                rows = transform_daily_stats(raw, league, item_id, api_id)
                if rows:
                    written = await store.write_daily_stats_batch(
                        league=league, rows=rows,
                    )
                    total_rows += max(written, 0)
                    total_items_ok += 1
                else:
                    # Provider returned None or empty — not a failure,
                    # just no data for this item.
                    logger.debug(
                        "item_id=%d api_id=%s: no data from provider",
                        item_id, api_id,
                    )
            except Exception as item_err:
                total_items_fail += 1
                logger.warning(
                    "item_id=%d api_id=%s FAILED (continuing): %s",
                    item_id, api_id, item_err,
                )

            if idx % PROGRESS_EVERY == 0 or idx == len(items):
                logger.info(
                    "Progress: %d/%d items (%.0f%%), rows persisted so far: %d, "
                    "failures: %d",
                    idx, len(items), 100.0 * idx / len(items),
                    total_rows, total_items_fail,
                )

            # Rate limit — sleep between requests.
            if idx < len(items):
                await asyncio.sleep(RATE_LIMIT_SLEEP_SEC)
    finally:
        await store.close()

    logger.info(
        "Backfill complete: %d items processed, %d ok, %d failed, "
        "%d rows persisted (league=%s, day_count=%d)",
        len(items), total_items_ok, total_items_fail, total_rows,
        league, day_count,
    )
    return 0 if total_items_fail == 0 else 2


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
