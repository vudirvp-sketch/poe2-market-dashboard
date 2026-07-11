"""
TD-4 (iter 128) — /api/v1/market-spreads/history route integration tests.

Verifies the route:
1. Returns 200 with data_available=false + empty points when no rows exist.
2. Returns persisted rows when rows exist.
3. Honors the pair filter.
4. Honors the days parameter.
5. available_pairs is populated correctly.
6. Returns 200 (not 500) when HistoricalStore raises — graceful degradation.

Same TestClient pattern as test_flips_integration.py.
"""

from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch, AsyncMock

# Ensure project root is on path
_project_root = Path(__file__).resolve().parent.parent
if str(_project_root) not in sys.path:
    sys.path.insert(0, str(_project_root))

import pytest

from backend.config import AppConfig, LeagueConfig, DataConfig
from backend.data.historical import HistoricalStore, reset_historical_store


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _reset_store():
    """Reset the HistoricalStore singleton before and after each test."""
    reset_historical_store()
    yield
    reset_historical_store()


@pytest.fixture
def route_client(tmp_path):
    """TestClient with a temp HistoricalStore DB.

    Patches get_historical_store to return a fresh store backed by a temp
    DB so the test doesn't touch the real historical.db.
    """
    from fastapi.testclient import TestClient
    from backend.main import app
    from backend.api import routes_market_spreads
    from backend.data import historical as historical_module

    config = AppConfig(
        data=DataConfig(),
        league=LeagueConfig(league_name="Standard", base_currency="exalted"),
    )

    # Create a fresh store with a temp DB path
    store = HistoricalStore(db_path=tmp_path / "route_test.db", config=config)

    # Patch the module-level get_historical_store to return our test store
    # for both routes_market_spreads and data_snapshot imports.
    def _fake_get_historical_store(cfg=None):
        return store

    with patch.object(historical_module, "get_historical_store", _fake_get_historical_store), \
         patch.object(routes_market_spreads, "get_settings", return_value=config):
        with TestClient(app) as client:
            yield client, store


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestMarketSpreadsRouteEmpty:
    """When no rows are persisted, the route returns data_available=false."""

    def test_returns_200_with_data_available_false(self, route_client):
        client, store = route_client
        resp = client.get("/api/v1/market-spreads/history")
        assert resp.status_code == 200
        data = resp.json()
        assert data["data_available"] is False
        assert data["points"] == []
        assert data["available_pairs"] == []
        assert data["league"] == "Standard"
        assert data["days"] == 30
        assert data["pair"] is None
        assert "fetched_at" in data

    def test_fetched_at_is_iso_string(self, route_client):
        client, _ = route_client
        resp = client.get("/api/v1/market-spreads/history")
        data = resp.json()
        # Should parse as an ISO datetime
        datetime.fromisoformat(data["fetched_at"].replace("Z", "+00:00"))


class TestMarketSpreadsRouteWithRows:
    """When rows are persisted, the route returns them."""

    def test_returns_rows_when_persisted(self, route_client):
        client, store = route_client
        # Seed rows
        import asyncio
        async def _seed():
            await store.init()
            await store.write_market_spreads_batch(
                league="Standard",
                spreads=[
                    {"pair_key": "exalted/divine", "currency_from": "exalted", "currency_to": "divine",
                     "raw_rate": 0.15, "volume_24h": 500.0, "market_spread": 0.05,
                     "total_spread": 0.06, "momentum_factor": 0.2, "bfs_widening_factor": 1.0},
                    {"pair_key": "exalted/mirror", "currency_from": "exalted", "currency_to": "mirror",
                     "raw_rate": 0.001, "volume_24h": 50.0, "market_spread": 0.08,
                     "total_spread": 0.10, "momentum_factor": 0.25, "bfs_widening_factor": 1.0},
                ],
                timestamp=datetime.now(timezone.utc),
            )
        asyncio.run(_seed())

        resp = client.get("/api/v1/market-spreads/history")
        assert resp.status_code == 200
        data = resp.json()
        assert data["data_available"] is True
        assert len(data["points"]) == 2
        pair_keys = {p["pair_key"] for p in data["points"]}
        assert pair_keys == {"exalted/divine", "exalted/mirror"}

    def test_pair_filter_returns_only_matching_rows(self, route_client):
        client, store = route_client
        import asyncio
        async def _seed():
            await store.init()
            await store.write_market_spreads_batch(
                league="Standard",
                spreads=[
                    {"pair_key": "exalted/divine", "currency_from": "exalted", "currency_to": "divine",
                     "raw_rate": 0.15, "volume_24h": 500.0, "market_spread": 0.05,
                     "total_spread": 0.06, "momentum_factor": 0.2, "bfs_widening_factor": 1.0},
                    {"pair_key": "exalted/mirror", "currency_from": "exalted", "currency_to": "mirror",
                     "raw_rate": 0.001, "volume_24h": 50.0, "market_spread": 0.08,
                     "total_spread": 0.10, "momentum_factor": 0.25, "bfs_widening_factor": 1.0},
                ],
                timestamp=datetime.now(timezone.utc),
            )
        asyncio.run(_seed())

        resp = client.get("/api/v1/market-spreads/history?pair=exalted/divine")
        assert resp.status_code == 200
        data = resp.json()
        assert data["pair"] == "exalted/divine"
        assert len(data["points"]) == 1
        assert data["points"][0]["pair_key"] == "exalted/divine"

    def test_available_pairs_populated(self, route_client):
        client, store = route_client
        import asyncio
        async def _seed():
            await store.init()
            await store.write_market_spreads_batch(
                league="Standard",
                spreads=[
                    {"pair_key": "exalted/divine", "currency_from": "exalted", "currency_to": "divine",
                     "raw_rate": 0.15, "volume_24h": 500.0, "market_spread": 0.05,
                     "total_spread": 0.06, "momentum_factor": 0.2, "bfs_widening_factor": 1.0},
                    {"pair_key": "exalted/mirror", "currency_from": "exalted", "currency_to": "mirror",
                     "raw_rate": 0.001, "volume_24h": 50.0, "market_spread": 0.08,
                     "total_spread": 0.10, "momentum_factor": 0.25, "bfs_widening_factor": 1.0},
                ],
                timestamp=datetime.now(timezone.utc),
            )
        asyncio.run(_seed())

        resp = client.get("/api/v1/market-spreads/history")
        data = resp.json()
        assert "exalted/divine" in data["available_pairs"]
        assert "exalted/mirror" in data["available_pairs"]
        # Available pairs should be sorted alphabetically
        assert data["available_pairs"] == sorted(data["available_pairs"])

    def test_point_has_all_expected_fields(self, route_client):
        client, store = route_client
        import asyncio
        async def _seed():
            await store.init()
            await store.write_market_spreads_batch(
                league="Standard",
                spreads=[{
                    "pair_key": "exalted/divine", "currency_from": "exalted", "currency_to": "divine",
                    "raw_rate": 0.15, "volume_24h": 500.0, "market_spread": 0.05,
                    "total_spread": 0.06, "momentum_factor": 0.2, "bfs_widening_factor": 1.0,
                }],
                timestamp=datetime(2026, 7, 11, 12, 0, tzinfo=timezone.utc),
            )
        asyncio.run(_seed())

        resp = client.get("/api/v1/market-spreads/history")
        data = resp.json()
        point = data["points"][0]
        for key in (
            "timestamp", "pair_key", "currency_from", "currency_to",
            "raw_rate", "volume_24h", "market_spread",
            "total_spread", "momentum_factor", "bfs_widening_factor",
        ):
            assert key in point, f"missing point field: {key}"
        assert point["pair_key"] == "exalted/divine"
        assert point["currency_from"] == "exalted"
        assert point["currency_to"] == "divine"
        assert point["raw_rate"] == 0.15
        assert point["volume_24h"] == 500.0
        assert point["market_spread"] == 0.05
        assert point["total_spread"] == 0.06
        assert point["momentum_factor"] == 0.2
        assert point["bfs_widening_factor"] == 1.0


class TestMarketSpreadsRouteValidation:
    """Query parameter validation."""

    def test_days_clamped_to_min(self, route_client):
        client, _ = route_client
        resp = client.get("/api/v1/market-spreads/history?days=0")
        assert resp.status_code == 422  # FastAPI validation error

    def test_days_clamped_to_max(self, route_client):
        client, _ = route_client
        resp = client.get("/api/v1/market-spreads/history?days=91")
        assert resp.status_code == 422

    def test_days_at_boundaries(self, route_client):
        client, _ = route_client
        # days=1 and days=90 should be accepted
        resp1 = client.get("/api/v1/market-spreads/history?days=1")
        resp90 = client.get("/api/v1/market-spreads/history?days=90")
        assert resp1.status_code == 200
        assert resp90.status_code == 200
        assert resp1.json()["days"] == 1
        assert resp90.json()["days"] == 90

    def test_default_days_is_30(self, route_client):
        client, _ = route_client
        resp = client.get("/api/v1/market-spreads/history")
        assert resp.status_code == 200
        assert resp.json()["days"] == 30


class TestMarketSpreadsRouteDegraded:
    """Graceful degradation when HistoricalStore raises."""

    def test_store_failure_returns_200_with_empty_result(self, tmp_path):
        """When read_market_spreads raises, the route returns 200 with
        data_available=false (NOT 500)."""
        from fastapi.testclient import TestClient
        from backend.main import app
        from backend.api import routes_market_spreads
        from backend.data import historical as historical_module
        from backend.config import AppConfig, LeagueConfig, DataConfig

        config = AppConfig(
            data=DataConfig(),
            league=LeagueConfig(league_name="Standard", base_currency="exalted"),
        )

        class _BrokenStore:
            async def read_market_spreads(self, *args, **kwargs):
                raise RuntimeError("simulated DB corruption")
            async def read_market_spreads_pairs(self, *args, **kwargs):
                raise RuntimeError("simulated DB corruption")

        def _fake_get_historical_store(cfg=None):
            return _BrokenStore()

        with patch.object(historical_module, "get_historical_store", _fake_get_historical_store), \
             patch.object(routes_market_spreads, "get_settings", return_value=config):
            with TestClient(app) as client:
                resp = client.get("/api/v1/market-spreads/history")
                assert resp.status_code == 200
                data = resp.json()
                assert data["data_available"] is False
                assert data["points"] == []
                assert data["available_pairs"] == []
                assert data["league"] == "Standard"
