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
from backend.data.pipeline_cache import get_pipeline_cache
from backend.api.shared import get_provider as _get_provider, get_phase_detector as _get_phase_detector
from backend.api.data_snapshot import get_snapshot
from backend.economy.momentum import PriceMomentumTracker
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
# Fix 2.2: Helper to find price closest to 24 hours ago
# ---------------------------------------------------------------------------

def _find_price_24h_ago(
    history_with_timestamps: list[tuple[datetime, float]],
    max_drift_hours: float = 6.0,
) -> float | None:
    """Find the price point closest to 24 hours ago.

    Args:
        history_with_timestamps: list of (timestamp_utc, price) tuples, sorted ascending.
        max_drift_hours: Maximum allowed time drift in hours (default 6h).

    Returns:
        The price ~24h ago, or None if no data within ±max_drift of target.
    """
    if not history_with_timestamps:
        return None

    from datetime import timedelta
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    max_drift = timedelta(hours=max_drift_hours)

    closest: float | None = None
    closest_diff: timedelta | None = None

    for ts, price in history_with_timestamps:
        # Ensure timezone-aware comparison
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        diff = abs(ts - cutoff)
        if closest_diff is None or diff < closest_diff:
            closest = price
            closest_diff = diff

    if closest_diff and closest_diff > max_drift:
        return None  # No point within ±max_drift of 24h ago

    return closest


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
    # Fix 2.2: Also store timestamped history for accurate 24h-ago lookup
    currency_price_history_timestamped: dict[str, list[tuple[datetime, float]]] = {}
    for api_id_lower, points in snapshot.price_histories.items():
        currency_price_history[api_id_lower] = [p.price for p in points]
        currency_price_history_timestamped[api_id_lower] = [(p.timestamp, p.price) for p in points]
    # Also store by original-case api_id using DataSnapshot.get_currency()
    for api_id_lower in list(snapshot.price_histories.keys()):
        curr = snapshot.get_currency(api_id_lower)
        if curr:
            orig_id = curr.get("api_id", "")
            if orig_id and orig_id != api_id_lower and api_id_lower in currency_price_history:
                currency_price_history[orig_id] = currency_price_history[api_id_lower]
                currency_price_history_timestamped[orig_id] = currency_price_history_timestamped.get(api_id_lower, [])

    # 3. Get phase info
    phase_info = detector.get_phase_info()
    phase_multiplier = get_phase_multiplier(phase_info.phase, config)

    # 4. Compute max volume across all pairs for fill probability normalization
    max_volume = max(
        (r.volume_traded for r in rates.values() if r.volume_traded > 0),
        default=1,
    )

    # 5. Build price mapping from snapshot.
    # Variable naming: `prices` holds prices in a consistent reference currency.
    # For fee calculations the triangular algorithm needs a common unit;
    # when the base is Exalted we convert to Chaos so gold-to-chaos fee
    # arithmetic stays correct.
    prices = dict(snapshot.prices_in_base)  # shallow copy — prevents mutation of shared state

    if "chaos" in prices and config.league.base_currency != "chaos":
        exalted_to_chaos = prices.get("chaos", 1.0)
        for k in list(prices.keys()):
            if k != "chaos":
                prices[k] = prices[k] * exalted_to_chaos

    # 6. Run currency clustering
    # FIX: Cache clustering result with pipeline_cache instead of recreating
    # CurrencyClusterer on every request. KMeans with n_init=10 means ~10
    # KMeans runs per call, which is expensive. Cache with same TTL as snapshot.
    clusterer = CurrencyClusterer(config)
    cluster_labels: dict[str, ClusterLabel] = {}

    try:
        cached_clustering = pipeline_cache.get("cluster_labels")
        if cached_clustering is not None and not cached_clustering.stale:
            cluster_labels = cached_clustering.value
        else:
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
                    # Fix 2.2: Use timestamped history for accurate 24h-ago price
                    ts_history = currency_price_history_timestamped.get(curr, [])
                    if ts_history:
                        price_24h = _find_price_24h_ago(ts_history)
                        cluster_prices_24h_ago[curr] = price_24h if price_24h is not None else (history[-2] if len(history) >= 2 else history[-1])
                    else:
                        # No timestamps available — fallback to second-to-last point
                        cluster_prices_24h_ago[curr] = history[-2] if len(history) >= 2 else history[-1]
                else:
                    cluster_prices_now[curr] = prices.get(curr, 0)
                    cluster_prices_24h_ago[curr] = prices.get(curr, 0)

            if len(cluster_price_histories) >= 3:
                cluster_labels_result = clusterer.fit(
                    cluster_price_histories, cluster_volumes,
                    cluster_prices_now, cluster_prices_24h_ago,
                )
                cluster_labels = {c.currency: c.cluster for c in clusterer.last_output.clusters}
                logger.info("Clustering completed: %d currencies assigned", len(cluster_labels))
                # Cache the result
                pipeline_cache.put("cluster_labels", cluster_labels)
            else:
                logger.warning(
                    "Only %d currencies for clustering (need >=3), using MODERATE default",
                    len(cluster_price_histories),
                )
    except Exception as e:
        logger.error("Clustering failed, using MODERATE default: %s", e)
        cluster_labels = {}

    # 7. Build reverse-rate lookup (kept for potential future use)
    rate_by_pair: dict[tuple[str, str], object] = {}
    for rk, rv in rates.items():
        rate_by_pair[(rv.currency_from, rv.currency_to)] = rv

    # 8. Score each pair as a flip opportunity
    opportunities: list[FlipOpportunity] = []

    import math as _math

    for key, rate in rates.items():
        # Fix: case-insensitive history lookup — snapshot keys are lowercase
        history = currency_price_history.get(rate.currency_from, [])
        if not history:
            history = currency_price_history.get(rate.currency_from.lower(), [])
        tracker = PriceMomentumTracker(window_size=24, history=history)
        for price in history:
            tracker.update(price)
        momentum_result = tracker.compute()

        mid_price = rate.raw_rate
        volume = float(rate.volume_traded)

        # --- Bid/ask computation ---
        #
        # BUG FIX (Iteration 4): The old model used forward/reverse rate gap
        # to estimate spread. But in POE2Scout, both forward and reverse rates
        # are derived from the same relative_price data, so:
        #   reverse_rate = c2_rel / c1_rel
        #   1 / reverse_rate = c1_rel / c2_rel = forward_rate
        # This means market_spread = 0 for ALL mirrored pairs.
        # The 0.5% floor was a band-aid producing unrealistically tight spreads.
        #
        # NEW MODEL: Realistic volume-based + volatility-based spread estimation.
        # In POE2's Currency Exchange, the bid-ask gap comes from:
        #   1. Order book depth — higher volume → tighter spread
        #   2. Volatility — uncertain prices → wider spread
        #   3. Market microstructure — POE2 has no market makers, so spreads
        #      are typically 2-10% (much wider than traditional markets)
        #
        # Volume-based spread: tighter for high-volume pairs
        #   log1p(100) ≈ 4.6, log1p(1000) ≈ 6.9, log1p(10000) ≈ 9.2
        #   At volume=1000:  0.05 / (1 + 6.9/8) = 0.05 / 1.86 ≈ 2.7%
        #   At volume=10000: 0.05 / (1 + 9.2/8) = 0.05 / 2.15 ≈ 2.3%
        #   At volume=100:   0.05 / (1 + 4.6/8) = 0.05 / 1.58 ≈ 3.2%
        if volume > 0:
            volume_spread = 0.05 / (1.0 + _math.log1p(volume) / 8.0)
        else:
            volume_spread = 0.08  # 8% for zero-volume pairs

        # Volatility contribution: volatile pairs have wider spreads
        # vol=0.01 → 0.5%, vol=0.05 → 2.5%, vol=0.10 → 5%
        vol_spread = momentum_result.volatility * 0.5

        # Base spread = volume component + volatility component
        market_spread = volume_spread + vol_spread

        # Apply realistic bounds:
        #   Minimum 1% — even the most liquid POE2 pairs have at least 1% spread
        #   Maximum 15% — beyond this the spread is too wide to be tradeable
        market_spread = max(0.01, min(0.15, market_spread))

        # Momentum contribution: trending pairs may have wider effective spread
        # because you can buy now and sell later at the expected price.
        # Multiplicative model with cap: momentum_factor ∈ [0, 0.5]
        # (at most 50% wider than base spread, not 100% which was too much)
        if len(history) >= 2 and momentum_result.momentum != 0:
            momentum_24h_raw = abs(_math.exp(momentum_result.momentum * 24) - 1)
        else:
            momentum_24h_raw = 0.0

        momentum_factor = min(momentum_24h_raw, 0.5)

        # Total effective spread = market spread amplified by momentum
        total_spread = market_spread * (1.0 + momentum_factor)

        # Re-apply cap after momentum amplification
        total_spread = min(total_spread, 0.20)

        bid = mid_price * (1 - total_spread / 2)
        ask = mid_price * (1 + total_spread / 2)

        logger.debug(
            "spread_model pair=%s volume=%.0f volume_spread=%.4f vol_spread=%.4f "
            "market_spread=%.4f momentum_factor=%.4f total_spread=%.4f bid=%.6f ask=%.6f mid=%.6f",
            rate.currency_from + "/" + rate.currency_to,
            volume, volume_spread, vol_spread,
            market_spread, momentum_factor,
            total_spread, bid, ask, mid_price,
        )

        score = compute_opportunity_score(
            bid=bid,
            ask=ask,
            mid_price=mid_price,
            volume_24h=float(rate.volume_traded),
            max_volume=float(max_volume),
            volatility=momentum_result.volatility,
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

        spread_value = (ask - bid) / mid_price if mid_price > 0 else 0.0

        opp = FlipOpportunity(
            currency=f"{rate.currency_from}/{rate.currency_to}",
            score=score,
            spread=spread_value,
            spread_after_fees=spread_value,  # backward compat alias (no fees deducted)
            volume_24h=float(rate.volume_traded),
            momentum=momentum_result.momentum,
            volatility=momentum_result.volatility,
            cluster=cluster,
            bid=bid,
            ask=ask,
            mid_price=mid_price,
        )

        if quick_filter(opp, phase_info.phase, config=config):
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
                "spread": round(o.spread, 6),
                "spread_after_fees": round(o.spread_after_fees, 6),  # backward compat
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
        # FIX: Gold fee warning — all scoring excludes gold fees, so displayed
        # profits may be lower or even negative after actual trade fees.
        # This warning informs the user that gold/commission costs are NOT
        # factored into the spread or score calculations.
        "fee_warning": {
            "gold_fees_excluded": True,
            "message": "Gold/commission fees are NOT included in spread or profit calculations. "
                       "Actual profit may be lower than shown. POE2 gold fees can be up to 24% "
                       "asymmetric, making many apparent arbitrage opportunities unprofitable after fees.",
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

    # Build prices in a consistent reference currency.
    prices = dict(snapshot.prices_in_base)  # shallow copy
    if "chaos" in prices and config.league.base_currency != "chaos":
        base_to_chaos = prices.get("chaos", 1.0)
        for k in list(prices.keys()):
            if k != "chaos":
                prices[k] = prices[k] * base_to_chaos

    pair_volumes: dict[tuple[str, str], float] = {}
    for key, rate in rates_dict.items():
        pair_volumes[(rate.currency_from, rate.currency_to)] = float(rate.volume_traded) if rate.volume_traded else 0.0

    opportunities = find_triangular_arbitrage(
        rates=rates_for_bf,
        prices=prices,
        min_profit_pct=min_profit_pct,
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
                "total_volume": o.total_volume,
                "confidence": round(o.confidence, 4),
            }
            for o in opportunities
        ],
        # FIX: Gold fee warning for triangular arbitrage
        "fee_warning": {
            "gold_fees_excluded": True,
            "message": "Gold/commission fees are NOT included in profit calculations. "
                       "Actual profit may be lower or even negative after fees.",
        },
        "data_available": True,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }
