"""
Tests for the Event Manager system (Milestone 9).

From PoE2_Flipper_Implementation_Spec.md §6 and §10:
- Manual event flagging API
- Event effects on subsystems
- Auto-expiry
- Phase reset on major_patch

Test cases:
1. Event creation and retrieval
2. Event auto-expiry
3. Event deactivation and deletion
4. Score penalty for affected currencies
5. Score exclusion for specifically-affected currencies
6. Major patch phase reset detection
7. Event summary for UI
8. Multiple events interaction
9. Prune expired events
"""

from __future__ import annotations

import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

# Ensure project root is on path
_project_root = Path(__file__).resolve().parent.parent
if str(_project_root) not in sys.path:
    sys.path.insert(0, str(_project_root))

import pytest

from backend.config import AppConfig, EventsConfig
from backend.economy.events import EventManager, StoredEvent, get_event_manager, reset_event_manager
from backend.models.currency import EventType, MarketEvent


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def config():
    """Create a test config with short event expiry for testing."""
    return AppConfig(
        events=EventsConfig(
            default_expiry_hours=48,
            event_score_penalty=0.5,
        )
    )


@pytest.fixture
def manager(config):
    """Create a fresh EventManager for each test."""
    m = EventManager(config)
    return m


# ---------------------------------------------------------------------------
# Test: Event creation and retrieval
# ---------------------------------------------------------------------------

class TestEventCreation:
    def test_create_event_basic(self, manager):
        """Test basic event creation."""
        event = manager.create_event(
            event_type=EventType.MINOR_PATCH,
            description="Patch 0.2.1 hotfix",
        )

        assert event.event_id is not None
        assert event.event_type == EventType.MINOR_PATCH
        assert event.description == "Patch 0.2.1 hotfix"
        assert event.is_active is True
        assert event.expires_at is not None  # should have default expiry

    def test_create_event_with_affected_currencies(self, manager):
        """Test event creation with specific affected currencies."""
        event = manager.create_event(
            event_type=EventType.STREAMER_HYPE,
            description="Zizaran currency giveaway",
            affected_currencies=["divine", "exalted"],
        )

        assert event.affected_currencies == ["divine", "exalted"]

    def test_create_major_patch_event(self, manager):
        """Test creating a major patch event."""
        event = manager.create_event(
            event_type=EventType.MAJOR_PATCH,
            description="Patch 0.3.0 released",
        )

        assert event.event_type == EventType.MAJOR_PATCH

    def test_create_event_with_custom_expiry(self, manager):
        """Test event creation with custom expiry time."""
        expires = datetime.now(timezone.utc) + timedelta(hours=24)
        event = manager.create_event(
            event_type=EventType.OTHER,
            description="Custom expiry event",
            expires_at=expires,
        )

        assert event.expires_at is not None
        # Should be approximately 24 hours from now
        diff = abs((event.expires_at - expires).total_seconds())
        assert diff < 5  # within 5 seconds

    def test_get_event_by_id(self, manager):
        """Test retrieving an event by ID."""
        event = manager.create_event(
            event_type=EventType.MINOR_PATCH,
            description="Test event",
        )

        retrieved = manager.get_event(event.event_id)
        assert retrieved is not None
        assert retrieved.event_id == event.event_id
        assert retrieved.description == "Test event"

    def test_get_nonexistent_event(self, manager):
        """Test retrieving a non-existent event returns None."""
        result = manager.get_event("nonexistent")
        assert result is None


# ---------------------------------------------------------------------------
# Test: Event listing
# ---------------------------------------------------------------------------

class TestEventListing:
    def test_list_active_events(self, manager):
        """Test listing only active events."""
        manager.create_event(EventType.MINOR_PATCH, "Active event 1")
        manager.create_event(EventType.OTHER, "Active event 2")

        events = manager.list_events(active_only=True)
        assert len(events) == 2

    def test_list_all_events_includes_inactive(self, manager):
        """Test listing all events including inactive ones."""
        event = manager.create_event(EventType.MINOR_PATCH, "Will deactivate")
        manager.create_event(EventType.OTHER, "Stays active")

        manager.deactivate_event(event.event_id)

        active = manager.list_events(active_only=True)
        all_events = manager.list_events(active_only=False)

        assert len(active) == 1
        assert len(all_events) == 2


# ---------------------------------------------------------------------------
# Test: Event deletion and deactivation
# ---------------------------------------------------------------------------

class TestEventDeletion:
    def test_delete_event(self, manager):
        """Test deleting an event."""
        event = manager.create_event(EventType.MINOR_PATCH, "To delete")
        result = manager.delete_event(event.event_id)

        assert result is True
        assert manager.get_event(event.event_id) is None

    def test_delete_nonexistent_event(self, manager):
        """Test deleting a non-existent event returns False."""
        result = manager.delete_event("nonexistent")
        assert result is False

    def test_deactivate_event(self, manager):
        """Test deactivating an event without deleting it."""
        event = manager.create_event(EventType.MINOR_PATCH, "To deactivate")
        result = manager.deactivate_event(event.event_id)

        assert result is True
        retrieved = manager.get_event(event.event_id)
        assert retrieved is not None
        assert retrieved.is_active is False


# ---------------------------------------------------------------------------
# Test: Event auto-expiry
# ---------------------------------------------------------------------------

class TestEventExpiry:
    def test_event_not_expired_initially(self, manager):
        """Test that a newly created event is not expired."""
        event = manager.create_event(EventType.MINOR_PATCH, "Fresh event")
        assert not manager._is_expired(event)

    def test_event_expired(self, manager):
        """Test that an event with past expiry is detected as expired."""
        event = manager.create_event(
            EventType.MINOR_PATCH,
            "Expired event",
            expires_at=datetime.now(timezone.utc) - timedelta(hours=1),
        )
        assert manager._is_expired(event)

    def test_prune_expired_events(self, manager):
        """Test that expired events are pruned from storage."""
        # Create an event that expires immediately
        manager.create_event(
            EventType.MINOR_PATCH,
            "Already expired",
            expires_at=datetime.now(timezone.utc) - timedelta(hours=1),
        )
        # Create a normal event
        manager.create_event(EventType.OTHER, "Still active")

        pruned = manager._prune_expired()
        assert pruned == 1

        events = manager.list_events(active_only=True)
        assert len(events) == 1
        assert events[0].description == "Still active"

    def test_event_with_no_expiry_never_expires(self, manager):
        """Test that an event with no expiry_at never expires."""
        event = manager.create_event(
            EventType.OTHER,
            "Permanent event",
            expires_at=None,
        )
        assert not manager._is_expired(event)


# ---------------------------------------------------------------------------
# Test: Score penalty for affected currencies
# ---------------------------------------------------------------------------

class TestScorePenalty:
    def test_no_penalty_without_events(self, manager):
        """Test that there is no penalty when no events are active."""
        penalty = manager.get_event_score_penalty("divine")
        assert penalty == 1.0  # no penalty

    def test_penalty_for_unspecified_currencies(self, manager):
        """Test that all currencies get event_score_penalty when no specific
        currencies are listed in the event."""
        manager.create_event(
            EventType.STREAMER_HYPE,
            "Big stream event",
            # No affected_currencies → affects all
        )

        penalty = manager.get_event_score_penalty("divine")
        assert penalty == 0.5  # config default

    def test_exclusion_for_specific_currencies(self, manager):
        """Test that currencies specifically listed in affected_currencies
        are excluded entirely (penalty = 0.0)."""
        manager.create_event(
            EventType.MINOR_PATCH,
            "Divine nerf",
            affected_currencies=["divine", "exalted"],
        )

        # Specifically affected → excluded
        assert manager.get_event_score_penalty("divine") == 0.0
        assert manager.get_event_score_penalty("exalted") == 0.0

        # Unaffected currency → no penalty
        assert manager.get_event_score_penalty("chaos") == 1.0

    def test_multiple_events_penalty(self, manager):
        """Test penalty interaction with multiple events.

        If one event targets a currency specifically and another
        targets all currencies, the first one wins (exclusion).
        """
        # Event 1: specific currencies excluded
        manager.create_event(
            EventType.MINOR_PATCH,
            "Divine nerf",
            affected_currencies=["divine"],
        )
        # Event 2: all currencies get penalty
        manager.create_event(
            EventType.STREAMER_HYPE,
            "Big stream",
            # No specific currencies → all get 0.5
        )

        # Divine is specifically excluded by event 1
        assert manager.get_event_score_penalty("divine") == 0.0
        # Chaos gets penalty from event 2
        assert manager.get_event_score_penalty("chaos") == 0.5


# ---------------------------------------------------------------------------
# Test: Event activity checks
# ---------------------------------------------------------------------------

class TestEventActivity:
    def test_is_event_active_no_events(self, manager):
        """Test that no events means nothing is active."""
        assert manager.is_event_active() is False

    def test_is_event_active_with_event(self, manager):
        """Test that an event makes is_event_active return True."""
        manager.create_event(EventType.OTHER, "Test event")
        assert manager.is_event_active() is True

    def test_is_event_active_for_specific_currency(self, manager):
        """Test event activity check for a specific currency."""
        manager.create_event(
            EventType.MINOR_PATCH,
            "Divine event",
            affected_currencies=["divine"],
        )

        assert manager.is_event_active("divine") is True
        assert manager.is_event_active("chaos") is False  # not in affected list

    def test_is_event_active_for_currency_with_universal_event(self, manager):
        """Test that a universal event (no specific currencies) affects all."""
        manager.create_event(EventType.OTHER, "Universal event")
        assert manager.is_event_active("divine") is True
        assert manager.is_event_active("chaos") is True

    def test_is_event_active_after_deactivation(self, manager):
        """Test that deactivated events don't count as active."""
        event = manager.create_event(EventType.OTHER, "Will deactivate")
        manager.deactivate_event(event.event_id)

        assert manager.is_event_active() is False


# ---------------------------------------------------------------------------
# Test: Major patch phase reset
# ---------------------------------------------------------------------------

class TestMajorPatchPhaseReset:
    def test_has_major_patch_event(self, manager):
        """Test detecting a major_patch event."""
        manager.create_event(EventType.MINOR_PATCH, "Minor")
        assert manager.has_major_patch_event() is False

        manager.create_event(EventType.MAJOR_PATCH, "Major patch 0.3.0")
        assert manager.has_major_patch_event() is True

    def test_get_latest_major_patch_timestamp(self, manager):
        """Test getting the most recent major_patch timestamp."""
        # Use future expiry so events don't get pruned during the test
        far_future = datetime.now(timezone.utc) + timedelta(days=365)
        ts1 = datetime(2025, 3, 1, 12, 0, 0, tzinfo=timezone.utc)
        ts2 = datetime(2025, 4, 1, 12, 0, 0, tzinfo=timezone.utc)

        manager.create_event(
            EventType.MAJOR_PATCH, "Patch 0.2.0",
            timestamp=ts1,
            expires_at=far_future,
        )
        manager.create_event(
            EventType.MAJOR_PATCH, "Patch 0.3.0",
            timestamp=ts2,
            expires_at=far_future,
        )

        latest = manager.get_latest_major_patch_timestamp()
        assert latest is not None
        # The latest should be the more recent one
        assert latest == ts2

    def test_no_major_patch_timestamp_without_events(self, manager):
        """Test that None is returned when no major_patch events exist."""
        assert manager.get_latest_major_patch_timestamp() is None


# ---------------------------------------------------------------------------
# Test: Event summary for UI
# ---------------------------------------------------------------------------

class TestEventSummary:
    def test_summary_no_events(self, manager):
        """Test summary returns None when no events are active."""
        assert manager.get_active_event_summary() is None

    def test_summary_with_events(self, manager):
        """Test summary returns correct data when events are active."""
        manager.create_event(EventType.MINOR_PATCH, "Minor patch event")
        manager.create_event(EventType.MAJOR_PATCH, "Major patch event")

        summary = manager.get_active_event_summary()

        assert summary is not None
        # Major patch should take priority
        assert summary["event_type"] == "major_patch"
        assert summary["total_active_events"] == 2

    def test_summary_priority_order(self, manager):
        """Test that summary prioritizes events correctly.

        Priority: major_patch > minor_patch > streamer_hype > other
        """
        manager.create_event(EventType.OTHER, "Other event")
        manager.create_event(EventType.STREAMER_HYPE, "Streamer event")
        manager.create_event(EventType.MINOR_PATCH, "Minor event")

        summary = manager.get_active_event_summary()
        assert summary["event_type"] == "minor_patch"


# ---------------------------------------------------------------------------
# Test: StoredEvent serialization
# ---------------------------------------------------------------------------

class TestStoredEventSerialization:
    def test_to_dict(self, manager):
        """Test that StoredEvent.to_dict produces valid output."""
        event = manager.create_event(
            EventType.MINOR_PATCH,
            "Serialization test",
            affected_currencies=["divine"],
        )

        d = event.to_dict()
        assert "event_id" in d
        assert d["event_type"] == "minor_patch"
        assert d["description"] == "Serialization test"
        assert d["affected_currencies"] == ["divine"]
        assert "timestamp" in d
        assert "expires_at" in d
        assert d["is_active"] is True

    def test_to_market_event(self, manager):
        """Test conversion back to MarketEvent domain model."""
        event = manager.create_event(
            EventType.MAJOR_PATCH,
            "Domain model test",
        )

        market_event = event.to_market_event()
        assert isinstance(market_event, MarketEvent)
        assert market_event.event_type == EventType.MAJOR_PATCH
        assert market_event.description == "Domain model test"


# ---------------------------------------------------------------------------
# Test: Clear all events
# ---------------------------------------------------------------------------

class TestClearAll:
    def test_clear_all(self, manager):
        """Test clearing all events."""
        manager.create_event(EventType.OTHER, "Event 1")
        manager.create_event(EventType.OTHER, "Event 2")
        manager.create_event(EventType.OTHER, "Event 3")

        count = manager.clear_all()
        assert count == 3
        assert manager.is_event_active() is False


# ---------------------------------------------------------------------------
# Test: Singleton accessor
# ---------------------------------------------------------------------------

class TestSingletonAccessor:
    def test_get_event_manager_returns_instance(self):
        """Test that get_event_manager returns an EventManager instance."""
        reset_event_manager()
        manager = get_event_manager()
        assert isinstance(manager, EventManager)

    def test_get_event_manager_returns_same_instance(self):
        """Test that get_event_manager returns the same instance."""
        reset_event_manager()
        m1 = get_event_manager()
        m2 = get_event_manager()
        assert m1 is m2

    def test_reset_event_manager(self):
        """Test that reset_event_manager creates a new instance."""
        m1 = get_event_manager()
        reset_event_manager()
        m2 = get_event_manager()
        assert m1 is not m2


# ---------------------------------------------------------------------------
# Test: Integration with PhaseDetector
# ---------------------------------------------------------------------------

class TestPhaseDetectorIntegration:
    def test_phase_detector_reset_on_major_patch(self, manager):
        """Test that PhaseDetector.reset_for_major_patch is called
        when a major_patch event is created.

        This tests the integration pattern, not the actual PhaseDetector
        (which has its own tests in test_lifecycle.py).
        """
        from backend.economy.lifecycle import PhaseDetector
        from backend.config import AppConfig, LeagueConfig

        config = AppConfig(
            league=LeagueConfig(
                league_start_date="2025-01-15T00:00:00Z",
            )
        )

        detector = PhaseDetector(config.league.league_start_datetime, config)

        # Before reset: phase should be based on league start
        days_before = detector.days_since_reference()

        # Reset for a major patch
        patch_ts = datetime(2025, 6, 1, 0, 0, 0, tzinfo=timezone.utc)
        detector.reset_for_major_patch(patch_ts)

        # After reset: reference date should be the patch date
        assert detector.patch_reset_date == patch_ts

        # Days since reference should now be relative to the patch
        days_after = detector.days_since_reference(now=datetime(2025, 6, 5, 0, 0, 0, tzinfo=timezone.utc))
        assert days_after == 4


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
