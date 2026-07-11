"""
TD-3 (iter 129) — /api/v1/arbitrage/triangular/history route integration tests.

Verifies the route:
1. Returns 200 with data_available=false + empty points when no rows exist.
2. Returns persisted rows when rows exist.
3. Honors the cycle_key filter.
4. available_cycle_keys is populated correctly.
5. Returns 200 (not 500) when HistoricalStore raises — graceful degradation.
6. days parameter validation.

Same TestClient pattern as test_market_spreads_route.py (TD-4 iter 128).
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
    from backend.api import routes_arbitrage
    from backend.data import historical as historical_module

    config = AppConfig(
        data=DataConfig(),
        league=LeagueConfig(league_name="Standard", base_currency="exalted"),
    )

    # Create a fresh store with a temp DB path
    store = HistoricalStore(db_path=tmp_path / "route_test.db", config=config)

    # Patch the module-level get_historical_store to return our test store
    # for both routes_arbitrage and data_snapshot imports.
    def _fake_get_historical_store(cfg=None):
        return store

    with patch.object(historical_module, "get_historical_store", _fake_get_historical_store), \
         patch.object(routes_arbitrage, "get_settings", return_value=config):
        with TestClient(app) as client:
            yield client, store


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestTriangularCyclesRouteEmpty:
    """When no rows are persisted, the route returns data_available=false."""

    def test_returns_200_with_data_available_false(self, route_client):
        client, store = route_client
        resp = client.get("/api/v1/arbitrage/triangular/history")
        assert resp.status_code == 200
        data = resp.json()
        assert data["data_available"] is False
        assert data["points"] == []
        assert data["available_cycle_keys"] == []
        assert data["league"] == "Standard"
        assert data["days"] == 30
        assert data["cycle_key"] is None
        assert "fetched_at" in data

    def test_fetched_at_is_iso_string(self, route_client):
        client, _ = route_client
        resp = client.get("/api/v1/arbitrage/triangular/history")
        data = resp.json()
        # Should parse as an ISO datetime
        datetime.fromisoformat(data["fetched_at"].replace("Z", "+00:00"))


class TestTriangularCyclesRouteWithRows:
    """When rows are persisted, the route returns them."""

    def test_returns_rows_when_persisted(self, route_client):
        client, store = route_client
        # Seed rows
        import asyncio
        async def _seed():
            await store.init()
            await store.write_triangular_cycles_batch(
                league="Standard",
                cycles=[
                    {
                        "cycle_key": "divine->exalted->mirror",
                        "cycle_currencies": '["exalted","divine","mirror"]',
                        "raw_profit_pct": 5.0, "executable_estimate": 100,
                        "executable_profit": 110, "confidence": 0.85,
                        "snapshot_age_sec": 5,
                    },
                    {
                        "cycle_key": "chaos->divine->exalted",
                        "cycle_currencies": '["exalted","chaos","divine"]',
                        "raw_profit_pct": 3.0, "executable_estimate": 50,
                        "executable_profit": 53, "confidence": 0.7,
                        "snapshot_age_sec": 5,
                    },
                ],
                timestamp=datetime.now(timezone.utc),
            )
        asyncio.run(_seed())

        resp = client.get("/api/v1/arbitrage/triangular/history")
        assert resp.status_code == 200
        data = resp.json()
        assert data["data_available"] is True
        assert len(data["points"]) == 2
        keys = {p["cycle_key"] for p in data["points"]}
        assert keys == {"divine->exalted->mirror", "chaos->divine->exalted"}

    def test_cycle_key_filter_returns_only_matching_rows(self, route_client):
        client, store = route_client
        import asyncio
        async def _seed():
            await store.init()
            await store.write_triangular_cycles_batch(
                league="Standard",
                cycles=[
                    {
                        "cycle_key": "divine->exalted->mirror",
                        "cycle_currencies": '["exalted","divine","mirror"]',
                        "raw_profit_pct": 5.0, "executable_estimate": 100,
                        "executable_profit": 110, "confidence": 0.85,
                        "snapshot_age_sec": 5,
                    },
                    {
                        "cycle_key": "chaos->divine->exalted",
                        "cycle_currencies": '["exalted","chaos","divine"]',
                        "raw_profit_pct": 3.0, "executable_estimate": 50,
                        "executable_profit": 53, "confidence": 0.7,
                        "snapshot_age_sec": 5,
                    },
                ],
                timestamp=datetime.now(timezone.utc),
            )
        asyncio.run(_seed())

        resp = client.get(
            "/api/v1/arbitrage/triangular/history?cycle_key=divine-%3Eexalted-%3Emirror"
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["cycle_key"] == "divine->exalted->mirror"
        assert len(data["points"]) == 1
        assert data["points"][0]["cycle_key"] == "divine->exalted->mirror"

    def test_available_cycle_keys_populated(self, route_client):
        client, store = route_client
        import asyncio
        async def _seed():
            await store.init()
            await store.write_triangular_cycles_batch(
                league="Standard",
                cycles=[
                    {
                        "cycle_key": "divine->exalted->mirror",
                        "cycle_currencies": '["exalted","divine","mirror"]',
                        "raw_profit_pct": 5.0, "executable_estimate": 100,
                        "executable_profit": 110, "confidence": 0.85,
                        "snapshot_age_sec": 5,
                    },
                    {
                        "cycle_key": "chaos->divine->exalted",
                        "cycle_currencies": '["exalted","chaos","divine"]',
                        "raw_profit_pct": 3.0, "executable_estimate": 50,
                        "executable_profit": 53, "confidence": 0.7,
                        "snapshot_age_sec": 5,
                    },
                ],
                timestamp=datetime.now(timezone.utc),
            )
        asyncio.run(_seed())

        resp = client.get("/api/v1/arbitrage/triangular/history")
        data = resp.json()
        assert "divine->exalted->mirror" in data["available_cycle_keys"]
        assert "chaos->divine->exalted" in data["available_cycle_keys"]
        # Available keys should be sorted alphabetically
        assert data["available_cycle_keys"] == sorted(data["available_cycle_keys"])

    def test_point_has_all_expected_fields(self, route_client):
        client, store = route_client
        import asyncio
        async def _seed():
            await store.init()
            await store.write_triangular_cycles_batch(
                league="Standard",
                cycles=[{
                    "cycle_key": "divine->exalted->mirror",
                    "cycle_currencies": '["exalted","divine","mirror"]',
                    "raw_profit_pct": 5.0, "executable_estimate": 100,
                    "executable_profit": 110, "confidence": 0.85,
                    "snapshot_age_sec": 5,
                }],
                timestamp=datetime(2026, 7, 11, 12, 0, tzinfo=timezone.utc),
            )
        asyncio.run(_seed())

        resp = client.get("/api/v1/arbitrage/triangular/history")
        data = resp.json()
        point = data["points"][0]
        for key in (
            "timestamp", "cycle_key", "cycle_currencies",
            "raw_profit_pct", "executable_estimate", "executable_profit",
            "confidence", "snapshot_age_sec",
        ):
            assert key in point, f"missing point field: {key}"
        assert point["cycle_key"] == "divine->exalted->mirror"
        assert point["cycle_currencies"] == '["exalted","divine","mirror"]'
        assert point["raw_profit_pct"] == 5.0
        assert point["executable_estimate"] == 100
        assert point["executable_profit"] == 110
        assert abs(point["confidence"] - 0.85) < 1e-9
        assert point["snapshot_age_sec"] == 5


class TestTriangularCyclesRouteValidation:
    """Query parameter validation."""

    def test_days_clamped_to_min(self, route_client):
        client, _ = route_client
        resp = client.get("/api/v1/arbitrage/triangular/history?days=0")
        assert resp.status_code == 422  # FastAPI validation error

    def test_days_clamped_to_max(self, route_client):
        client, _ = route_client
        resp = client.get("/api/v1/arbitrage/triangular/history?days=91")
        assert resp.status_code == 422

    def test_days_at_boundaries(self, route_client):
        client, _ = route_client
        # days=1 and days=90 should be accepted
        resp1 = client.get("/api/v1/arbitrage/triangular/history?days=1")
        resp90 = client.get("/api/v1/arbitrage/triangular/history?days=90")
        assert resp1.status_code == 200
        assert resp90.status_code == 200
        assert resp1.json()["days"] == 1
        assert resp90.json()["days"] == 90

    def test_default_days_is_30(self, route_client):
        client, _ = route_client
        resp = client.get("/api/v1/arbitrage/triangular/history")
        assert resp.status_code == 200
        assert resp.json()["days"] == 30


class TestTriangularCyclesRouteDegraded:
    """Graceful degradation when HistoricalStore raises."""

    def test_store_failure_returns_200_with_empty_result(self, tmp_path):
        """When read_triangular_cycles raises, the route returns 200 with
        data_available=false (NOT 500)."""
        from fastapi.testclient import TestClient
        from backend.main import app
        from backend.api import routes_arbitrage
        from backend.data import historical as historical_module
        from backend.config import AppConfig, LeagueConfig, DataConfig

        config = AppConfig(
            data=DataConfig(),
            league=LeagueConfig(league_name="Standard", base_currency="exalted"),
        )

        class _BrokenStore:
            async def read_triangular_cycles(self, *args, **kwargs):
                raise RuntimeError("simulated DB corruption")
            async def read_triangular_cycles_keys(self, *args, **kwargs):
                raise RuntimeError("simulated DB corruption")

        def _fake_get_historical_store(cfg=None):
            return _BrokenStore()

        with patch.object(historical_module, "get_historical_store", _fake_get_historical_store), \
             patch.object(routes_arbitrage, "get_settings", return_value=config):
            with TestClient(app) as client:
                resp = client.get("/api/v1/arbitrage/triangular/history")
                assert resp.status_code == 200
                data = resp.json()
                assert data["data_available"] is False
                assert data["points"] == []
                assert data["available_cycle_keys"] == []
                assert data["league"] == "Standard"


class TestTriangularCyclesRouteDistinctFromLive:
    """Verify the /history route is distinct from the live /triangular route."""

    def test_history_route_does_not_call_find_triangular_arbitrage(self, route_client):
        """The /history route reads from SQLite only — it must NOT call
        find_triangular_arbitrage (that's the live /triangular route's job)."""
        client, _ = route_client
        with patch(
            "backend.arbitrage.triangular.find_triangular_arbitrage",
            new=AsyncMock(side_effect=AssertionError("should not be called")),
        ):
            resp = client.get("/api/v1/arbitrage/triangular/history")
            assert resp.status_code == 200

    def test_live_route_still_works_alongside_history(self, route_client):
        """Both /triangular and /triangular/history are registered and
        respond (the /history suffix doesn't shadow the live route)."""
        client, _ = route_client
        # Live route — may return 200 with data_available=false (no snapshot)
        resp_live = client.get("/api/v1/arbitrage/triangular")
        assert resp_live.status_code == 200
        # History route
        resp_hist = client.get("/api/v1/arbitrage/triangular/history")
        assert resp_hist.status_code == 200
        # Both have distinct shapes
        assert "opportunities" in resp_live.json()
        assert "points" in resp_hist.json()
        assert "opportunities" not in resp_hist.json()
        assert "points" not in resp_live.json()
