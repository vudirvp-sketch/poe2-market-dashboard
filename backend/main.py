"""
FastAPI application entry point for the PoE2 Flipper backend.

Start with:
    uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000

Provides:
    GET /api/phase              — current league phase
    GET /api/currencies         — currency metadata
    GET /api/prices             — all exchange rates with fee info
    GET /api/prices/heatmap     — 24h price change heatmap data
    GET /api/prices/{pair}      — price for a specific pair
    GET /api/arbitrage/flips    — scored flip opportunities
    GET /api/arbitrage/triangular — triangular arbitrage cycles
    GET /api/anomalies          — anomaly detection across currencies
    GET /api/storage-value/{currency} — projected value and hold/sell decision
    POST /api/events            — create a manual event flag
    GET /api/events             — list active events
    GET /api/health             — health check
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from concurrent.futures import ProcessPoolExecutor
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse

from backend.api.routes_prices import router as prices_router
from backend.api.routes_arbitrage import router as arbitrage_router
from backend.api.routes_events import router as events_router
from backend.config import get_settings

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Fix 8 (POE2-FIX-SPEC): Health check dependency
# ---------------------------------------------------------------------------

_provider_healthy = True
_last_health_check = 0.0
HEALTH_CHECK_INTERVAL = 60.0  # seconds

# FIX: asyncio.Lock to prevent race condition on global health state.
# Without a lock, multiple concurrent requests could simultaneously check
# _last_health_check, see it's stale, and all initiate a health check —
# resulting in multiple overlapping upstream requests and potential race
# on _provider_healthy / _last_health_check globals.
_health_check_lock = asyncio.Lock()


async def check_provider_health():
    """Periodic check if poe2scout API is reachable.

    Caches the result for HEALTH_CHECK_INTERVAL seconds to avoid
    hitting the upstream API on every incoming request.
    
    Thread-safe via asyncio.Lock — only one health check runs at a time.
    Concurrent callers wait for the in-flight check to complete and use
    its result instead of starting their own.
    
    NOTE: This function no longer raises HTTPException on failure.
    The health status is tracked via _provider_healthy and exposed
    through /api/health. Callers should check _provider_healthy
    instead of relying on exceptions.
    """
    global _provider_healthy, _last_health_check

    # Fast path: if a recent check was done, return immediately
    # (check outside lock for performance — only the assignment is racy,
    #  and reading a float is atomic in CPython)
    now = time.monotonic()
    if now - _last_health_check < HEALTH_CHECK_INTERVAL:
        return

    # Acquire lock — only one coroutine performs the health check
    async with _health_check_lock:
        # Re-check after acquiring lock (another coroutine may have
        # completed the check while we were waiting)
        now = time.monotonic()
        if now - _last_health_check < HEALTH_CHECK_INTERVAL:
            return

        _last_health_check = now
        try:
            from backend.api.shared import get_provider
            provider = get_provider()
            # Quick connectivity check — fetch exchange rates with a short timeout.
            # Reduced from 15s to 5s: this runs periodically and should not
            # block request handling. A 5s timeout is sufficient to detect
            # whether the upstream API is reachable.
            rates = await asyncio.wait_for(
                provider.get_exchange_rates(get_settings().league.league_name),
                timeout=5.0
            )
            _provider_healthy = rates is not None and len(rates) > 0
        except asyncio.TimeoutError:
            logger.warning("Health check timed out (5s) — marking provider as unreachable")
            _provider_healthy = False
        except Exception as e:
            logger.warning("Health check failed: %s — marking provider as unreachable", e)
            _provider_healthy = False


# ---------------------------------------------------------------------------
# Lifespan: startup/shutdown logic
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan: initialize resources on startup, clean up on shutdown.

    Fix 9 (POE2-FIX-SPEC): startup resilience — if HistoricalStore or
    scheduler init fails/hangs, the app still starts (degraded mode).
    """
    logger.info("PoE2 Flipper backend starting up...")
    config = get_settings()
    logger.info(
        "League: %s, Realm: %s, Base currency: %s",
        config.league.league_name,
        config.league.realm,
        config.league.base_currency,
    )

    # --- Phase 2: Initialize HistoricalStore ---
    # Fix 9: startup resilience with timeout
    historical_store = None
    try:
        from backend.data.historical import get_historical_store
        historical_store = get_historical_store(config)
        await asyncio.wait_for(historical_store.init(), timeout=10.0)
        logger.info("HistoricalStore initialized")
    except asyncio.TimeoutError:
        logger.error("HistoricalStore init timed out — continuing without history")
        historical_store = None
    except Exception as e:
        logger.error(f"HistoricalStore init failed: {e} — continuing without history")
        historical_store = None

    # --- Phase 2: Load persisted events from SQLite ---
    if historical_store:
        try:
            from backend.economy.events import get_event_manager
            from backend.economy.lifecycle import PhaseDetector
            manager = get_event_manager(config)

            # 1. Load persisted events from SQLite into EventManager
            loaded = await manager.load_from_store(historical_store)
            logger.info("Loaded %d persisted events from SQLite", loaded)

            # 2. Prune expired events from both memory and SQLite
            manager._prune_expired()
            await historical_store.prune_expired_events()

            # 3. Reset PhaseDetector if needed (same logic as before, now works after restart)
            if manager.has_major_patch_event():
                patch_ts = manager.get_latest_major_patch_timestamp()
                if patch_ts:
                    detector = PhaseDetector(config.league.league_start_datetime, config)
                    detector.reset_for_major_patch(patch_ts)
                    logger.info(
                        "PhaseDetector reset for major patch event at %s",
                        patch_ts.isoformat(),
                    )
        except Exception as e:
            logger.error(f"Event loading failed: {e} — continuing without events")

    # --- Phase 2: Start Background Scheduler (Spec Section 7) ---
    scheduler = None
    try:
        from backend.scheduler import DataScheduler
        from backend.api.shared import get_provider as _get_shared_provider
        scheduler_provider = _get_shared_provider()
        event_manager_for_scheduler = None
        try:
            from backend.economy.events import get_event_manager
            event_manager_for_scheduler = get_event_manager(config)
        except Exception:
            pass

        if historical_store and event_manager_for_scheduler:
            scheduler = DataScheduler(
                provider=scheduler_provider,
                historical_store=historical_store,
                event_manager=event_manager_for_scheduler,
                config=config,
            )
            scheduler.start()
        else:
            logger.warning("Scheduler skipped — missing HistoricalStore or EventManager")
    except Exception as e:
        logger.warning("Scheduler failed to start: %s", e)

    # P0-1: Start snapshot refresh as a background task (non-blocking)
    # The backend is ready to accept requests immediately.
    # The snapshot will be populated once the first refresh completes.
    snapshot_refresh_task = None
    try:
        from backend.api.data_snapshot import get_snapshot_manager
        snapshot_mgr = get_snapshot_manager(config)
        snapshot_refresh_task = asyncio.create_task(
            snapshot_mgr.start_periodic_refresh()
        )
        logger.info("Snapshot periodic refresh started as background task")
        # Store reference for health endpoint (avoids repeated imports)
        global _snapshot_manager_ref
        _snapshot_manager_ref = snapshot_mgr
    except Exception as e:
        logger.error("Failed to start snapshot periodic refresh: %s — continuing without", e)

    # Fix 8: initial health check — fully non-blocking (asyncio.create_task).
    # Previously awaited check_provider_health() which could block startup
    # for up to 15s if the upstream API was unreachable. Now the health
    # check runs in the background and the backend becomes ready immediately.
    # The _provider_healthy flag defaults to True, so the backend starts in
    # "optimistic" mode and updates to "unreachable" if the check fails.
    asyncio.create_task(check_provider_health())

    yield

    # --- P0-1: Shutdown background tasks ---
    # Cancel snapshot refresh task
    if snapshot_refresh_task is not None:
        try:
            snapshot_refresh_task.cancel()
            try:
                await snapshot_refresh_task
            except asyncio.CancelledError:
                pass
            logger.info("Snapshot periodic refresh task cancelled")
        except Exception as e:
            logger.warning("Snapshot refresh task cancellation error: %s", e)

    # --- Phase 2: Shutdown Scheduler ---
    if scheduler is not None:
        try:
            scheduler.shutdown(wait=False)
        except Exception as e:
            logger.warning("Scheduler shutdown error: %s", e)

    # Cleanup: close shared provider and HistoricalStore
    try:
        from backend.api.shared import close_shared
        await close_shared()
    except Exception as e:
        logger.warning("Shared cleanup error: %s", e)

    if historical_store:
        try:
            await historical_store.close()
        except Exception as e:
            logger.warning("HistoricalStore close error: %s", e)

    logger.info("PoE2 Flipper backend shut down.")


# ---------------------------------------------------------------------------
# App creation
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# ProcessPoolExecutor for CPU-bound work (GIL bypass)
# ---------------------------------------------------------------------------
# CPU-bound tasks (Bellman-Ford O(V²E), cross-rate validation O(E²),
# clustering) are offloaded to a ProcessPoolExecutor instead of the default
# ThreadPoolExecutor. This completely bypasses the Python GIL, preventing
# the event loop from being starved of CPU time during heavy computation.
#
# This fixes the cascade: heavy compute → GIL starvation → health check
# timeout → bridge kills backend → circuit breaker opens.
#
# Workers: min(4, cpu_count-1) — leave at least 1 core for the event loop.
# ---------------------------------------------------------------------------
import multiprocessing
_cpu_count = multiprocessing.cpu_count()
_process_workers = max(1, min(4, _cpu_count - 1)) if _cpu_count > 1 else 1
# Windows uses 'spawn' by default; Linux/macOS defaults to 'fork'.
# Explicitly use 'spawn' context for cross-platform consistency —
# child processes must be able to import the module without side effects
# (no re-creating ProcessPoolExecutor on import).
_mp_ctx = multiprocessing.get_context("spawn")
process_pool = ProcessPoolExecutor(max_workers=_process_workers, mp_context=_mp_ctx)
logger.info(
    "ProcessPoolExecutor initialized: %d workers (cpu_count=%d, start_method=spawn)",
    _process_workers, _cpu_count,
)


app = FastAPI(
    title="PoE2 Flipper API",
    description="Backend API for PoE2 currency analysis and arbitrage detection",
    version="0.2.0",
    lifespan=lifespan,
)

# CORS: allow Next.js frontend and local dev
# Configure via CORS_ORIGINS env var (comma-separated). Defaults to localhost:3000.
_cors_origins_str = os.environ.get(
    "CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
)
_cors_origins = [o.strip() for o in _cors_origins_str.split(",") if o.strip()]
logger.info("CORS origins: %s", _cors_origins)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(prices_router)
app.include_router(arbitrage_router)
app.include_router(events_router)

# Phase 2: Register new routers (will be created below)
try:
    from backend.api.routes_anomalies import router as anomalies_router
    app.include_router(anomalies_router)
except ImportError:
    logger.debug("Anomalies router not available yet")

try:
    from backend.api.routes_storage_value import router as storage_value_router
    app.include_router(storage_value_router)
except ImportError:
    logger.debug("Storage value router not available yet")

try:
    from backend.api.routes_optimizer import router as optimizer_router
    app.include_router(optimizer_router)
except ImportError:
    logger.debug("Optimizer router not available yet")

try:
    from backend.api.routes_scanner import router as scanner_router
    app.include_router(scanner_router)
except ImportError:
    logger.debug("Scanner router not available yet")

try:
    from backend.api.routes_analyst import router as analyst_router
    app.include_router(analyst_router)
except ImportError:
    logger.debug("Analyst router not available yet")

# P3-3: Portfolio analytics routes (correlation matrix)
try:
    from backend.api.routes_portfolio import router as portfolio_router
    app.include_router(portfolio_router)
except ImportError:
    logger.debug("Portfolio router not available yet")

# WebSocket routes for live updates
try:
    from backend.api.routes_ws import router as ws_router
    app.include_router(ws_router)
except ImportError:
    logger.debug("WebSocket router not available yet")

# Liquid Chain module — vendor reforge conversion chain analysis
try:
    from backend.api.routes_liquid_chain import router as liquid_chain_router
    app.include_router(liquid_chain_router)
except ImportError:
    logger.debug("Liquid Chain router not available yet")

# NOTE: routes_auth.py has been removed. OAuth2 authentication was a stub
# that depended on GGG_CLIENT_ID/SECRET env vars (never configured).
# If OAuth2 is needed in the future, create a new routes_auth.py and
# re-register it here.


# ---------------------------------------------------------------------------
# Pre-import modules used by health check to avoid lazy import overhead.
# These imports happen once at module load time, so the health endpoint
# can access singletons directly without repeated import statements.
# This reduces response time during GIL contention from executor threads.
# ---------------------------------------------------------------------------
from backend.economy.events import get_event_manager as _get_event_manager
from backend.data.pipeline_cache import get_pipeline_cache as _get_pipeline_cache
from backend.api.data_snapshot import get_snapshot_manager as _get_snapshot_manager
from backend.data.daily_stats_cache import get_daily_stats_cache as _get_daily_stats_cache

# Lazily-populated reference to the snapshot manager, set during lifespan.
# Avoids calling get_snapshot_manager() on every health check, which would
# trigger a module-level import if the function hasn't been called yet.
_snapshot_manager_ref = None


# ---------------------------------------------------------------------------
# Fix 8 (POE2-FIX-SPEC): Health check endpoint with provider status
# ---------------------------------------------------------------------------

@app.get("/api/health/ping")
async def health_ping():
    """Ultra-lightweight health probe — no JSON serialization, no imports.

    Returns a plain-text "ok" in under 1ms even during heavy computation.
    This endpoint is designed for circuit breaker and bridge health probes
    that only need to know "is the process alive and the event loop running?".
    It avoids all overhead: no config lookup, no dict construction, no JSON
    serialization, no dependency injection.

    Use /api/health for detailed diagnostics.
    """
    return PlainTextResponse("ok", media_type="text/plain")


@app.get("/api/health")
async def health_check():
    """Health check endpoint with provider status and cache info.

    Fix 8 (POE2-FIX-SPEC): returns provider reachability status so the
    frontend can distinguish "backend offline" from "no data".

    PERFORMANCE: Pre-imports modules at function definition time to avoid
    repeated import overhead. Uses cached snapshot_manager reference.
    The response is built from in-memory state only — no I/O or heavy
    computation. This ensures the endpoint responds within milliseconds
    even when the event loop is under GIL contention from executor threads.
    """
    config = get_settings()

    # Include event status in health check
    event_summary: dict = {}
    try:
        manager = _get_event_manager(config)
        event_summary = manager.get_active_event_summary() or {}
    except Exception:
        pass

    # Include pipeline cache stats
    cache_entries = 0
    try:
        pc = _get_pipeline_cache()
        cache_entries = len(pc._store)
    except Exception:
        pass

    # Include DataSnapshot health info (stale detection, age, etc.)
    snapshot_health: dict = {}
    try:
        mgr = _get_snapshot_manager()
        snapshot_health = mgr.health_info()
    except Exception:
        pass

    # Include DailyStatsCache stats
    daily_stats_cache_stats: dict = {}
    try:
        ds_cache = _get_daily_stats_cache()
        daily_stats_cache_stats = ds_cache.stats()
    except Exception:
        pass

    # P0-1: Determine overall status based on both provider health AND snapshot availability
    snapshot_ready = _snapshot_manager_ref is not None and _snapshot_manager_ref.last_snapshot is not None

    if _provider_healthy and snapshot_ready:
        overall_status = "ok"
    elif snapshot_ready:
        # Snapshot exists but provider may be unreachable — can serve cached data
        overall_status = "degraded"
    else:
        # No snapshot at all — truly degraded, can't serve analytics
        overall_status = "degraded"

    return {
        "status": overall_status,
        "snapshot_ready": snapshot_ready,
        "provider": "reachable" if _provider_healthy else "unreachable",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "league": config.league.league_name,
        "base_currency": config.league.base_currency,
        "active_events": event_summary.get("total_active_events", 0),
        "cache_entries": cache_entries,
        "snapshot": snapshot_health,
        "daily_stats_cache": daily_stats_cache_stats,
    }
