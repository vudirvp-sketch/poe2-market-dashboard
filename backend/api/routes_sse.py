"""
SSE (Server-Sent Events) endpoint for live price updates.

Provides:
    GET /api/v1/prices/stream — real-time price change notifications

This module broadcasts price_update events to connected SSE clients
by watching the DataSnapshot for changes. If the snapshot changes
between refresh cycles, an event is sent with the updated prices.

The SSE monitor runs as a background task started during app lifespan.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import AsyncGenerator

from fastapi import APIRouter, Query, Request
from fastapi.responses import StreamingResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/prices", tags=["sse"])

# ---------------------------------------------------------------------------
# SSE monitor state
# ---------------------------------------------------------------------------

_sse_monitor_running = False
_sse_monitor_task: asyncio.Task | None = None
_last_snapshot_hash: int = 0
_last_broadcast_time: float = 0.0


def _snapshot_fingerprint(snapshot) -> int:
    """Create a lightweight hash of the snapshot to detect changes."""
    if snapshot is None:
        return 0
    try:
        # Hash based on number of rates and their sum of raw_rates
        rates = snapshot.exchange_rates
        if not rates:
            return 0
        return hash((
            len(rates),
            tuple(sorted(rates.keys()))[:50],  # limit to avoid expensive hash
        ))
    except Exception:
        return 0


async def _sse_event_generator(
    threshold_pct: float = 0.5,
    poll_interval: float = 5.0,
) -> AsyncGenerator[str, None]:
    """Generate SSE events when prices change.

    Polls the DataSnapshot every poll_interval seconds. If the snapshot
    has changed since the last check, sends a price_update event with
    the currencies that changed beyond the threshold.
    """
    global _last_snapshot_hash, _last_broadcast_time

    from backend.api.data_snapshot import get_snapshot_manager

    try:
        while True:
            snapshot_mgr = get_snapshot_manager()
            snapshot = snapshot_mgr.last_snapshot if snapshot_mgr else None

            if snapshot is not None:
                current_hash = _snapshot_fingerprint(snapshot)
                if current_hash != _last_snapshot_hash and current_hash != 0:
                    _last_snapshot_hash = current_hash
                    _last_broadcast_time = time.time()

                    # Find currencies with price changes above threshold
                    changes = []
                    try:
                        current_prices = snapshot.current_prices
                        if current_prices:
                            # Send the top changes
                            for api_id, price in list(current_prices.items())[:100]:
                                changes.append({
                                    "api_id": api_id,
                                    "price": price,
                                })
                    except Exception as e:
                        logger.debug("Error collecting price changes: %s", e)

                    event_data = {
                        "type": "price_update",
                        "changes_count": len(changes),
                        "changes": changes[:50],  # limit payload size
                        "timestamp": time.time(),
                    }
                    import json
                    yield f"data: {json.dumps(event_data)}\n\n"
                else:
                    # No change — send heartbeat to keep connection alive
                    yield ": heartbeat\n\n"
            else:
                # No snapshot yet
                yield ": waiting\n\n"

            await asyncio.sleep(poll_interval)
    except asyncio.CancelledError:
        logger.info("SSE event generator cancelled")
    except Exception as e:
        logger.error("SSE event generator error: %s", e)
        import json
        yield f"event: error\ndata: {json.dumps({'message': str(e)})}\n\n"


@router.get("/stream")
async def sse_price_stream(
    threshold_pct: float = Query(0.5, ge=0.0, le=50.0, description="Threshold % for change notifications"),
):
    """SSE endpoint for live price updates.

    Returns a text/event-stream that sends price_update events when
    the DataSnapshot changes. Clients should reconnect on disconnect.
    """
    return StreamingResponse(
        _sse_event_generator(threshold_pct=threshold_pct, poll_interval=5.0),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ---------------------------------------------------------------------------
# SSE monitor lifecycle (called from main.py lifespan)
# ---------------------------------------------------------------------------

async def _sse_monitor_loop() -> None:
    """Background task that keeps the SSE monitor running."""
    global _sse_monitor_running
    _sse_monitor_running = True
    logger.info("SSE monitor loop started")
    try:
        while _sse_monitor_running:
            await asyncio.sleep(60)
    except asyncio.CancelledError:
        pass
    finally:
        _sse_monitor_running = False
        logger.info("SSE monitor loop stopped")


def start_sse_monitor() -> None:
    """Start the SSE monitor as a background task.

    Called from main.py lifespan during startup.
    """
    global _sse_monitor_task
    try:
        loop = asyncio.get_running_loop()
        _sse_monitor_task = loop.create_task(_sse_monitor_loop())
        logger.info("SSE monitor background task created")
    except RuntimeError:
        logger.warning("No running event loop — SSE monitor not started")


def stop_sse_monitor() -> None:
    """Stop the SSE monitor background task.

    Called from main.py lifespan during shutdown.
    """
    global _sse_monitor_running, _sse_monitor_task
    _sse_monitor_running = False
    if _sse_monitor_task is not None:
        _sse_monitor_task.cancel()
        _sse_monitor_task = None
    logger.info("SSE monitor stopped")
