"""
End-to-End API Tests.

Phase 2 (Spec Section 12): Tests that exercise the FastAPI endpoints.
These tests hit the real app with the real dependency chain, but the
POE2Scout provider makes real API calls (which may fail in CI if
the API is down or rate-limited).

For fully deterministic E2E tests, use the mock_provider fixture
(see conftest.py and mock_provider.py).

Run with:
    pytest tests/e2e/ -v -s
    pytest tests/e2e/ -v -s -m e2e  # with marker
"""

from __future__ import annotations

import pytest


@pytest.mark.e2e
async def test_health_endpoint(client):
    """Test that the health check endpoint returns 200."""
    resp = await client.get("/api/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert "timestamp" in data
    assert "league" in data


@pytest.mark.e2e
async def test_get_phase(client):
    """Test that the phase endpoint returns valid phase info."""
    resp = await client.get("/api/phase")
    assert resp.status_code == 200
    data = resp.json()
    assert data["phase"] in ["early", "mid", "late"]
    assert "days_since_reference" in data
    assert "recommended_strategy" in data
    assert "reference_currency" in data


@pytest.mark.e2e
async def test_get_currencies(client):
    """Test that the currencies endpoint returns a list."""
    resp = await client.get("/api/currencies")
    assert resp.status_code == 200
    data = resp.json()
    assert "currencies" in data
    # May be empty if API is down, but the endpoint itself should work
    assert isinstance(data["currencies"], list)


@pytest.mark.e2e
async def test_get_prices(client):
    """Test that the prices endpoint returns exchange rate data."""
    resp = await client.get("/api/prices")
    # 503 is acceptable if the live API is unavailable
    assert resp.status_code in [200, 503]
    if resp.status_code == 200:
        data = resp.json()
        assert "league" in data
        assert "rates" in data
        assert isinstance(data["rates"], list)
        assert "phase" in data


@pytest.mark.e2e
async def test_get_heatmap(client):
    """Test that the heatmap endpoint returns data."""
    resp = await client.get("/api/prices/heatmap")
    assert resp.status_code in [200, 503]
    if resp.status_code == 200:
        data = resp.json()
        assert "currencies" in data
        assert isinstance(data["currencies"], list)


@pytest.mark.e2e
async def test_create_and_list_events(client):
    """Test event creation, listing, and deactivation."""
    # Create an event
    resp = await client.post("/api/events", json={
        "event_type": "minor_patch",
        "description": "E2E test patch event",
        "affected_currencies": ["divine"],
    })
    assert resp.status_code == 200
    data = resp.json()
    assert "event_id" in data
    event_id = data["event_id"]

    # List events
    resp = await client.get("/api/events?active_only=true")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data.get("events", [])) >= 1

    # Deactivate the event
    resp = await client.post(f"/api/events/{event_id}/deactivate")
    assert resp.status_code == 200


@pytest.mark.e2e
async def test_arbitrage_flips(client):
    """Test the flips endpoint."""
    resp = await client.get("/api/arbitrage/flips")
    assert resp.status_code in [200, 503]


@pytest.mark.e2e
async def test_arbitrage_triangular(client):
    """Test the triangular arbitrage endpoint."""
    resp = await client.get("/api/arbitrage/triangular")
    assert resp.status_code in [200, 503]


@pytest.mark.e2e
async def test_anomalies_endpoint(client):
    """Test the anomalies endpoint."""
    resp = await client.get("/api/anomalies")
    assert resp.status_code in [200, 503]


@pytest.mark.e2e
async def test_storage_value(client):
    """Test the storage value endpoint."""
    resp = await client.get("/api/storage-value/divine")
    # May fail if data insufficient
    assert resp.status_code in [200, 422, 503]



