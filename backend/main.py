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
    GET /api/forecast/{currency} — price forecast for a currency
    GET /api/anomalies          — anomaly detection across currencies
    GET /api/storage-value/{currency} — projected value and hold/sell decision
    GET /api/portfolio          — portfolio allocation
    GET /api/portfolio/frontier — efficient frontier data
    GET /api/recipes            — vendor recipe arbitrage
    POST /api/events            — create a manual event flag
    GET /api/events             — list active events
    GET /api/health             — health check
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.api.routes_prices import router as prices_router
from backend.api.routes_arbitrage import router as arbitrage_router
from backend.api.routes_forecast import router as forecast_router
from backend.api.routes_portfolio import router as portfolio_router
from backend.api.routes_events import router as events_router
from backend.config import get_settings

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Lifespan: startup/shutdown logic
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan: initialize resources on startup, clean up on shutdown.

    Phase 2 (Spec Section 1):
    - Initialize HistoricalStore and connect it to EventManager
    - Load persisted events from SQLite into EventManager
    - Prune expired events from both memory and SQLite
    - Reset PhaseDetector if a major_patch event exists
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
    from backend.data.historical import get_historical_store
    historical_store = get_historical_store(config)
    await historical_store.init()
    logger.info("HistoricalStore initialized")

    # --- Phase 2: Load persisted events from SQLite ---
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

    # --- Phase 2: Start Background Scheduler (Spec Section 7) ---
    scheduler = None
    try:
        from backend.scheduler import DataScheduler
        from backend.api.shared import get_provider as _get_shared_provider
        scheduler_provider = _get_shared_provider()
        scheduler = DataScheduler(
            provider=scheduler_provider,
            historical_store=historical_store,
            event_manager=manager,
            config=config,
        )
        scheduler.start()
    except Exception as e:
        logger.warning("Scheduler failed to start: %s", e)

    yield

    # --- Phase 2: Shutdown Scheduler ---
    if scheduler is not None:
        try:
            scheduler.shutdown(wait=False)
        except Exception as e:
            logger.warning("Scheduler shutdown error: %s", e)

    # Cleanup: close shared provider and HistoricalStore
    from backend.api.shared import close_shared
    await close_shared()
    await historical_store.close()
    logger.info("PoE2 Flipper backend shut down.")


# ---------------------------------------------------------------------------
# App creation
# ---------------------------------------------------------------------------

app = FastAPI(
    title="PoE2 Flipper API",
    description="Backend API for PoE2 currency analysis and arbitrage detection",
    version="0.2.0",
    lifespan=lifespan,
)

# CORS: allow Next.js frontend and local dev
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(prices_router)
app.include_router(arbitrage_router)
app.include_router(forecast_router)
app.include_router(portfolio_router)
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
    from backend.api.routes_recipes import router as recipes_router
    app.include_router(recipes_router)
except ImportError:
    logger.debug("Recipes router not available yet")

# WebSocket routes for live updates
try:
    from backend.api.routes_ws import router as ws_router
    app.include_router(ws_router)
except ImportError:
    logger.debug("WebSocket router not available yet")

# OAuth2 authentication routes
try:
    from backend.api.routes_auth import router as auth_router
    app.include_router(auth_router)
except ImportError:
    logger.debug("Auth router not available yet")


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@app.get("/api/health")
async def health_check():
    """Simple health check endpoint."""
    config = get_settings()

    # Include event status in health check
    from backend.economy.events import get_event_manager
    manager = get_event_manager(config)
    event_summary = manager.get_active_event_summary()

    return {
        "status": "ok",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "league": config.league.league_name,
        "base_currency": config.league.base_currency,
        "active_events": event_summary["total_active_events"] if event_summary else 0,
    }
