"""
SSE (Server-Sent Events) routes for live price updates.

Endpoints:
    GET /api/prices/stream  — pushes price change events to connected clients

Unlike WebSocket routes (/ws/*), SSE is unidirectional (server → client),
which is ideal for price push notifications:
  - Works over standard HTTP (no Upgrade handshake)
  - Auto-reconnects built into the browser EventSource API
  - Works through reverse proxies without special configuration
  - No CORS issues when served from the same origin

The server monitors the DataSnapshot for changes and pushes incremental
price updates to all connected clients whenever a new snapshot is available.

Message format (SSE):
    event: price_update
    data: {"changed_pairs": [...], "timestamp": "ISO8601", "snapshot_age_ms": 1234}

    event: heartbeat
    data: {"timestamp": "ISO8601"}
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from backend.config import get_settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["sse"])

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

PUSH_INTERVAL_SECONDS = 5  # How often to check for price changes
HEARTBEAT_INTERVAL_SECONDS = 30  # How often to send heartbeats
MAX_CLIENTS = 50  # Maximum concurrent SSE connections
CLIENT_TIMEOUT_SECONDS = 300  # Close connection after 5 min of no activity

# ---------------------------------------------------------------------------
# Connected clients registry
# ---------------------------------------------------------------------------

_client_queues: list[asyncio.Queue] = []
_clients_lock = asyncio.Lock()


async def _register_client() -> asyncio.Queue:
    """Register a new SSE client and return its message queue."""
    async with _clients_lock:
        if len(_client_queues) >= MAX_CLIENTS:
            raise RuntimeError("Maximum SSE client limit reached")
        queue: asyncio.Queue = asyncio.Queue(maxsize=100)
        _client_queues.append(queue)
        logger.info("SSE client connected (total: %d)", len(_client_queues))
        return queue


async def _unregister_client(queue: asyncio.Queue) -> None:
    """Remove an SSE client's queue from the registry."""
    async with _clients_lock:
        if queue in _client_queues:
            _client_queues.remove(queue)
            logger.info("SSE client disconnected (total: %d)", len(_client_queues))


async def _broadcast(event_type: str, data: dict) -> None:
    """Send an SSE event to all connected clients."""
    async with _clients_lock:
        dead_queues: list[asyncio.Queue] = []
        for queue in _client_queues:
            try:
                queue.put_nowait((event_type, data))
            except asyncio.QueueFull:
                # Client is too slow — drop it
                dead_queues.append(queue)
        for q in dead_queues:
            _client_queues.remove(q)
            logger.warning("Dropped slow SSE client (queue full)")


# ---------------------------------------------------------------------------
# Price change detection
# ---------------------------------------------------------------------------

_last_prices: dict[str, float] = {}
_last_snapshot_ts: float = 0.0


def _detect_price_changes(
    current_prices: dict[str, float],
    previous_prices: dict[str, float],
    threshold_pct: float = 0.5,
) -> list[dict]:
    """Detect currencies whose price changed by more than threshold_pct.

    Returns a list of change dicts sorted by absolute change descending.
    """
    changes = []
    for api_id, current_price in current_prices.items():
        prev_price = previous_prices.get(api_id)
        if prev_price is None or prev_price <= 0 or current_price <= 0:
            continue
        change_pct = ((current_price - prev_price) / prev_price) * 100
        if abs(change_pct) >= threshold_pct:
            changes.append({
                "api_id": api_id,
                "previous_price": round(prev_price, 8),
                "current_price": round(current_price, 8),
                "change_pct": round(change_pct, 2),
            })
    changes.sort(key=lambda c: abs(c["change_pct"]), reverse=True)
    return changes[:100]  # Cap at 100 changes per event


# ---------------------------------------------------------------------------
# Background task: monitor snapshot and broadcast changes
# ---------------------------------------------------------------------------

_sse_monitor_task: Optional[asyncio.Task] = None


async def _start_sse_monitor() -> None:
    """Background task that monitors DataSnapshot for price changes
    and broadcasts updates to connected SSE clients.

    This runs as a long-lived coroutine started from the FastAPI lifespan.
    """
    global _last_prices, _last_snapshot_ts

    logger.info("SSE monitor: started (interval=%ds)", PUSH_INTERVAL_SECONDS)

    while True:
        try:
            await asyncio.sleep(PUSH_INTERVAL_SECONDS)

            # Get current snapshot
            from backend.api.data_snapshot import get_snapshot_manager
            snapshot_mgr = get_snapshot_manager()
            if snapshot_mgr.last_snapshot is None:
                continue

            snapshot = snapshot_mgr.last_snapshot
            current_ts = snapshot_mgr._snapshot_ts

            # Skip if snapshot hasn't changed since last broadcast
            if current_ts <= _last_snapshot_ts:
                continue

            _last_snapshot_ts = current_ts

            # Detect price changes
            current_prices = dict(snapshot.prices_in_base)
            if _last_prices:
                changes = _detect_price_changes(current_prices, _last_prices)
                if changes:
                    await _broadcast("price_update", {
                        "changed_pairs": changes,
                        "total_currencies": len(current_prices),
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "snapshot_age_ms": int((time.monotonic() - current_ts) * 1000),
                    })

            _last_prices = current_prices

        except asyncio.CancelledError:
            logger.info("SSE monitor: cancelled — shutting down")
            raise
        except Exception as e:
            logger.error("SSE monitor error: %s", e)
            await asyncio.sleep(PUSH_INTERVAL_SECONDS)


def start_sse_monitor() -> Optional[asyncio.Task]:
    """Start the SSE background monitor if not already running."""
    global _sse_monitor_task
    if _sse_monitor_task is not None and not _sse_monitor_task.done():
        return _sse_monitor_task
    _sse_monitor_task = asyncio.create_task(_start_sse_monitor())
    return _sse_monitor_task


def stop_sse_monitor() -> None:
    """Cancel the SSE background monitor."""
    global _sse_monitor_task
    if _sse_monitor_task is not None and not _sse_monitor_task.done():
        _sse_monitor_task.cancel()
        _sse_monitor_task = None


# ---------------------------------------------------------------------------
# SSE endpoint
# ---------------------------------------------------------------------------

@router.get("/prices/stream")
async def prices_stream(request: Request):
    """SSE endpoint for live price updates.

    Clients connect with EventSource or a similar SSE client.
    The server pushes price_update events whenever the DataSnapshot
    refreshes and detects price changes above the threshold.

    Query parameters:
        threshold_pct: Minimum price change percentage to trigger an event
                       (default: 0.5, range: 0.1-50.0)
    """
    # Check client limit
    if len(_client_queues) >= MAX_CLIENTS:
        return StreamingResponse(
            iter(["event: error\ndata: {\"message\": \"Maximum SSE clients reached\"}\n\n"]),
            media_type="text/event-stream",
            status_code=429,
        )

    queue = await _register_client()

    async def event_generator():
        """Generate SSE events for this client."""
        last_activity = time.monotonic()
        heartbeat_counter = 0

        try:
            while True:
                # Check if client disconnected
                if await request.is_disconnected():
                    break

                # Check timeout
                if time.monotonic() - last_activity > CLIENT_TIMEOUT_SECONDS:
                    yield "event: timeout\ndata: {\"message\": \"Connection timeout\"}\n\n"
                    break

                # Wait for events with a short timeout for heartbeat
                try:
                    event_type, data = await asyncio.wait_for(
                        queue.get(), timeout=HEARTBEAT_INTERVAL_SECONDS
                    )
                    last_activity = time.monotonic()
                    yield f"event: {event_type}\ndata: {json.dumps(data)}\n\n"
                except asyncio.TimeoutError:
                    # Send heartbeat
                    heartbeat_counter += 1
                    last_activity = time.monotonic()
                    yield (
                        f"event: heartbeat\ndata: "
                        f"{{\"timestamp\": \"{datetime.now(timezone.utc).isoformat()}\", "
                        f"\"counter\": {heartbeat_counter}}}\n\n"
                    )

        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error("SSE stream error: %s", e)
        finally:
            await _unregister_client(queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable nginx buffering
        },
    )
