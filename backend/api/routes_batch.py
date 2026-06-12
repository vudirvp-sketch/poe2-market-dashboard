"""
Batch API endpoint — combine multiple API calls into a single HTTP request.

POST /api/batch

Accepts a JSON body with a list of request descriptors. Each descriptor
specifies a backend API path and optional query parameters. The server
executes all requests internally (in-process HTTP via httpx) and
returns a single response with results keyed by request ID.

This reduces network overhead on initial page load:
  Before: 5-6 separate HTTP requests, each with proxy overhead +
          circuit-breaker checks + JSON parse overhead.
  After:  1 HTTP request with all results bundled together.

Request format:
    POST /api/batch
    Content-Type: application/json
    {
      "requests": [
        { "id": "health", "path": "/api/health" },
        { "id": "phase", "path": "/api/phase" },
        { "id": "events", "path": "/api/events", "params": {"active_only": "true"} },
        { "id": "currencies", "path": "/api/currencies" }
      ]
    }

Response format:
    {
      "results": {
        "health": { "status": "ok", ... },
        "phase": { "phase": "MID", ... },
        "events": { "total": 2, ... },
        "currencies": { "currencies": [...] }
      },
      "errors": {
        // only failed requests appear here
      },
      "timing_ms": 42.5
    }

Safety:
  - Maximum 10 requests per batch (prevents abuse)
  - Only GET-style endpoints are allowed (no mutations via POST/PUT/DELETE)
  - Each sub-request has a 15s timeout
  - Results are fetched concurrently via asyncio.gather
  - Internal HTTP calls go to localhost only (no external network)
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Optional

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.config import get_settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["batch"])

# Maximum number of sub-requests in a single batch call
MAX_BATCH_SIZE = 10

# Timeout per sub-request (seconds)
SUB_REQUEST_TIMEOUT = 15.0

# Allowed path prefixes for batch requests (safety: only GET endpoints)
ALLOWED_PREFIXES = (
    "/api/health",
    "/api/phase",
    "/api/currencies",
    "/api/prices",
    "/api/arbitrage",
    "/api/events",
    "/api/anomalies",
    "/api/storage-value",
    "/api/optimizer",
    "/api/analyst",
    "/api/portfolio",
    "/api/scanner",
    "/api/liquid-chain",
)

# Denied paths — mutations or dangerous endpoints
DENIED_PATHS = (
    "/api/events/",       # POST/DELETE mutations — not safe for batch
)

# Shared httpx client for internal requests (reused across batch calls)
_internal_client: httpx.AsyncClient | None = None


async def _get_internal_client() -> httpx.AsyncClient:
    """Get or create the shared httpx client for internal batch requests.

    Sends Accept-Encoding: identity to skip compression on internal
    localhost requests — compression adds CPU overhead with no network
    benefit for in-process communication.
    """
    global _internal_client
    if _internal_client is None or _internal_client.is_closed:
        _internal_client = httpx.AsyncClient(
            base_url="http://localhost:8000",
            timeout=httpx.Timeout(SUB_REQUEST_TIMEOUT),
            headers={
                "Accept": "application/json",
                "Accept-Encoding": "identity",  # skip compression for internal requests
            },
        )
    return _internal_client


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class BatchSubRequest(BaseModel):
    """A single sub-request within a batch."""
    id: str = Field(
        ...,
        description="Client-defined identifier for this sub-request result lookup",
        max_length=64,
    )
    path: str = Field(
        ...,
        description="API path, e.g. /api/phase",
    )
    params: Optional[dict[str, str]] = Field(
        default=None,
        description="Optional query parameters for the sub-request",
    )


class BatchRequest(BaseModel):
    """Top-level batch request body."""
    requests: list[BatchSubRequest] = Field(
        ...,
        description="List of sub-requests to execute",
        max_length=MAX_BATCH_SIZE,
    )


class BatchResponse(BaseModel):
    """Batch response containing results and errors."""
    results: dict[str, Any] = Field(default_factory=dict)
    errors: dict[str, Any] = Field(default_factory=dict)
    timing_ms: float = Field(default=0.0, description="Total batch execution time in ms")


# ---------------------------------------------------------------------------
# Internal request execution
# ---------------------------------------------------------------------------

async def _execute_sub_request(
    client: httpx.AsyncClient,
    sub: BatchSubRequest,
) -> tuple[str, Any, Any | None]:
    """Execute a single sub-request via internal HTTP.

    Returns (id, result_or_none, error_or_none).
    """
    try:
        params = sub.params or {}
        response = await client.get(sub.path, params=params)

        if response.status_code >= 400:
            # Sub-request returned an error — include it in errors
            try:
                error_data = response.json()
            except Exception:
                error_data = {"detail": response.text}
            return (sub.id, None, {
                "status": response.status_code,
                "error": error_data,
            })

        result = response.json()
        return (sub.id, result, None)

    except httpx.TimeoutException:
        logger.warning("Batch sub-request %s timed out: %s", sub.id, sub.path)
        return (sub.id, None, {"error": "timeout", "detail": f"Sub-request {sub.id} timed out"})
    except httpx.ConnectError:
        logger.warning("Batch sub-request %s connection error: %s", sub.id, sub.path)
        return (sub.id, None, {"error": "connection_error", "detail": f"Sub-request {sub.id} failed to connect"})
    except Exception as e:
        logger.warning("Batch sub-request %s failed: %s — %s", sub.id, sub.path, e)
        return (sub.id, None, {"error": "internal_error", "detail": str(e)})


# ---------------------------------------------------------------------------
# Batch endpoint
# ---------------------------------------------------------------------------

@router.post("/batch")
async def batch_endpoint(batch: BatchRequest) -> BatchResponse:
    """Execute multiple API requests in a single HTTP call.

    This endpoint is designed for initial page load optimization.
    Instead of making 5-6 separate HTTP requests to fetch health,
    phase, events, currencies, and optimal-currency data, the
    frontend sends a single POST /api/batch request.

    All sub-requests are executed concurrently via asyncio.gather.
    Failed sub-requests are reported in the 'errors' dict without
    affecting successful ones.

    The sub-requests are dispatched as internal HTTP calls to
    localhost:8000 (the same FastAPI app). This approach:
    - Reuses all existing route logic without code duplication
    - Respects all existing middleware, error handling, and caching
    - Is safe because it's internal-only (no external network access)
    """
    start = time.monotonic()

    # Validate paths — only allow safe GET endpoints
    for sub in batch.requests:
        # Check denied paths (mutations)
        for denied in DENIED_PATHS:
            if sub.path.startswith(denied):
                raise HTTPException(
                    status_code=400,
                    detail=f"Path not allowed in batch (mutation): {sub.path}",
                )
        # Check allowed prefixes
        allowed = any(sub.path.startswith(prefix) or sub.path == prefix for prefix in ALLOWED_PREFIXES)
        if not allowed:
            raise HTTPException(
                status_code=400,
                detail=f"Path not allowed in batch: {sub.path}",
            )

    # Get shared HTTP client
    client = await _get_internal_client()

    # Execute all sub-requests concurrently
    tasks = [_execute_sub_request(client, sub) for sub in batch.requests]
    outcomes = await asyncio.gather(*tasks, return_exceptions=True)

    results: dict[str, Any] = {}
    errors: dict[str, Any] = {}

    for outcome in outcomes:
        if isinstance(outcome, Exception):
            logger.error("Batch sub-request failed with exception: %s", outcome)
            errors["_unknown"] = {"error": "exception", "detail": str(outcome)}
            continue
        sub_id, result, error = outcome  # type: ignore[misc]
        if error is not None:
            errors[sub_id] = error
        elif result is not None:
            results[sub_id] = result

    elapsed_ms = (time.monotonic() - start) * 1000

    return BatchResponse(
        results=results,
        errors=errors,
        timing_ms=round(elapsed_ms, 1),
    )
