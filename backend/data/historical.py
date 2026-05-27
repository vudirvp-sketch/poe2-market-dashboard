"""
Historical price store using SQLite.

Tables:
- price_snapshots: (timestamp, league, currency, price_chaos, volume_24h, bid, ask)
- gold_chaos_rates: (timestamp, league, rate)

Write: every time current prices are fetched successfully.
Read: for any model that needs history.
Retention: configurable, default 90 days. Older records pruned on startup.
"""

from __future__ import annotations

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
    price_chaos REAL,
    volume_24h REAL,
    bid REAL,
    ask REAL
);

CREATE INDEX IF NOT EXISTS idx_price_snapshots_ts
    ON price_snapshots(timestamp);

CREATE INDEX IF NOT EXISTS idx_price_snapshots_league_curr
    ON price_snapshots(league, currency);

CREATE TABLE IF NOT EXISTS gold_chaos_rates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    league TEXT NOT NULL,
    rate REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gold_chaos_rates_ts
    ON gold_chaos_rates(timestamp);
"""


class HistoricalStore:
    """SQLite-backed historical price store."""

    def __init__(self, db_path: str | Path | None = None, config: AppConfig | None = None):
        self._config = config or get_settings()
        self._db_path = Path(db_path) if db_path else _DB_PATH
        self._db: aiosqlite.Connection | None = None
        self._retention_days = self._config.data.historical_retention_days

    async def init(self) -> None:
        """Initialize the database and create tables. Must be called once on startup."""
        self._db = await aiosqlite.connect(str(self._db_path))
        self._db.row_factory = aiosqlite.Row
        await self._db.executescript(_CREATE_TABLES_SQL)
        await self._db.commit()
        await self._prune_old_records()

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
    # Writes
    # ------------------------------------------------------------------

    async def write_price_snapshot(
        self,
        league: str,
        currency: str,
        price_chaos: float | None,
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
               (timestamp, league, currency, price_chaos, volume_24h, bid, ask)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (ts, league, currency, price_chaos, volume_24h, bid, ask),
        )
        await db.commit()

    async def write_gold_chaos_rate(
        self,
        league: str,
        rate: float,
        timestamp: datetime | None = None,
    ) -> None:
        """Write an observed gold→chaos conversion rate."""
        db = await self._ensure_db()
        ts = (timestamp or datetime.now(timezone.utc)).isoformat()
        await db.execute(
            "INSERT INTO gold_chaos_rates (timestamp, league, rate) VALUES (?, ?, ?)",
            (ts, league, rate),
        )
        await db.commit()

    async def write_price_snapshots_batch(
        self,
        league: str,
        snapshots: list[dict],
        timestamp: datetime | None = None,
    ) -> None:
        """Write multiple price snapshots in a single transaction."""
        db = await self._ensure_db()
        ts = (timestamp or datetime.now(timezone.utc)).isoformat()

        rows = [
            (
                ts,
                league,
                s.get("currency", ""),
                s.get("price_chaos"),
                s.get("volume_24h"),
                s.get("bid"),
                s.get("ask"),
            )
            for s in snapshots
        ]

        await db.executemany(
            """INSERT INTO price_snapshots
               (timestamp, league, currency, price_chaos, volume_24h, bid, ask)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            rows,
        )
        await db.commit()

    # ------------------------------------------------------------------
    # Reads
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
            """SELECT timestamp, currency, price_chaos, volume_24h, bid, ask
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
                "price_chaos": row[2],
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
            """SELECT ps.timestamp, ps.currency, ps.price_chaos, ps.volume_24h, ps.bid, ps.ask
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
                "price_chaos": row[2],
                "volume_24h": row[3],
                "bid": row[4],
                "ask": row[5],
            }
            for row in rows
        ]

    async def get_gold_chaos_rates(
        self, league: str, days: int = 7
    ) -> list[dict]:
        """Get historical gold→chaos rates for a league."""
        db = await self._ensure_db()
        cursor = await db.execute(
            """SELECT timestamp, league, rate
               FROM gold_chaos_rates
               WHERE league = ?
                 AND timestamp >= datetime('now', ? || ' days')
               ORDER BY timestamp ASC""",
            (league, f"-{days}"),
        )
        rows = await cursor.fetchall()
        return [{"timestamp": row[0], "league": row[1], "rate": row[2]} for row in rows]

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

        cursor = await db.execute(
            "DELETE FROM gold_chaos_rates WHERE timestamp < datetime('now', ? || ' days')",
            (f"-{days}",),
        )
        deleted_rates = cursor.rowcount

        await db.commit()

        if deleted_prices > 0 or deleted_rates > 0:
            logger.info(
                "Pruned %d price snapshots and %d gold/chaos rates older than %d days",
                deleted_prices, deleted_rates, days,
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
