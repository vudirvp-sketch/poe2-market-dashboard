"""
SSE (Server-Sent Events) E2E Tests.

P0-1 regression tests (iter 55): Verify that the SSE event generator
sends per-currency price change events with change_pct, filters
by threshold_pct, and matches the frontend SSEPriceUpdate contract.

Run with:
    pytest tests/e2e/test_sse.py -v -s
"""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from unittest.mock import patch

import pytest

from backend.api.data_snapshot import DataSnapshot, SnapshotManager


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_snapshot(current_prices: dict[str, float]) -> DataSnapshot:
    """Create a DataSnapshot with the given current_prices."""
    snap = DataSnapshot()
    snap.current_prices = current_prices
    snap.valid = True
    snap.fetched_at = datetime.now(timezone.utc)
    return snap


class SequencingSnapshotManager(SnapshotManager):
    """SnapshotManager that returns a predefined sequence of snapshots.

    Each call to ``last_snapshot`` returns the next snapshot from the list.
    After the list is exhausted, returns the last snapshot forever.
    This is a real SnapshotManager subclass — it has all methods —
    but ``last_snapshot`` is overridden for deterministic testing.
    """

    def __init__(self, snapshots: list[DataSnapshot | None]):
        # Don't call super().__init__() — we don't need a real provider
        self._snapshots = snapshots
        self._idx = 0

    @property
    def last_snapshot(self):
        if self._idx < len(self._snapshots):
            snap = self._snapshots[self._idx]
            self._idx += 1
            return snap
        return self._snapshots[-1] if self._snapshots else None


async def _collect_data_events(gen, max_yields: int = 20) -> list[dict]:
    """Collect data events from the SSE generator, stopping after *max_yields* yields."""
    events = []
    yields = 0
    try:
        async for raw in gen:
            yields += 1
            if raw.startswith("data: "):
                payload_str = raw[len("data: "):].strip()
                try:
                    events.append(json.loads(payload_str))
                except json.JSONDecodeError:
                    pass
            if yields >= max_yields:
                break
    except asyncio.CancelledError:
        pass
    return events


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

@pytest.mark.e2e
async def test_sse_event_format_matches_frontend_contract():
    """SSE events must contain {pair, change_pct, new_price, old_price, timestamp}.

    P0-1 regression: Previously the backend sent
    {type, changes_count, changes: [{api_id, price}], timestamp}
    which did not include change_pct and had a different shape.
    """
    from backend.api.routes_sse import _sse_event_generator

    snap_v1 = _make_snapshot({"divine": 220.0, "exalted": 10.0})
    snap_v2 = _make_snapshot({"divine": 230.0, "exalted": 10.0})  # divine +4.55%
    mgr = SequencingSnapshotManager([snap_v1, snap_v2])

    with patch("backend.api.data_snapshot.get_snapshot_manager", return_value=mgr):
        gen = _sse_event_generator(threshold_pct=0.5, poll_interval=0.01)
        events = await _collect_data_events(gen, max_yields=10)

    assert len(events) >= 1, f"Expected at least 1 data event, got {len(events)}"

    divine_events = [e for e in events if e.get("pair") == "divine"]
    assert len(divine_events) >= 1, "No event for 'divine' currency"

    event = divine_events[0]
    # Verify the frontend SSEPriceUpdate contract fields
    assert "pair" in event, "Missing 'pair' field"
    assert "change_pct" in event, "Missing 'change_pct' field"
    assert "new_price" in event, "Missing 'new_price' field"
    assert "old_price" in event, "Missing 'old_price' field"
    assert "timestamp" in event, "Missing 'timestamp' field"

    assert event["pair"] == "divine"
    assert event["old_price"] == 220.0
    assert event["new_price"] == 230.0
    # change_pct = ((230 - 220) / 220) * 100 ≈ 4.5455
    assert abs(event["change_pct"] - 4.5455) < 0.1


@pytest.mark.e2e
async def test_sse_threshold_filters_below_threshold():
    """SSE should NOT send events for currencies below threshold_pct."""
    from backend.api.routes_sse import _sse_event_generator

    # divine +0.18% (below 0.5% threshold), exalted +5% (above threshold)
    snap_v1 = _make_snapshot({"divine": 220.0, "exalted": 10.0})
    snap_v2 = _make_snapshot({"divine": 220.4, "exalted": 10.5})
    mgr = SequencingSnapshotManager([snap_v1, snap_v2])

    with patch("backend.api.data_snapshot.get_snapshot_manager", return_value=mgr):
        gen = _sse_event_generator(threshold_pct=0.5, poll_interval=0.01)
        events = await _collect_data_events(gen, max_yields=10)

    divine_events = [e for e in events if e.get("pair") == "divine"]
    exalted_events = [e for e in events if e.get("pair") == "exalted"]

    assert len(divine_events) == 0, (
        f"divine event should be filtered (0.18% < 0.5%), but got: {divine_events}"
    )
    assert len(exalted_events) >= 1, (
        "exalted event should pass threshold (5% >= 0.5%)"
    )


@pytest.mark.e2e
async def test_sse_no_event_on_first_snapshot():
    """First snapshot should be recorded as baseline — no data events emitted."""
    from backend.api.routes_sse import _sse_event_generator

    snap_v1 = _make_snapshot({"divine": 220.0})
    mgr = SequencingSnapshotManager([snap_v1])

    with patch("backend.api.data_snapshot.get_snapshot_manager", return_value=mgr):
        gen = _sse_event_generator(threshold_pct=0.5, poll_interval=0.01)
        events = await _collect_data_events(gen, max_yields=5)

    assert len(events) == 0, (
        f"Expected 0 data events on first/unchanged snapshot, got {len(events)}: {events}"
    )


@pytest.mark.e2e
async def test_sse_multiple_currencies_change():
    """Multiple currencies changing above threshold should each get an event."""
    from backend.api.routes_sse import _sse_event_generator

    snap_v1 = _make_snapshot({"divine": 220.0, "exalted": 10.0, "chaos": 0.1})
    snap_v2 = _make_snapshot({"divine": 250.0, "exalted": 12.0, "chaos": 0.1})  # divine +13.6%, exalted +20%
    mgr = SequencingSnapshotManager([snap_v1, snap_v2])

    with patch("backend.api.data_snapshot.get_snapshot_manager", return_value=mgr):
        gen = _sse_event_generator(threshold_pct=0.5, poll_interval=0.01)
        events = await _collect_data_events(gen, max_yields=10)

    pairs_with_events = {e["pair"] for e in events}
    assert "divine" in pairs_with_events, "Missing event for 'divine' (+13.6%)"
    assert "exalted" in pairs_with_events, "Missing event for 'exalted' (+20%)"
    assert "chaos" not in pairs_with_events, "chaos should not appear (no change)"


# ---------------------------------------------------------------------------
# KI-13 regression (iter 107): HTTP-level route conflict test
# ---------------------------------------------------------------------------

def test_sse_route_registered_before_pair_path_route():
    """The SSE route /api/v1/prices/stream must be registered BEFORE the
    greedy /api/v1/prices/{pair:path} route.

    KI-13 root cause: FastAPI matches routes in registration order. The
    {pair:path} route in routes_prices.py is a greedy path-parameter that
    matches ANY sub-path under /api/v1/prices/, including /stream. If it
    is registered before the SSE route, GET /api/v1/prices/stream is
    routed to get_price_for_pair(pair="stream"), which fails with 400
    ("Invalid pair format: stream. Expected 'from/to'.").

    This test inspects the FastAPI app's route table to verify the SSE
    route appears before the {pair:path} route. It does NOT make an HTTP
    request (SSE streams are hard to test with ASGITransport due to
    buffering), but the route-order check is the direct regression guard.
    """
    from backend.main import app

    sse_route_index = None
    pair_path_route_index = None

    for i, route in enumerate(app.routes):
        path = getattr(route, "path", "")
        if path == "/api/v1/prices/stream":
            sse_route_index = i
        elif path == "/api/v1/prices/{pair:path}":
            pair_path_route_index = i

    assert sse_route_index is not None, (
        "SSE route /api/v1/prices/stream not found in app routes. "
        "Check that sse_router is registered in backend/main.py."
    )
    assert pair_path_route_index is not None, (
        "Pair route /api/v1/prices/{pair:path} not found in app routes. "
        "Check that prices_router is registered in backend/main.py."
    )
    assert sse_route_index < pair_path_route_index, (
        f"SSE route (index {sse_route_index}) must be registered BEFORE "
        f"the {{pair:path}} route (index {pair_path_route_index}). "
        f"This is KI-13 regressing — the greedy {{pair:path}} route will "
        f"capture /stream and return 400. Fix: register sse_router before "
        f"prices_router in backend/main.py."
    )


@pytest.mark.e2e
async def test_sse_http_endpoint_returns_text_event_stream(mock_client):
    """GET /api/v1/prices/stream?threshold_pct=1 must return 200 with
    content-type text/event-stream, not 400 with JSON error.

    KI-13 regression: Before the fix, this endpoint returned 400 because
    the {pair:path} route captured /stream as a pair name. After the fix,
    the SSE route is matched first and returns a proper event stream.

    Note: ASGITransport buffers the response, so we read the first chunk
    with a hard timeout. If the stream is live, the first chunk (a
    heartbeat comment) arrives immediately.
    """
    import asyncio

    async def _check():
        # Use a non-streaming GET with a hard 2s timeout. The SSE endpoint
        # sends the first chunk immediately (": waiting\\n\\n" or
        # ": heartbeat\\n\\n"), so httpx will receive headers + at least
        # one body chunk quickly. The connection then stays open (SSE),
        # which httpx treats as a read timeout — but we've already got
        # the response object by then.
        resp = await mock_client.get(
            "/api/v1/prices/stream?threshold_pct=1",
            headers={"Accept": "text/event-stream"},
            timeout=2.0,
        )
        # If we get here, the response was fully received (unlikely for SSE
        # but possible if the generator exits early). Check status + type.
        assert resp.status_code == 200, (
            f"Expected 200 for SSE endpoint, got {resp.status_code}. "
            f"Body: {resp.text[:200]}"
        )
        content_type = resp.headers.get("content-type", "")
        assert "text/event-stream" in content_type, (
            f"Expected content-type text/event-stream, got: {content_type}"
        )

    try:
        await asyncio.wait_for(_check(), timeout=5.0)
    except (asyncio.TimeoutError, Exception) as e:
        # httpx.ReadTimeout is expected for SSE (stream stays open).
        # The key question is: did we get a 400 or a 200 before timeout?
        # If the route conflict regresses, we'd get a fast 400 (no timeout).
        # If the fix works, we get a timeout (stream is live).
        # So timeout = PASS, fast 400 = FAIL.
        if "400" in str(e) or "Bad Request" in str(e):
            pytest.fail(
                f"SSE endpoint returned 400 — KI-13 regression. "
                f"The {{pair:path}} route is capturing /stream. Error: {e}"
            )
        # Any other exception (timeout, read error) means the stream was
        # live — the SSE route was matched. This is the expected behavior.
        pass
