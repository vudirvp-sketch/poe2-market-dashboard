"""
SSE (Server-Sent Events) endpoint for live price updates.

Provides:
    GET /api/v1/prices/stream — real-time price change notifications

This module broadcasts price_update events to connected SSE clients
by watching the DataSnapshot for changes. When a snapshot changes,
the generator computes per-currency change_pct, filters by threshold,
and sends individual events in the format expected by the frontend:

    {pair, change_pct, new_price, old_price, timestamp}

P0-1 fix (iter 55):
  - Removed dead _sse_monitor_loop / start_sse_monitor / stop_sse_monitor
    (was an empty asyncio.sleep(60) loop wasting a task slot).
  - _sse_event_generator now stores a previous snapshot, computes change_pct
    per currency, filters by threshold_pct, and emits one SSE message per
    changed currency matching the frontend SSEPriceUpdate contract.
  - Frontend no longer needs to parse a bulk {changes: [...]} payload.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import AsyncGenerator

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/prices", tags=["sse"])


async def _sse_event_generator(
    threshold_pct: float = 0.5,
    poll_interval: float = 5.0,
) -> AsyncGenerator[str, None]:
    """Generate SSE events when prices change beyond threshold.

    Polls the DataSnapshot every *poll_interval* seconds.  On the first
    cycle with a valid snapshot, records it as the baseline (no events
    emitted).  On subsequent cycles, computes ``change_pct`` for every
    currency whose price changed, filters by *threshold_pct*, and emits
    one SSE ``data`` message per qualifying currency in the format::

        {pair, change_pct, new_price, old_price, timestamp}

    This matches the ``SSEPriceUpdate`` interface expected by the
    frontend hook ``use-price-stream.ts``.
    """
    from backend.api.data_snapshot import get_snapshot_manager

    previous_prices: dict[str, float] | None = None

    try:
        while True:
            snapshot_mgr = get_snapshot_manager()
            snapshot = snapshot_mgr.last_snapshot if snapshot_mgr else None

            if snapshot is not None:
                current_prices: dict[str, float] = dict(snapshot.current_prices)

                if previous_prices is not None:
                    # Compute per-currency changes and emit events
                    for api_id, new_price in current_prices.items():
                        old_price = previous_prices.get(api_id)
                        if old_price is None or old_price == 0:
                            continue  # new currency or zero old price — skip
                        change_pct = ((new_price - old_price) / old_price) * 100.0
                        if abs(change_pct) < threshold_pct:
                            continue  # below threshold — skip

                        event_data = {
                            "pair": api_id,
                            "change_pct": round(change_pct, 4),
                            "new_price": new_price,
                            "old_price": old_price,
                            "timestamp": time.time(),
                        }
                        yield f"data: {json.dumps(event_data)}\n\n"

                # Record current snapshot for next cycle
                previous_prices = current_prices

                if previous_prices is not None and len(current_prices) == 0:
                    # No prices yet — send heartbeat
                    yield ": waiting\n\n"
                else:
                    # After processing, send heartbeat to keep connection alive
                    yield ": heartbeat\n\n"
            else:
                # No snapshot available yet
                yield ": waiting\n\n"

            await asyncio.sleep(poll_interval)
    except asyncio.CancelledError:
        logger.info("SSE event generator cancelled")
    except Exception as e:
        logger.error("SSE event generator error: %s", e)
        yield f"event: error\ndata: {json.dumps({'message': str(e)})}\n\n"


@router.get("/stream")
async def sse_price_stream(
    threshold_pct: float = Query(0.5, ge=0.0, le=50.0, description="Threshold % for change notifications"),
):
    """SSE endpoint for live price updates.

    Returns a text/event-stream that sends price_update events when
    the DataSnapshot changes.  Each event is a single currency change
    in the format ``{pair, change_pct, new_price, old_price, timestamp}``.

    Clients should reconnect on disconnect.
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
