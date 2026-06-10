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
import math as _math
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse

from backend.config import get_settings, AppConfig
from backend.data.pipeline_cache import get_pipeline_cache
from backend.api.shared import get_provider as _get_provider, get_phase_detector as _get_phase_detector
from backend.api.data_snapshot import get_snapshot
from backend.economy.momentum import PriceMomentumTracker
from backend.arbitrage.scorer import compute_opportunity_score, compute_quantized_analysis
from backend.arbitrage.quick_filter import quick_filter
from backend.arbitrage.triangular import find_triangular_arbitrage
from backend.predictors.clustering import CurrencyClusterer
from backend.models.currency import (
    ExchangeRate,
    FlipOpportunity,
    LeaguePhase,
    ClusterLabel,
)
from backend.economy.tiers import tier_penalty, tier_distance
from backend.economy.events import get_event_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/arbitrage", tags=["arbitrage"])

# Concurrency limiter for expensive endpoints — prevents OOM and CPU
# saturation when multiple clients hit /flips or /triangular simultaneously.
# With ProcessPoolExecutor, each concurrent request gets its own process,
# so we limit to avoid spawning too many worker processes.
_arbitrage_semaphore = asyncio.Semaphore(2)


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
# Helper: build flip opportunities from live data — CPU-bound sync function
# ---------------------------------------------------------------------------

def _build_flip_opportunities_sync(
    snapshot,
    config: AppConfig,
    phase_info,
    phase_multiplier: float,
    event_penalties: dict[str, float],
    cached_cluster_labels: dict[str, str] | None,
) -> list[FlipOpportunity]:
    """CPU-bound flip opportunity computation — runs in executor process.

    All data is pre-fetched by the async wrapper. This function receives only
    picklable data (no sqlite3.Connection or PipelineCache references) so it
    can safely run in ProcessPoolExecutor.

    Args:
        snapshot: DataSnapshot with exchange rates and price histories.
        config: Application configuration.
        phase_info: LeaguePhaseInfo from PhaseDetector.
        phase_multiplier: Float multiplier from PhaseDetector.
        event_penalties: Dict mapping currency_name → score_penalty (float).
            Pre-computed from EventManager to avoid passing the unpicklable
            EventManager (which holds sqlite3.Connection) into the executor.
            A penalty of 0.0 means "skip this currency entirely" (crisis event).
        cached_cluster_labels: Pre-fetched cluster labels from PipelineCache,
            or None if clustering needs to be computed fresh.

    Returns a sorted list of FlipOpportunity objects.
    """
    rates = snapshot.exchange_rates
    if not rates:
        return []

    # Build price history lookup from snapshot
    currency_price_history: dict[str, list[float]] = {}
    currency_price_history_timestamped: dict[str, list[tuple[datetime, float]]] = {}
    for api_id_lower, points in snapshot.price_histories.items():
        currency_price_history[api_id_lower] = [p.price for p in points]
        currency_price_history_timestamped[api_id_lower] = [(p.timestamp, p.price) for p in points]
    # Also store by original-case api_id
    for api_id_lower in list(snapshot.price_histories.keys()):
        curr = snapshot.get_currency(api_id_lower)
        if curr:
            orig_id = curr.get("api_id", "")
            if orig_id and orig_id != api_id_lower and api_id_lower in currency_price_history:
                currency_price_history[orig_id] = currency_price_history[api_id_lower]
                currency_price_history_timestamped[orig_id] = currency_price_history_timestamped.get(api_id_lower, [])

    # Compute max volume for fill probability normalization
    max_volume = max(
        (r.volume_traded for r in rates.values() if r.volume_traded > 0),
        default=1,
    )

    # Build price mapping
    prices = dict(snapshot.prices_in_base)
    if "chaos" in prices and config.league.base_currency != "chaos":
        chaos_in_base = prices.get("chaos", 0)
        if chaos_in_base and chaos_in_base > 0:
            base_to_chaos = 1.0 / chaos_in_base
            for k in list(prices.keys()):
                if k != "chaos":
                    prices[k] = prices[k] * base_to_chaos
    prices["chaos"] = 1.0
    prices["Chaos Orb"] = 1.0

    # Currency clustering (cached)
    clusterer = CurrencyClusterer(config)
    cluster_labels: dict[str, ClusterLabel] = {}

    try:
        # Use pre-fetched cluster labels from PipelineCache (passed via
        # cached_cluster_labels to avoid passing PipelineCache itself into
        # the executor, which would fail with "cannot pickle sqlite3.Connection")
        if cached_cluster_labels is not None:
            cluster_labels = {k: ClusterLabel(v) for k, v in cached_cluster_labels.items()}
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
                    ts_history = currency_price_history_timestamped.get(curr, [])
                    if ts_history:
                        price_24h = _find_price_24h_ago(ts_history)
                        cluster_prices_24h_ago[curr] = price_24h if price_24h is not None else (history[-2] if len(history) >= 2 else history[-1])
                    else:
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
                # Note: cannot cache to PipelineCache here — we're inside
                # ProcessPoolExecutor and PipelineCache is not available.
                # Caching happens in the async wrapper after executor returns.
            else:
                logger.warning(
                    "Only %d currencies for clustering (need >=3), using MODERATE default",
                    len(cluster_price_histories),
                )
    except Exception as e:
        logger.error("Clustering failed, using MODERATE default: %s", e)
        cluster_labels = {}

    # Score each pair
    opportunities: list[FlipOpportunity] = []
    _momentum_cache: dict[str, object] = {}

    def _get_momentum(currency: str):
        if currency in _momentum_cache:
            return _momentum_cache[currency]
        history = currency_price_history.get(currency, [])
        if not history:
            history = currency_price_history.get(currency.lower(), [])
        tracker = PriceMomentumTracker(window_size=24, history=history)
        for price in history:
            tracker.update(price)
        result = tracker.compute()
        _momentum_cache[currency] = result
        return result

    # BFS detection
    _currencies_with_direct_base: set[str] = set()
    for _rk, _rv in rates.items():
        if _rv.currency_to == config.league.base_currency:
            _currencies_with_direct_base.add(_rv.currency_from)
        elif _rv.currency_from == config.league.base_currency:
            _currencies_with_direct_base.add(_rv.currency_to)

    for key, rate in rates.items():
        momentum_result = _get_momentum(rate.currency_from)
        mid_price = rate.raw_rate
        volume = float(rate.volume_traded)
        highest_stock = rate.highest_stock

        # Spread model
        if volume > 0 and highest_stock > 0:
            liquidity_score = _math.log1p(volume) * _math.log1p(highest_stock)
            liquidity_spread = 0.04 / (1.0 + liquidity_score / 40.0)
        elif volume > 0:
            liquidity_spread = 0.05 / (1.0 + _math.log1p(volume) / 8.0)
        else:
            liquidity_spread = 0.08

        vol_spread = momentum_result.volatility * 0.5
        market_spread = liquidity_spread + vol_spread

        is_bfs_pair = (
            rate.currency_from not in _currencies_with_direct_base
            and rate.currency_to not in _currencies_with_direct_base
        )
        bfs_widening = 1.5 if is_bfs_pair else 1.0
        market_spread *= bfs_widening
        market_spread = max(0.005, min(0.15, market_spread))

        momentum_24h_raw = 0.0
        history = currency_price_history.get(rate.currency_from, [])
        if len(history) >= 2 and momentum_result.momentum != 0:
            momentum_24h_raw = abs(_math.exp(momentum_result.momentum * 24) - 1)

        momentum_factor = min(momentum_24h_raw, 0.5)
        total_spread = market_spread * (1.0 + momentum_factor)
        total_spread = min(total_spread, 0.20)

        bid = mid_price * (1 - total_spread / 2)
        ask = mid_price * (1 + total_spread / 2)

        data_age_seconds = (
            (datetime.now(timezone.utc) - rate.timestamp).total_seconds()
            if rate.timestamp else None
        )
        is_stale = data_age_seconds is not None and data_age_seconds > config.data.cache_ttl_prices_minutes * 60

        score = compute_opportunity_score(
            bid=bid, ask=ask, mid_price=mid_price,
            volume_24h=float(rate.volume_traded), max_volume=float(max_volume),
            volatility=momentum_result.volatility, phase_multiplier=phase_multiplier,
            momentum=momentum_result.momentum,
            momentum_neg_threshold=config.scoring.momentum_negative_threshold,
            vol_reference=config.scoring.volatility_reference,
            volatility_period="hourly",
        )

        # Event penalties — use pre-computed dict instead of event_manager
        # (event_manager holds sqlite3.Connection and can't be pickled for
        # ProcessPoolExecutor)
        event_penalty = event_penalties.get(rate.currency_from, 1.0)
        if event_penalty == 0.0:
            continue
        score = score * event_penalty
        score = min(max(score, 0.0), 1.0)

        event_penalty_to = event_penalties.get(rate.currency_to, 1.0)
        if event_penalty_to == 0.0:
            continue
        score = score * event_penalty_to
        score = min(max(score, 0.0), 1.0)

        currency_key = rate.currency_from
        cluster = cluster_labels.get(currency_key, ClusterLabel.MODERATE)
        spread_value = (ask - bid) / mid_price if mid_price > 0 else 0.0

        quantized = compute_quantized_analysis(
            R_buy=bid if mid_price > 0 else 0,
            R_sell=ask if mid_price > 0 else 0,
            mid_price=mid_price if mid_price > 0 else 1.0,
            lot_sizes=config.quantization.default_lot_sizes,
            max_lot_search=config.quantization.max_lot_search,
        )

        # Tier penalty
        t_penalty = 1.0
        t_distance = 0
        if snapshot.tiers:
            tier_a = snapshot.tiers.get(rate.currency_from)
            tier_b = snapshot.tiers.get(rate.currency_to)
            if tier_a and tier_b:
                t_penalty = tier_penalty(tier_a.tier, tier_b.tier)
                t_distance = tier_distance(tier_a.tier, tier_b.tier)
                score = score * t_penalty
                score = min(max(score, 0.0), 1.0)

        net_spread = spread_value
        net_profit_pct = net_spread * 100 if mid_price > 0 else 0.0

        opp = FlipOpportunity(
            currency=f"{rate.currency_from}/{rate.currency_to}",
            score=score, spread=spread_value,
            spread_after_fees=net_spread,
            volume_24h=float(rate.volume_traded),
            momentum=momentum_result.momentum,
            volatility=momentum_result.volatility,
            cluster=cluster, bid=bid, ask=ask, mid_price=mid_price,
            quantized_analysis=quantized, tier_distance=t_distance,
        )

        if is_stale:
            logger.info("Skipping stale opportunity %s (data_age=%.0fs > TTL=%ds)",
                        opp.currency, data_age_seconds or 0,
                        config.data.cache_ttl_prices_minutes * 60)
            continue

        if net_profit_pct <= 0:
            continue

        if quick_filter(opp, phase_info.phase, config=config):
            opportunities.append(opp)

    opportunities.sort(key=lambda o: o.score, reverse=True)
    return opportunities


# ---------------------------------------------------------------------------
# Async wrapper — fetches data, then offloads computation to executor
# ---------------------------------------------------------------------------

async def _build_flip_opportunities(config: AppConfig) -> list[FlipOpportunity]:
    """Fetch live data and compute scored flip opportunities.

    OPTIMIZATION: Uses DataSnapshot instead of making N individual
    get_historical_prices() calls. The snapshot already contains
    price histories from the ByCategory response.

    PERFORMANCE: CPU-bound computation (clustering, scoring, filtering)
    is offloaded to ProcessPoolExecutor via loop.run_in_executor() to
    bypass the GIL. This prevents health check timeouts and circuit
    breaker cascade failures during heavy computation.

    PICKLE SAFETY: Only picklable data is passed to the executor.
    EventManager and PipelineCache hold sqlite3.Connection references
    that cannot be pickled — so we pre-extract the needed data
    (event_penalties dict, cached_cluster_labels dict) before calling
    the executor.
    """
    detector = _get_phase_detector()
    pipeline_cache = get_pipeline_cache()

    # 1. Fetch snapshot (async — the only await in this function)
    snapshot = await get_snapshot()

    # 2. Pre-fetch all data needed by the sync function
    phase_info = detector.get_phase_info()
    phase_multiplier = detector.get_phase_multiplier()
    event_manager = get_event_manager(config)

    # 3. Pre-extract picklable data from unpicklable objects.
    # EventManager holds sqlite3.Connection → can't be pickled for
    # ProcessPoolExecutor. Extract event penalties as a plain dict.
    event_penalties: dict[str, float] = {}
    try:
        # Collect all currency names from snapshot rates
        for key, rate in snapshot.exchange_rates.items():
            for curr in (rate.currency_from, rate.currency_to):
                if curr not in event_penalties:
                    event_penalties[curr] = event_manager.get_event_score_penalty(curr)
    except Exception as e:
        logger.warning("Failed to pre-extract event penalties: %s", e)
        # Default: all currencies get penalty 1.0 (no penalty)
        event_penalties = {}

    # Pre-extract cached cluster labels from PipelineCache.
    # PipelineCache may hold references to sqlite3.Connection, so we
    # extract the data as a plain dict before passing to executor.
    cached_cluster_labels: dict[str, str] | None = None
    try:
        cached_clustering = pipeline_cache.get("arbitrage_cluster_labels")
        if cached_clustering is not None and not cached_clustering.stale:
            # Convert ClusterLabel enums to plain strings for pickling
            cached_cluster_labels = {
                k: v.value if hasattr(v, 'value') else str(v)
                for k, v in cached_clustering.value.items()
            }
    except Exception as e:
        logger.warning("Failed to pre-extract cluster labels: %s", e)

    # 4. Offload CPU-bound computation to ProcessPoolExecutor for GIL bypass.
    # Falls back to default ThreadPoolExecutor if process_pool is unavailable.
    loop = asyncio.get_running_loop()
    executor = None
    try:
        from backend.main import process_pool
        executor = process_pool
    except (ImportError, AttributeError):
        pass

    # Timeout for flip computation (seconds). Clustering + scoring for 600+
    # currencies typically takes 5-15s. If executor hangs (sklearn deadlock),
    # the timeout prevents indefinite blocking.
    try:
        opportunities = await asyncio.wait_for(
            loop.run_in_executor(
                executor,
                _build_flip_opportunities_sync,
                snapshot, config, phase_info, phase_multiplier,
                event_penalties, cached_cluster_labels,
            ),
            timeout=60.0,
        )
    except asyncio.TimeoutError:
        logger.error("Flip computation timed out after 60s — returning empty result")
        return []

    # 5. Cache clustering result back to PipelineCache (only if computed fresh)
    # The sync function may have computed new cluster_labels. We can't cache
    # inside the executor (no PipelineCache access), but the price_cluster_labels
    # cache in routes_prices.py covers this.

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

    # P0-1: Check if snapshot data is available before processing.
    # Return 200 with data_available=false instead of 503 so the frontend
    # can show a graceful fallback UI instead of an error.
    from backend.api.data_snapshot import get_snapshot_manager
    snapshot_mgr = get_snapshot_manager()
    if snapshot_mgr.last_snapshot is None:
        return {
            "league": config.league.league_name,
            "total": 0,
            "opportunities": [],
            "data_available": False,
            "message": "Snapshot is being collected. Try again in a few seconds.",
            "event_status": {
                "any_active": False,
                "affected_currencies": [],
                "summary": "",
            },
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }

    event_manager = get_event_manager(config)
    pipeline_cache = get_pipeline_cache()

    cached = pipeline_cache.get("flip_opportunities")
    if cached is not None and not cached.stale:
        opportunities = cached.value
    else:
        try:
            async with _arbitrage_semaphore:
                opportunities = await _build_flip_opportunities(config)
            pipeline_cache.put("flip_opportunities", opportunities)
        except HTTPException:
            raise
        except Exception as e:
            logger.warning("Failed to recompute flip_opportunities: %s", e)
            if cached is not None:
                logger.info("Returning stale cache for flip_opportunities")
                opportunities = cached.value
            else:
                # Return empty result instead of 500 — the frontend can handle
                # data_available: false gracefully
                logger.error("No cache available for flip_opportunities, returning empty: %s", e)
                opportunities = []

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
                # Step 4: Data freshness indicator for each opportunity
                "data_source": "snapshot_pairs",  # indicates data comes from real SnapshotPair data
                "quantized_analysis": {
                    "q_spreads": {
                        str(k): {
                            "lot_size": v.lot_size,
                            "actual_cost": v.actual_cost,
                            "actual_revenue": v.actual_revenue,
                            "net_profit": v.net_profit,
                            "gross_profit_pct": round(v.gross_profit_pct, 4),
                            "q_spread": round(v.q_spread, 6),
                        }
                        for k, v in o.quantized_analysis.q_spreads.items()
                    },
                    "min_profitable_lot": o.quantized_analysis.min_profitable_lot,
                    "optimal_lot_profit_pct": round(o.quantized_analysis.optimal_lot_profit_pct, 4),
                    "recommended_ratio": list(o.quantized_analysis.recommended_ratio),
                    "brick_resistance": round(o.quantized_analysis.brick_resistance, 4),
                    "theoretical_spread": round(o.quantized_analysis.theoretical_spread, 6),
                } if o.quantized_analysis else None,
                "tier_distance": o.tier_distance,
            }
            for o in filtered
        ],
        "event_status": {
            "any_active": event_manager.is_event_active(),
            "affected_currencies": list(event_manager.get_affected_currencies()),
            "summary": event_manager.get_active_event_summary(),
        },
        # Step 4: Data freshness metadata
        "data_freshness": {
            "source": "snapshot_pairs",
            "spread_model": "liquidity_volatility",
            "bfs_widening": 1.5,
            "stale_data_filtered": True,
            "min_spread_basis_points": 50,  # 0.5%
        },
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/triangular")
async def get_triangular_arbitrage(
    min_profit_pct: float = Query(1.0, ge=0.0, description="Min profit % to report"),
):
    """Return detected triangular arbitrage cycles.

    Uses DataSnapshot for exchange rates instead of independent API call.
    """
    config = get_settings()

    # P0-1: Check if snapshot data is available before processing.
    # Return 200 with data_available=false instead of 503 so the frontend
    # can show a graceful fallback UI instead of an error.
    from backend.api.data_snapshot import get_snapshot_manager
    snapshot_mgr = get_snapshot_manager()
    if snapshot_mgr.last_snapshot is None:
        return {
            "league": config.league.league_name,
            "total": 0,
            "opportunities": [],
            "data_available": False,
            "message": "Snapshot is being collected. Try again in a few seconds.",
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }

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
        # Same conversion as in _build_flip_opportunities: invert chaos price
        chaos_in_base = prices.get("chaos", 0)
        if chaos_in_base and chaos_in_base > 0:
            base_to_chaos = 1.0 / chaos_in_base
            for k in list(prices.keys()):
                if k != "chaos":
                    prices[k] = prices[k] * base_to_chaos

    # Step 1.4: Fix chaos price
    prices["chaos"] = 1.0
    prices["Chaos Orb"] = 1.0

    pair_volumes: dict[tuple[str, str], float] = {}
    for key, rate in rates_dict.items():
        pair_volumes[(rate.currency_from, rate.currency_to)] = float(rate.volume_traded) if rate.volume_traded else 0.0

    # PERFORMANCE FIX: Cache triangular arbitrage results in pipeline_cache
    # to avoid recomputing O(n³) cross-rate validation on every request.
    # The cache TTL matches the snapshot TTL — results are refreshed when
    # new snapshot data arrives.
    pipeline_cache = get_pipeline_cache()
    cache_key = f"triangular_arbitrage_{min_profit_pct}"
    cached_tri = pipeline_cache.get(cache_key)
    if cached_tri is not None and not cached_tri.stale:
        opportunities = cached_tri.value[0]
        cross_rate_warning = cached_tri.value[1]
    else:
        async with _arbitrage_semaphore:
            result = await find_triangular_arbitrage(
            rates=rates_for_bf,
            prices=prices,
            min_profit_pct=min_profit_pct,
            pair_volumes=pair_volumes,
            snapshot_time=datetime.now(timezone.utc),
            cross_rate_threshold_pct=10.0,
        )
        opportunities = result.opportunities
        suspicious_triples = result.suspicious_triples

        cross_rate_warning = None
        if suspicious_triples:
            affected_currencies = set()
            for triple in suspicious_triples:
                affected_currencies.update(triple)
            cross_rate_warning = {
                "suspicious_triples_count": len(suspicious_triples),
                "affected_currencies": sorted(affected_currencies),
                "message": (
                    f"{len(suspicious_triples)} currency triples have >10% "
                    "cross-rate divergence (implied vs direct rates). "
                    "Some detected cycles may be false positives from "
                    "inconsistent relative_price data between pairs."
                ),
            }

        # Cache the result: store (opportunities, cross_rate_warning) tuple
        pipeline_cache.put(cache_key, (opportunities, cross_rate_warning))

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
                "min_starting_amount": o.min_starting_amount,
                "quantized_profit_pct": round(o.quantized_profit_pct, 4),
                "continuous_profit_pct": round(o.continuous_profit_pct, 4),
                "integer_simulation": o.integer_simulation,
            }
            for o in opportunities
        ],
        "cross_rate_warning": cross_rate_warning,
        "data_available": True,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }


# ---------------------------------------------------------------------------
# §11: Cross-Currency Optimal Payment & Cross-Rate Flip Detection
# ---------------------------------------------------------------------------

# Anchor currency hierarchy (§11.1): highest value first
ANCHOR_CURRENCIES = ["mirror", "divine", "exalted", "chaos"]


def _select_anchor(prices_in_base: dict[str, float]) -> str:
    """Select the best available anchor currency from prices_in_base.

    §11.1: Prefers Mirror > Divine > Exalted > Chaos.
    Returns the apiId of the anchor, or "exalted" as ultimate fallback.
    """
    for anchor in ANCHOR_CURRENCIES:
        price = prices_in_base.get(anchor)
        if price is not None and price > 0:
            return anchor
    return "exalted"


def _effective_anchor_price(
    price_in_currency: float,
    currency_rel_price: float,
    anchor_rel_price: float,
) -> float:
    """§11.2: effective_anchor_price(C) = P_C * (relativePrice_C / relativePrice_anchor)"""
    if anchor_rel_price <= 0 or currency_rel_price <= 0:
        return float("inf")
    rate_to_anchor = currency_rel_price / anchor_rel_price
    return price_in_currency * rate_to_anchor


def _find_optimal_payment(
    pricing_options: list[dict],
    anchor_rel_price: float,
) -> dict | None:
    """§11.4: Find the cheapest payment currency for an item priced in multiple currencies.

    Args:
        pricing_options: List of dicts with keys:
            currency_id, currency_name, price_in_currency, relative_price
        anchor_rel_price: relativePrice of the anchor currency in base currency

    Returns:
        Dict with optimal payment result, or None if <2 valid options.
    """
    if len(pricing_options) < 2:
        return None

    # Compute effective anchor price for each option
    options = []
    for opt in pricing_options:
        eff_price = _effective_anchor_price(
            opt["price_in_currency"],
            opt["relative_price"],
            anchor_rel_price,
        )
        if eff_price != float("inf") and eff_price > 0 and _math.isfinite(eff_price):
            options.append({
                "currency_id": opt["currency_id"],
                "currency_name": opt["currency_name"],
                "price_in_currency": opt["price_in_currency"],
                "effective_anchor_price": eff_price,
                "premium_pct": 0.0,
            })

    if len(options) < 2:
        return None

    # Sort by effective anchor price ascending (cheapest first)
    options.sort(key=lambda o: o["effective_anchor_price"])

    best = options[0]
    worst = options[-1]

    # Compute premium for each option relative to the cheapest
    for opt in options:
        opt["premium_pct"] = (
            ((opt["effective_anchor_price"] - best["effective_anchor_price"])
             / best["effective_anchor_price"] * 100)
            if best["effective_anchor_price"] > 0
            else 0.0
        )

    savings_anchor = worst["effective_anchor_price"] - best["effective_anchor_price"]
    savings_pct = (
        (savings_anchor / worst["effective_anchor_price"] * 100)
        if worst["effective_anchor_price"] > 0
        else 0.0
    )

    return {
        "best_currency_id": best["currency_id"],
        "worst_currency_id": worst["currency_id"],
        "best_anchor_price": round(best["effective_anchor_price"], 8),
        "worst_anchor_price": round(worst["effective_anchor_price"], 8),
        "savings_anchor": round(savings_anchor, 8),
        "savings_pct": round(savings_pct, 2),
        "options": [
            {
                "currency_id": o["currency_id"],
                "currency_name": o["currency_name"],
                "price_in_currency": round(o["price_in_currency"], 6),
                "effective_anchor_price": round(o["effective_anchor_price"], 8),
                "premium_pct": round(o["premium_pct"], 2),
            }
            for o in options
        ],
    }


def _detect_cross_rate_flips(
    rates: dict[str, ExchangeRate],
    prices_in_base: dict[str, float],
    threshold_pct: float = 5.0,
    min_volume: int = 10,
) -> list[dict]:
    """§11.5: Detect cross-rate flip opportunities from exchange rates.

    Compares the market rate between two currencies with the "fair" rate
    implied by their prices in the base currency.

    Returns list of cross-rate flip dicts, sorted by estimated profit descending.
    """
    results: list[dict] = []

    for key, rate in rates.items():
        c1_price = prices_in_base.get(rate.currency_from)
        c2_price = prices_in_base.get(rate.currency_to)

        if c1_price is None or c2_price is None or c1_price <= 0 or c2_price <= 0:
            continue
        if rate.volume_traded < min_volume:
            continue
        if rate.raw_rate <= 0:
            continue

        # Fair cross-rate: how many c2 per 1 c1
        fair_rate = c1_price / c2_price

        # Market rate (from the pair's raw_rate — already cross-rate)
        market_rate = rate.raw_rate

        # Deviation
        if fair_rate <= 0:
            continue
        deviation_pct = ((market_rate - fair_rate) / fair_rate) * 100

        if abs(deviation_pct) >= threshold_pct:
            direction = "buy_sell_with_buy" if deviation_pct < 0 else "buy_buy_with_sell"
            estimated_profit_pct = abs(deviation_pct)

            results.append({
                "buy_currency_id": rate.currency_from if deviation_pct < 0 else rate.currency_to,
                "sell_currency_id": rate.currency_to if deviation_pct < 0 else rate.currency_from,
                "fair_rate": round(fair_rate, 8),
                "market_rate": round(market_rate, 8),
                "deviation_pct": round(deviation_pct, 2),
                "direction": direction,
                "estimated_profit_pct": round(estimated_profit_pct, 2),
                "volume": rate.volume_traded,
            })

    # Sort by estimated profit descending
    results.sort(key=lambda r: r["estimated_profit_pct"], reverse=True)
    return results[:50]


@router.get("/optimal-currency")
async def get_optimal_currency(
    threshold_pct: float = Query(5.0, ge=0.1, le=50.0, description="Cross-rate flip threshold %"),
    min_volume: int = Query(10, ge=0, description="Min volume for cross-rate flip detection"),
):
    """§11: Cross-currency optimal payment analysis and cross-rate flip detection.

    Computes:
    - optimalPaymentByPair: For each currency with 2+ payment options,
      which currency is cheapest and how much you save.
    - crossRateFlips: Pairs where market rate deviates from fair rate
      (implied by prices_in_base) by more than threshold_pct.
    - anchorId: The selected anchor currency for price normalization.

    This mirrors the client-side logic in currency-optimal.ts but runs
    server-side for better performance with large datasets.
    """
    config = get_settings()

    from backend.api.data_snapshot import get_snapshot_manager
    snapshot_mgr = get_snapshot_manager()
    if snapshot_mgr.last_snapshot is None:
        return {
            "league": config.league.league_name,
            "anchor_id": "exalted",
            "optimal_payment_by_pair": {},
            "cross_rate_flips": [],
            "data_available": False,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }

    snapshot = await get_snapshot()
    rates = snapshot.exchange_rates
    if not rates:
        return {
            "league": config.league.league_name,
            "anchor_id": "exalted",
            "optimal_payment_by_pair": {},
            "cross_rate_flips": [],
            "data_available": False,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }

    prices = dict(snapshot.prices_in_base)

    # Select anchor currency
    anchor = _select_anchor(prices)
    anchor_rel_price = prices.get(anchor, 1.0)

    # Build metadata lookup for currency display names
    # Key: api_id (lowercase) -> display text
    currency_names: dict[str, str] = {}
    currency_categories: dict[str, str] = {}  # api_id (lowercase) → category_api_id
    for meta in snapshot.currency_metadata:
        currency_names[meta.api_id.lower()] = meta.text
        currency_categories[meta.api_id.lower()] = meta.category_api_id

    # Group exchange rates by currency_from — each group is one "item"
    # priced in multiple currencies (currency_to is the payment currency).
    groups: dict[str, list[ExchangeRate]] = {}
    for key, rate in rates.items():
        existing = groups.get(rate.currency_from)
        if existing is not None:
            existing.append(rate)
        else:
            groups[rate.currency_from] = [rate]

    # For each group with 2+ pricing options, compute optimal payment
    optimal_by_pair: dict[str, dict] = {}
    for from_id, group_rates in groups.items():
        if len(group_rates) < 2:
            continue

        # Build pricing options from each rate in the group
        pricing_options = []
        for rate in group_rates:
            c2_price = prices.get(rate.currency_to)
            if c2_price is None or c2_price <= 0:
                continue
            # Cross-rate: how many currency_to per 1 currency_from
            c1_price = prices.get(rate.currency_from)
            if c1_price is None or c1_price <= 0:
                continue
            price_in_currency = c1_price / c2_price if c2_price > 0 else 0

            if price_in_currency <= 0:
                continue

            currency_name = currency_names.get(rate.currency_to.lower(), rate.currency_to)

            pricing_options.append({
                "currency_id": rate.currency_to,
                "currency_name": currency_name,
                "price_in_currency": price_in_currency,
                "relative_price": c2_price,
            })

        result = _find_optimal_payment(pricing_options, anchor_rel_price)
        if result is not None:
            # Map result back to each rate's pair key for frontend lookup
            for rate in group_rates:
                pair_key = f"{rate.currency_from}_{rate.currency_to}"
                optimal_by_pair[pair_key] = result

    # Section 11 extension: Item-aware optimal payment.
    # For craft items (Omens, Soul Cores), the currency_from is an item
    # (not a pure currency). Group pairs where currency_from belongs to
    # an item category, then for each item find the cheapest payment currency.
    item_categories = set(config.league.item_categories)
    item_groups: dict[str, list] = {}
    for key, rate in rates.items():
        cat = currency_categories.get(rate.currency_from.lower(), "")
        if cat in item_categories:
            existing = item_groups.get(rate.currency_from)
            if existing is not None:
                existing.append(rate)
            else:
                item_groups[rate.currency_from] = [rate]

    for item_id, item_rates in item_groups.items():
        if len(item_rates) < 2:
            continue

        pricing_options = []
        for rate in item_rates:
            c2_price = prices.get(rate.currency_to)
            if c2_price is None or c2_price <= 0:
                continue
            c1_price = prices.get(rate.currency_from)
            if c1_price is None or c1_price <= 0:
                continue
            price_in_currency = c1_price / c2_price if c2_price > 0 else 0
            if price_in_currency <= 0:
                continue
            currency_name = currency_names.get(rate.currency_to.lower(), rate.currency_to)
            pricing_options.append({
                "currency_id": rate.currency_to,
                "currency_name": currency_name,
                "price_in_currency": price_in_currency,
                "relative_price": c2_price,
            })

        result = _find_optimal_payment(pricing_options, anchor_rel_price)
        if result is not None:
            for rate in item_rates:
                pair_key = f"{rate.currency_from}_{rate.currency_to}"
                optimal_by_pair[pair_key] = result

    # Detect cross-rate flips
    cross_rate_flips = _detect_cross_rate_flips(rates, prices, threshold_pct, min_volume)

    return {
        "league": config.league.league_name,
        "anchor_id": anchor,
        "optimal_payment_by_pair": optimal_by_pair,
        "cross_rate_flips": cross_rate_flips,
        "data_available": True,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }
