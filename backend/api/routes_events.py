"""
API routes for manual event flagging.

From PoE2_Flipper_Implementation_Spec.md §6:
Events are flagged manually by the user via API/UI.

Endpoints:
    POST   /api/v1/events           — create a new event
    GET    /api/v1/events           — list all active events
    GET    /api/v1/events/{id}      — get a specific event
    DELETE /api/v1/events/{id}      — delete an event
    POST   /api/v1/events/{id}/deactivate — deactivate an event without deleting
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from backend.config import get_settings, AppConfig
from backend.economy.events import get_event_manager, EventManager
from backend.api.shared import get_phase_detector as _get_phase_detector
from backend.models.currency import EventType
from backend.data.unified_cache import get_pipeline_cache, get_daily_stats_cache
from backend.api.response_models import EventCreateResponse, EventsListResponse, EventSummaryResponse, EventMessageResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/events", tags=["events"])


# ---------------------------------------------------------------------------
# Request/Response Models
# ---------------------------------------------------------------------------

class CreateEventRequest(BaseModel):
    """Request body for creating a new event."""
    event_type: EventType = Field(
        ...,
        description="Type of event: major_patch, minor_patch, league_start, economy_shift, streamer_hype, other",
    )
    description: str = Field(
        ...,
        min_length=1,
        max_length=500,
        description="Human-readable description of the event",
    )
    affected_currencies: list[str] = Field(
        default_factory=list,
        description="Optional list of currency API IDs affected by this event. "
                    "If empty, the event affects all currencies.",
    )
    timestamp: str | None = Field(
        default=None,
        description="ISO 8601 timestamp of when the event occurred. Defaults to now.",
    )
    expires_at: str | None = Field(
        default=None,
        description="ISO 8601 timestamp of when the event expires. "
                    "Defaults to now + config.events.default_expiry_hours.",
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("", response_model=EventCreateResponse)
async def create_event(request: CreateEventRequest):
    """Create a new manual event flag.

    From spec section 6, events affect multiple subsystems:
    - SARIMA forecasts: labeled low_confidence=True
    - Holt-Winters: disabled entirely
    - Flip scoring: affected currencies get penalty or exclusion
    - Phase reset: major_patch events reset the PhaseDetector

    Events auto-expire after a configurable duration (default: 48 hours).
    """
    config = get_settings()
    manager = get_event_manager(config)

    # Parse optional timestamps
    event_timestamp = None
    if request.timestamp:
        try:
            event_timestamp = datetime.fromisoformat(
                request.timestamp.replace("Z", "+00:00")
            )
        except ValueError:
            raise HTTPException(
                status_code=422,
                detail=f"Invalid timestamp format: {request.timestamp}. Use ISO 8601.",
            )

    expires_at = None
    if request.expires_at:
        try:
            expires_at = datetime.fromisoformat(
                request.expires_at.replace("Z", "+00:00")
            )
        except ValueError:
            raise HTTPException(
                status_code=422,
                detail=f"Invalid expires_at format: {request.expires_at}. Use ISO 8601.",
            )

    # Create the event
    event = await manager.create_event(
        event_type=request.event_type,
        description=request.description,
        affected_currencies=request.affected_currencies,
        timestamp=event_timestamp,
        expires_at=expires_at,
    )

    # If this is a major_patch event, reset the PhaseDetector
    if request.event_type == EventType.MAJOR_PATCH:
        detector = _get_phase_detector()
        patch_ts = event_timestamp or datetime.now(timezone.utc)
        detector.reset_for_major_patch(patch_ts)
        logger.info(
            "PhaseDetector reset for major patch at %s",
            patch_ts.isoformat(),
        )

    # Invalidate the pipeline cache — events affect scoring, forecasting,
    # and storage value computations. The next request will recompute
    # with the new event taken into account.
    pipeline_cache = get_pipeline_cache()
    pipeline_cache.invalidate()
    logger.info("PipelineCache invalidated after event creation")

    # P1-11: also invalidate the daily_stats namespace. Event creation
    # affects forecast confidence and 24h trend interpretation, which
    # feed the daily-stats aggregation. Without this, stale daily-stats
    # entries survive up to their TTL (default 30 min) before reflecting
    # the new event context — causing the UI to show outdated
    # benchmarks/storage-value estimates after a major_patch flag.
    daily_stats_cache = get_daily_stats_cache()
    daily_stats_cache.invalidate()
    logger.info("DailyStatsCache invalidated after event creation")

    return {
        "message": "Event created successfully",
        "event": event.to_dict(),
    }


@router.get("", response_model=EventsListResponse)
async def list_events(
    active_only: bool = Query(True, description="Only return active events"),
):
    """List all events, optionally filtering to active ones only."""
    config = get_settings()
    manager = get_event_manager(config)

    events = manager.list_events(active_only=active_only)

    return {
        "total": len(events),
        "events": [e.to_dict() for e in events],
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/summary", response_model=EventSummaryResponse)
async def get_event_summary():
    """Get a summary of the most important active event.

    Returns the highest-priority active event for UI display in the sticky bar.
    Also returns whether any event is active at all.
    """
    config = get_settings()
    manager = get_event_manager(config)

    summary = manager.get_active_event_summary()

    return {
        "any_event_active": summary is not None,
        "event": summary,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/{event_id}")
async def get_event(event_id: str):
    """Get a specific event by ID."""
    config = get_settings()
    manager = get_event_manager(config)

    event = manager.get_event(event_id)
    if event is None:
        raise HTTPException(status_code=404, detail=f"Event not found: {event_id}")

    return event.to_dict()


@router.delete("/{event_id}", response_model=EventMessageResponse)
async def delete_event(event_id: str):
    """Delete an event by ID."""
    config = get_settings()
    manager = get_event_manager(config)

    deleted = await manager.delete_event(event_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Event not found: {event_id}")

    # Invalidate pipeline cache — removal changes scoring/forecast context
    pipeline_cache = get_pipeline_cache()
    pipeline_cache.invalidate()
    logger.info("PipelineCache invalidated after event deletion")

    # P1-11: also invalidate daily_stats (same rationale as create_event).
    daily_stats_cache = get_daily_stats_cache()
    daily_stats_cache.invalidate()
    logger.info("DailyStatsCache invalidated after event deletion")

    return {"message": f"Event {event_id} deleted successfully"}


@router.post("/{event_id}/deactivate", response_model=EventMessageResponse)
async def deactivate_event(event_id: str):
    """Deactivate an event without deleting it.

    The event will remain in the history but will no longer affect subsystems.
    """
    config = get_settings()
    manager = get_event_manager(config)

    deactivated = await manager.deactivate_event(event_id)
    if not deactivated:
        raise HTTPException(status_code=404, detail=f"Event not found: {event_id}")

    # Invalidate pipeline cache — deactivation changes scoring/forecast context
    pipeline_cache = get_pipeline_cache()
    pipeline_cache.invalidate()
    logger.info("PipelineCache invalidated after event deactivation")

    # P1-11: also invalidate daily_stats (same rationale as create_event).
    daily_stats_cache = get_daily_stats_cache()
    daily_stats_cache.invalidate()
    logger.info("DailyStatsCache invalidated after event deactivation")

    return {"message": f"Event {event_id} deactivated successfully"}
