"""
TD-5 (iter 131) — Daily Stats persistence tests.

Covers four layers:
1. ``transform_daily_stats`` / ``is_daily_stats_fresh`` /
   ``pick_top_items_by_volume`` pure helpers — shape, edge cases,
   freshness logic, top-N ranking.
2. ``HistoricalStore.write_daily_stats_batch`` /
   ``read_daily_stats`` / ``read_daily_stats_latest_date`` /
   ``read_daily_stats_items`` roundtrip + INSERT OR REPLACE behavior
   + league isolation + day_count filter.
3. ``GET /api/v1/items/{item_id}/daily-stats`` route — SQLite-first
   with lazy-fetch provider fallback. Tests fresh/stale/empty/failed
   paths.
4. ``DataScheduler.refresh_daily_stats`` — picks top-N, fetches,
   persists, tolerates per-item failures.

Design doc: docs/design/TD-3-4-5-9-persistence-gaps-design.md §4 + §5.2
+ §6.3 + §9 Phase 4.
"""

from __future__ import annotations

import asyncio
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path
from unittest.mock import patch, AsyncMock, MagicMock

# Ensure project root is on path
_project_root = Path(__file__).resolve().parent.parent
if str(_project_root) not in sys.path:
    sys.path.insert(0, str(_project_root))

import pytest

from backend.config import (
    AppConfig, LeagueConfig, DataConfig, SchedulerConfig,
)
from backend.data.historical import HistoricalStore, reset_historical_store
from backend.models.currency import CurrencyInfo, ExchangeRate


def _run(coro):
    """Run a coroutine on a fresh event loop (Python 3.14+ compatible).

    Replaces ``asyncio.get_event_loop().run_until_complete(coro)`` which
    was removed in Python 3.14 (raises ``RuntimeError: There is no
    current event loop in thread 'MainThread'`` when no loop is running).
    Each call creates a fresh loop via ``asyncio.run`` — safe for
    HistoricalStore because aiosqlite connections support cross-loop
    usage (each ``await`` binds the Future to the caller's loop, and the
    aiosqlite worker thread posts results back via
    ``loop.call_soon_threadsafe``). See KI-28 in STATUS.md.
    """
    return asyncio.run(coro)


# ---------------------------------------------------------------------------
# Shared fixtures + helpers
# ---------------------------------------------------------------------------

def _make_config(league: str = "Standard") -> AppConfig:
    return AppConfig(
        data=DataConfig(),
        league=LeagueConfig(league_name=league, base_currency="exalted"),
    )


def _make_rate(
    currency_from: str,
    currency_to: str,
    raw_rate: float,
    volume_traded: int = 100,
    highest_stock: int = 50,
) -> ExchangeRate:
    return ExchangeRate(
        currency_from=currency_from,
        currency_to=currency_to,
        raw_rate=raw_rate,
        volume_traded=volume_traded,
        highest_stock=highest_stock,
        timestamp=datetime.now(timezone.utc),
    )


def _make_snapshot(
    rates: dict[str, ExchangeRate] | None = None,
    currency_metadata: list[CurrencyInfo] | None = None,
):
    """Build a minimal DataSnapshot for pick_top_items_by_volume tests."""
    from backend.api.data_snapshot import DataSnapshot
    snapshot = DataSnapshot()
    snapshot.exchange_rates = rates or {}
    snapshot.currency_metadata = currency_metadata or []
    snapshot.valid = True
    snapshot.fetched_at = datetime.now(timezone.utc)
    return snapshot


# Sample POE2Scout DailyStatsHistory response (PascalCase keys).
_SAMPLE_PROVIDER_RESPONSE = {
    "DailyStats": [
        {"Time": "2026-07-09", "Open": 220.0, "High": 225.0, "Low": 218.0,
         "Close": 222.0, "Average": 221.5, "Volume": 5000},
        {"Time": "2026-07-10", "Open": 222.0, "High": 228.0, "Low": 220.0,
         "Close": 225.0, "Average": 224.0, "Volume": 4500},
        {"Time": "2026-07-11", "Open": 225.0, "High": 230.0, "Low": 223.0,
         "Close": 228.0, "Average": 226.5, "Volume": 4800},
    ],
    "HasMore": False,
    "BaseCurrencyApiId": "exalted",
    "BaseCurrencyText": "Exalted Orb",
}


# ===========================================================================
# 1. transform_daily_stats — pure helper tests
# ===========================================================================

class TestTransformDailyStats:
    """Verify transform_daily_stats output shape + edge cases."""

    def test_none_response_returns_empty(self):
        from backend.economy.daily_stats import transform_daily_stats
        assert transform_daily_stats(None, "Standard", 42, "divine") == []

    def test_empty_dict_returns_empty(self):
        from backend.economy.daily_stats import transform_daily_stats
        assert transform_daily_stats({}, "Standard", 42, "divine") == []

    def test_missing_daily_stats_key_returns_empty(self):
        from backend.economy.daily_stats import transform_daily_stats
        resp = {"HasMore": False, "BaseCurrencyApiId": "exalted"}
        assert transform_daily_stats(resp, "Standard", 42, "divine") == []

    def test_empty_daily_stats_list_returns_empty(self):
        from backend.economy.daily_stats import transform_daily_stats
        resp = {"DailyStats": []}
        assert transform_daily_stats(resp, "Standard", 42, "divine") == []

    def test_normal_response_produces_rows(self):
        from backend.economy.daily_stats import transform_daily_stats
        rows = transform_daily_stats(
            _SAMPLE_PROVIDER_RESPONSE, "Standard", 42, "divine",
        )
        assert len(rows) == 3
        for key in (
            "date", "item_id", "api_id", "open", "high", "low",
            "close", "average", "volume",
        ):
            assert key in rows[0], f"missing key: {key}"

    def test_date_mapped_from_time_pascalcase(self):
        from backend.economy.daily_stats import transform_daily_stats
        rows = transform_daily_stats(
            _SAMPLE_PROVIDER_RESPONSE, "Standard", 42, "divine",
        )
        assert rows[0]["date"] == "2026-07-09"
        assert rows[1]["date"] == "2026-07-10"

    def test_ohlcv_fields_mapped(self):
        from backend.economy.daily_stats import transform_daily_stats
        rows = transform_daily_stats(
            _SAMPLE_PROVIDER_RESPONSE, "Standard", 42, "divine",
        )
        row = rows[0]
        assert row["open"] == 220.0
        assert row["high"] == 225.0
        assert row["low"] == 218.0
        assert row["close"] == 222.0
        assert row["average"] == 221.5
        assert row["volume"] == 5000.0

    def test_item_id_and_api_id_echoed(self):
        from backend.economy.daily_stats import transform_daily_stats
        rows = transform_daily_stats(
            _SAMPLE_PROVIDER_RESPONSE, "Standard", 42, "divine",
        )
        assert rows[0]["item_id"] == 42
        assert rows[0]["api_id"] == "divine"

    def test_api_id_none_preserved(self):
        """api_id=None is preserved (item not in snapshot)."""
        from backend.economy.daily_stats import transform_daily_stats
        rows = transform_daily_stats(
            _SAMPLE_PROVIDER_RESPONSE, "Standard", 42, None,
        )
        assert rows[0]["api_id"] is None

    def test_accepts_lowercase_keys(self):
        """Helper accepts both PascalCase and lowercase keys."""
        from backend.economy.daily_stats import transform_daily_stats
        resp = {
            "DailyStats": [
                {"time": "2026-07-09", "open": 1.0, "high": 2.0,
                 "low": 0.5, "close": 1.5, "average": 1.25, "volume": 100},
            ],
        }
        rows = transform_daily_stats(resp, "Standard", 1, "test")
        assert len(rows) == 1
        assert rows[0]["date"] == "2026-07-09"
        assert rows[0]["open"] == 1.0
        assert rows[0]["close"] == 1.5

    def test_null_ohlcv_preserved_as_none(self):
        """POE2Scout returns null for days with no trades — preserve None."""
        from backend.economy.daily_stats import transform_daily_stats
        resp = {
            "DailyStats": [
                {"Time": "2026-07-09", "Open": None, "High": None,
                 "Low": None, "Close": None, "Average": None, "Volume": None},
            ],
        }
        rows = transform_daily_stats(resp, "Standard", 1, "test")
        assert len(rows) == 1
        assert rows[0]["open"] is None
        assert rows[0]["high"] is None
        assert rows[0]["close"] is None
        assert rows[0]["volume"] is None

    def test_non_dict_entries_skipped(self):
        """Non-dict entries in DailyStats are skipped, not crash."""
        from backend.economy.daily_stats import transform_daily_stats
        resp = {
            "DailyStats": [
                {"Time": "2026-07-09", "Close": 1.0},
                "not a dict",
                None,
                42,
                {"Time": "2026-07-10", "Close": 2.0},
            ],
        }
        rows = transform_daily_stats(resp, "Standard", 1, "test")
        assert len(rows) == 2
        assert rows[0]["date"] == "2026-07-09"
        assert rows[1]["date"] == "2026-07-10"

    def test_entry_missing_time_skipped(self):
        """Entries without a Time field are skipped."""
        from backend.economy.daily_stats import transform_daily_stats
        resp = {
            "DailyStats": [
                {"Open": 1.0, "Close": 2.0},  # no Time → skipped
                {"Time": "2026-07-09", "Close": 1.0},
            ],
        }
        rows = transform_daily_stats(resp, "Standard", 1, "test")
        assert len(rows) == 1
        assert rows[0]["date"] == "2026-07-09"

    def test_unparseable_ohlcv_becomes_none(self):
        """Non-numeric OHLCV values become None (not crash)."""
        from backend.economy.daily_stats import transform_daily_stats
        resp = {
            "DailyStats": [
                {"Time": "2026-07-09", "Open": "not a number",
                 "Close": "1.5abc", "Volume": "lots"},
            ],
        }
        rows = transform_daily_stats(resp, "Standard", 1, "test")
        assert len(rows) == 1
        assert rows[0]["open"] is None
        assert rows[0]["close"] is None
        assert rows[0]["volume"] is None


# ===========================================================================
# 2. is_daily_stats_fresh — pure helper tests
# ===========================================================================

class TestIsDailyStatsFresh:
    """Verify the lazy-fetch freshness check."""

    def _now(self) -> datetime:
        # Fixed "now" for deterministic tests: 2026-07-12 12:00 UTC.
        return datetime(2026, 7, 12, 12, 0, tzinfo=timezone.utc)

    def test_none_returns_false(self):
        from backend.economy.daily_stats import is_daily_stats_fresh
        assert is_daily_stats_fresh(None, now=self._now()) is False

    def test_empty_string_returns_false(self):
        from backend.economy.daily_stats import is_daily_stats_fresh
        assert is_daily_stats_fresh("", now=self._now()) is False

    def test_unparseable_returns_false(self):
        from backend.economy.daily_stats import is_daily_stats_fresh
        assert is_daily_stats_fresh("not-a-date", now=self._now()) is False
        assert is_daily_stats_fresh("2026/07/10", now=self._now()) is False

    def test_today_is_fresh(self):
        from backend.economy.daily_stats import is_daily_stats_fresh
        assert is_daily_stats_fresh("2026-07-12", now=self._now()) is True

    def test_yesterday_is_fresh_default_grace(self):
        from backend.economy.daily_stats import is_daily_stats_fresh
        assert is_daily_stats_fresh("2026-07-11", now=self._now()) is True

    def test_two_days_ago_not_fresh_default_grace(self):
        from backend.economy.daily_stats import is_daily_stats_fresh
        assert is_daily_stats_fresh("2026-07-10", now=self._now()) is False

    def test_future_date_not_fresh(self):
        """A future date (age < 0) is not fresh — guards clock skew."""
        from backend.economy.daily_stats import is_daily_stats_fresh
        assert is_daily_stats_fresh("2026-07-13", now=self._now()) is False

    def test_grace_zero_today_only(self):
        from backend.economy.daily_stats import is_daily_stats_fresh
        assert is_daily_stats_fresh(
            "2026-07-12", now=self._now(), grace_days=0,
        ) is True
        assert is_daily_stats_fresh(
            "2026-07-11", now=self._now(), grace_days=0,
        ) is False

    def test_grace_two_days_includes_today_yesterday_and_day_before(self):
        from backend.economy.daily_stats import is_daily_stats_fresh
        assert is_daily_stats_fresh(
            "2026-07-10", now=self._now(), grace_days=2,
        ) is True
        assert is_daily_stats_fresh(
            "2026-07-09", now=self._now(), grace_days=2,
        ) is False


# ===========================================================================
# 3. pick_top_items_by_volume — pure helper tests
# ===========================================================================

class TestPickTopItemsByVolume:
    """Verify the scheduler's top-N item picker."""

    def test_n_zero_returns_empty(self):
        from backend.economy.daily_stats import pick_top_items_by_volume
        snapshot = _make_snapshot(
            rates={"a/b": _make_rate("a", "b", 1.0)},
            currency_metadata=[CurrencyInfo(api_id="a", text="A", category_api_id="c", item_id=1)],
        )
        assert pick_top_items_by_volume(snapshot, n=0) == []

    def test_n_negative_returns_empty(self):
        from backend.economy.daily_stats import pick_top_items_by_volume
        snapshot = _make_snapshot(
            rates={"a/b": _make_rate("a", "b", 1.0)},
            currency_metadata=[CurrencyInfo(api_id="a", text="A", category_api_id="c", item_id=1)],
        )
        assert pick_top_items_by_volume(snapshot, n=-5) == []

    def test_empty_snapshot_returns_empty(self):
        from backend.economy.daily_stats import pick_top_items_by_volume
        assert pick_top_items_by_volume(_make_snapshot(), n=10) == []

    def test_no_exchange_rates_returns_empty(self):
        from backend.economy.daily_stats import pick_top_items_by_volume
        snapshot = _make_snapshot(
            rates={},
            currency_metadata=[CurrencyInfo(api_id="a", text="A", category_api_id="c", item_id=1)],
        )
        assert pick_top_items_by_volume(snapshot, n=10) == []

    def test_no_metadata_returns_empty(self):
        """Currencies with no item_id in metadata are skipped."""
        from backend.economy.daily_stats import pick_top_items_by_volume
        snapshot = _make_snapshot(
            rates={"a/b": _make_rate("a", "b", 1.0, volume_traded=100)},
            currency_metadata=[],
        )
        assert pick_top_items_by_volume(snapshot, n=10) == []

    def test_single_item_returned(self):
        from backend.economy.daily_stats import pick_top_items_by_volume
        snapshot = _make_snapshot(
            rates={"a/b": _make_rate("a", "b", 1.0, volume_traded=100)},
            currency_metadata=[
                CurrencyInfo(api_id="a", text="A", category_api_id="c", item_id=1),
                CurrencyInfo(api_id="b", text="B", category_api_id="c", item_id=2),
            ],
        )
        result = pick_top_items_by_volume(snapshot, n=10)
        assert len(result) == 2
        assert (1, "a") in result
        assert (2, "b") in result

    def test_ranked_by_volume_descending(self):
        """Higher-volume items come first."""
        from backend.economy.daily_stats import pick_top_items_by_volume
        snapshot = _make_snapshot(
            rates={
                "a/b": _make_rate("a", "b", 1.0, volume_traded=100),
                "b/c": _make_rate("b", "c", 1.0, volume_traded=500),
                "c/d": _make_rate("c", "d", 1.0, volume_traded=50),
            },
            currency_metadata=[
                CurrencyInfo(api_id="a", text="A", category_api_id="c", item_id=1),
                CurrencyInfo(api_id="b", text="B", category_api_id="c", item_id=2),
                CurrencyInfo(api_id="c", text="C", category_api_id="c", item_id=3),
                CurrencyInfo(api_id="d", text="D", category_api_id="c", item_id=4),
            ],
        )
        result = pick_top_items_by_volume(snapshot, n=10)
        # b has volume 100+500=600, a has 100, c has 500+50=550, d has 50
        # Expected order: b(600), c(550), a(100), d(50)
        item_ids = [iid for iid, _ in result]
        assert item_ids == [2, 3, 1, 4]

    def test_n_limit_respected(self):
        from backend.economy.daily_stats import pick_top_items_by_volume
        snapshot = _make_snapshot(
            rates={
                "a/b": _make_rate("a", "b", 1.0, volume_traded=100),
                "b/c": _make_rate("b", "c", 1.0, volume_traded=500),
                "c/d": _make_rate("c", "d", 1.0, volume_traded=50),
            },
            currency_metadata=[
                CurrencyInfo(api_id="a", text="A", category_api_id="c", item_id=1),
                CurrencyInfo(api_id="b", text="B", category_api_id="c", item_id=2),
                CurrencyInfo(api_id="c", text="C", category_api_id="c", item_id=3),
                CurrencyInfo(api_id="d", text="D", category_api_id="c", item_id=4),
            ],
        )
        result = pick_top_items_by_volume(snapshot, n=2)
        assert len(result) == 2
        assert result[0] == (2, "b")  # highest volume
        assert result[1] == (3, "c")  # second highest

    def test_item_id_zero_skipped(self):
        """Items with item_id=0 cannot be queried via DailyStatsHistory."""
        from backend.economy.daily_stats import pick_top_items_by_volume
        snapshot = _make_snapshot(
            rates={"a/b": _make_rate("a", "b", 1.0, volume_traded=100)},
            currency_metadata=[
                CurrencyInfo(api_id="a", text="A", category_api_id="c", item_id=0),
                CurrencyInfo(api_id="b", text="B", category_api_id="c", item_id=2),
            ],
        )
        result = pick_top_items_by_volume(snapshot, n=10)
        assert result == [(2, "b")]

    def test_duplicate_item_id_deduplicated(self):
        """Same item_id appearing twice in metadata is only returned once."""
        from backend.economy.daily_stats import pick_top_items_by_volume
        snapshot = _make_snapshot(
            rates={"a/b": _make_rate("a", "b", 1.0, volume_traded=100)},
            currency_metadata=[
                CurrencyInfo(api_id="a", text="A", category_api_id="c", item_id=1),
                CurrencyInfo(api_id="A", text="A dup", category_api_id="c", item_id=1),
                CurrencyInfo(api_id="b", text="B", category_api_id="c", item_id=2),
            ],
        )
        result = pick_top_items_by_volume(snapshot, n=10)
        item_ids = [iid for iid, _ in result]
        assert item_ids.count(1) == 1

    def test_case_insensitive_api_id_match(self):
        """api_id in exchange_rates may be lowercase while metadata has
        original-case. Match should be case-insensitive."""
        from backend.economy.daily_stats import pick_top_items_by_volume
        snapshot = _make_snapshot(
            # exchange_rates key uses "Divine" (capital D)
            rates={"Divine/exalted": _make_rate("Divine", "exalted", 1.0, volume_traded=100)},
            currency_metadata=[
                # metadata has lowercase api_id "divine"
                CurrencyInfo(api_id="divine", text="Divine Orb", category_api_id="c", item_id=42),
            ],
        )
        result = pick_top_items_by_volume(snapshot, n=10)
        # Should match case-insensitively and return original-case api_id
        assert len(result) == 1
        assert result[0] == (42, "divine")


# ===========================================================================
# 4. HistoricalStore daily_stats persistence tests
# ===========================================================================

class TestHistoricalStoreDailyStats:
    """Roundtrip + INSERT OR REPLACE + read helpers + league isolation."""

    @pytest.fixture(autouse=True)
    def _reset_store(self):
        reset_historical_store()
        yield
        reset_historical_store()

    @pytest.fixture
    def store(self, tmp_path):
        config = _make_config()
        s = HistoricalStore(db_path=tmp_path / "test_daily.db", config=config)
        s._db = None
        return s

    @pytest.mark.asyncio
    async def test_write_and_read_roundtrip(self, store):
        """write_daily_stats_batch then read_daily_stats returns the rows."""
        await store.init()
        try:
            rows = [
                {"date": "2026-07-09", "item_id": 42, "api_id": "divine",
                 "open": 220.0, "high": 225.0, "low": 218.0, "close": 222.0,
                 "average": 221.5, "volume": 5000},
                {"date": "2026-07-10", "item_id": 42, "api_id": "divine",
                 "open": 222.0, "high": 228.0, "low": 220.0, "close": 225.0,
                 "average": 224.0, "volume": 4500},
            ]
            written = await store.write_daily_stats_batch(league="Standard", rows=rows)
            assert written == 2

            read_back = await store.read_daily_stats(
                league="Standard", item_id=42, day_count=30,
            )
            assert len(read_back) == 2
            assert read_back[0]["date"] == "2026-07-09"
            assert read_back[0]["close"] == 222.0
            assert read_back[0]["api_id"] == "divine"
            assert read_back[1]["date"] == "2026-07-10"
        finally:
            await store.close()

    @pytest.mark.asyncio
    async def test_insert_or_replace_overwrites_same_day(self, store):
        """A re-fetch for the same (date, league, item_id) overwrites the row.

        This is the key difference from triangular_cycles/market_spreads
        which use INSERT OR IGNORE. POE2Scout may revise a day's candle.
        """
        await store.init()
        try:
            row1 = [{"date": "2026-07-09", "item_id": 42, "api_id": "divine",
                     "open": 220.0, "high": 225.0, "low": 218.0, "close": 222.0,
                     "average": 221.5, "volume": 5000}]
            await store.write_daily_stats_batch(league="Standard", rows=row1)

            # Re-fetch same day with revised close price.
            row2 = [{"date": "2026-07-09", "item_id": 42, "api_id": "divine",
                     "open": 220.0, "high": 226.0, "low": 218.0, "close": 230.0,
                     "average": 223.0, "volume": 5200}]
            await store.write_daily_stats_batch(league="Standard", rows=row2)

            read_back = await store.read_daily_stats(
                league="Standard", item_id=42, day_count=30,
            )
            assert len(read_back) == 1  # NOT 2 — overwrote
            assert read_back[0]["close"] == 230.0
            assert read_back[0]["volume"] == 5200
        finally:
            await store.close()

    @pytest.mark.asyncio
    async def test_empty_write_returns_zero(self, store):
        await store.init()
        try:
            written = await store.write_daily_stats_batch(league="Standard", rows=[])
            assert written == 0
        finally:
            await store.close()

    @pytest.mark.asyncio
    async def test_empty_read_returns_empty_list(self, store):
        await store.init()
        try:
            rows = await store.read_daily_stats(
                league="Standard", item_id=999, day_count=30,
            )
            assert rows == []
        finally:
            await store.close()

    @pytest.mark.asyncio
    async def test_read_latest_date_returns_max(self, store):
        await store.init()
        try:
            rows = [
                {"date": "2026-07-08", "item_id": 42, "api_id": "divine",
                 "close": 1.0},
                {"date": "2026-07-10", "item_id": 42, "api_id": "divine",
                 "close": 2.0},
                {"date": "2026-07-09", "item_id": 42, "api_id": "divine",
                 "close": 1.5},
            ]
            await store.write_daily_stats_batch(league="Standard", rows=rows)
            latest = await store.read_daily_stats_latest_date(
                league="Standard", item_id=42,
            )
            assert latest == "2026-07-10"
        finally:
            await store.close()

    @pytest.mark.asyncio
    async def test_read_latest_date_none_when_no_rows(self, store):
        await store.init()
        try:
            latest = await store.read_daily_stats_latest_date(
                league="Standard", item_id=999,
            )
            assert latest is None
        finally:
            await store.close()

    @pytest.mark.asyncio
    async def test_read_items_returns_distinct_pairs(self, store):
        await store.init()
        try:
            rows = [
                {"date": "2026-07-09", "item_id": 42, "api_id": "divine", "close": 1.0},
                {"date": "2026-07-10", "item_id": 42, "api_id": "divine", "close": 2.0},
                {"date": "2026-07-09", "item_id": 7, "api_id": "exalted", "close": 3.0},
            ]
            await store.write_daily_stats_batch(league="Standard", rows=rows)
            items = await store.read_daily_stats_items(league="Standard")
            assert (7, "exalted") in items
            assert (42, "divine") in items
            assert len(items) == 2
        finally:
            await store.close()

    @pytest.mark.asyncio
    async def test_league_isolation(self, store):
        """Rows for LeagueA are not visible to LeagueB."""
        await store.init()
        try:
            rows = [{"date": "2026-07-09", "item_id": 42, "api_id": "divine",
                     "close": 1.0}]
            await store.write_daily_stats_batch(league="LeagueA", rows=rows)

            rows_b = await store.read_daily_stats(
                league="LeagueB", item_id=42, day_count=30,
            )
            assert rows_b == []

            rows_a = await store.read_daily_stats(
                league="LeagueA", item_id=42, day_count=30,
            )
            assert len(rows_a) == 1
        finally:
            await store.close()

    @pytest.mark.asyncio
    async def test_day_count_filter(self, store):
        """day_count limits the lookback window."""
        await store.init()
        try:
            # Insert rows: today, 10 days ago, 100 days ago.
            from datetime import date, timedelta
            today = date(2026, 7, 12)
            rows = [
                {"date": (today - timedelta(days=100)).isoformat(),
                 "item_id": 42, "api_id": "divine", "close": 1.0},
                {"date": (today - timedelta(days=10)).isoformat(),
                 "item_id": 42, "api_id": "divine", "close": 2.0},
                {"date": today.isoformat(),
                 "item_id": 42, "api_id": "divine", "close": 3.0},
            ]
            await store.write_daily_stats_batch(league="Standard", rows=rows)

            # day_count=30 should return only the 10-day-ago + today rows.
            read_30 = await store.read_daily_stats(
                league="Standard", item_id=42, day_count=30,
            )
            assert len(read_30) == 2

            # day_count=365 should return all 3.
            read_365 = await store.read_daily_stats(
                league="Standard", item_id=42, day_count=365,
            )
            assert len(read_365) == 3
        finally:
            await store.close()

    @pytest.mark.asyncio
    async def test_null_ohlcv_preserved_through_roundtrip(self, store):
        """NULL OHLCV values survive the write → read roundtrip."""
        await store.init()
        try:
            rows = [{"date": "2026-07-09", "item_id": 42, "api_id": "divine",
                     "open": None, "high": None, "low": None, "close": None,
                     "average": None, "volume": None}]
            await store.write_daily_stats_batch(league="Standard", rows=rows)
            read_back = await store.read_daily_stats(
                league="Standard", item_id=42, day_count=30,
            )
            assert len(read_back) == 1
            assert read_back[0]["open"] is None
            assert read_back[0]["close"] is None
            assert read_back[0]["volume"] is None
        finally:
            await store.close()

    @pytest.mark.asyncio
    async def test_api_id_null_preserved(self, store):
        """api_id=None is preserved (item not in snapshot)."""
        await store.init()
        try:
            rows = [{"date": "2026-07-09", "item_id": 42, "api_id": None,
                     "close": 1.0}]
            await store.write_daily_stats_batch(league="Standard", rows=rows)
            read_back = await store.read_daily_stats(
                league="Standard", item_id=42, day_count=30,
            )
            assert read_back[0]["api_id"] is None
        finally:
            await store.close()


# ===========================================================================
# 5. Route tests — GET /api/v1/items/{item_id}/daily-stats
# ===========================================================================

class TestDailyStatsRoute:
    """Route tests: SQLite-first with lazy-fetch provider fallback."""

    @pytest.fixture(autouse=True)
    def _reset_store(self):
        reset_historical_store()
        yield
        reset_historical_store()

    @pytest.fixture
    def route_client(self, tmp_path):
        """TestClient with a temp HistoricalStore DB + patched provider/snapshot."""
        from fastapi.testclient import TestClient
        from backend.main import app
        from backend.api import routes_daily_stats, shared
        from backend.data import historical as historical_module

        config = _make_config()
        store = HistoricalStore(db_path=tmp_path / "route_test.db", config=config)

        def _fake_get_historical_store(cfg=None):
            return store

        # Build a mock provider for the lazy-fetch fallback.
        mock_provider = MagicMock()
        mock_provider.get_daily_stats = AsyncMock(return_value=None)

        # Build a mock snapshot with empty currency_metadata
        # (so _resolve_api_id returns None).
        mock_snapshot = MagicMock()
        mock_snapshot.currency_metadata = []

        with patch.object(historical_module, "get_historical_store", _fake_get_historical_store), \
             patch.object(routes_daily_stats, "get_settings", return_value=config), \
             patch.object(shared, "get_provider", return_value=mock_provider), \
             patch("backend.api.data_snapshot.get_snapshot", new=AsyncMock(return_value=mock_snapshot)):
            with TestClient(app) as client:
                yield client, store, mock_provider

    def test_empty_returns_200_with_data_available_false(self, route_client):
        """No SQLite rows + provider returns None → empty response."""
        client, store, mock_provider = route_client
        # Initialize store so reads don't fail.
        _run(store.init())
        try:
            resp = client.get("/api/v1/items/42/daily-stats")
            assert resp.status_code == 200
            data = resp.json()
            assert data["data_available"] is False
            assert data["points"] == []
            assert data["item_id"] == 42
            assert data["source"] == "empty"
        finally:
            _run(store.close())

    def test_fresh_sqlite_served_from_cache(self, route_client):
        """When SQLite has fresh rows (today), source='sqlite'."""
        client, store, mock_provider = route_client
        from datetime import date
        today = date(2026, 7, 12).isoformat()

        async def _seed():
            await store.init()
            await store.write_daily_stats_batch(
                league="Standard",
                rows=[
                    {"date": today, "item_id": 42, "api_id": "divine",
                     "open": 1.0, "close": 2.0, "high": 2.5, "low": 0.5,
                     "average": 1.5, "volume": 100},
                ],
            )
        _run(_seed())
        try:
            # Patch is_daily_stats_fresh to return True for this test
            # (since the seeded date may not be "today" in the test env).
            with patch("backend.economy.daily_stats.is_daily_stats_fresh", return_value=True):
                resp = client.get("/api/v1/items/42/daily-stats")
            assert resp.status_code == 200
            data = resp.json()
            assert data["data_available"] is True
            assert data["source"] == "sqlite"
            assert len(data["points"]) == 1
            assert data["points"][0]["close"] == 2.0
            # Provider should NOT have been called.
            mock_provider.get_daily_stats.assert_not_called()
        finally:
            _run(store.close())

    def test_stale_sqlite_triggers_provider_fetch(self, route_client):
        """When SQLite is stale, lazy-fetch from provider + persist."""
        client, store, mock_provider = route_client

        async def _seed():
            await store.init()
            # Seed a stale row (old date).
            await store.write_daily_stats_batch(
                league="Standard",
                rows=[{"date": "2026-01-01", "item_id": 42, "api_id": "divine",
                       "close": 1.0}],
            )
        _run(_seed())

        # Provider returns fresh data.
        mock_provider.get_daily_stats = AsyncMock(
            return_value={
                "DailyStats": [
                    {"Time": "2026-07-11", "Open": 10.0, "High": 11.0,
                     "Low": 9.0, "Close": 10.5, "Average": 10.25, "Volume": 200},
                    {"Time": "2026-07-12", "Open": 10.5, "High": 12.0,
                     "Low": 10.0, "Close": 11.5, "Average": 11.0, "Volume": 250},
                ],
            },
        )

        try:
            # Force is_daily_stats_fresh to return False (stale).
            with patch("backend.economy.daily_stats.is_daily_stats_fresh", return_value=False):
                resp = client.get("/api/v1/items/42/daily-stats")
            assert resp.status_code == 200
            data = resp.json()
            assert data["source"] == "provider"
            assert data["data_available"] is True
            assert len(data["points"]) == 2
            assert data["points"][0]["close"] == 10.5
            # Provider was called.
            mock_provider.get_daily_stats.assert_called_once()
        finally:
            _run(store.close())

    def test_provider_failure_falls_back_to_sqlite(self, route_client):
        """When provider raises, fall back to whatever SQLite has."""
        client, store, mock_provider = route_client

        async def _seed():
            await store.init()
            await store.write_daily_stats_batch(
                league="Standard",
                rows=[{"date": "2026-01-01", "item_id": 42, "api_id": "divine",
                       "close": 1.0}],
            )
        _run(_seed())

        # Provider raises.
        mock_provider.get_daily_stats = AsyncMock(side_effect=ConnectionError("API down"))

        try:
            with patch("backend.economy.daily_stats.is_daily_stats_fresh", return_value=False):
                resp = client.get("/api/v1/items/42/daily-stats?day_count=365")
            assert resp.status_code == 200
            data = resp.json()
            # Provider failed, fell back to SQLite's stale row.
            assert data["data_available"] is True
            assert len(data["points"]) == 1
            assert data["points"][0]["close"] == 1.0
            # Source is 'sqlite' because we served from SQLite (the empty
            # provider_rows path falls through to the SQLite read).
            assert data["source"] == "sqlite"
        finally:
            _run(store.close())

    def test_item_id_path_param_validation(self, route_client):
        """item_id must be >= 1."""
        client, store, _ = route_client
        _run(store.init())
        try:
            # 0 and -1 should be 422 (path param ge=1 validation).
            assert client.get("/api/v1/items/0/daily-stats").status_code == 422
        finally:
            _run(store.close())

    def test_day_count_query_param_validation(self, route_client):
        """day_count must be 1..365."""
        client, store, _ = route_client
        _run(store.init())
        try:
            assert client.get(
                "/api/v1/items/42/daily-stats?day_count=0",
            ).status_code == 422
            assert client.get(
                "/api/v1/items/42/daily-stats?day_count=366",
            ).status_code == 422
            # Valid bounds pass (200, not 422).
            assert client.get(
                "/api/v1/items/42/daily-stats?day_count=1",
            ).status_code == 200
            assert client.get(
                "/api/v1/items/42/daily-stats?day_count=365",
            ).status_code == 200
        finally:
            _run(store.close())


# ===========================================================================
# 6. Scheduler.refresh_daily_stats tests
# ===========================================================================

class TestSchedulerRefreshDailyStats:
    """Test DataScheduler.refresh_daily_stats()."""

    @pytest.fixture(autouse=True)
    def _reset_store(self):
        reset_historical_store()
        yield
        reset_historical_store()

    @pytest.fixture
    def config(self):
        return AppConfig(
            data=DataConfig(),
            league=LeagueConfig(league_name="Standard", base_currency="exalted"),
            scheduler=SchedulerConfig(
                enabled=True,
                daily_stats_top_n_items=5,
            ),
        )

    @pytest.fixture
    async def historical_store(self, tmp_path, config):
        store = HistoricalStore(db_path=tmp_path / "sched_test.db", config=config)
        await store.init()
        yield store
        await store.close()

    @pytest.fixture
    def event_manager(self, config):
        from backend.economy.events import EventManager
        return EventManager(config=config)

    @pytest.fixture
    def scheduler(self, historical_store, event_manager, config):
        from backend.scheduler import DataScheduler
        mock_provider = MagicMock()
        return DataScheduler(
            provider=mock_provider,
            historical_store=historical_store,
            event_manager=event_manager,
            config=config,
        )

    @pytest.mark.asyncio
    async def test_no_items_returns_zero(self, scheduler):
        """When snapshot has no items with item_id, returns 0."""
        empty_snapshot = _make_snapshot(rates={}, currency_metadata=[])
        with patch("backend.scheduler._get_snapshot", new=AsyncMock(return_value=empty_snapshot)):
            count = await scheduler.refresh_daily_stats()
        assert count == 0

    @pytest.mark.asyncio
    async def test_happy_path_persists_rows(self, scheduler, historical_store):
        """Items are fetched + transformed + persisted."""
        snapshot = _make_snapshot(
            rates={"divine/exalted": _make_rate("divine", "exalted", 1.0, volume_traded=500)},
            currency_metadata=[
                CurrencyInfo(api_id="divine", text="Divine", category_api_id="c", item_id=42),
            ],
        )
        scheduler._provider.get_daily_stats = AsyncMock(return_value={
            "DailyStats": [
                {"Time": "2026-07-11", "Open": 10.0, "High": 11.0,
                 "Low": 9.0, "Close": 10.5, "Average": 10.25, "Volume": 200},
            ],
        })

        with patch("backend.scheduler._get_snapshot", new=AsyncMock(return_value=snapshot)):
            count = await scheduler.refresh_daily_stats()

        assert count == 1  # one row persisted
        # Verify it landed in SQLite.
        rows = await historical_store.read_daily_stats(
            league="Standard", item_id=42, day_count=30,
        )
        assert len(rows) == 1
        assert rows[0]["close"] == 10.5

    @pytest.mark.asyncio
    async def test_provider_failure_on_one_item_continues(
        self, scheduler, historical_store,
    ):
        """A failure on one item does not abort the whole refresh."""
        snapshot = _make_snapshot(
            rates={
                "divine/exalted": _make_rate("divine", "exalted", 1.0, volume_traded=500),
                "mirror/exalted": _make_rate("mirror", "exalted", 1.0, volume_traded=400),
            },
            currency_metadata=[
                CurrencyInfo(api_id="divine", text="Divine", category_api_id="c", item_id=42),
                CurrencyInfo(api_id="mirror", text="Mirror", category_api_id="c", item_id=77),
            ],
        )

        # item_id=42 succeeds, item_id=77 raises.
        async def _mock_get_daily_stats(league, item_id, day_count):
            if item_id == 42:
                return {"DailyStats": [{"Time": "2026-07-11", "Close": 10.5, "Volume": 100}]}
            raise ConnectionError("API down for mirror")

        scheduler._provider.get_daily_stats = AsyncMock(side_effect=_mock_get_daily_stats)

        with patch("backend.scheduler._get_snapshot", new=AsyncMock(return_value=snapshot)):
            count = await scheduler.refresh_daily_stats()

        # Only divine (42) succeeded.
        assert count == 1
        rows_42 = await historical_store.read_daily_stats(
            league="Standard", item_id=42, day_count=30,
        )
        assert len(rows_42) == 1
        rows_77 = await historical_store.read_daily_stats(
            league="Standard", item_id=77, day_count=30,
        )
        assert rows_77 == []

    @pytest.mark.asyncio
    async def test_top_n_config_respected(self, scheduler):
        """The scheduler only fetches the top-N items (config-driven)."""
        # 3 items with different volumes.
        snapshot = _make_snapshot(
            rates={
                "a/b": _make_rate("a", "b", 1.0, volume_traded=100),
                "c/d": _make_rate("c", "d", 1.0, volume_traded=200),
                "e/f": _make_rate("e", "f", 1.0, volume_traded=50),
            },
            currency_metadata=[
                CurrencyInfo(api_id="a", text="A", category_api_id="c", item_id=1),
                CurrencyInfo(api_id="b", text="B", category_api_id="c", item_id=2),
                CurrencyInfo(api_id="c", text="C", category_api_id="c", item_id=3),
                CurrencyInfo(api_id="d", text="D", category_api_id="c", item_id=4),
                CurrencyInfo(api_id="e", text="E", category_api_id="c", item_id=5),
                CurrencyInfo(api_id="f", text="F", category_api_id="c", item_id=6),
            ],
        )
        scheduler._provider.get_daily_stats = AsyncMock(return_value={
            "DailyStats": [{"Time": "2026-07-11", "Close": 1.0, "Volume": 10}],
        })

        # config has daily_stats_top_n_items=5.
        with patch("backend.scheduler._get_snapshot", new=AsyncMock(return_value=snapshot)):
            await scheduler.refresh_daily_stats()

        # Provider should have been called at most 5 times (top_n=5),
        # NOT 6 (there are 6 items but only top-5 by volume are picked).
        assert scheduler._provider.get_daily_stats.call_count <= 5

    @pytest.mark.asyncio
    async def test_snapshot_failure_returns_zero(self, scheduler):
        """When get_snapshot raises, refresh returns 0 (not crash)."""
        with patch("backend.scheduler._get_snapshot", new=AsyncMock(side_effect=Exception("snapshot down"))):
            count = await scheduler.refresh_daily_stats()
        assert count == 0
