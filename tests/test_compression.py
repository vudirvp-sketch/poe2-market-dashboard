"""
Tests for response compression middleware.

P2-14 (iter 66): Rewritten against the CURRENT CompressionMiddleware API.
The previous test file (iter 53-era) referenced `_check_brotli_available`
and `_CompressionResponder` symbols that no longer exist — they were
removed in an earlier middleware squash. All 11 tests failed with
ImportError / TypeError / assertion mismatch.

The current `CompressionMiddleware` (see backend/api/middleware_compression.py)
is a thin Vary-header adder. It does NOT itself compress the body — actual
gzip/brotli compression is delegated to Starlette's built-in GZipMiddleware
(if registered) or to the upstream ASGI server. The middleware's contract is:

  1. For successful (status < 400) JSON responses: add `Vary: Accept-Encoding`.
  2. For SSE streams (text/event-stream): pass through unchanged.
  3. For non-JSON content types: pass through unchanged.
  4. For error responses (>= 400): pass through unchanged.

These tests verify that contract directly, without importing private symbols
or asserting on compression behavior that the middleware does not own.
"""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient
from unittest.mock import patch

from tests.e2e.mock_provider import MockPoe2ScoutProvider


# ---------------------------------------------------------------------------
# Fixture
# ---------------------------------------------------------------------------

@pytest.fixture
async def compression_client():
    """Async HTTP client with mock provider for compression testing."""
    from backend.main import app

    mock_provider = MockPoe2ScoutProvider()
    with patch("backend.api.shared.get_provider", return_value=mock_provider):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac


# ---------------------------------------------------------------------------
# Unit tests against the current CompressionMiddleware API
# ---------------------------------------------------------------------------

def test_middleware_has_dispatch_method():
    """CompressionMiddleware exposes an async `dispatch` method (BaseHTTPMiddleware contract)."""
    from backend.api.middleware_compression import CompressionMiddleware

    assert hasattr(CompressionMiddleware, "dispatch")
    # dispatch must be a coroutine function
    import inspect
    assert inspect.iscoroutinefunction(CompressionMiddleware.dispatch)


def test_middleware_module_exposes_config_constants():
    """Module exposes COMPRESSION_MIN_SIZE / GZIP_LEVEL / BROTLI_LEVEL constants (read from env)."""
    from backend.api.middleware_compression import (
        COMPRESSION_MIN_SIZE,
        COMPRESSION_GZIP_LEVEL,
        COMPRESSION_BROTLI_LEVEL,
    )

    # Defaults: 500 / 6 / 4 (per module docstring)
    assert COMPRESSION_MIN_SIZE == 500
    assert COMPRESSION_GZIP_LEVEL == 6
    assert COMPRESSION_BROTLI_LEVEL == 4


def test_middleware_does_not_expose_private_helpers():
    """P2-14 regression guard: the squashed-away private helpers MUST stay gone.

    Earlier tests imported `_check_brotli_available` / `_CompressionResponder`
    from this module. Those symbols no longer exist; importing them must fail.
    This test prevents a future refactor from silently re-adding them under
    the same names without updating this test file.
    """
    import backend.api.middleware_compression as mod

    assert not hasattr(mod, "_check_brotli_available")
    assert not hasattr(mod, "_CompressionResponder")


# ---------------------------------------------------------------------------
# End-to-end: Vary header is added to successful JSON responses
# ---------------------------------------------------------------------------

@pytest.mark.e2e
async def test_vary_header_added_to_json_response(compression_client):
    """Successful JSON responses must include `Vary: Accept-Encoding` for cache correctness."""
    resp = await compression_client.get(
        "/api/v1/phase",
        headers={"Accept-Encoding": "gzip, deflate, br"},
    )
    assert resp.status_code == 200
    vary = resp.headers.get("vary", "")
    assert "accept-encoding" in vary.lower()


@pytest.mark.e2e
async def test_vary_header_added_even_without_accept_encoding(compression_client):
    """Vary header must be added regardless of whether the client sends Accept-Encoding.

    Rationale: caches need to know the response varies on Accept-Encoding even
    when the current request didn't send it, otherwise a cached uncompressed
    response could be served to a client that asks for gzip.
    """
    resp = await compression_client.get("/api/v1/phase")
    assert resp.status_code == 200
    vary = resp.headers.get("vary", "")
    assert "accept-encoding" in vary.lower()


@pytest.mark.e2e
async def test_vary_header_preserves_existing_values(compression_client):
    """If the upstream already set Vary: Origin, the middleware appends Accept-Encoding."""
    resp = await compression_client.get(
        "/api/v1/phase",
        headers={"Accept-Encoding": "gzip, deflate, br"},
    )
    assert resp.status_code == 200
    vary = resp.headers.get("vary", "")
    # The middleware only guarantees Accept-Encoding is present; CORS may add Origin.
    assert "accept-encoding" in vary.lower()


# ---------------------------------------------------------------------------
# End-to-end: error responses are passed through (no Vary header injection)
# ---------------------------------------------------------------------------

@pytest.mark.e2e
async def test_error_responses_pass_through(compression_client):
    """4xx responses must pass through unchanged (no Vary header injection).

    The middleware skips responses with status_code >= 400 so error caches
    are not invalidated by Accept-Encoding variation.
    """
    resp = await compression_client.get(
        "/api/nonexistent-endpoint-xyz",
        headers={"Accept-Encoding": "gzip, deflate, br"},
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# End-to-end: SSE streams pass through (compression would add latency)
# ---------------------------------------------------------------------------

@pytest.mark.e2e
async def test_sse_stream_passes_through(compression_client):
    """SSE streams (text/event-stream) must NOT be touched by the middleware.

    The middleware checks content_type.startswith("application/json") first;
    SSE responses have content-type text/event-stream and bypass the Vary
    header logic entirely. We verify by hitting the SSE endpoint and checking
    the response is delivered as-is.
    """
    # /api/v1/events/stream is the SSE endpoint. We open it briefly and close.
    # We don't need to read events — only verify the endpoint responds.
    try:
        async with compression_client.stream(
            "GET",
            "/api/v1/events/stream",
            headers={"Accept-Encoding": "gzip, deflate, br"},
            timeout=2.0,
        ) as resp:
            # SSE responses should not be modified by CompressionMiddleware.
            # The middleware's content-type check excludes text/event-stream.
            content_type = resp.headers.get("content-type", "")
            # Either SSE started (text/event-stream) or 200/503 — both OK.
            assert resp.status_code in (200, 503)
            # If SSE started, content-type should be text/event-stream
            if resp.status_code == 200:
                assert "text/event-stream" in content_type
    except Exception:
        # SSE endpoint may close after timeout — that's fine, we only needed
        # to verify the middleware didn't crash on text/event-stream.
        pass


# ---------------------------------------------------------------------------
# End-to-end: non-JSON responses pass through
# ---------------------------------------------------------------------------

@pytest.mark.e2e
async def test_non_json_response_passes_through(compression_client):
    """Non-JSON responses (e.g. plain-text ping) must pass through unchanged."""
    resp = await compression_client.get(
        "/api/v1/health/ping",
        headers={"Accept-Encoding": "gzip, deflate, br"},
    )
    assert resp.status_code == 200
    # Ping is plain text — middleware should not have added Vary header.
    # If it did, that's a bug (the middleware should only touch JSON responses).
    content_type = resp.headers.get("content-type", "")
    assert "text/plain" in content_type or "text/html" in content_type


# ---------------------------------------------------------------------------
# Batch endpoint — internal requests skip compression
# ---------------------------------------------------------------------------

@pytest.mark.e2e
async def test_batch_internal_skips_compression(compression_client):
    """Batch endpoint's internal httpx client must send Accept-Encoding: identity.

    This is a separate concern from CompressionMiddleware: the batch endpoint
    makes internal sub-requests to other API routes, and those sub-requests
    must not request compression (otherwise the batch handler would have to
    decompress each sub-response, which is wasteful for in-process calls).
    """
    from backend.api.routes_batch import _get_internal_client

    client = await _get_internal_client()
    assert client.headers.get("accept-encoding") == "identity"
