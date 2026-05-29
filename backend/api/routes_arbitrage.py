"""
API routes for arbitrage / flip opportunity data.

Endpoints:
    GET /api/arbitrage/flips        — scored flip opportunities
    GET /api/arbitrage/triangular   — detected triangular arbitrage cycles

OPTIMIZATION: Uses DataSnapshot instead of making N individual
get_historical_prices() calls per currency. Before: 50+ API requests.
After: ~16 requests (shared snapshot).
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from backend.config import get_settings, AppConfig
from backend.data.cache import get_cache
from backend.data.pipeline_cache import get_pipeline_cache
from backend.api.shared import get_provider as _get_provider, get_phase_detector as _get_phase_detector
from backend.api.data_snapshot import get_snapshot
from backend.economy.momentum import PriceMomentumTracker
from backend.economy.gold_costs import compute_gold_fee_fraction, compute_gold_fee
from backend.economy.gold_cost_table import get_gold_cost_per_unit, get_api_id_to_gold_cost
from backend.economy.events import get_event_manager, EventManager
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
# Helper: build flip opportunities from live data
# ---------------------------------------------------------------------------

async def _build_flip_opportunities(config: AppConfig) -> list[FlipOpportunity]:
    """Fetch live data and compute scored flip opportunities.

    OPTIMIZATION: Uses DataSnapshot instead of making N individual
    get_historical_prices() calls. The snapshot already contains
    price histories from the ByCategory response.

    Pipeline:
    1. Get exchange rates + currencies from DataSnapshot (0 additional API calls)
    2. Compute momentum/volatility for each currency (from snapshot price_logs)
    3. Compute gold fee fractions (direction-dependent)
    4. Score each opportunity
    5. Apply event penalties
    6. Apply quick filter
    """
    detector = _get_phase_detector()
    event_manager = get_event_manager(config)

    # 1. Use DataSnapshot instead of N+1 API calls
    snapshot = await get_snapshot()

    rates = snapshot.exchange_rates
    if not rates:
        return []

    # 2. Build price history lookup from snapshot
    currency_price_history: dict[str, list[float]] = {}
    for api_id_lower, points in snapshot.price_histories.items():
        currency_price_history[api_id_lower] = [p.price for p in points]
    # Also store by original-case api_id using DataSnapshot.get_currency()
    for api_id_lower in list(snapshot.price_histories.keys()):
        curr = snapshot.get_currency(api_id_lower)
        if curr:
            orig_id = curr.get("api_id", "")
            if orig_id and orig_id != api_id_lower and api_id_lower in currency_price_history:
                currency_price_history[orig_id] = currency_price_history[api_id_lower]

    # 3. Determine gold_to_chaos_rate
    gold_to_chaos_rate = config.fees.fixed_gold_to_chaos_rate or 0.001
    if config.fees.gold_to_chaos_rate_source == "market":
        from backend.api.shared import get_provider
        provider = get_provider()
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

    # 6. Build price-in-chaos mapping from snapshot
    prices_in_chaos = snapshot.prices_in_base

    if "chaos" in prices_in_chaos and config.league.base_currency != "chaos":
        exalted_to_chaos = prices_in_chaos.get("chaos", 1.0)
        for k in list(prices_in_chaos.keys()):
            if k != "chaos":
                prices_in_chaos[k] = prices_in_chaos[k] * exalted_to_chaos

    # 7. Run currency clustering
    clusterer = CurrencyClusterer(config)
    cluster_labels: dict[str, ClusterLabel] = {}

    try:
        cluster_price_histories: dict[str, list[float]] = {}
        cluster_volumes: dict[str, float] = {}
        cluster_prices_now: dict[str, float] = {}
        cluster_prices_24h_ago: dict[str, float] = {}

        for key, rate in rates.items():
            for curr in (rate.currency_from, rate.currency_to):
                if curr not in cluster_price_histories:
                    cluster_price_histories[curr] = currency_price_history.get(curr, [])
                    cluster_volumes[curr] = 0.0
                    cluster_prices_now[curr] = 0.0
                    cluster_prices_24h_ago[curr] = 0.0

            for curr in (rate.currency_from, rate.currency_to):
                vol = float(rate.volume_traded)
                if vol > cluster_volumes.get(curr, 0):
                    cluster_volumes[curr] = vol

        for curr, history in cluster_price_histories.items():
            if history:
                cluster_prices_now[curr] = history[-1]
                cluster_prices_24h_ago[curr] = history[0] if len(history) > 1 else history[-1]
            else:
                cluster_prices_now[curr] = prices_in_chaos.get(curr, 0)
                cluster_prices_24h_ago[curr] = prices_in_chaos.get(curr, 0)

        if len(cluster_price_histories) >= 3:
            cluster_labels = clusterer.fit(
                cluster_price_histories, cluster_volumes,
                cluster_prices_now, cluster_prices_24h_ago,
            )
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
        history = currency_price_history.get(rate.currency_from, [])
        tracker = PriceMomentumTracker(window_size=24)
        for price in history:
            tracker.update(price)
        momentum_result = tracker.compute()

        mid_price = rate.raw_rate
        spread_estimate = max(0.01, momentum_result.volatility * 2)
        bid = mid_price * (1 - spread_estimate / 2)
        ask = mid_price * (1 + spread_estimate / 2)

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

        # Apply event penalties
        event_penalty = event_manager.get_event_score_penalty(rate.currency_from)
        if event_penalty == 0.0:
            continue
        score = score * event_penalty
        score = min(max(score, 0.0), 1.0)

        event_penalty_to = event_manager.get_event_score_penalty(rate.currency_to)
        if event_penalty_to == 0.0:
            continue
        score = score * event_penalty_to
        score = min(max(score, 0.0), 1.0)

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

        if quick_filter(opp, phase_info.phase, fee_fraction, config):
            opportunities.append(opp)

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
    """Return scored flip opportunities for the configured league."""
    config = get_settings()
    event_manager = get_event_manager(config)
    pipeline_cache = get_pipeline_cache()

    cached = pipeline_cache.get("flip_opportunities")
    if cached is not None and not cached.stale:
        opportunities = cached.value
    else:
        try:
            opportunities = await _build_flip_opportunities(config)
            pipeline_cache.put("flip_opportunities", opportunities)
        except Exception as e:
            logger.warning("Failed to recompute flip_opportunities: %s", e)
            if cached is not None:
                logger.info("Returning stale cache for flip_opportunities")
                opportunities = cached.value
            else:
                raise

    filtered = [
        o for o in opportunities
        if o.score >= min_score and o.volume_24h >= min_volume
    ]
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
        "event_status": {
            "any_active": event_manager.is_event_active(),
            "affected_currencies": list(event_manager.get_affected_currencies()),
            "summary": event_manager.get_active_event_summary(),
        },
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/triangular")
async def get_triangular_arbitrage(
    min_profit_pct: float = Query(0.1, ge=0.0, description="Min profit % to report"),
):
    """Return detected triangular arbitrage cycles.

    Uses DataSnapshot for exchange rates instead of independent API call.
    """
    config = get_settings()
    snapshot = await get_snapshot()

    rates_dict = snapshot.exchange_rates
    if not rates_dict:
        return {
            "league": config.league.league_name,
            "total": 0,
            "opportunities": [],
            "data_available": False,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }

    rates_for_bf: dict[tuple[str, str], float] = {}
    for key, rate in rates_dict.items():
        rates_for_bf[(rate.currency_from, rate.currency_to)] = rate.raw_rate

    gold_cost_dict = get_api_id_to_gold_cost()
    prices_in_chaos = snapshot.prices_in_base

    gold_to_chaos_rate = config.fees.fixed_gold_to_chaos_rate or 0.001
    if config.fees.gold_to_chaos_rate_source == "market":
        from backend.api.shared import get_provider
        provider = get_provider()
        observed = await provider.get_gold_chaos_rate(config.league.league_name)
        if observed is not None:
            gold_to_chaos_rate = observed

    pair_volumes: dict[tuple[str, str], float] = {}
    for key, rate in rates_dict.items():
        pair_volumes[(rate.currency_from, rate.currency_to)] = float(rate.volume_traded) if rate.volume_traded else 0.0

    opportunities = find_triangular_arbitrage(
        rates=rates_for_bf,
        gold_cost_per_unit=gold_cost_dict,
        prices_in_chaos=prices_in_chaos,
        gold_to_chaos_rate=gold_to_chaos_rate,
        min_profit_pct=min_profit_pct,
        fallback_gold_cost=config.fees.unknown_item_gold_cost,
        pair_volumes=pair_volumes,
        snapshot_time=datetime.now(timezone.utc),
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
        "data_available": True,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }
