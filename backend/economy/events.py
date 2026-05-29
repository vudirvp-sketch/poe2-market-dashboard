"""
Event Manager — manual event flagging and effect propagation.

From PoE2_Flipper_Implementation_Spec.md Section 6:

Events are flagged manually by the user. When an event is active:
1. SARIMA forecasts: labeled low_confidence=True
2. Holt-Winters: disabled entirely
3. Auto-flip blocking: affected currencies excluded from scoring,
   or all currencies get event_score_penalty if no specific currencies listed
4. Phase reset: major_patch events reset the PhaseDetector reference date
5. Event expiry: events expire after 48h by default (configurable)

Phase 2 enhancement (Spec Section 1):
- Events are dual-written: in-memory dict (fast reads) + SQLite (persistence).
- On startup, events are loaded from SQLite via load_from_store().
- On create/deactivate/delete: both in-memory and SQLite are updated.
- Expired events are pruned from both stores.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
from typing import Optional, TYPE_CHECKING

from backend.config import AppConfig, get_settings
from backend.models.currency import EventType, MarketEvent

if TYPE_CHECKING:
    from backend.data.historical import HistoricalStore

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Stored Event (extends MarketEvent with id and metadata)
# ---------------------------------------------------------------------------

@dataclass
class StoredEvent:
    """A stored event with unique ID and computed expiry."""
    event_id: str
    event_type: EventType
    description: str
    affected_currencies: list[str] = field(default_factory=list)
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    expires_at: datetime | None = None
    is_active: bool = True
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def to_dict(self) -> dict:
        """Serialize to a dict suitable for API responses."""
        return {
            "event_id": self.event_id,
            "event_type": self.event_type.value,
            "description": self.description,
            "affected_currencies": self.affected_currencies,
            "timestamp": self.timestamp.isoformat(),
            "expires_at": self.expires_at.isoformat() if self.expires_at else None,
            "is_active": self.is_active,
            "created_at": self.created_at.isoformat(),
        }

    def to_market_event(self) -> MarketEvent:
        """Convert back to the domain model."""
        return MarketEvent(
            event_type=self.event_type,
            description=self.description,
            affected_currencies=self.affected_currencies,
            timestamp=self.timestamp,
            expires_at=self.expires_at,
            is_active=self.is_active,
        )


# ---------------------------------------------------------------------------
# Event Manager
# ---------------------------------------------------------------------------

class EventManager:
    """In-memory event storage with SQLite dual-write and auto-expiry.

    Phase 2 (Spec Section 1): Events are dual-written to both an in-memory
    dict (for fast reads) and SQLite (for persistence across restarts).

    Thread safety note: This implementation is designed for single-process
    use (FastAPI with uvicorn). For multi-worker deployments, replace the
    in-memory storage with a shared store (Redis, DB, etc.).
    """

    def __init__(self, config: AppConfig | None = None):
        self._config = config or get_settings()
        self._events: dict[str, StoredEvent] = {}
        self._store: HistoricalStore | None = None  # set via load_from_store

    # ---------------------------------------------------------------
    # Persistence: load from SQLite on startup
    # ---------------------------------------------------------------

    async def load_from_store(self, store: HistoricalStore) -> int:
        """Load persisted events from SQLite into memory.

        Called once on startup before any other operations.
        Does NOT clear existing in-memory events — merges instead.

        Args:
            store: The HistoricalStore instance to read from.

        Returns:
            Number of events loaded from SQLite.
        """
        self._store = store
        loaded = 0
        try:
            persisted = await store.read_active_events()
            for event_dict in persisted:
                event_id = event_dict["event_id"]
                # Skip if already in memory (e.g. from an earlier init)
                if event_id in self._events:
                    continue

                # Reconstruct StoredEvent from persisted dict
                event_type = EventType(event_dict["event_type"])
                created_at = event_dict.get("created_at")
                expires_at = event_dict.get("expires_at")

                # Parse ISO timestamps
                if isinstance(created_at, str):
                    created_at = datetime.fromisoformat(created_at)
                if isinstance(expires_at, str):
                    expires_at = datetime.fromisoformat(expires_at)

                event = StoredEvent(
                    event_id=event_id,
                    event_type=event_type,
                    description=event_dict.get("description", ""),
                    affected_currencies=event_dict.get("affected_currencies", []),
                    timestamp=created_at or datetime.now(timezone.utc),
                    expires_at=expires_at,
                    is_active=event_dict.get("is_active", True),
                    created_at=created_at or datetime.now(timezone.utc),
                )
                self._events[event_id] = event
                loaded += 1

            if loaded > 0:
                logger.info("Loaded %d persisted events from SQLite", loaded)
        except Exception as e:
            logger.error("Failed to load events from SQLite: %s", e)

        return loaded

    # ---------------------------------------------------------------
    # CRUD Operations (dual-write: memory + SQLite)
    # ---------------------------------------------------------------

    def create_event(
        self,
        event_type: EventType,
        description: str,
        affected_currencies: list[str] | None = None,
        timestamp: datetime | None = None,
        expires_at: datetime | None = None,
    ) -> StoredEvent:
        """Create a new event and store it.

        Dual-writes to in-memory dict AND SQLite (if store is available).

        Args:
            event_type: Type of event (major_patch, minor_patch, etc.)
            description: Human-readable description
            affected_currencies: Optional list of currency API IDs affected
            timestamp: When the event occurred (defaults to now)
            expires_at: When the event expires (defaults to now + config expiry)

        Returns:
            The created StoredEvent with a unique event_id
        """
        now = datetime.now(timezone.utc)
        if timestamp is None:
            timestamp = now

        if expires_at is None:
            expiry_hours = self._config.events.default_expiry_hours
            expires_at = timestamp + timedelta(hours=expiry_hours)

        event_id = str(uuid.uuid4())[:8]  # short ID for convenience

        event = StoredEvent(
            event_id=event_id,
            event_type=event_type,
            description=description,
            affected_currencies=affected_currencies or [],
            timestamp=timestamp,
            expires_at=expires_at,
            is_active=True,
            created_at=now,
        )

        # In-memory write (fast)
        self._events[event_id] = event

        # SQLite write (async, fire-and-forget via task if possible)
        if self._store is not None:
            import asyncio
            try:
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    asyncio.ensure_future(self._store.write_event(event))
                else:
                    loop.run_until_complete(self._store.write_event(event))
            except Exception as e:
                logger.error("Failed to persist event %s to SQLite: %s", event_id, e)

        logger.info(
            "Event created: [%s] %s — %s (expires: %s)",
            event.event_type.value,
            event.event_id,
            event.description[:80],
            event.expires_at.isoformat() if event.expires_at else "never",
        )

        return event

    def get_event(self, event_id: str) -> StoredEvent | None:
        """Get a single event by ID."""
        self._prune_expired()
        return self._events.get(event_id)

    def list_events(
        self,
        active_only: bool = True,
    ) -> list[StoredEvent]:
        """List events, optionally filtering to active ones only.

        Args:
            active_only: If True, only return events that are currently
                         active (not expired, not manually deactivated)
        """
        self._prune_expired()

        events = list(self._events.values())

        if active_only:
            events = [e for e in events if e.is_active and not self._is_expired(e)]

        # Sort by timestamp descending (most recent first)
        events.sort(key=lambda e: e.timestamp, reverse=True)
        return events

    def delete_event(self, event_id: str) -> bool:
        """Delete an event by ID.

        Removes from both in-memory and SQLite.

        Returns:
            True if the event was found and deleted, False otherwise.
        """
        if event_id in self._events:
            del self._events[event_id]

            # Also delete from SQLite
            if self._store is not None:
                import asyncio
                try:
                    loop = asyncio.get_event_loop()
                    if loop.is_running():
                        asyncio.ensure_future(self._store.delete_event(event_id))
                    else:
                        loop.run_until_complete(self._store.delete_event(event_id))
                except Exception as e:
                    logger.error("Failed to delete event %s from SQLite: %s", event_id, e)

            logger.info("Event deleted: %s", event_id)
            return True
        return False

    def deactivate_event(self, event_id: str) -> bool:
        """Mark an event as inactive without deleting it.

        Updates both in-memory and SQLite.

        Returns:
            True if the event was found and deactivated, False otherwise.
        """
        event = self._events.get(event_id)
        if event is not None:
            event.is_active = False

            # Also deactivate in SQLite
            if self._store is not None:
                import asyncio
                try:
                    loop = asyncio.get_event_loop()
                    if loop.is_running():
                        asyncio.ensure_future(self._store.deactivate_event(event_id))
                    else:
                        loop.run_until_complete(self._store.deactivate_event(event_id))
                except Exception as e:
                    logger.error("Failed to deactivate event %s in SQLite: %s", event_id, e)

            logger.info("Event deactivated: %s", event_id)
            return True
        return False

    # ---------------------------------------------------------------
    # Query Interfaces for Subsystems
    # ---------------------------------------------------------------

    def is_event_active(self, currency: str | None = None) -> bool:
        """Check if any event is currently active.

        Args:
            currency: Optional currency API ID. If provided, checks if
                      any active event affects this specific currency.
                      If None, checks if ANY event is active.

        Returns:
            True if there is at least one active event
        """
        self._prune_expired()

        for event in self._events.values():
            if not event.is_active or self._is_expired(event):
                continue

            if currency is None:
                return True

            # If the event specifies affected_currencies, check if currency is listed
            if event.affected_currencies:
                if currency in event.affected_currencies:
                    return True
            else:
                # No specific currencies -> affects all currencies
                return True

        return False

    def get_event_score_penalty(self, currency: str) -> float:
        """Get the score penalty multiplier for a currency due to active events.

        From spec section 6: If affected_currencies is specified, those currencies
        are excluded from flip scoring. If not specified, all currencies get
        a temporary event_penalty = 0.5 on their scores.

        This returns a multiplier:
        - 0.0 = currency should be excluded entirely
        - 0.5 = currency gets penalty (event with no specific currencies)
        - 1.0 = no penalty

        Args:
            currency: Currency API ID to check

        Returns:
            Penalty multiplier (0.0, 0.5, or 1.0)
        """
        self._prune_expired()

        penalty = self._config.events.event_score_penalty

        for event in self._events.values():
            if not event.is_active or self._is_expired(event):
                continue

            if event.affected_currencies:
                # Specific currencies affected -> exclude them
                if currency in event.affected_currencies:
                    return 0.0  # excluded entirely
            else:
                # No specific currencies -> all get penalty
                return penalty

        return 1.0  # no penalty

    def get_affected_currencies(self) -> set[str]:
        """Get the set of all currency API IDs affected by active events.

        Returns:
            Set of currency API IDs that are specifically targeted by active events.
            Note: Events with empty affected_currencies affect ALL currencies.
        """
        self._prune_expired()

        affected: set[str] = set()
        for event in self._events.values():
            if not event.is_active or self._is_expired(event):
                continue
            if event.affected_currencies:
                affected.update(event.affected_currencies)

        return affected

    def has_major_patch_event(self) -> bool:
        """Check if there is an active major_patch event.

        Used by PhaseDetector to determine if the phase clock should be reset.
        """
        self._prune_expired()

        for event in self._events.values():
            if not event.is_active or self._is_expired(event):
                continue
            if event.event_type == EventType.MAJOR_PATCH:
                return True
        return False

    def get_latest_major_patch_timestamp(self) -> datetime | None:
        """Get the timestamp of the most recent active major_patch event.

        Returns None if no active major_patch event exists.
        Used by PhaseDetector.reset_for_major_patch().
        """
        self._prune_expired()

        latest: datetime | None = None
        for event in self._events.values():
            if not event.is_active or self._is_expired(event):
                continue
            if event.event_type == EventType.MAJOR_PATCH:
                if latest is None or event.timestamp > latest:
                    latest = event.timestamp

        return latest

    def get_active_event_summary(self) -> dict | None:
        """Get a summary of the most important active event for UI display.

        Returns:
            Dict with event_type, description, and affected_currencies,
            or None if no events are active.
        """
        self._prune_expired()

        events = self.list_events(active_only=True)
        if not events:
            return None

        # Priority: major_patch > minor_patch > streamer_hype > other
        priority = {
            EventType.MAJOR_PATCH: 0,
            EventType.MINOR_PATCH: 1,
            EventType.STREAMER_HYPE: 2,
            EventType.OTHER: 3,
        }

        events.sort(key=lambda e: priority.get(e.event_type, 99))
        top = events[0]

        return {
            "event_type": top.event_type.value,
            "description": top.description,
            "affected_currencies": top.affected_currencies,
            "expires_at": top.expires_at.isoformat() if top.expires_at else None,
            "total_active_events": len(events),
        }

    # ---------------------------------------------------------------
    # Internal
    # ---------------------------------------------------------------

    def _is_expired(self, event: StoredEvent) -> bool:
        """Check if an event has expired."""
        if event.expires_at is None:
            return False
        now = datetime.now(timezone.utc)
        # Handle timezone-naive expires_at
        expires = event.expires_at
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        return now >= expires

    def _prune_expired(self) -> int:
        """Remove expired events from storage.

        Also prunes from SQLite if the store is available.

        Returns:
            Number of events pruned from memory
        """
        now = datetime.now(timezone.utc)
        expired_ids = []

        for eid, event in self._events.items():
            if self._is_expired(event):
                expired_ids.append(eid)

        for eid in expired_ids:
            del self._events[eid]

        if expired_ids:
            logger.info("Pruned %d expired events from memory", len(expired_ids))

            # Also prune from SQLite
            if self._store is not None:
                import asyncio
                try:
                    loop = asyncio.get_event_loop()
                    if loop.is_running():
                        asyncio.ensure_future(self._store.prune_expired_events())
                    else:
                        loop.run_until_complete(self._store.prune_expired_events())
                except Exception as e:
                    logger.error("Failed to prune expired events from SQLite: %s", e)

        return len(expired_ids)

    def clear_all(self) -> int:
        """Clear all events from both in-memory and SQLite. Useful for testing.

        Fix 4.2: Also clears the persistent SQLite store so that old events
        don't reappear after a backend restart.

        Returns:
            Number of events cleared
        """
        count = len(self._events)
        self._events.clear()
        # Fix 4.2: Also clear persistent store
        if self._store is not None:
            import asyncio
            try:
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    asyncio.ensure_future(self._store.clear_all_events())
                else:
                    loop.run_until_complete(self._store.clear_all_events())
            except Exception as e:
                logger.error("Failed to clear persistent events: %s", e)
        return count


# ---------------------------------------------------------------------------
# Singleton accessor
# ---------------------------------------------------------------------------

_event_manager: EventManager | None = None


def get_event_manager(config: AppConfig | None = None) -> EventManager:
    """Return the shared EventManager instance (lazy singleton)."""
    global _event_manager
    if _event_manager is None:
        _event_manager = EventManager(config)
    return _event_manager


def reset_event_manager() -> None:
    """Reset the singleton. Primarily for testing."""
    global _event_manager
    _event_manager = None
