"""
API routes for arbitrage / flip opportunity data.

Endpoints:
    GET /api/arbitrage/flips        — scored flip opportunities
    GET /api/arbitrage/triangular   — detected triangular arbitrage cycles
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from backend.config import get_settings, AppConfig
from backend.data.cache import get_cache
from backend.data.providers.poe2scout import Poe2ScoutProvider
from backend.economy.lifecycle import PhaseDetector
from backend.economy.momentum import PriceMomentumTracker
from backend.economy.gold_costs import compute_gold_fee_fraction, compute_gold_fee
from backend.economy.gold_cost_table import get_gold_cost_per_unit, get_api_id_to_gold_cost
from backend.arbitrage.scorer import compute_opportunity_score, get_phase_multiplier
from backend.arbitrage.quick_filter import quick_filter
from backend.arbitrage.triangular import find_triangular_arbitrage
from backend.predictors.clustering import CurrencyClusterer
from backend.models.currency import (
    FlipOpportunity,
    LeaguePhase,
    ClusterLabel,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/arbitrage", tags=["arbitrage"])

# ---------------------------------------------------------------------------
# Shared singletons
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
# Helper: build flip opportunities from live data
# ---------------------------------------------------------------------------

async def _build_flip_opportunities(config: AppConfig) -> list[FlipOpportunity]:
    """Fetch live data and compute scored flip opportunities.

    This orchestrates the full pipeline:
    1. Get exchange rates from provider (via cache)
    2. Compute momentum/volatility for each currency
    3. Compute gold fee fractions (direction-dependent)
    4. Score each opportunity
    5. Apply quick filter
    """
    provider = _get_provider()
    cache = get_cache()
    detector = _get_phase_detector()

    # 1. Fetch exchange rates
    rates_result = await cache.get_or_fetch(
        "prices",
        provider.name(),
        "get_exchange_rates",
        provider.get_exchange_rates,
        config.league.league_name,
    )
    if rates_result.value is None:
        return []

    rates = rates_result.value
    if not rates:
        return []

    # 2. Fetch historical data for momentum calculation
    # Use ByCategory endpoint which includes price_logs
    metadata_result = await cache.get_or_fetch(
        "metadata",
        provider.name(),
        "get_currency_metadata",
        provider.get_currency_metadata,
        config.league.league_name,
    )
    currencies = metadata_result.value if metadata_result.value else []

    # Build a mapping from api_id to historical prices for momentum
    currency_price_history: dict[str, list[float]] = {}
    for curr in currencies:
        hist_result = await cache.get_or_fetch(
            "history",
            provider.name(),
            "get_historical_prices",
            provider.get_historical_prices,
            curr.api_id,
            7,
        )
        if hist_result.value:
            currency_price_history[curr.api_id] = [
                p.price for p in hist_result.value
            ]

    # 3. Determine gold_to_chaos_rate
    gold_to_chaos_rate = config.fees.fixed_gold_to_chaos_rate or 0.001
    if config.fees.gold_to_chaos_rate_source == "market":
        observed = await provider.get_gold_chaos_rate(config.league.league_name)
        if observed is not None:
            gold_to_chaos_rate = observed

    # 4. Get phase info
    phase_info = detector.get_phase_info()
    phase_multiplier = get_phase_multiplier(phase_info.phase, config)

    # 5. Compute max volume across all pairs for fill probability normalization
    max_volume = max(
        (r.volume_traded for r in rates.values() if r.volume_traded > 0),
        default=1,
    )

    # 6. Build price-in-chaos mapping
    # Use the base currency as reference; if base is "exalted",
    # we derive prices from the exchange rates
    prices_in_chaos: dict[str, float] = {config.league.base_currency: 1.0}
    for key, rate in rates.items():
        if rate.currency_from == config.league.base_currency:
            # e.g. exalted → chaos: raw_rate = how many chaos per 1 exalted
            if rate.currency_to not in prices_in_chaos:
                prices_in_chaos[rate.currency_to] = rate.raw_rate
        elif rate.currency_to == config.league.base_currency:
            # e.g. chaos → exalted: raw_rate = how many exalted per 1 chaos
            # so 1 chaos = raw_rate exalted → 1 chaos in exalted terms
            if rate.currency_from not in prices_in_chaos:
                prices_in_chaos[rate.currency_from] = 1.0 / rate.raw_rate if rate.raw_rate > 0 else 0.0

    # If we have chaos in the prices, convert everything to chaos
    if "chaos" in prices_in_chaos and config.league.base_currency != "chaos":
        exalted_to_chaos = prices_in_chaos.get("chaos", 1.0)
        for k in list(prices_in_chaos.keys()):
            if k != "chaos":
                prices_in_chaos[k] = prices_in_chaos[k] * exalted_to_chaos

    # 7. Run currency clustering (Milestone 6: §5)
    # Build clustering inputs from the data we already have
    clusterer = CurrencyClusterer(config)
    cluster_labels: dict[str, ClusterLabel] = {}

    try:
        # Prepare clustering inputs
        cluster_price_histories: dict[str, list[float]] = {}
        cluster_volumes: dict[str, float] = {}
        cluster_prices_now: dict[str, float] = {}
        cluster_prices_24h_ago: dict[str, float] = {}

        # Collect unique currencies from both sides of each pair
        for key, rate in rates.items():
            for curr in (rate.currency_from, rate.currency_to):
                if curr not in cluster_price_histories:
                    cluster_price_histories[curr] = currency_price_history.get(curr, [])
                    # Use volume from whichever pair involves this currency
                    cluster_volumes[curr] = 0.0
                    cluster_prices_now[curr] = 0.0
                    cluster_prices_24h_ago[curr] = 0.0

            # Accumulate volume per currency (use max volume across pairs)
            for curr in (rate.currency_from, rate.currency_to):
                vol = float(rate.volume_traded)
                if vol > cluster_volumes.get(curr, 0):
                    cluster_volumes[curr] = vol

        # Derive prices_now and prices_24h_ago from the price histories
        for curr, history in cluster_price_histories.items():
            if history:
                cluster_prices_now[curr] = history[-1]
                cluster_prices_24h_ago[curr] = history[0] if len(history) > 1 else history[-1]
            else:
                # Fallback: use prices_in_chaos if available
                cluster_prices_now[curr] = prices_in_chaos.get(curr, 0)
                cluster_prices_24h_ago[curr] = prices_in_chaos.get(curr, 0)

        # Only cluster if we have enough currencies
        if len(cluster_price_histories) >= 3:
            cluster_labels = clusterer.fit(
                cluster_price_histories, cluster_volumes,
                cluster_prices_now, cluster_prices_24h_ago,
            )
            # Convert ClusterResult to dict
            cluster_labels = {c.currency: c.cluster for c in clusterer.last_output.clusters}
            logger.info("Clustering completed: %d currencies assigned", len(cluster_labels))
        else:
            logger.warning(
                "Only %d currencies for clustering (need >=3), using MODERATE default",
                len(cluster_price_histories),
            )
    except Exception as e:
        logger.error("Clustering failed, using MODERATE default: %s", e)
        cluster_labels = {}

    # 8. Score each pair as a flip opportunity
    opportunities: list[FlipOpportunity] = []

    for key, rate in rates.items():
        # Compute momentum and volatility from price history
        history = currency_price_history.get(rate.currency_from, [])
        tracker = PriceMomentumTracker(window_size=24)
        for price in history:
            tracker.update(price)
        momentum_result = tracker.compute()

        # Estimate bid/ask from the rate (1% estimated spread if no order book)
        # In a real system, these come from the order book.
        mid_price = rate.raw_rate
        # Use a spread proportional to volatility
        spread_estimate = max(0.01, momentum_result.volatility * 2)
        bid = mid_price * (1 - spread_estimate / 2)
        ask = mid_price * (1 + spread_estimate / 2)

        # Compute gold fee fraction (direction-dependent)
        price_to_chaos = prices_in_chaos.get(rate.currency_to, 0)
        trade_value = rate.raw_rate * price_to_chaos

        try:
            fee_fraction = compute_gold_fee_fraction(
                currency_received=rate.currency_to,
                quantity_received=rate.raw_rate,
                gold_to_chaos_rate=gold_to_chaos_rate,
                trade_value_in_chaos=max(trade_value, 1e-10),
                fallback_cost=config.fees.unknown_item_gold_cost,
            )
            gold_fee_actual = compute_gold_fee(
                rate.currency_to,
                rate.raw_rate,
                fallback_cost=config.fees.unknown_item_gold_cost,
            )
        except Exception:
            fee_fraction = 0.0
            gold_fee_actual = 0.0

        # Score
        score = compute_opportunity_score(
            bid=bid,
            ask=ask,
            mid_price=mid_price,
            volume_24h=float(rate.volume_traded),
            max_volume=float(max_volume),
            volatility=momentum_result.volatility,
            gold_fee_fraction=fee_fraction,
            phase_multiplier=phase_multiplier,
            momentum=momentum_result.momentum,
            momentum_neg_threshold=config.scoring.momentum_negative_threshold,
            vol_reference=config.scoring.volatility_reference,
        )

        # Determine cluster label (use clustering result, fallback to MODERATE)
        # Check both sides of the pair; use the "from" currency's cluster
        currency_key = rate.currency_from
        cluster = cluster_labels.get(currency_key, ClusterLabel.MODERATE)

        opp = FlipOpportunity(
            currency=f"{rate.currency_from}/{rate.currency_to}",
            score=score,
            spread_after_fees=(ask - bid) / mid_price - fee_fraction if mid_price > 0 else 0.0,
            gold_fee_fraction=fee_fraction,
            gold_fee_actual=gold_fee_actual,
            volume_24h=float(rate.volume_traded),
            momentum=momentum_result.momentum,
            volatility=momentum_result.volatility,
            cluster=cluster,
            bid=bid,
            ask=ask,
            mid_price=mid_price,
        )

        # Apply quick filter
        if quick_filter(opp, phase_info.phase, fee_fraction, config):
            opportunities.append(opp)

    # Sort by score descending
    opportunities.sort(key=lambda o: o.score, reverse=True)
    return opportunities


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/flips")
async def get_flip_opportunities(
    min_score: float = Query(0.0, ge=0.0, le=1.0, description="Minimum score filter"),
    min_volume: int = Query(0, ge=0, description="Minimum 24h volume filter"),
    limit: int = Query(50, ge=1, le=200, description="Max results"),
):
    """Return scored flip opportunities for the configured league.

    Each opportunity includes: currency pair, score, spread after fees,
    gold fee (actual gold amount), volume, momentum, volatility, cluster.
    """
    config = get_settings()
    opportunities = await _build_flip_opportunities(config)

    # Apply filters
    filtered = [
        o for o in opportunities
        if o.score >= min_score and o.volume_24h >= min_volume
    ]

    # Limit results
    filtered = filtered[:limit]

    return {
        "league": config.league.league_name,
        "total": len(filtered),
        "opportunities": [
            {
                "currency": o.currency,
                "score": round(o.score, 4),
                "spread_after_fees": round(o.spread_after_fees, 6),
                "gold_fee_fraction": round(o.gold_fee_fraction, 6),
                "gold_fee_actual": round(o.gold_fee_actual, 1),
                "volume_24h": o.volume_24h,
                "momentum": round(o.momentum, 6),
                "volatility": round(o.volatility, 6),
                "cluster": o.cluster.value,
                "bid": round(o.bid, 6),
                "ask": round(o.ask, 6),
                "mid_price": round(o.mid_price, 6),
            }
            for o in filtered
        ],
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/triangular")
async def get_triangular_arbitrage(
    min_profit_pct: float = Query(0.1, ge=0.0, description="Min profit % to report"),
):
    """Return detected triangular arbitrage cycles.

    Uses Bellman-Ford negative cycle detection with direction-dependent
    gold fee calculations.
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
        raise HTTPException(status_code=503, detail="Exchange rate data unavailable")

    rates_dict = rates_result.value

    # Build the rates dict in the format expected by find_triangular_arbitrage
    rates_for_bf: dict[tuple[str, str], float] = {}
    for key, rate in rates_dict.items():
        rates_for_bf[(rate.currency_from, rate.currency_to)] = rate.raw_rate

    # Build gold cost and price dicts
    gold_cost_dict = get_api_id_to_gold_cost()
    prices_in_chaos: dict[str, float] = {}

    # Derive prices from exchange rates (simplified)
    base = config.league.base_currency
    prices_in_chaos[base] = 1.0
    for key, rate in rates_dict.items():
        if rate.currency_from == base:
            prices_in_chaos[rate.currency_to] = rate.raw_rate
        elif rate.currency_to == base and rate.raw_rate > 0:
            prices_in_chaos[rate.currency_from] = 1.0 / rate.raw_rate

    # Gold-to-chaos rate
    gold_to_chaos_rate = config.fees.fixed_gold_to_chaos_rate or 0.001
    if config.fees.gold_to_chaos_rate_source == "market":
        observed = await provider.get_gold_chaos_rate(config.league.league_name)
        if observed is not None:
            gold_to_chaos_rate = observed

    # Run Bellman-Ford
    opportunities = find_triangular_arbitrage(
        rates=rates_for_bf,
        gold_cost_per_unit=gold_cost_dict,
        prices_in_chaos=prices_in_chaos,
        gold_to_chaos_rate=gold_to_chaos_rate,
        min_profit_pct=min_profit_pct,
        fallback_gold_cost=config.fees.unknown_item_gold_cost,
    )

    return {
        "league": config.league.league_name,
        "total": len(opportunities),
        "opportunities": [
            {
                "cycle": o.cycle,
                "net_profit_pct": round(o.net_profit_pct, 4),
                "step_rates": [round(r, 6) for r in o.step_rates],
                "step_fees_gold": [round(f, 1) for f in o.step_fees_gold],
                "step_fees_fraction": [round(f, 6) for f in o.step_fees_fraction],
                "total_volume": o.total_volume,
                "confidence": round(o.confidence, 4),
            }
            for o in opportunities
        ],
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }
