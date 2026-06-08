"""
DEPRECATED: This file is a duplicate of backend/main.py.

The canonical entry point is backend.main:app (started via uvicorn).
This file exists only for backward compatibility and re-exports the app.

Start with:
    uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000

NOTE: The old main.py had a blocking health check (await check_provider_health()
in lifespan) which caused the backend to hang on startup when poe2scout.com was
unreachable. The canonical backend/main.py uses asyncio.create_task() instead.
"""

from backend.main import app  # noqa: F401
