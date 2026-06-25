"""
FastAPI application entry point for the PoE2 Flipper backend.

Start with:
    uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000

All endpoints are versioned under /api/v1/ (Phase 4.2).
Responses include X-API-Version header.

Provides:
    GET /api/v1/phase              — current league phase
    GET /api/v1/currencies         — currency metadata
    GET /api/v1/prices             — all exchange rates with fee info
    GET /api/v1/prices/heatmap     — 24h price change heatmap data
    GET /api/v1/prices/{pair}      — price for a specific pair
    GET /api/v1/arbitrage/flips    — scored flip opportunities
    GET /api/v1/arbitrage/triangular — triangular arbitrage cycles
    GET /api/v1/anomalies          — anomaly detection across currencies
    GET /api/v1/storage-value/{currency} — projected value and hold/sell decision
    POST /api/v1/events            — create a manual event flag
    GET /api/v1/events             — list active events
    GET /api/v1/health             — health check
    POST /api/v1/batch             — batch multiple GET requests into one call
"""

from __future__ import annotations

import asyncio
import logging
import os
import threading
import time
import warnings
from concurrent.futures import ProcessPoolExecutor
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, Depends, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from starlette.middleware.base import BaseHTTPMiddleware

from backend.api.middleware_compression import CompressionMiddleware
from backend.api.response_models import HealthResponse

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

    # P0-1 fix (iter 55): Removed dead SSE monitor (start_sse_monitor / _sse_monitor_loop).
    # The SSE endpoint now works per-connection: each client's _sse_event_generator
    # polls the snapshot independently and emits change_pct-filtered events.
    # No background monitor task is needed.

    # ProcessPoolExecutor warm-up: submit trivial tasks to all workers
    # so the first real request doesn't suffer from ~5s cold-start latency
    # (sklearn/numpy/scipy import time in each spawn process).
    try:
        loop = asyncio.get_running_loop()
        pool = get_process_pool()
        if pool is None:
            logger.warning(
                "ProcessPoolExecutor unavailable — warm-up skipped, "
                "CPU-bound work will use the default ThreadPoolExecutor"
            )
        else:
            warmup_futures = [
                loop.run_in_executor(pool, _executor_warmup_task)
                for _ in range(_process_workers)
            ]
            # Don't block startup — just fire and forget, but log when done
            async def _log_warmup():
                try:
                    results = await asyncio.wait_for(
                        asyncio.gather(*warmup_futures, return_exceptions=True),
                        timeout=30.0,
                    )
                    ok = sum(1 for r in results if r is True)
                    logger.info(
                        "ProcessPoolExecutor warm-up complete: %d/%d workers ready",
                        ok, _process_workers,
                    )
                except asyncio.TimeoutError:
                    logger.warning("ProcessPoolExecutor warm-up timed out (30s)")
                except Exception as e:
                    logger.warning("ProcessPoolExecutor warm-up error: %s", e)
            asyncio.create_task(_log_warmup())
    except Exception as e:
        logger.warning("ProcessPoolExecutor warm-up failed: %s", e)

    yield

    # --- Shutdown ProcessPoolExecutor ---
    # P2-13: delegate to `_shutdown_process_pool()` which also clears the
    # cached reference, so any subsequent `get_process_pool()` call (e.g.
    # from a later test in the same pytest session) creates a fresh pool.
    _shutdown_process_pool()

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

    # P0-1 fix (iter 55): No SSE monitor to stop — removed dead _sse_monitor_loop.
    # Active SSE connections are cancelled by StreamingResponse cleanup.

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
# Workers: controlled by FLIPPER_WORKERS env var (default: 1).
# Each worker process loads sklearn/numpy/scipy (~300-500 MB), so
# multiple workers can cause OOM. Set FLIPPER_WORKERS=0 to auto-detect
# (min(4, cpu_count-1)), or set to a specific number for more parallelism.
# ---------------------------------------------------------------------------
import multiprocessing
_cpu_count = multiprocessing.cpu_count()

# FLIPPER_WORKERS env var: override the number of ProcessPoolExecutor workers.
# Default: 1 worker (safe for low-memory environments; sklearn/numpy/scipy
# each worker imports ~300-500 MB). With 600+ currencies, multiple workers
# can cause OOM on systems with <16 GB RAM. Set FLIPPER_WORKERS=0 to use
# the automatic formula: min(4, cpu_count-1).
_env_workers = os.environ.get("FLIPPER_WORKERS", "1")
if _env_workers.strip() == "0":
    _process_workers = max(1, min(4, _cpu_count - 1)) if _cpu_count > 1 else 1
else:
    try:
        _process_workers = max(1, int(_env_workers))
    except ValueError:
        _process_workers = 1

# Windows uses 'spawn' by default; Linux/macOS defaults to 'fork'.
# Explicitly use 'spawn' context for cross-platform consistency —
# child processes must be able to import the module without side effects
# (no re-creating ProcessPoolExecutor on import).
_mp_ctx = multiprocessing.get_context("spawn")

# P2-13 (iter 65): ProcessPoolExecutor is now lazy / re-creatable.
# Previously it was a module-level singleton created at import time and
# shut down inside `lifespan` teardown. In the test suite, every
# `with TestClient(app)` or `AsyncClient(ASGITransport(app))` context
# triggers lifespan shutdown → `process_pool.shutdown(...)` → the global
# pool becomes permanently broken. Any later test that calls
# `loop.run_in_executor(process_pool, ...)` then raises
# `RuntimeError: cannot schedule new futures after shutdown`.
# This polluted `test_triangular.py` and any other test that ran after a
# TestClient-based test in the same pytest session.
#
# Fix: pool is stored in `_process_pool` and accessed only through
# `get_process_pool()`, which lazily creates a fresh pool if the cached
# one is None or has been shut down. `lifespan` shutdown calls
# `_shutdown_process_pool()` which closes the pool AND clears the cached
# reference, so the next caller gets a brand-new pool.

_process_pool: ProcessPoolExecutor | None = None
_process_pool_lock = threading.Lock()


def _is_pool_broken(pool: ProcessPoolExecutor | None) -> bool:
    """Return True if `pool` is None or has been shut down.

    `ProcessPoolExecutor._shutdown` is a stable boolean flag set by
    `.shutdown()`; we read it to detect pools that cannot accept new
    futures. This is the same flag CPython's `submit()` checks.
    """
    if pool is None:
        return True
    return bool(getattr(pool, "_shutdown", False))


def get_process_pool() -> ProcessPoolExecutor | None:
    """Return a live ProcessPoolExecutor, creating one if necessary.

    P2-13: Thread-safe lazy initializer. If the cached pool has been
    shut down (e.g. by a previous `lifespan` teardown in a test), a
    fresh pool is created transparently. Returns None only if pool
    construction fails — callers must fall back to the default
    ThreadPoolExecutor in that case.

    Callers should NOT cache the returned reference for long: always
    call this function at the call site, so re-creation works.
    """
    global _process_pool
    # Fast path: cached and alive (no lock).
    pool = _process_pool
    if not _is_pool_broken(pool):
        return pool

    # Slow path: create under the lock so we never spawn two pools.
    with _process_pool_lock:
        pool = _process_pool
        if not _is_pool_broken(pool):
            return pool
        try:
            pool = ProcessPoolExecutor(
                max_workers=_process_workers, mp_context=_mp_ctx
            )
            _process_pool = pool
            logger.info(
                "ProcessPoolExecutor (re)created: %d workers "
                "(cpu_count=%d, FLIPPER_WORKERS=%s, start_method=spawn)",
                _process_workers, _cpu_count, _env_workers,
            )
            return pool
        except Exception as e:
            logger.warning("ProcessPoolExecutor creation failed: %s", e)
            return None


def _shutdown_process_pool() -> None:
    """Shut down the cached ProcessPoolExecutor and clear the reference.

    P2-13: Called from `lifespan` teardown. Clearing `_process_pool` to
    None ensures the next `get_process_pool()` call (e.g. from a later
    test) creates a fresh pool instead of reusing the broken one.
    """
    global _process_pool
    pool = _process_pool
    if pool is None:
        return
    try:
        logger.info("Shutting down ProcessPoolExecutor...")
        pool.shutdown(wait=False, cancel_futures=True)
        logger.info("ProcessPoolExecutor shut down")
    except Exception as e:
        logger.warning("ProcessPoolExecutor shutdown error: %s", e)
    finally:
        _process_pool = None


def _executor_warmup_task() -> bool:
    """Trivial task submitted to ProcessPoolExecutor at startup.

    Forces spawn of all worker processes so the first real request doesn't
    suffer from cold-start latency (~5s for sklearn import in each worker).
    Returns True on success.
    """
    return True


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

# Phase 3.3: Response compression (gzip + brotli)
# Registered AFTER CORS so that CORS headers are set on the original
# response before compression middleware processes it.
# Configurable via env vars: COMPRESSION_MIN_SIZE, COMPRESSION_GZIP_LEVEL,
# COMPRESSION_BROTLI_LEVEL. Brotli is preferred over gzip (15-25% better
# ratio) when the client accepts it. SSE streams (text/event-stream) are
# excluded because compression adds latency to real-time data.
app.add_middleware(CompressionMiddleware)

# Phase 4.2: API versioning — add X-API-Version header to all responses
API_VERSION = "1"


class APIVersionMiddleware(BaseHTTPMiddleware):
    """Add X-API-Version header to all responses.

    This middleware adds a `X-API-Version: 1` header to every response,
    allowing clients to detect which API version they are consuming.
    The header is added after all other middleware has processed the request
    so it appears on every response (including error responses).
    """

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-API-Version"] = API_VERSION
        return response


app.add_middleware(APIVersionMiddleware)

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

# WebSocket routes were removed in iter 58 (P0-2 + P1-1 + P1-2).
# Real-time price updates are handled by SSE (routes_sse.py, P0-1 fixed iter 55);
# other channels use REST + React Query polling. See STATUS.md §Fixed (iter 58).

# Liquid Chain module — vendor reforge conversion chain analysis
try:
    from backend.api.routes_liquid_chain import router as liquid_chain_router
    app.include_router(liquid_chain_router)
except ImportError:
    logger.debug("Liquid Chain router not available yet")

# Phase 3.1: Batch endpoint — combine multiple API calls into one HTTP request
try:
    from backend.api.routes_batch import router as batch_router
    app.include_router(batch_router)
except ImportError:
    logger.debug("Batch router not available yet")

# Phase 3.2: SSE endpoint — live price updates via Server-Sent Events
try:
    from backend.api.routes_sse import router as sse_router
    app.include_router(sse_router)
except ImportError:
    logger.debug("SSE router not available yet")

# F3 (iter 75): Content Pulse — per-category turnover + 7d/30d rolling deltas.
try:
    from backend.api.routes_content_pulse import router as content_pulse_router
    app.include_router(content_pulse_router)
except ImportError:
    logger.debug("Content Pulse router not available yet")


# ---------------------------------------------------------------------------
# Pre-import modules used by health check to avoid lazy import overhead.
# These imports happen once at module load time, so the health endpoint
# can access singletons directly without repeated import statements.
# This reduces response time during GIL contention from executor threads.
# ---------------------------------------------------------------------------
from backend.economy.events import get_event_manager as _get_event_manager
from backend.data.unified_cache import get_pipeline_cache as _get_pipeline_cache
from backend.api.data_snapshot import get_snapshot_manager as _get_snapshot_manager
from backend.data.unified_cache import get_daily_stats_cache as _get_daily_stats_cache

# Lazily-populated reference to the snapshot manager, set during lifespan.
# Avoids calling get_snapshot_manager() on every health check, which would
# trigger a module-level import if the function hasn't been called yet.
_snapshot_manager_ref = None


# ---------------------------------------------------------------------------
# Fix 8 (POE2-FIX-SPEC): Health check endpoint with provider status
# ---------------------------------------------------------------------------

@app.get("/api/v1/health/ping")
async def health_ping():
    """Ultra-lightweight health probe — no JSON serialization, no imports.

    Returns a plain-text "ok" in under 1ms even during heavy computation.
    This endpoint is designed for circuit breaker and bridge health probes
    that only need to know "is the process alive and the event loop running?".
    It avoids all overhead: no config lookup, no dict construction, no JSON
    serialization, no dependency injection.

    Use /api/v1/health for detailed diagnostics.
    """
    return PlainTextResponse("ok", media_type="text/plain")


@app.get("/api/v1/health", response_model=HealthResponse)
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
        cache_entries = pc.stats()["total_entries"]
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


# ---------------------------------------------------------------------------
# P2-13: Backward-compat module attribute access for `process_pool`.
# ---------------------------------------------------------------------------
# Old call sites did `from backend.main import process_pool` and then
# `loop.run_in_executor(process_pool, ...)`. That pattern is broken under
# the lazy/re-creatable model because the imported reference would be a
# snapshot taken at import time and could go stale after a `lifespan`
# teardown. We keep the attribute accessible (so external code/tests that
# still import it keep working) but route it through `get_process_pool()`
# and emit a DeprecationWarning pointing callers at the new API.
def __getattr__(name: str):
    if name == "process_pool":
        warnings.warn(
            "`backend.main.process_pool` is deprecated (P2-13): the pool "
            "is now lazy and may be recreated after lifespan teardown. "
            "Use `from backend.main import get_process_pool` and call it "
            "at the call site instead.",
            DeprecationWarning,
            stacklevel=2,
        )
        return get_process_pool()
    raise AttributeError(f"module 'backend.main' has no attribute {name!r}")

