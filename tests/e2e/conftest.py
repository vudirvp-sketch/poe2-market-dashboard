"""
End-to-End Test Configuration.

Phase 2 (Spec Section 12): Provides fixtures for testing the full
FastAPI pipeline with a mock POE2Scout provider, avoiding live API calls.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient, ASGITransport


@pytest.fixture
async def client():
    """Async HTTP client for E2E testing against the FastAPI app.

    Uses httpx's ASGITransport to call the app directly without
    starting a real HTTP server. This is fast and deterministic.
    """
    from backend.main import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
