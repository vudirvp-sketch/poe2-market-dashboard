"""
FastAPI application entry point for the PoE2 Flipper backend.

Start with:
    uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000

Provides:
    GET /api/phase              — current league phase
    GET /api/currencies         — currency metadata
    GET /api/prices             — all exchange rates with fee info
    GET /api/prices/{pair}      — price for a specific pair
    GET /api/arbitrage/flips    — scored flip opportunities
    GET /api/arbitrage/triangular — triangular arbitrage cycles
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
    """Application lifespan: initialize resources on startup, clean up on shutdown."""
    logger.info("PoE2 Flipper backend starting up...")
    config = get_settings()
    logger.info(
        "League: %s, Realm: %s, Base currency: %s",
        config.league.league_name,
        config.league.realm,
        config.league.base_currency,
    )
    yield
    # Cleanup: close provider HTTP clients
    from backend.api.routes_prices import _provider as prices_provider
    from backend.api.routes_arbitrage import _provider as arb_provider
    for prov in [prices_provider, arb_provider]:
        if prov is not None:
            await prov.close()
    logger.info("PoE2 Flipper backend shut down.")


# ---------------------------------------------------------------------------
# App creation
# ---------------------------------------------------------------------------

app = FastAPI(
    title="PoE2 Flipper API",
    description="Backend API for PoE2 currency analysis and arbitrage detection",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS: allow Streamlit frontend (localhost:8501) and any local dev
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:8501",
        "http://127.0.0.1:8501",
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


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@app.get("/api/health")
async def health_check():
    """Simple health check endpoint."""
    config = get_settings()
    return {
        "status": "ok",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "league": config.league.league_name,
        "base_currency": config.league.base_currency,
    }
