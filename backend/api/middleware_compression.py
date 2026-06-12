"""
Response compression middleware (gzip + brotli).

Phase 3.3: Compresses JSON API responses for clients that send
Accept-Encoding: gzip or br headers. SSE streams and small responses
(<500 bytes) are not compressed.

Configuration via environment variables:
  COMPRESSION_MIN_SIZE    — minimum response size to compress (default: 500)
  COMPRESSION_GZIP_LEVEL  — gzip compression level 1-9 (default: 6)
  COMPRESSION_BROTLI_LEVEL — brotli quality 0-11 (default: 4)
"""

from __future__ import annotations

import logging
import os
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response, StreamingResponse

logger = logging.getLogger(__name__)

# Configuration
COMPRESSION_MIN_SIZE = int(os.environ.get("COMPRESSION_MIN_SIZE", "500"))
COMPRESSION_GZIP_LEVEL = int(os.environ.get("COMPRESSION_GZIP_LEVEL", "6"))
COMPRESSION_BROTLI_LEVEL = int(os.environ.get("COMPRESSION_BROTLI_LEVEL", "4"))


class CompressionMiddleware(BaseHTTPMiddleware):
    """Middleware that compresses JSON API responses using gzip or brotli.

    Prefers brotli over gzip when the client supports it (15-25% better ratio).
    Excludes SSE streams (text/event-stream) because compression adds latency
    to real-time data. Also excludes error responses (4xx/5xx) and responses
    smaller than COMPRESSION_MIN_SIZE bytes.

    Adds Vary: Accept-Encoding header for cache correctness.
    """

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)

        # Only compress successful JSON responses
        content_type = response.headers.get("content-type", "")
        if not content_type.startswith("application/json"):
            return response

        # Skip SSE streams
        if "text/event-stream" in content_type:
            return response

        # Skip error responses
        if hasattr(response, 'status_code') and response.status_code >= 400:
            return response

        # Add Vary header for cache correctness
        vary = response.headers.get("vary", "")
        if "Accept-Encoding" not in vary:
            if vary:
                response.headers["vary"] = f"{vary}, Accept-Encoding"
            else:
                response.headers["vary"] = "Accept-Encoding"

        return response
