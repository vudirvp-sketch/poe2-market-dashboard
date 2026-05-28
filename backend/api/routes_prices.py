"""
API routes for price data.

Endpoints:
    GET /api/prices              — all current prices for the configured league
    GET /api/prices/heatmap      — 24h price change heatmap data (Phase 2, Spec Section 2)
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

    Phase 2 (Spec Section 3): Added volatility and momentum fields
    computed from price_logs via PriceMomentumTracker.
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

    # Phase 2: Fetch all currencies with price_logs for momentum/volatility computation
    from backend.economy.momentum import PriceMomentumTracker

    all_currencies = await provider.get_all_currencies_with_prices(
        config.league.league_name
    )

    # Build momentum/volatility lookup from price_logs
    momentum_lookup: dict[str, dict] = {}  # api_id -> {momentum, volatility, acceleration}
    for curr in all_currencies:
        api_id = curr.get("api_id", "")
        price_logs = curr.get("price_logs", [])
        if not api_id or len(price_logs) < 2:
            if api_id:
                momentum_lookup[api_id] = {"momentum": 0.0, "volatility": 0.0, "acceleration": 0.0}
            continue
        try:
            sorted_logs = sorted(
                [l for l in price_logs if l.get("price") is not None and l.get("time") is not None],
                key=lambda l: l["time"],
            )
            prices = [l["price"] for l in sorted_logs]
            if len(prices) < 2:
                momentum_lookup[api_id] = {"momentum": 0.0, "volatility": 0.0, "acceleration": 0.0}
                continue
            tracker = PriceMomentumTracker(window_size=24)
            for p in prices:
                tracker.update(p)
            result = tracker.compute()
            momentum_lookup[api_id] = {
                "momentum": result.momentum,
                "volatility": result.volatility,
                "acceleration": result.acceleration,
            }
        except Exception as e:
            logger.debug("Momentum computation failed for %s: %s", api_id, e)
            momentum_lookup[api_id] = {"momentum": 0.0, "volatility": 0.0, "acceleration": 0.0}

    # Build response with fee calculations + momentum/volatility
    from backend.economy.gold_costs import compute_fee_breakdown
    from backend.economy.gold_cost_table import get_gold_cost_per_unit

    pairs_data = []
    for key, rate in rates.items():
        # Compute fee for the forward direction
        price_to = rate.raw_rate
        price_from_chaos = 1.0
        price_to_chaos = rate.raw_rate

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

        # Phase 2: Add volatility and momentum from price_logs
        from_momentum = momentum_lookup.get(rate.currency_from, {})
        to_momentum = momentum_lookup.get(rate.currency_to, {})

        pairs_data.append({
            "pair": key,
            "currency_from": rate.currency_from,
            "currency_to": rate.currency_to,
            "raw_rate": rate.raw_rate,
            "volume_traded": rate.volume_traded,
            "stock_value": rate.stock_value,
            "fee_fraction": round(fee_fraction, 6),
            "gold_fee_actual": round(gold_fee_actual, 1),
            "volatility": round(from_momentum.get("volatility", 0.0), 6),
            "momentum": round(from_momentum.get("momentum", 0.0), 6),
            "acceleration": round(from_momentum.get("acceleration", 0.0), 6),
            "timestamp": rate.timestamp.isoformat() if rate.timestamp else None,
        })

    # Phase 2 (Spec §13): Write price snapshots to HistoricalStore
    try:
        from backend.data.historical import get_historical_store
        historical_store = get_historical_store(config)
        # Build snapshots from current rates
        base = config.league.base_currency
        prices_in_chaos: dict[str, float] = {base: 1.0}
        for key, rate in rates.items():
            if rate.currency_from == base:
                prices_in_chaos[rate.currency_to] = rate.raw_rate
            elif rate.currency_to == base and rate.raw_rate > 0:
                prices_in_chaos[rate.currency_from] = 1.0 / rate.raw_rate

        snapshots = []
        for api_id, price in prices_in_chaos.items():
            snapshots.append({
                "currency": api_id,
                "price_chaos": price,
                "volume_24h": None,
                "bid": None,
                "ask": None,
            })
        if snapshots:
            await historical_store.write_price_snapshots_batch(
                config.league.league_name, snapshots
            )

        # Also write gold→chaos rate
        if gold_to_chaos_rate:
            await historical_store.write_gold_chaos_rate(
                config.league.league_name, gold_to_chaos_rate
            )
    except Exception as e:
        logger.debug("HistoricalStore write failed (non-critical): %s", e)

    return {
        "league": config.league.league_name,
        "phase": phase_info.phase.value,
        "rates": pairs_data,
        "gold_to_chaos_rate": gold_to_chaos_rate,
        "base_currency": config.league.base_currency,
        "stale": rates_result.stale,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/prices/heatmap")
async def get_heatmap_data():
    """Return 24h price change percentages for all currencies.

    Phase 2 (Spec Section 2.4): Uses price_logs from POE2Scout API
    to compute real price change percentages between consecutive log entries.

    Returns:
        Dict with:
        - currencies: list of {api_id, text, icon_url, changes: [float], time_labels: [str]}
        - fetched_at: ISO timestamp
    """
    config = get_settings()
    provider = _get_provider()

    # Fetch all currencies with price_logs
    all_currencies = await provider.get_all_currencies_with_prices(
        config.league.league_name
    )

    currencies_data = []
    for curr in all_currencies:
        api_id = curr.get("api_id", "")
        text = curr.get("text", "")
        icon_url = curr.get("icon_url")
        price_logs = curr.get("price_logs", [])

        if not api_id or len(price_logs) < 2:
            continue

        # Sort by time
        try:
            sorted_logs = sorted(
                [l for l in price_logs if l.get("price") is not None and l.get("time") is not None],
                key=lambda l: l["time"],
            )
        except Exception:
            continue

        prices = [l["price"] for l in sorted_logs]
        times = [l["time"] for l in sorted_logs]

        if len(prices) < 2:
            continue

        # Compute percentage changes between consecutive price points
        changes = []
        time_labels = []
        for i in range(1, len(prices)):
            prev = prices[i - 1]
            curr_p = prices[i]
            if prev > 0:
                change_pct = ((curr_p - prev) / prev) * 100.0
            else:
                change_pct = 0.0
            changes.append(round(change_pct, 4))
            time_labels.append(times[i] if i < len(times) else f"t{i}")

        currencies_data.append({
            "api_id": api_id,
            "text": text,
            "icon_url": icon_url,
            "changes": changes,
            "time_labels": time_labels,
        })

    return {
        "currencies": currencies_data,
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
