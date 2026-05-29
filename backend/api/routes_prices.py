"""
API routes for price data.

Endpoints:
    GET /api/prices              — all current prices for the configured league
    GET /api/prices/heatmap      — 24h price change heatmap data (Phase 2, Spec Section 2)
    GET /api/prices/{pair}       — current price for a specific pair (e.g. "divine/exalted")
    GET /api/currencies          — currency metadata (names, icons, etc.)
    GET /api/phase               — current league phase info

OPTIMIZATION: Uses DataSnapshot to avoid redundant API calls.
Before: each route made 15-30+ requests to ByCategory independently.
After: all routes share a single cached snapshot (~16 requests total per TTL window).
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from backend.config import get_settings
from backend.data.cache import get_cache
from backend.api.shared import get_provider as _get_provider, get_phase_detector as _get_phase_detector
from backend.api.data_snapshot import get_snapshot
from backend.models.currency import PhaseInfo

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["prices"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _compute_momentum_from_logs(
    price_logs: list[dict],
) -> dict:
    """Compute momentum/volatility/acceleration from price_logs dicts."""
    from backend.economy.momentum import PriceMomentumTracker

    if len(price_logs) < 2:
        return {"momentum": 0.0, "volatility": 0.0, "acceleration": 0.0}

    try:
        sorted_logs = sorted(
            [l for l in price_logs if l.get("price") is not None and l.get("time") is not None],
            key=lambda l: l["time"],
        )
        prices = [l["price"] for l in sorted_logs]
        if len(prices) < 2:
            return {"momentum": 0.0, "volatility": 0.0, "acceleration": 0.0}
        tracker = PriceMomentumTracker(window_size=24)
        for p in prices:
            tracker.update(p)
        result = tracker.compute()
        return {
            "momentum": result.momentum,
            "volatility": result.volatility,
            "acceleration": result.acceleration,
        }
    except Exception as e:
        logger.debug("Momentum computation failed: %s", e)
        return {"momentum": 0.0, "volatility": 0.0, "acceleration": 0.0}


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
    """Return currency metadata for the configured league.

    Uses DataSnapshot instead of making independent ByCategory requests.
    """
    snapshot = await get_snapshot()

    if not snapshot.currency_metadata:
        return {"currencies": [], "stale": True, "data_available": False}

    return {
        "currencies": [
            {
                "api_id": c.api_id,
                "text": c.text,
                "category_api_id": c.category_api_id,
                "icon_url": c.icon_url,
            }
            for c in snapshot.currency_metadata
        ],
        "stale": False,
        "data_available": True,
    }


@router.get("/prices")
async def get_all_prices():
    """Return all current exchange rates for the configured league.

    This is the primary endpoint for the dashboard — it returns all trading
    pairs with their current rates, volumes, and derived metrics (momentum,
    volatility, fee fractions).

    OPTIMIZATION: Uses DataSnapshot to avoid 30+ redundant API requests.
    The snapshot provides exchange_rates + all_currencies in one pass.
    """
    config = get_settings()
    snapshot = await get_snapshot()

    rates = snapshot.exchange_rates
    if not rates:
        return {
            "league": config.league.league_name,
            "phase": "unknown",
            "rates": [],
            "gold_to_chaos_rate": config.fees.fixed_gold_to_chaos_rate or 0.001,
            "base_currency": config.league.base_currency,
            "stale": True,
            "data_available": False,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }

    # Get phase info
    detector = _get_phase_detector()
    phase_info = detector.get_phase_info()

    # Determine gold_to_chaos_rate
    gold_to_chaos_rate = config.fees.fixed_gold_to_chaos_rate or 0.001
    if config.fees.gold_to_chaos_rate_source == "market":
        from backend.api.shared import get_provider
        provider = get_provider()
        observed = await provider.get_gold_chaos_rate(config.league.league_name)
        if observed is not None:
            gold_to_chaos_rate = observed

    # Build momentum/volatility lookup from snapshot's currencies data
    momentum_lookup: dict[str, dict] = {}
    for api_id_lower, curr in snapshot.currencies.items():
        price_logs = curr.get("price_logs", [])
        momentum_lookup[api_id_lower] = _compute_momentum_from_logs(price_logs)
        # Also store by original-case api_id
        orig_api_id = curr.get("api_id", "")
        if orig_api_id and orig_api_id != api_id_lower:
            momentum_lookup[orig_api_id] = momentum_lookup[api_id_lower]

    # Build response with fee calculations + momentum/volatility + cluster
    from backend.economy.gold_costs import compute_fee_breakdown
    from backend.economy.gold_cost_table import get_gold_cost_per_unit
    from backend.predictors.clustering import CurrencyClusterer
    from backend.models.currency import ClusterLabel

    # Run currency clustering for cluster labels
    cluster_labels: dict[str, ClusterLabel] = {}
    try:
        cluster_price_histories: dict[str, list[float]] = {}
        cluster_volumes: dict[str, float] = {}
        cluster_prices_now: dict[str, float] = {}
        cluster_prices_24h_ago: dict[str, float] = {}

        # Use snapshot's prices_in_base for clustering fallback
        prices_in_chaos = snapshot.prices_in_base

        # Accumulate volume per currency from rates
        for key, rate in rates.items():
            for curr in (rate.currency_from, rate.currency_to):
                if curr not in cluster_price_histories:
                    cluster_price_histories[curr] = []
                    cluster_volumes[curr] = 0.0
                    cluster_prices_now[curr] = 0.0
                    cluster_prices_24h_ago[curr] = 0.0
                vol = float(rate.volume_traded)
                if vol > cluster_volumes.get(curr, 0):
                    cluster_volumes[curr] = vol

        # Reuse snapshot's currencies for price histories
        for api_id_lower, curr in snapshot.currencies.items():
            orig_id = curr.get("api_id", api_id_lower)
            price_logs = curr.get("price_logs", [])
            if orig_id in cluster_price_histories and price_logs:
                sorted_logs = sorted(
                    [l for l in price_logs if l.get("price") is not None and l.get("time") is not None],
                    key=lambda l: l["time"],
                )
                prices = [l["price"] for l in sorted_logs]
                if len(prices) >= 2:
                    cluster_price_histories[orig_id] = prices
                    cluster_prices_now[orig_id] = prices[-1]
                    cluster_prices_24h_ago[orig_id] = prices[0]

        # Fill remaining prices from prices_in_chaos fallback
        for curr in cluster_price_histories:
            if cluster_prices_now[curr] == 0:
                cluster_prices_now[curr] = prices_in_chaos.get(curr, 0)
            if cluster_prices_24h_ago[curr] == 0:
                cluster_prices_24h_ago[curr] = prices_in_chaos.get(curr, 0)

        if len(cluster_price_histories) >= 3:
            clusterer = CurrencyClusterer(config)
            output = clusterer.fit(
                cluster_price_histories, cluster_volumes,
                cluster_prices_now, cluster_prices_24h_ago,
            )
            cluster_labels = {c.currency: c.cluster for c in output.clusters}
            logger.info("Prices clustering completed: %d currencies assigned", len(cluster_labels))
        else:
            logger.warning(
                "Only %d currencies for clustering (need >=3), using MODERATE default",
                len(cluster_price_histories),
            )
    except Exception as e:
        logger.error("Clustering in prices route failed: %s", e)
        cluster_labels = {}

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

        # Add volatility and momentum from snapshot
        from_momentum = momentum_lookup.get(rate.currency_from, {})
        to_momentum = momentum_lookup.get(rate.currency_to, {})

        # Cluster label for currency_from
        from_cluster = cluster_labels.get(rate.currency_from, ClusterLabel.MODERATE).value
        to_cluster = cluster_labels.get(rate.currency_to, ClusterLabel.MODERATE).value

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
            "cluster_from": from_cluster,
            "cluster_to": to_cluster,
            "timestamp": rate.timestamp.isoformat() if rate.timestamp else None,
        })

    return {
        "league": config.league.league_name,
        "phase": phase_info.phase.value,
        "rates": pairs_data,
        "gold_to_chaos_rate": gold_to_chaos_rate,
        "base_currency": config.league.base_currency,
        "stale": False,
        "data_available": True,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/prices/heatmap")
async def get_heatmap_data():
    """Return 24h price change percentages for all currencies.

    Uses DataSnapshot instead of making independent ByCategory requests.
    """
    snapshot = await get_snapshot()

    currencies_data = []
    for api_id_lower, curr in snapshot.currencies.items():
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
