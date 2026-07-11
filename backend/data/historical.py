"""
Historical price store using SQLite.

Tables:
- price_snapshots: (timestamp, league, currency, price, volume_24h, bid, ask)
- events: (event_id, event_type, description, affected_currencies, created_at, expires_at, is_active, deactivated_at)
- market_spreads: (timestamp, league, pair_key, currency_from, currency_to,
                   raw_rate, volume_24h, market_spread, total_spread,
                   momentum_factor, bfs_widening_factor)  -- TD-4 (iter 128)
- triangular_cycles: (timestamp, league, cycle_key, cycle_currencies,
                      raw_profit_pct, executable_estimate, executable_profit,
                      confidence, snapshot_age_sec)  -- TD-3 (iter 129)

Write: every time current prices are fetched successfully.
Read: for any model that needs history.
Retention: configurable, default 90 days. Older records pruned on startup.

Migration (v1→v2): column `price_chaos` renamed to `price` because the stored
value is in the league's base currency (Exalted for PoE2), not necessarily
Chaos. Existing databases are migrated automatically on init().
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import aiosqlite

from backend.config import AppConfig, get_settings

logger = logging.getLogger(__name__)

_DB_PATH = Path(__file__).resolve().parent.parent.parent / "historical.db"

_CREATE_TABLES_SQL = """
CREATE TABLE IF NOT EXISTS price_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    league TEXT NOT NULL,
    currency TEXT NOT NULL,
    price REAL,
    volume_24h REAL,
    bid REAL,
    ask REAL
);

CREATE INDEX IF NOT EXISTS idx_price_snapshots_ts
    ON price_snapshots(timestamp);

CREATE INDEX IF NOT EXISTS idx_price_snapshots_league_curr
    ON price_snapshots(league, currency);

CREATE UNIQUE INDEX IF NOT EXISTS idx_price_snapshot_dedup 
    ON price_snapshots(strftime('%Y-%m-%d %H:%M', timestamp), league, currency);

CREATE TABLE IF NOT EXISTS events (
    event_id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    description TEXT,
    affected_currencies TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    deactivated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_events_active
    ON events(is_active, expires_at);

-- TD-4 (iter 128): market spread per direct pair per snapshot.
-- Design doc: docs/design/TD-3-4-5-9-persistence-gaps-design.md §4 (Option B).
-- Cadence: one row per (league, pair_key, 5-min bucket) — INSERT OR IGNORE
-- deduplicates on idx_market_spreads_dedup. Only direct pairs (BFS factor = 1.0)
-- are persisted per design doc §10 Q2 default.
CREATE TABLE IF NOT EXISTS market_spreads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    league TEXT NOT NULL,
    pair_key TEXT NOT NULL,
    currency_from TEXT NOT NULL,
    currency_to TEXT NOT NULL,
    raw_rate REAL,
    volume_24h REAL,
    market_spread REAL,
    total_spread REAL,
    momentum_factor REAL,
    bfs_widening_factor REAL
);

CREATE INDEX IF NOT EXISTS idx_market_spreads_ts
    ON market_spreads(timestamp);

CREATE INDEX IF NOT EXISTS idx_market_spreads_pair
    ON market_spreads(pair_key, league);

CREATE UNIQUE INDEX IF NOT EXISTS idx_market_spreads_dedup
    ON market_spreads(strftime('%Y-%m-%d %H:%M', timestamp), league, pair_key);

-- TD-3 (iter 129): detected triangular arbitrage cycles per snapshot.
-- Design doc: docs/design/TD-3-4-5-9-persistence-gaps-design.md §4 (Option B).
-- Cadence: one row per (league, cycle_key, 5-min bucket) — INSERT OR IGNORE
-- deduplicates on idx_tri_cycles_dedup. Only profitable cycles (>= 1.0%) are
-- persisted per design doc §10 Q1 default.
CREATE TABLE IF NOT EXISTS triangular_cycles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    league TEXT NOT NULL,
    cycle_key TEXT NOT NULL,
    cycle_currencies TEXT NOT NULL,
    raw_profit_pct REAL,
    executable_estimate INTEGER,
    executable_profit INTEGER,
    confidence REAL,
    snapshot_age_sec INTEGER
);

CREATE INDEX IF NOT EXISTS idx_tri_cycles_ts
    ON triangular_cycles(timestamp);

CREATE INDEX IF NOT EXISTS idx_tri_cycles_key
    ON triangular_cycles(cycle_key, league);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tri_cycles_dedup
    ON triangular_cycles(strftime('%Y-%m-%d %H:%M', timestamp), league, cycle_key);
"""

# ---------------------------------------------------------------------------
# Schema migration: v1 (price_chaos) → v2 (price)
# ---------------------------------------------------------------------------

_MIGRATION_V1_TO_V2 = """
-- Rename price_chaos → price (the column stores price in the league's base
-- currency, not necessarily Chaos Orbs).
ALTER TABLE price_snapshots RENAME COLUMN price_chaos TO price;
"""


class HistoricalStore:
    """SQLite-backed historical price store."""

    def __init__(self, db_path: str | Path | None = None, config: AppConfig | None = None):
        self._config = config or get_settings()
        self._db_path = Path(db_path) if db_path else _DB_PATH
        self._db: aiosqlite.Connection | None = None
        self._retention_days = self._config.data.historical_retention_days

    async def init(self) -> None:
        """Initialize the database, run migrations, and create tables.

        Must be called once on startup.  If the database still has the old
        ``price_chaos`` column, it is automatically migrated to ``price``.
        Also cleans up data from previous leagues to avoid stale cross-league
        data contaminating queries.
        """
        self._db = await aiosqlite.connect(str(self._db_path))
        self._db.row_factory = aiosqlite.Row

        # --- Auto-migration: v1 (price_chaos) → v2 (price) ---
        await self._migrate_v1_to_v2()

        await self._db.executescript(_CREATE_TABLES_SQL)
        await self._db.commit()

        # --- Cleanup: drop obsolete gold_chaos_rates table if it exists ---
        await self._drop_obsolete_tables()

        # --- Cleanup: remove data from old leagues ---
        await self._prune_old_league_data()

        await self._prune_old_records()

    async def _migrate_v1_to_v2(self) -> None:
        """Rename price_chaos → price if the old column still exists."""
        db = self._db
        # Check if the old column exists
        cursor = await db.execute("PRAGMA table_info(price_snapshots)")
        columns = await cursor.fetchall()
        col_names = {row[1] for row in columns}  # row[1] = column name

        if "price_chaos" in col_names and "price" not in col_names:
            logger.info("Migrating DB schema: price_chaos → price")
            await db.executescript(_MIGRATION_V1_TO_V2)
            await db.commit()
            logger.info("Migration complete: price_chaos column renamed to price")

    async def _drop_obsolete_tables(self) -> None:
        """Drop tables that are no longer part of the schema.

        The gold_chaos_rates table was used by the recipe arbitrage module
        which has been removed. If the table still exists in an older
        database, we drop it here to keep the schema clean.
        """
        db = self._db
        # Check if gold_chaos_rates table exists
        cursor = await db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='gold_chaos_rates'"
        )
        row = await cursor.fetchone()
        if row:
            logger.info("Dropping obsolete table: gold_chaos_rates")
            await db.execute("DROP TABLE IF EXISTS gold_chaos_rates")
            await db.commit()

    async def _prune_old_league_data(self) -> None:
        """Remove price data from leagues that are no longer the current league.

        When the user switches leagues (e.g. from 'runes' to 'vaal'), the
        HistoricalStore SQLite may still contain data from the old league.
        While queries filter by league, old data wastes space and can cause
        confusion when inspecting the database manually.

        This method:
        1. Finds all distinct leagues in the price_snapshots table
        2. Deletes any that don't match the currently configured league
           (chunked to avoid holding a long write lock on large tables)
        3. Also deletes events that don't belong to the current league
        4. TD-4 (iter 128): also deletes market_spreads rows for old leagues
        5. TD-3 (iter 129): also deletes triangular_cycles rows for old leagues

        P1-6 (iter 66): Chunked delete with `await db.commit()` between
        batches. Previously a single `DELETE FROM ... WHERE league = ?`
        could lock the DB for seconds when an old league had hundreds of
        thousands of snapshots. The chunk size is small (1000 rows) so
        concurrent reads remain responsive during pruning.
        """
        db = self._db
        current_league = self._config.league.league_name

        # Find distinct leagues across price_snapshots + market_spreads +
        # triangular_cycles. TD-3 (iter 129): triangular_cycles may have
        # leagues that the other tables don't (snapshot refresh persisted
        # cycles but the ByCategory call failed that tick), so union all
        # three sources.
        cursor = await db.execute(
            "SELECT DISTINCT league FROM price_snapshots "
            "UNION SELECT DISTINCT league FROM market_spreads "
            "UNION SELECT DISTINCT league FROM triangular_cycles"
        )
        rows = await cursor.fetchall()
        old_leagues = [row[0] for row in rows if row[0] != current_league]

        if old_leagues:
            chunk_size = 1000  # rows per DELETE batch
            for old_league in old_leagues:
                total_deleted = 0
                while True:
                    # Use rowid subquery instead of `DELETE ... LIMIT ?` because
                    # LIMIT in DELETE requires SQLITE_ENABLE_UPDATE_DELETE_LIMIT
                    # compile-time option, which many distros don't enable.
                    cursor = await db.execute(
                        "DELETE FROM price_snapshots WHERE rowid IN ("
                        "  SELECT rowid FROM price_snapshots WHERE league = ? LIMIT ?"
                        ")",
                        (old_league, chunk_size),
                    )
                    deleted = cursor.rowcount
                    total_deleted += max(deleted, 0)
                    await db.commit()  # release write lock between batches
                    if deleted < chunk_size:
                        break  # no more rows for this league
                if total_deleted > 0:
                    logger.info(
                        "Pruned %d price snapshots from old league '%s' "
                        "(current league: '%s', chunk size: %d)",
                        total_deleted, old_league, current_league, chunk_size,
                    )

                # TD-4 (iter 128): same chunked delete for market_spreads.
                total_spreads_deleted = 0
                while True:
                    cursor = await db.execute(
                        "DELETE FROM market_spreads WHERE rowid IN ("
                        "  SELECT rowid FROM market_spreads WHERE league = ? LIMIT ?"
                        ")",
                        (old_league, chunk_size),
                    )
                    deleted = cursor.rowcount
                    total_spreads_deleted += max(deleted, 0)
                    await db.commit()
                    if deleted < chunk_size:
                        break
                if total_spreads_deleted > 0:
                    logger.info(
                        "Pruned %d market_spreads rows from old league '%s' "
                        "(current league: '%s', chunk size: %d)",
                        total_spreads_deleted, old_league, current_league, chunk_size,
                    )

                # TD-3 (iter 129): same chunked delete for triangular_cycles.
                total_cycles_deleted = 0
                while True:
                    cursor = await db.execute(
                        "DELETE FROM triangular_cycles WHERE rowid IN ("
                        "  SELECT rowid FROM triangular_cycles WHERE league = ? LIMIT ?"
                        ")",
                        (old_league, chunk_size),
                    )
                    deleted = cursor.rowcount
                    total_cycles_deleted += max(deleted, 0)
                    await db.commit()
                    if deleted < chunk_size:
                        break
                if total_cycles_deleted > 0:
                    logger.info(
                        "Pruned %d triangular_cycles rows from old league '%s' "
                        "(current league: '%s', chunk size: %d)",
                        total_cycles_deleted, old_league, current_league, chunk_size,
                    )
        else:
            logger.info(
                "No old league data found in HistoricalStore (current: '%s')",
                current_league,
            )

    async def close(self) -> None:
        if self._db:
            await self._db.close()
            self._db = None

    async def _ensure_db(self) -> aiosqlite.Connection:
        if self._db is None:
            await self.init()
        assert self._db is not None
        return self._db

    # ------------------------------------------------------------------
    # Price Writes
    # ------------------------------------------------------------------

    async def write_price_snapshot(
        self,
        league: str,
        currency: str,
        price: float | None,
        volume_24h: float | None = None,
        bid: float | None = None,
        ask: float | None = None,
        timestamp: datetime | None = None,
    ) -> None:
        """Write a single price snapshot.

        Uses INSERT OR IGNORE to avoid duplicates based on the
        idx_price_snapshot_dedup unique index (rounded to 5-min bucket).
        """
        db = await self._ensure_db()
        ts = (timestamp or datetime.now(timezone.utc)).isoformat()
        await db.execute(
            """INSERT OR IGNORE INTO price_snapshots
               (timestamp, league, currency, price, volume_24h, bid, ask)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (ts, league, currency, price, volume_24h, bid, ask),
        )
        await db.commit()

    async def write_price_snapshots_batch(
        self,
        league: str,
        snapshots: list[dict],
        timestamp: datetime | None = None,
    ) -> None:
        """Write multiple price snapshots in a single transaction.

        Uses INSERT OR IGNORE to avoid duplicates based on the
        idx_price_snapshot_dedup unique index (rounded to 5-min bucket).
        """
        db = await self._ensure_db()
        ts = (timestamp or datetime.now(timezone.utc)).isoformat()

        rows = [
            (
                ts,
                league,
                s.get("currency", ""),
                s.get("price"),
                s.get("volume_24h"),
                s.get("bid"),
                s.get("ask"),
            )
            for s in snapshots
        ]

        await db.executemany(
            """INSERT OR IGNORE INTO price_snapshots
               (timestamp, league, currency, price, volume_24h, bid, ask)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            rows,
        )
        await db.commit()

    # ------------------------------------------------------------------
    # Price Reads
    # ------------------------------------------------------------------

    async def get_price_history(
        self,
        league: str,
        currency: str,
        days: int = 30,
    ) -> list[dict]:
        """Get price history for a currency in a league."""
        db = await self._ensure_db()
        cutoff = datetime.now(timezone.utc).isoformat()  # We want the last N days

        cursor = await db.execute(
            """SELECT timestamp, currency, price, volume_24h, bid, ask
               FROM price_snapshots
               WHERE league = ? AND currency = ?
                 AND timestamp >= datetime('now', ? || ' days')
               ORDER BY timestamp ASC""",
            (league, currency, f"-{days}"),
        )
        rows = await cursor.fetchall()
        return [
            {
                "timestamp": row[0],
                "currency": row[1],
                "price": row[2],
                "volume_24h": row[3],
                "bid": row[4],
                "ask": row[5],
            }
            for row in rows
        ]

    async def get_latest_prices(self, league: str) -> list[dict]:
        """Get the most recent price for each currency in a league."""
        db = await self._ensure_db()
        cursor = await db.execute(
            """SELECT ps.timestamp, ps.currency, ps.price, ps.volume_24h, ps.bid, ps.ask
               FROM price_snapshots ps
               INNER JOIN (
                   SELECT currency, MAX(timestamp) as max_ts
                   FROM price_snapshots
                   WHERE league = ?
                   GROUP BY currency
               ) latest ON ps.currency = latest.currency AND ps.timestamp = latest.max_ts
               WHERE ps.league = ?
               ORDER BY ps.currency""",
            (league, league),
        )
        rows = await cursor.fetchall()
        return [
            {
                "timestamp": row[0],
                "currency": row[1],
                "price": row[2],
                "volume_24h": row[3],
                "bid": row[4],
                "ask": row[5],
            }
            for row in rows
        ]

    # ------------------------------------------------------------------
    # Event Persistence (Phase 2, Spec Section 1)
    # ------------------------------------------------------------------

    async def write_event(self, event: "StoredEvent") -> None:
        """Persist an event to SQLite.

        Args:
            event: A StoredEvent instance from backend.economy.events
        """
        db = await self._ensure_db()
        affected_json = json.dumps(event.affected_currencies)
        expires_iso = event.expires_at.isoformat() if event.expires_at else None
        created_iso = event.created_at.isoformat() if event.created_at else datetime.now(timezone.utc).isoformat()
        deactivated_iso = None

        await db.execute(
            """INSERT OR REPLACE INTO events
               (event_id, event_type, description, affected_currencies,
                created_at, expires_at, is_active, deactivated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                event.event_id,
                event.event_type.value,
                event.description,
                affected_json,
                created_iso,
                expires_iso,
                1 if event.is_active else 0,
                deactivated_iso,
            ),
        )
        await db.commit()

    async def write_events_batch(self, events: list["StoredEvent"]) -> None:
        """Batch persist events to SQLite."""
        db = await self._ensure_db()
        rows = []
        for event in events:
            affected_json = json.dumps(event.affected_currencies)
            expires_iso = event.expires_at.isoformat() if event.expires_at else None
            created_iso = event.created_at.isoformat() if event.created_at else datetime.now(timezone.utc).isoformat()
            deactivated_iso = None
            rows.append((
                event.event_id,
                event.event_type.value,
                event.description,
                affected_json,
                created_iso,
                expires_iso,
                1 if event.is_active else 0,
                deactivated_iso,
            ))

        await db.executemany(
            """INSERT OR REPLACE INTO events
               (event_id, event_type, description, affected_currencies,
                created_at, expires_at, is_active, deactivated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            rows,
        )
        await db.commit()

    async def read_active_events(self) -> list[dict]:
        """Load all non-expired, non-deactivated events from SQLite.

        Returns:
            List of dicts with event fields suitable for reconstructing StoredEvent objects.
        """
        db = await self._ensure_db()
        now_iso = datetime.now(timezone.utc).isoformat()

        cursor = await db.execute(
            """SELECT event_id, event_type, description, affected_currencies,
                      created_at, expires_at, is_active, deactivated_at
               FROM events
               WHERE is_active = 1
                 AND (expires_at IS NULL OR expires_at > ?)
               ORDER BY created_at DESC""",
            (now_iso,),
        )
        rows = await cursor.fetchall()

        results = []
        for row in rows:
            affected = json.loads(row[3]) if row[3] else []
            results.append({
                "event_id": row[0],
                "event_type": row[1],
                "description": row[2],
                "affected_currencies": affected,
                "created_at": row[4],
                "expires_at": row[5],
                "is_active": bool(row[6]),
                "deactivated_at": row[7],
            })
        return results

    async def deactivate_event(self, event_id: str) -> None:
        """Mark event as inactive in SQLite."""
        db = await self._ensure_db()
        now_iso = datetime.now(timezone.utc).isoformat()
        await db.execute(
            """UPDATE events SET is_active = 0, deactivated_at = ?
               WHERE event_id = ?""",
            (now_iso, event_id),
        )
        await db.commit()

    async def delete_event(self, event_id: str) -> None:
        """Remove event from store."""
        db = await self._ensure_db()
        await db.execute("DELETE FROM events WHERE event_id = ?", (event_id,))
        await db.commit()

    async def prune_expired_events(self) -> int:
        """Delete events past their expiry. Call on startup.

        Returns:
            Number of events pruned.
        """
        db = await self._ensure_db()
        now_iso = datetime.now(timezone.utc).isoformat()
        cursor = await db.execute(
            "DELETE FROM events WHERE expires_at IS NOT NULL AND expires_at <= ?",
            (now_iso,),
        )
        deleted = cursor.rowcount
        await db.commit()
        if deleted > 0:
            logger.info("Pruned %d expired events from SQLite", deleted)
        return deleted

    # ------------------------------------------------------------------
    # Market Spreads (TD-4, iter 128)
    # ------------------------------------------------------------------
    # Design doc: docs/design/TD-3-4-5-9-persistence-gaps-design.md §4 + §5.1.
    # Persists per-pair spread metrics computed by
    # backend.economy.market_spreads.compute_market_spreads() so they can be
    # backtested / trended. Write is best-effort from
    # SnapshotManager._refresh() — a failure here MUST NOT block the
    # snapshot publish (next tick will retry via INSERT OR IGNORE dedup).

    async def write_market_spreads_batch(
        self,
        league: str,
        spreads: list[dict],
        timestamp: datetime | None = None,
    ) -> int:
        """Persist a batch of per-pair spread records.

        Uses INSERT OR IGNORE so a second write within the same 5-min bucket
        (same league + pair_key + strftime('%Y-%m-%d %H:%M', timestamp)) is
        silently dropped — matches the price_snapshots dedup convention.

        Args:
            league: League name.
            spreads: List of dicts from ``compute_market_spreads()``. Each
                dict must contain: pair_key, currency_from, currency_to,
                raw_rate, volume_24h, market_spread, total_spread,
                momentum_factor, bfs_widening_factor.
            timestamp: Snapshot timestamp (UTC). Defaults to now.

        Returns:
            Number of rows actually inserted (may be less than
            ``len(spreads)`` if dedup dropped some).
        """
        if not spreads:
            return 0
        db = await self._ensure_db()
        ts = (timestamp or datetime.now(timezone.utc)).isoformat()

        rows = [
            (
                ts,
                league,
                s.get("pair_key", ""),
                s.get("currency_from", ""),
                s.get("currency_to", ""),
                s.get("raw_rate"),
                s.get("volume_24h"),
                s.get("market_spread"),
                s.get("total_spread"),
                s.get("momentum_factor"),
                s.get("bfs_widening_factor", 1.0),
            )
            for s in spreads
        ]

        cursor = await db.executemany(
            """INSERT OR IGNORE INTO market_spreads
               (timestamp, league, pair_key, currency_from, currency_to,
                raw_rate, volume_24h, market_spread, total_spread,
                momentum_factor, bfs_widening_factor)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            rows,
        )
        await db.commit()
        return max(cursor.rowcount or 0, 0)

    async def read_market_spreads(
        self,
        league: str,
        pair_key: str | None = None,
        days: int = 30,
    ) -> list[dict]:
        """Read market spread history for a league (optionally one pair).

        Args:
            league: League name.
            pair_key: Optional pair filter (e.g. ``"exalted/divine"``). When
                None, returns rows for all pairs in the league.
            days: Lookback window in days (default 30).

        Returns:
            List of dicts (oldest-first) with the same keys as the write
            batch plus ``timestamp``. Empty list when no rows match.
        """
        db = await self._ensure_db()
        params: list = [league, f"-{days}"]
        where_pair = " AND pair_key = ?" if pair_key is not None else ""
        if pair_key is not None:
            params.append(pair_key)

        cursor = await db.execute(
            f"""SELECT timestamp, league, pair_key, currency_from, currency_to,
                      raw_rate, volume_24h, market_spread, total_spread,
                      momentum_factor, bfs_widening_factor
               FROM market_spreads
               WHERE league = ?
                 AND timestamp >= datetime('now', ? || ' days')
                 {where_pair}
               ORDER BY timestamp ASC""",
            params,
        )
        rows = await cursor.fetchall()
        return [
            {
                "timestamp": row[0],
                "league": row[1],
                "pair_key": row[2],
                "currency_from": row[3],
                "currency_to": row[4],
                "raw_rate": row[5],
                "volume_24h": row[6],
                "market_spread": row[7],
                "total_spread": row[8],
                "momentum_factor": row[9],
                "bfs_widening_factor": row[10],
            }
            for row in rows
        ]

    async def read_market_spreads_pairs(self, league: str) -> list[str]:
        """Return the distinct pair_keys that have at least one persisted row.

        Useful for the route to enumerate available pairs without pulling
        all rows. Ordered alphabetically.
        """
        db = await self._ensure_db()
        cursor = await db.execute(
            "SELECT DISTINCT pair_key FROM market_spreads WHERE league = ? "
            "ORDER BY pair_key ASC",
            (league,),
        )
        rows = await cursor.fetchall()
        return [row[0] for row in rows]

    # ------------------------------------------------------------------
    # TD-3 (iter 129): Triangular Cycles Writes + Reads
    # ------------------------------------------------------------------
    # Design doc: docs/design/TD-3-4-5-9-persistence-gaps-design.md §4 + §5.1.
    # Persists detected triangular arbitrage cycles computed by
    # backend.economy.triangular_cycles.compute_triangular_cycles() so they
    # can be backtested / trended. Write is best-effort from
    # SnapshotManager._refresh() — a failure here MUST NOT block the
    # snapshot publish (next tick will retry via INSERT OR IGNORE dedup).

    async def write_triangular_cycles_batch(
        self,
        league: str,
        cycles: list[dict],
        timestamp: datetime | None = None,
    ) -> int:
        """Persist a batch of detected triangular arbitrage cycles.

        Uses INSERT OR IGNORE so a second write within the same 5-min bucket
        (same league + cycle_key + strftime('%Y-%m-%d %H:%M', timestamp))
        is silently dropped — matches the price_snapshots + market_spreads
        dedup convention.

        Args:
            league: League name.
            cycles: List of dicts from ``compute_triangular_cycles()``. Each
                dict must contain: cycle_key, cycle_currencies (JSON string),
                raw_profit_pct, executable_estimate, executable_profit,
                confidence, snapshot_age_sec.
            timestamp: Snapshot timestamp (UTC). Defaults to now.

        Returns:
            Number of rows actually inserted (may be less than
            ``len(cycles)`` if dedup dropped some).
        """
        if not cycles:
            return 0
        db = await self._ensure_db()
        ts = (timestamp or datetime.now(timezone.utc)).isoformat()

        rows = [
            (
                ts,
                league,
                c.get("cycle_key", ""),
                c.get("cycle_currencies", "[]"),
                c.get("raw_profit_pct"),
                c.get("executable_estimate", 0),
                c.get("executable_profit", 0),
                c.get("confidence"),
                c.get("snapshot_age_sec", 0),
            )
            for c in cycles
        ]

        cursor = await db.executemany(
            """INSERT OR IGNORE INTO triangular_cycles
               (timestamp, league, cycle_key, cycle_currencies,
                raw_profit_pct, executable_estimate, executable_profit,
                confidence, snapshot_age_sec)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            rows,
        )
        await db.commit()
        return max(cursor.rowcount or 0, 0)

    async def read_triangular_cycles(
        self,
        league: str,
        cycle_key: str | None = None,
        days: int = 30,
    ) -> list[dict]:
        """Read triangular arbitrage cycle history for a league.

        Args:
            league: League name.
            cycle_key: Optional cycle_key filter (e.g.
                ``"divine->exalted->mirror"``). When None, returns rows for
                all cycles in the league.
            days: Lookback window in days (default 30).

        Returns:
            List of dicts (oldest-first) with the same keys as the write
            batch plus ``timestamp``. Empty list when no rows match.
        """
        db = await self._ensure_db()
        params: list = [league, f"-{days}"]
        where_cycle = " AND cycle_key = ?" if cycle_key is not None else ""
        if cycle_key is not None:
            params.append(cycle_key)

        cursor = await db.execute(
            f"""SELECT timestamp, league, cycle_key, cycle_currencies,
                       raw_profit_pct, executable_estimate, executable_profit,
                       confidence, snapshot_age_sec
               FROM triangular_cycles
               WHERE league = ?
                 AND timestamp >= datetime('now', ? || ' days')
                 {where_cycle}
               ORDER BY timestamp ASC""",
            params,
        )
        rows = await cursor.fetchall()
        return [
            {
                "timestamp": row[0],
                "league": row[1],
                "cycle_key": row[2],
                "cycle_currencies": row[3],
                "raw_profit_pct": row[4],
                "executable_estimate": row[5],
                "executable_profit": row[6],
                "confidence": row[7],
                "snapshot_age_sec": row[8],
            }
            for row in rows
        ]

    async def read_triangular_cycles_keys(self, league: str) -> list[str]:
        """Return the distinct cycle_keys that have at least one persisted row.

        Useful for the route to enumerate available cycles without pulling
        all rows. Ordered alphabetically.
        """
        db = await self._ensure_db()
        cursor = await db.execute(
            "SELECT DISTINCT cycle_key FROM triangular_cycles WHERE league = ? "
            "ORDER BY cycle_key ASC",
            (league,),
        )
        rows = await cursor.fetchall()
        return [row[0] for row in rows]

    # ------------------------------------------------------------------
    # Maintenance
    # ------------------------------------------------------------------

    async def _prune_old_records(self) -> None:
        """Delete records older than the configured retention period.

        P3-2 (iter 66): Chunked delete — same pattern as `_prune_old_league_data`.
        Old leagues can accumulate millions of snapshots over a 90-day retention
        window; a single `DELETE FROM ... WHERE timestamp < ...` would lock the
        table for seconds. Chunked delete with `commit()` between batches keeps
        concurrent reads responsive.

        TD-4 (iter 128): Also prunes the ``market_spreads`` table using the
        same chunked pattern. Two independent delete loops so a failure in
        one doesn't skip the other.

        TD-3 (iter 129): Also prunes the ``triangular_cycles`` table with
        the same chunked pattern. Three independent delete loops.
        """
        db = await self._ensure_db()
        days = self._retention_days
        chunk_size = 1000
        total_deleted = 0

        while True:
            # Use rowid subquery instead of `DELETE ... LIMIT ?` (see P1-6 note above).
            cursor = await db.execute(
                "DELETE FROM price_snapshots WHERE rowid IN ("
                "  SELECT rowid FROM price_snapshots "
                "  WHERE timestamp < datetime('now', ? || ' days') LIMIT ?"
                ")",
                (f"-{days}", chunk_size),
            )
            deleted = cursor.rowcount
            total_deleted += max(deleted, 0)
            await db.commit()  # release write lock between batches
            if deleted < chunk_size:
                break  # no more old rows

        if total_deleted > 0:
            logger.info(
                "Pruned %d price snapshots older than %d days (chunk size: %d)",
                total_deleted, days, chunk_size,
            )

        # TD-4 (iter 128): prune market_spreads with the same chunked pattern.
        total_spreads_deleted = 0
        while True:
            cursor = await db.execute(
                "DELETE FROM market_spreads WHERE rowid IN ("
                "  SELECT rowid FROM market_spreads "
                "  WHERE timestamp < datetime('now', ? || ' days') LIMIT ?"
                ")",
                (f"-{days}", chunk_size),
            )
            deleted = cursor.rowcount
            total_spreads_deleted += max(deleted, 0)
            await db.commit()
            if deleted < chunk_size:
                break

        if total_spreads_deleted > 0:
            logger.info(
                "Pruned %d market_spreads rows older than %d days (chunk size: %d)",
                total_spreads_deleted, days, chunk_size,
            )

        # TD-3 (iter 129): prune triangular_cycles with the same chunked pattern.
        total_cycles_deleted = 0
        while True:
            cursor = await db.execute(
                "DELETE FROM triangular_cycles WHERE rowid IN ("
                "  SELECT rowid FROM triangular_cycles "
                "  WHERE timestamp < datetime('now', ? || ' days') LIMIT ?"
                ")",
                (f"-{days}", chunk_size),
            )
            deleted = cursor.rowcount
            total_cycles_deleted += max(deleted, 0)
            await db.commit()
            if deleted < chunk_size:
                break

        if total_cycles_deleted > 0:
            logger.info(
                "Pruned %d triangular_cycles rows older than %d days (chunk size: %d)",
                total_cycles_deleted, days, chunk_size,
            )


# ---------------------------------------------------------------------------
# Singleton
# ---------------------------------------------------------------------------

_instance: HistoricalStore | None = None
_instance_config_id: int | None = None  # Bug 27: Track config identity


def get_historical_store(config: AppConfig | None = None) -> HistoricalStore:
    """Return the global HistoricalStore instance (lazily created).

    Bug 27 fix: The singleton now respects config changes. If a different
    config object is passed after the singleton was already created, a
    warning is logged and the instance is recreated. This ensures that
    custom configs (e.g., for testing or different retention_days) are
    not silently ignored.

    Use reset_historical_store() to force recreation (e.g., in tests).
    """
    global _instance, _instance_config_id

    config_id = id(config) if config is not None else 0

    if _instance is not None:
        # Singleton exists — check if config changed
        if config is not None and _instance_config_id != config_id:
            logger.warning(
                "HistoricalStore singleton already created with a different config. "
                "Recreating with new config (retention_days=%d, db_path=%s).",
                config.data.historical_retention_days if config else 90,
                getattr(config, 'db_path', 'default') if config else 'default',
            )
            # Close old instance before replacing
            import asyncio
            try:
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    # Can't await in sync context — schedule cleanup
                    loop.create_task(_instance.close())
                else:
                    loop.run_until_complete(_instance.close())
            except Exception:
                pass  # Best-effort cleanup
            _instance = None
        else:
            return _instance

    _instance = HistoricalStore(config=config)
    _instance_config_id = config_id
    return _instance


def reset_historical_store() -> None:
    """Force recreation of the HistoricalStore singleton on next access.

    Useful for testing or when the config has fundamentally changed
    (e.g., after hot-reloading config.yaml).
    """
    global _instance, _instance_config_id
    if _instance is not None:
        import asyncio
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                loop.create_task(_instance.close())
            else:
                loop.run_until_complete(_instance.close())
        except Exception:
            pass  # Best-effort cleanup
    _instance = None
    _instance_config_id = None
