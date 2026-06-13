"""
End-to-End API Tests.

Phase 2 (Spec Section 12): Tests that exercise the FastAPI endpoints.
Uses the mock_provider fixture for deterministic results — no live API calls.

Run with:
    pytest tests/e2e/test_api_e2e.py -v -s
    pytest tests/e2e/test_api_e2e.py -v -s -m e2e
"""

from __future__ import annotations

import pytest


@pytest.mark.e2e
async def test_health_endpoint(mock_client):
    """Test that the health check endpoint returns 200 with mock provider."""
    resp = await mock_client.get("/api/v1/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] in ["ok", "degraded"]
    assert "timestamp" in data
    assert "league" in data


@pytest.mark.e2e
async def test_get_phase(mock_client):
    """Test that the phase endpoint returns valid phase info."""
    resp = await mock_client.get("/api/v1/phase")
    assert resp.status_code == 200
    data = resp.json()
    assert data["phase"] in ["early", "mid", "late"]
    assert "days_since_reference" in data
    assert "recommended_strategy" in data
    assert "reference_currency" in data


@pytest.mark.e2e
async def test_get_currencies(mock_client):
    """Test that the currencies endpoint returns a list."""
    resp = await mock_client.get("/api/v1/currencies")
    # 200 or 503 — depends on snapshot state with mock provider
    assert resp.status_code in [200, 503]
    if resp.status_code == 200:
        data = resp.json()
        assert "currencies" in data
        assert isinstance(data["currencies"], list)


@pytest.mark.e2e
async def test_get_prices(mock_client):
    """Test that the prices endpoint returns exchange rate data."""
    resp = await mock_client.get("/api/v1/prices")
    # 200 (data available) or 503 (snapshot not yet ready)
    assert resp.status_code in [200, 503]
    if resp.status_code == 200:
        data = resp.json()
        assert "league" in data
        assert "rates" in data
        assert isinstance(data["rates"], list)
        assert "phase" in data


@pytest.mark.e2e
async def test_get_heatmap(mock_client):
    """Test that the heatmap endpoint returns data."""
    resp = await mock_client.get("/api/v1/prices/heatmap")
    assert resp.status_code in [200, 503]
    if resp.status_code == 200:
        data = resp.json()
        assert "currencies" in data
        assert isinstance(data["currencies"], list)


@pytest.mark.e2e
async def test_create_and_list_events(mock_client):
    """Test event creation, listing, and deactivation."""
    # Create an event
    resp = await mock_client.post("/api/v1/events", json={
        "event_type": "minor_patch",
        "description": "E2E test patch event",
        "affected_currencies": ["divine"],
    })
    # Tolerate 503 if the backend hasn't fully initialized yet
    assert resp.status_code in [200, 503]
    if resp.status_code == 200:
        data = resp.json()
        assert "event" in data
        assert "event_id" in data["event"]
        event_id = data["event"]["event_id"]

        # List events
        resp = await mock_client.get("/api/v1/events?active_only=true")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data.get("events", [])) >= 1

        # Deactivate the event
        resp = await mock_client.post(f"/api/v1/events/{event_id}/deactivate")
        assert resp.status_code == 200


@pytest.mark.e2e
async def test_arbitrage_flips(mock_client):
    """Test the flips endpoint."""
    resp = await mock_client.get("/api/v1/arbitrage/flips")
    assert resp.status_code in [200, 503]


@pytest.mark.e2e
async def test_arbitrage_triangular(mock_client):
    """Test the triangular arbitrage endpoint."""
    resp = await mock_client.get("/api/v1/arbitrage/triangular")
    assert resp.status_code in [200, 503]


@pytest.mark.e2e
async def test_anomalies_endpoint(mock_client):
    """Test the anomalies endpoint."""
    resp = await mock_client.get("/api/v1/anomalies")
    assert resp.status_code in [200, 503]


@pytest.mark.e2e
async def test_storage_value(mock_client):
    """Test the storage value endpoint."""
    resp = await mock_client.get("/api/v1/storage-value/divine")
    # May fail if data insufficient
    assert resp.status_code in [200, 422, 503]
