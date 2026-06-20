"""
Regression tests for P1-11 — daily_stats invalidation on event mutations.

P1-11: routes_events.create_event / delete_event / deactivate_event
only invalidated the pipeline_cache namespace. The daily_stats namespace
(stale-fallback for daily benchmarks / storage-value aggregates) was left
untouched, so the UI kept serving stale daily-stats entries up to their
TTL after a major_patch flag was created or any event was deactivated.

These tests verify that both caches are invalidated after every
event-mutation endpoint.
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

# Ensure project root is on path
_project_root = Path(__file__).resolve().parent.parent
if str(_project_root) not in sys.path:
    sys.path.insert(0, str(_project_root))

import pytest
from fastapi.testclient import TestClient

from backend.models.currency import EventType


@pytest.fixture
def app_with_mocked_caches():
    """Yield the FastAPI app with both caches replaced by MagicMock spies.

    Patches `get_pipeline_cache` and `get_daily_stats_cache` inside the
    routes_events module so that the route handlers receive MagicMock
    instances whose `.invalidate()` calls we can assert on.

    Also patches `get_event_manager` to return a stubbed EventManager so
    create/delete/deactivate succeed without touching SQLite.
    """
    from backend.main import app
    from backend.api import routes_events

    pipeline_cache_mock = MagicMock()
    daily_stats_cache_mock = MagicMock()

    # Stub event manager: tracks events in-memory so the routes can
    # create/delete/deactivate without persisting to SQLite.
    stub_events: dict[str, dict] = {}

    class _StubEvent:
        def __init__(self, event_id: str, event_type: EventType, description: str):
            self.event_id = event_id
            self.event_type = event_type
            self.description = description
            self.affected_currencies: list[str] = []
            self.is_active = True
            from datetime import datetime, timezone
            self.timestamp = datetime.now(timezone.utc).isoformat()
            self.expires_at = None
            self.created_at = self.timestamp

        def to_dict(self) -> dict:
            return {
                "event_id": self.event_id,
                "event_type": self.event_type.value
                if isinstance(self.event_type, EventType)
                else self.event_type,
                "description": self.description,
                "affected_currencies": self.affected_currencies,
                "timestamp": self.timestamp,
                "expires_at": self.expires_at,
                "is_active": self.is_active,
                "created_at": self.created_at,
            }

    class _StubManager:
        def create_event(self, *, event_type, description, affected_currencies=None,
                         timestamp=None, expires_at=None):
            event_id = f"evt-{len(stub_events) + 1}"
            evt = _StubEvent(event_id, event_type, description)
            evt.affected_currencies = list(affected_currencies or [])
            stub_events[event_id] = evt
            return evt

        def delete_event(self, event_id: str) -> bool:
            return stub_events.pop(event_id, None) is not None

        def deactivate_event(self, event_id: str) -> bool:
            evt = stub_events.get(event_id)
            if evt is None:
                return False
            evt.is_active = False
            return True

    with patch.object(routes_events, "get_pipeline_cache", return_value=pipeline_cache_mock), \
         patch.object(routes_events, "get_daily_stats_cache", return_value=daily_stats_cache_mock), \
         patch.object(routes_events, "get_event_manager", return_value=_StubManager()), \
         patch.object(routes_events, "_get_phase_detector") as phase_detector_mock:
        # Stub PhaseDetector.reset_for_major_patch to avoid config side effects
        phase_detector_mock.return_value.reset_for_major_patch.return_value = None
        yield app, pipeline_cache_mock, daily_stats_cache_mock


@pytest.fixture
def client(app_with_mocked_caches):
    """Sync TestClient — sufficient for these route-level unit tests."""
    app, _, _ = app_with_mocked_caches
    with TestClient(app) as c:
        yield c


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestDailyStatsInvalidation:
    """P1-11: daily_stats cache must be invalidated alongside pipeline_cache."""

    def test_create_event_invalidates_daily_stats(self, client, app_with_mocked_caches):
        _, pipeline_mock, daily_stats_mock = app_with_mocked_caches
        resp = client.post("/api/v1/events", json={
            "event_type": "minor_patch",
            "description": "P1-11 regression: create",
            "affected_currencies": ["divine"],
        })
        assert resp.status_code == 200, resp.text
        pipeline_mock.invalidate.assert_called_once()
        daily_stats_mock.invalidate.assert_called_once()

    def test_create_major_patch_event_invalidates_daily_stats(
        self, client, app_with_mocked_caches
    ):
        _, pipeline_mock, daily_stats_mock = app_with_mocked_caches
        resp = client.post("/api/v1/events", json={
            "event_type": "major_patch",
            "description": "P1-11 regression: major patch create",
        })
        assert resp.status_code == 200, resp.text
        pipeline_mock.invalidate.assert_called_once()
        daily_stats_mock.invalidate.assert_called_once()

    def test_delete_event_invalidates_daily_stats(self, client, app_with_mocked_caches):
        _, pipeline_mock, daily_stats_mock = app_with_mocked_caches
        # Create an event first
        create_resp = client.post("/api/v1/events", json={
            "event_type": "minor_patch",
            "description": "to be deleted",
        })
        assert create_resp.status_code == 200
        event_id = create_resp.json()["event"]["event_id"]

        # Reset mocks so create's invalidate() calls don't pollute the assertion
        pipeline_mock.invalidate.reset_mock()
        daily_stats_mock.invalidate.reset_mock()

        del_resp = client.delete(f"/api/v1/events/{event_id}")
        assert del_resp.status_code == 200, del_resp.text
        pipeline_mock.invalidate.assert_called_once()
        daily_stats_mock.invalidate.assert_called_once()

    def test_deactivate_event_invalidates_daily_stats(
        self, client, app_with_mocked_caches
    ):
        _, pipeline_mock, daily_stats_mock = app_with_mocked_caches
        # Create an event first
        create_resp = client.post("/api/v1/events", json={
            "event_type": "minor_patch",
            "description": "to be deactivated",
        })
        assert create_resp.status_code == 200
        event_id = create_resp.json()["event"]["event_id"]

        # Reset mocks so create's invalidate() calls don't pollute the assertion
        pipeline_mock.invalidate.reset_mock()
        daily_stats_mock.invalidate.reset_mock()

        deact_resp = client.post(f"/api/v1/events/{event_id}/deactivate")
        assert deact_resp.status_code == 200, deact_resp.text
        pipeline_mock.invalidate.assert_called_once()
        daily_stats_mock.invalidate.assert_called_once()
