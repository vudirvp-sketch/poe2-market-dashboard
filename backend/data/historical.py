"""
Historical price store using SQLite.

Tables:
- price_snapshots: (timestamp, league, currency, price, volume_24h, bid, ask)
- events: (event_id, event_type, description, affected_currencies, created_at, expires_at, is_active, deactivated_at)

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
        """
        self._db = await aiosqlite.connect(str(self._db_path))
        self._db.row_factory = aiosqlite.Row

        # --- Auto-migration: v1 (price_chaos) → v2 (price) ---
        await self._migrate_v1_to_v2()

        await self._db.executescript(_CREATE_TABLES_SQL)
        await self._db.commit()
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
        """Write a single price snapshot."""
        db = await self._ensure_db()
        ts = (timestamp or datetime.now(timezone.utc)).isoformat()
        await db.execute(
            """INSERT INTO price_snapshots
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
    # Maintenance
    # ------------------------------------------------------------------

    async def _prune_old_records(self) -> None:
        """Delete records older than the configured retention period."""
        db = await self._ensure_db()
        days = self._retention_days

        cursor = await db.execute(
            "DELETE FROM price_snapshots WHERE timestamp < datetime('now', ? || ' days')",
            (f"-{days}",),
        )
        deleted_prices = cursor.rowcount

        await db.commit()

        if deleted_prices > 0:
            logger.info(
                "Pruned %d price snapshots older than %d days",
                deleted_prices, days,
            )


# ---------------------------------------------------------------------------
# Singleton
# ---------------------------------------------------------------------------

_instance: HistoricalStore | None = None


def get_historical_store(config: AppConfig | None = None) -> HistoricalStore:
    """Return the global HistoricalStore instance (lazily created)."""
    global _instance
    if _instance is None:
        _instance = HistoricalStore(config=config)
    return _instance
