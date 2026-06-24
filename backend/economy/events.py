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
import threading
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

    Thread safety (P3-3, iter 71):
        All in-memory reads and writes are guarded by a ``threading.RLock``.
        This makes the manager safe to use from FastAPI route handlers AND
        from background threads (scheduler, ProcessPoolExecutor callbacks)
        running concurrently within the same uvicorn worker process.

        The RLock is **never held across an ``await``** — SQLite writes are
        performed outside the lock so that one slow DB write does not block
        unrelated reads. The only state guarded by the lock is the in-memory
        ``_events`` dict and the ``_store`` back-reference.

        Multi-worker uvicorn deployments still need a shared external store
        (Redis, DB) to coordinate across processes — the lock here only
        protects in-process concurrency.
    """

    def __init__(self, config: AppConfig | None = None):
        self._config = config or get_settings()
        self._events: dict[str, StoredEvent] = {}
        self._store: HistoricalStore | None = None  # set via load_from_store
        # P3-3 (iter 71): RLock guards all in-memory _events / _store access.
        # RLock (not Lock) so that _prune_expired() can be called from within
        # other locked methods without deadlocking.
        self._lock = threading.RLock()

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
        # P3-3 (iter 71): store back-reference under the lock so that
        # concurrent CRUD calls don't see a half-set _store. The actual
        # SQLite read is awaited OUTSIDE the lock.
        with self._lock:
            self._store = store

        loaded = 0
        try:
            persisted = await store.read_active_events()
            # P3-3: merge under the lock — protects against concurrent
            # create_event() that might also be writing to _events.
            with self._lock:
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

    async def create_event(
        self,
        event_type: EventType,
        description: str,
        affected_currencies: list[str] | None = None,
        timestamp: datetime | None = None,
        expires_at: datetime | None = None,
    ) -> StoredEvent:
        """Create a new event and store it.

        Dual-writes to in-memory dict AND SQLite (if store is available).

        P1-7 (iter 61): Previously this method used the deprecated
        `asyncio.get_event_loop()` + `ensure_future` fire-and-forget
        pattern for the SQLite write. The in-memory write would succeed
        but the SQLite write could be silently lost on event-loop teardown.
        Now `await self._store.write_event(event)` — caller awaits both.

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

        # P3-3 (iter 71): in-memory write under the lock; SQLite write
        # is awaited OUTSIDE the lock so other readers aren't blocked
        # by a slow DB call. If the SQLite write fails, the in-memory
        # state is still consistent (event exists in memory only).
        with self._lock:
            self._events[event_id] = event
            store = self._store

        # SQLite write — awaited (P1-7: was fire-and-forget via ensure_future)
        if store is not None:
            try:
                await store.write_event(event)
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
        with self._lock:
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

        # P3-3 (iter 71): snapshot the dict under the lock, then build the
        # filtered/sorted list OUTSIDE the lock. Prevents "dict changed size
        # during iteration" errors if another thread mutates _events while
        # we're iterating.
        with self._lock:
            events = list(self._events.values())

        if active_only:
            events = [e for e in events if e.is_active and not self._is_expired(e)]

        # Sort by timestamp descending (most recent first)
        events.sort(key=lambda e: e.timestamp, reverse=True)
        return events

    async def delete_event(self, event_id: str) -> bool:
        """Delete an event by ID.

        Removes from both in-memory and SQLite.

        P1-7 (iter 61): Now async — awaits the SQLite delete instead of
        fire-and-forget. Prevents silent loss of deletes on shutdown.

        Returns:
            True if the event was found and deleted, False otherwise.
        """
        # P3-3 (iter 71): in-memory delete under the lock; SQLite delete
        # awaited outside the lock.
        with self._lock:
            if event_id not in self._events:
                return False
            del self._events[event_id]
            store = self._store

        # Also delete from SQLite — awaited (P1-7)
        if store is not None:
            try:
                await store.delete_event(event_id)
            except Exception as e:
                logger.error("Failed to delete event %s from SQLite: %s", event_id, e)

        logger.info("Event deleted: %s", event_id)
        return True

    async def deactivate_event(self, event_id: str) -> bool:
        """Mark an event as inactive without deleting it.

        Updates both in-memory and SQLite.

        P1-7 (iter 61): Now async — awaits the SQLite deactivate instead of
        fire-and-forget. Prevents silent loss of deactivations on shutdown.

        Returns:
            True if the event was found and deactivated, False otherwise.
        """
        # P3-3 (iter 71): mutate the StoredEvent under the lock — the
        # is_active flag is read by other methods (is_event_active,
        # get_event_score_penalty, etc.).
        with self._lock:
            event = self._events.get(event_id)
            if event is None:
                return False
            event.is_active = False
            store = self._store

        # Also deactivate in SQLite — awaited (P1-7)
        if store is not None:
            try:
                await store.deactivate_event(event_id)
            except Exception as e:
                logger.error("Failed to deactivate event %s in SQLite: %s", event_id, e)

        logger.info("Event deactivated: %s", event_id)
        return True

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

        # P3-3 (iter 71): snapshot under the lock; iterate outside.
        with self._lock:
            events = list(self._events.values())

        for event in events:
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

        # P3-3 (iter 71): snapshot under the lock; iterate outside.
        with self._lock:
            events = list(self._events.values())

        for event in events:
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

        # P3-3 (iter 71): snapshot under the lock; iterate outside.
        with self._lock:
            events = list(self._events.values())

        affected: set[str] = set()
        for event in events:
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

        # P3-3 (iter 71): snapshot under the lock; iterate outside.
        with self._lock:
            events = list(self._events.values())

        for event in events:
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

        # P3-3 (iter 71): snapshot under the lock; iterate outside.
        with self._lock:
            events = list(self._events.values())

        latest: datetime | None = None
        for event in events:
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
        # list_events() already snapshot-iterates under the lock (P3-3).
        events = self.list_events(active_only=True)
        if not events:
            return None

        # Priority: major_patch > minor_patch > league_start > economy_shift > streamer_hype > other
        priority = {
            EventType.MAJOR_PATCH: 0,
            EventType.MINOR_PATCH: 1,
            EventType.LEAGUE_START: 2,
            EventType.ECONOMY_SHIFT: 3,
            EventType.STREAMER_HYPE: 4,
            EventType.OTHER: 5,
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
        """Remove expired events from in-memory storage.

        P1-7 (iter 61): Previously this method ALSO triggered a fire-and-forget
        SQLite prune via `asyncio.ensure_future(self._store.prune_expired_events())`.
        That had two problems: (1) silent loss on event-loop teardown, same
        as the other CRUD methods; (2) `_prune_expired` is called from
        sync read-only methods (`list_events`, `get_event`, `is_event_active`,
        ...), so making it async would force every read-only path to become
        async — a much larger refactor with no caller-facing benefit.

        Solution: keep `_prune_expired` sync and limit it to in-memory prune.
        The SQLite prune is done by the scheduler (`DataScheduler.prune_events`,
        `backend/scheduler.py:145`) which already awaits
        `self._store.prune_expired_events()` on a periodic schedule, AND by
        `backend/main.py:174` on startup. Both code paths already exist
        and continue to keep SQLite in sync.

        P3-3 (iter 71): the in-memory prune is now performed under the
        RLock so that two concurrent readers don't both try to delete the
        same expired event ID (one of them would raise KeyError otherwise).

        Returns:
            Number of events pruned from memory
        """
        now = datetime.now(timezone.utc)

        # P3-3 (iter 71): snapshot under the lock, then mutate under the
        # same lock. RLock allows _prune_expired() to be called from within
        # another locked method (e.g. list_events) without deadlocking.
        with self._lock:
            expired_ids = [
                eid for eid, event in self._events.items()
                if self._is_expired(event)
            ]
            for eid in expired_ids:
                del self._events[eid]

        if expired_ids:
            logger.info("Pruned %d expired events from memory", len(expired_ids))

        return len(expired_ids)

    async def clear_all(self) -> int:
        """Clear all events from both in-memory and SQLite. Useful for testing.

        Fix 4.2: Also clears the persistent SQLite store so that old events
        don't reappear after a backend restart.

        P1-7 (iter 61): Now async — awaits the SQLite clear_all_events
        instead of fire-and-forget. Ensures test isolation: after a test
        calls `await manager.clear_all()`, the next test session does NOT
        see leftover events from the previous test's SQLite file.

        Returns:
            Number of events cleared
        """
        # P3-3 (iter 71): in-memory clear under the lock; SQLite clear
        # awaited outside the lock.
        with self._lock:
            count = len(self._events)
            self._events.clear()
            store = self._store

        # Fix 4.2: Also clear persistent store — awaited (P1-7)
        if store is not None:
            try:
                await store.clear_all_events()
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
