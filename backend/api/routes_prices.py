"""
API routes for price data.

Endpoints:
    GET /api/prices              — all current prices for the configured league
    GET /api/prices/{pair}       — current price for a specific pair (e.g. "divine/exalted")
    GET /api/currencies          — currency metadata (names, icons, etc.)
    GET /api/phase               — current league phase info
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from backend.config import get_settings
from backend.data.cache import get_cache
from backend.data.providers.poe2scout import Poe2ScoutProvider
from backend.economy.lifecycle import PhaseDetector
from backend.models.currency import PhaseInfo

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["prices"])

# ---------------------------------------------------------------------------
# Provider & cache singletons (lazily initialized)
# ---------------------------------------------------------------------------

_provider: Poe2ScoutProvider | None = None
_phase_detector: PhaseDetector | None = None


def _get_provider() -> Poe2ScoutProvider:
    global _provider
    if _provider is None:
        _provider = Poe2ScoutProvider()
    return _provider


def _get_phase_detector() -> PhaseDetector:
    global _phase_detector
    if _phase_detector is None:
        config = get_settings()
        _phase_detector = PhaseDetector(config.league.league_start_datetime, config)
    return _phase_detector


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/phase")
async def get_phase():
    """Return current league phase information."""
    detector = _get_phase_detector()
    info = detector.get_phase_info()
    return {
        "phase": info.phase.value,
        "days_since_reference": info.days_since_reference,
        "reference_currency": info.reference_currency,
        "recommended_strategy": info.recommended_strategy,
        "min_spread_after_fees": info.min_spread_after_fees,
        "max_hold_time": info.max_hold_time,
    }


@router.get("/currencies")
async def get_currencies():
    """Return currency metadata for the configured league."""
    config = get_settings()
    provider = _get_provider()
    cache = get_cache()

    result = await cache.get_or_fetch(
        "metadata",
        provider.name(),
        "get_currency_metadata",
        provider.get_currency_metadata,
        config.league.league_name,
    )

    if result.value is None:
        raise HTTPException(status_code=503, detail="Currency metadata unavailable")

    currencies = result.value
    return {
        "currencies": [
            {
                "api_id": c.api_id,
                "text": c.text,
                "category_api_id": c.category_api_id,
                "icon_url": c.icon_url,
            }
            for c in currencies
        ],
        "stale": result.stale,
    }


@router.get("/prices")
async def get_all_prices():
    """Return all current exchange rates for the configured league.

    This is the primary endpoint for the dashboard — it returns all trading
    pairs with their current rates, volumes, and derived metrics (momentum,
    volatility, fee fractions).
    """
    config = get_settings()
    provider = _get_provider()
    cache = get_cache()

    # Fetch exchange rates
    rates_result = await cache.get_or_fetch(
        "prices",
        provider.name(),
        "get_exchange_rates",
        provider.get_exchange_rates,
        config.league.league_name,
    )

    if rates_result.value is None:
        raise HTTPException(status_code=503, detail="Price data unavailable")

    rates = rates_result.value

    # Get phase info
    detector = _get_phase_detector()
    phase_info = detector.get_phase_info()

    # Determine gold_to_chaos_rate
    gold_to_chaos_rate = config.fees.fixed_gold_to_chaos_rate or 0.001
    if config.fees.gold_to_chaos_rate_source == "market":
        observed = await provider.get_gold_chaos_rate(config.league.league_name)
        if observed is not None:
            gold_to_chaos_rate = observed

    # Build response with fee calculations
    from backend.economy.gold_costs import compute_fee_breakdown
    from backend.economy.gold_cost_table import get_gold_cost_per_unit

    pairs_data = []
    for key, rate in rates.items():
        # Compute fee for the forward direction
        price_to = rate.raw_rate  # price of `to` in terms of `from` (per unit)
        # For fee calculation, we need price of each currency in chaos
        # Simplification: use relative prices from exchange rates
        price_from_chaos = 1.0  # will be refined with actual chaos prices
        price_to_chaos = rate.raw_rate  # approximation

        try:
            fee_bd = compute_fee_breakdown(
                currency_received=rate.currency_to,
                quantity_received=rate.raw_rate,
                gold_to_chaos_rate=gold_to_chaos_rate,
                trade_value_in_chaos=max(rate.raw_rate * price_to_chaos, 1e-10),
                fallback_cost=config.fees.unknown_item_gold_cost,
            )
            fee_fraction = fee_bd.fee_fraction
            gold_fee_actual = fee_bd.gold_fee_total
        except Exception:
            fee_fraction = 0.0
            gold_fee_actual = 0.0

        pairs_data.append({
            "pair": key,
            "currency_from": rate.currency_from,
            "currency_to": rate.currency_to,
            "raw_rate": rate.raw_rate,
            "volume_traded": rate.volume_traded,
            "stock_value": rate.stock_value,
            "fee_fraction": round(fee_fraction, 6),
            "gold_fee_actual": round(gold_fee_actual, 1),
            "timestamp": rate.timestamp.isoformat() if rate.timestamp else None,
        })

    return {
        "league": config.league.league_name,
        "phase": phase_info.phase.value,
        "rates": pairs_data,
        "gold_to_chaos_rate": gold_to_chaos_rate,
        "base_currency": config.league.base_currency,
        "stale": rates_result.stale,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/prices/{pair:path}")
async def get_price_for_pair(pair: str):
    """Return current price for a specific currency pair (e.g. 'divine/exalted')."""
    config = get_settings()
    provider = _get_provider()
    cache = get_cache()

    result = await cache.get_or_fetch(
        "prices",
        provider.name(),
        "get_current_price",
        provider.get_current_price,
        pair,
    )

    if result.value is None:
        raise HTTPException(status_code=404, detail=f"No price data for pair: {pair}")

    quote = result.value
    return {
        "pair": quote.pair,
        "bid": quote.bid,
        "ask": quote.ask,
        "mid_price": quote.mid_price,
        "volume_24h": quote.volume_24h,
        "timestamp": quote.timestamp.isoformat() if quote.timestamp else None,
        "stale": result.stale,
    }
