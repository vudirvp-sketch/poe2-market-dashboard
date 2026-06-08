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
# Gold fee imports removed — gold is excluded from all calculations.
# Gold is a consumable in PoE2 with no real trade value for small-scale flippers.
from backend.arbitrage.scorer import compute_opportunity_score, compute_quantized_analysis
from backend.arbitrage.quick_filter import quick_filter
from backend.arbitrage.triangular import find_triangular_arbitrage
from backend.predictors.clustering import CurrencyClusterer
from backend.models.currency import (
    FlipOpportunity,
    LeaguePhase,
    ClusterLabel,
)
from backend.economy.tiers import tier_penalty, tier_distance
from backend.economy.events import get_event_manager

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
    pipeline_cache = get_pipeline_cache()

    # 1. Use DataSnapshot instead of N+1 API calls
    snapshot = await get_snapshot()

    rates = snapshot.exchange_rates
    if not rates:
        return []

    # Gold fees are permanently excluded from all flipper calculations.
    # Gold is a consumable in PoE2 with no real trade value for small-scale flippers.
    event_manager = get_event_manager(config)

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
    # Bug 26 fix: Use PhaseDetector.get_phase_multiplier() which accounts for
    # LeagueType (standard/flashback/event). Previously, scorer.get_phase_multiplier()
    # was used which only considered EARLY/MID/LATE, making the LeagueType multiplier
    # (flashback=1.5, event=2.0) dead code.
    phase_multiplier = detector.get_phase_multiplier()

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
        # prices["chaos"] is the price of 1 chaos in base_currency (e.g. 0.1 exalted)
        # To convert from exalted-based to chaos-based, multiply by (1 / chaos_price)
        # i.e. exalted_to_chaos = 1 / prices["chaos"]
        chaos_in_base = prices.get("chaos", 0)
        if chaos_in_base and chaos_in_base > 0:
            base_to_chaos = 1.0 / chaos_in_base
            for k in list(prices.keys()):
                if k != "chaos":
                    prices[k] = prices[k] * base_to_chaos

    # Step 1.4: Explicitly set chaos price to 1.0
    # Chaos Orb = 1.0 Chaos by definition. POE2Scout's model may return
    # slightly off values (0.98 or 1.02) due to modeling noise.
    prices["chaos"] = 1.0
    prices["Chaos Orb"] = 1.0

    # 6. Run currency clustering
    # FIX: Cache clustering result with pipeline_cache instead of recreating
    # CurrencyClusterer on every request. KMeans with n_init=10 means ~10
    # KMeans runs per call, which is expensive. Cache with same TTL as snapshot.
    clusterer = CurrencyClusterer(config)
    cluster_labels: dict[str, ClusterLabel] = {}

    try:
        cached_clustering = pipeline_cache.get("arbitrage_cluster_labels")
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
                pipeline_cache.put("arbitrage_cluster_labels", cluster_labels)
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

    # Cache momentum results per currency to avoid recomputing the same
    # currency's momentum N times (once per pair it appears in)
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

    # Step 4: Identify direct vs BFS-computed pairs for spread widening.
    # All keys in snapshot.exchange_rates come directly from the
    # SnapshotPairs API — they are never BFS-generated.  However, a pair
    # is "BFS-computed" when either of its currencies does NOT appear as
    # CurrencyOne in any SnapshotPair with the base currency (meaning its
    # price_in_base was derived transitively rather than from a direct
    # observation).  We track those currencies to widen their spread.
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
        stock_value = rate.stock_value

        # --- Step 4: Real bid/ask from SnapshotPair data ---
        #
        # PREVIOUS MODEL (synthetic): 0.05 / (1 + log1p(volume) / 8) + volatility * 0.5
        # This produced plausible-looking but fabricated spreads. All derived
        # numbers were estimates, not grounded in actual trade data.
        #
        # NEW MODEL: Spread estimation anchored in real SnapshotPair fields:
        #   - RelativePrice → mid_price (already used as raw_rate)
        #   - VolumeTraded → volume (already used)
        #   - HighestStock → order book depth indicator
        #   - StockValue → total available inventory value
        #   - price_histories → momentum/volatility (already computed)
        #
        # The spread model now uses stock depth as a liquidity proxy:
        #   Deep order book (high HighestStock) → tighter spread
        #   Shallow order book → wider spread
        # This is closer to how real exchange bid/ask spreads behave.

        # --- Liquidity-based spread component ---
        # Use HighestStock as the primary liquidity indicator.
        # Higher stock = more listed inventory = tighter spread.
        # Typical range: 1–10000 units.
        # We use log1p for smooth compression and combine with volume.
        if volume > 0 and highest_stock > 0:
            # Combined liquidity score from volume AND stock depth
            # Both contribute: high-volume + deep-book → tightest spread
            liquidity_score = _math.log1p(volume) * _math.log1p(highest_stock)
            liquidity_spread = 0.04 / (1.0 + liquidity_score / 40.0)
        elif volume > 0:
            # Has volume but no stock data — use volume-only model
            liquidity_spread = 0.05 / (1.0 + _math.log1p(volume) / 8.0)
        else:
            # Zero volume pair — widest spread
            liquidity_spread = 0.08

        # --- Volatility contribution ---
        # vol=0.01 → 0.5%, vol=0.05 → 2.5%, vol=0.10 → 5%
        vol_spread = momentum_result.volatility * 0.5

        # --- Base spread ---
        market_spread = liquidity_spread + vol_spread

        # --- Step 4: BFS fallback widening ---
        # If neither currency in this pair has a direct SnapshotPair with the
        # base currency, the mid_price was effectively computed via a
        # transitive path (BFS).  Widen the spread by 50% to account for
        # path-length uncertainty.
        is_bfs_pair = (
            rate.currency_from not in _currencies_with_direct_base
            and rate.currency_to not in _currencies_with_direct_base
        )
        bfs_widening = 1.5 if is_bfs_pair else 1.0
        market_spread *= bfs_widening

        # Apply realistic bounds:
        #   Minimum 0.5% — highly liquid pairs with direct data
        #   Maximum 15% — beyond this the spread is too wide to be tradeable
        market_spread = max(0.005, min(0.15, market_spread))

        # --- Momentum amplification ---
        # Trending pairs may have wider effective spread because the
        # midpoint is less reliable. Capped at 50% wider.
        momentum_24h_raw = 0.0
        history = currency_price_history.get(rate.currency_from, [])
        if len(history) >= 2 and momentum_result.momentum != 0:
            momentum_24h_raw = abs(_math.exp(momentum_result.momentum * 24) - 1)

        momentum_factor = min(momentum_24h_raw, 0.5)
        total_spread = market_spread * (1.0 + momentum_factor)
        total_spread = min(total_spread, 0.20)  # hard cap at 20%

        # --- Derive bid/ask from mid_price and total_spread ---
        bid = mid_price * (1 - total_spread / 2)
        ask = mid_price * (1 + total_spread / 2)

        # --- Step 4: Data freshness indicator ---
        # The timestamp on the ExchangeRate tells us when the SnapshotPair
        # data was last fetched. Stale data (older than TTL) should be
        # flagged. The snapshot TTL is configured in config.yaml
        # (cache_ttl_prices_minutes, default 5 min).
        data_age_seconds = (
            (datetime.now(timezone.utc) - rate.timestamp).total_seconds()
            if rate.timestamp else None
        )
        is_stale = data_age_seconds is not None and data_age_seconds > config.data.cache_ttl_prices_minutes * 60

        logger.debug(
            "spread_model pair=%s volume=%.0f highest_stock=%d vol=%.4f "
            "liq_spread=%.4f vol_spread=%.4f market_spread=%.4f bfs=%s "
            "momentum_factor=%.4f total_spread=%.4f bid=%.6f ask=%.6f mid=%.6f "
            "data_age=%s stale=%s",
            rate.currency_from + "/" + rate.currency_to,
            volume, highest_stock, momentum_result.volatility,
            liquidity_spread, vol_spread, market_spread,
            "yes" if is_bfs_pair else "no",
            momentum_factor, total_spread, bid, ask, mid_price,
            f"{data_age_seconds:.0f}s" if data_age_seconds else "N/A",
            "yes" if is_stale else "no",
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
            volatility_period="hourly",  # FIX: PriceMomentumTracker uses hourly-period data
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

        # P1-1: Compute quantized analysis for this pair
        # BUG FIX (2026-06-04 v2): R_buy and R_sell were swapped!
        #
        # A "flip" opportunity means you BUY at the BID (the lower, maker-buy
        # price) and SELL at the ASK (the higher, maker-sell price), earning
        # the spread.  Passing R_buy=ask, R_sell=bid modeled the TAKER's
        # round-trip (buy at ask, sell at bid), which is ALWAYS a loss when
        # ask > bid.  That caused gross_profit_pct ≈ -3.5% for every pair.
        #
        # Correct: R_buy = bid (your cost to buy), R_sell = ask (your revenue
        # from selling).  The market-maker earns the spread; the taker pays it.
        quantized = compute_quantized_analysis(
            R_buy=bid if mid_price > 0 else 0,   # you BUY at bid (lower cost)
            R_sell=ask if mid_price > 0 else 0,  # you SELL at ask (higher revenue)
            mid_price=mid_price if mid_price > 0 else 1.0,
            lot_sizes=config.quantization.default_lot_sizes,
            max_lot_search=config.quantization.max_lot_search,
        )

        # P1-3: Compute tier penalty
        t_penalty = 1.0
        t_distance = 0
        if snapshot.tiers:
            tier_a = snapshot.tiers.get(rate.currency_from)
            tier_b = snapshot.tiers.get(rate.currency_to)
            if tier_a and tier_b:
                t_penalty = tier_penalty(tier_a.tier, tier_b.tier)
                t_distance = tier_distance(tier_a.tier, tier_b.tier)
                # Re-score with tier penalty
                score = score * t_penalty
                score = min(max(score, 0.0), 1.0)

        # Gold fees are permanently excluded — net_spread equals raw spread.
        net_spread = spread_value
        net_profit_pct = net_spread * 100 if mid_price > 0 else 0.0

        opp = FlipOpportunity(
            currency=f"{rate.currency_from}/{rate.currency_to}",
            score=score,
            spread=spread_value,
            spread_after_fees=net_spread,  # Step 3: Now includes gold fee deduction
            volume_24h=float(rate.volume_traded),
            momentum=momentum_result.momentum,
            volatility=momentum_result.volatility,
            cluster=cluster,
            bid=bid,
            ask=ask,
            mid_price=mid_price,
            quantized_analysis=quantized,
            tier_distance=t_distance,
        )

        # Step 4: Skip stale data opportunities (data too old to be reliable)
        if is_stale:
            logger.info("Skipping stale opportunity %s (data_age=%.0fs > TTL=%ds)",
                        opp.currency, data_age_seconds or 0,
                        config.data.cache_ttl_prices_minutes * 60)
            continue

        # Filter out flips where net profit is negative (spread is effectively zero)
        # With gold fees excluded, this filter now only removes pairs with
        # zero or negative spread (which shouldn't happen with our spread model
        # that ensures min 0.5% spread, but keep as safety net).
        if net_profit_pct <= 0:
            continue

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

    # Gold fees excluded — pass None/0 to disable gold fee in triangular arb
    result = find_triangular_arbitrage(
        rates=rates_for_bf,
        prices=prices,
        min_profit_pct=min_profit_pct,
        pair_volumes=pair_volumes,
        snapshot_time=datetime.now(timezone.utc),
        cross_rate_threshold_pct=5.0,
        gold_cost_per_unit=None,
        gold_to_chaos_rate=0.0,
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
                f"{len(suspicious_triples)} currency triples have >5% "
                "cross-rate divergence (implied vs direct rates). "
                "Some detected cycles may be false positives from "
                "inconsistent relative_price data between pairs."
            ),
        }

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
                "currencyId": o["currency_id"],
                "currencyName": o["currency_name"],
                "priceInCurrency": round(o["price_in_currency"], 6),
                "effectiveAnchorPrice": round(o["effective_anchor_price"], 8),
                "premiumPct": round(o["premium_pct"], 2),
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
                "buyCurrencyId": rate.currency_from if deviation_pct < 0 else rate.currency_to,
                "sellCurrencyId": rate.currency_to if deviation_pct < 0 else rate.currency_from,
                "fairRate": round(fair_rate, 8),
                "marketRate": round(market_rate, 8),
                "deviationPct": round(deviation_pct, 2),
                "direction": direction,
                "estimatedProfitPct": round(estimated_profit_pct, 2),
                "volume": rate.volume_traded,
            })

    # Sort by estimated profit descending
    results.sort(key=lambda r: r["estimatedProfitPct"], reverse=True)
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
            "anchorId": "exalted",
            "optimalPaymentByPair": {},
            "crossRateFlips": [],
            "dataAvailable": False,
            "fetchedAt": datetime.now(timezone.utc).isoformat(),
        }

    snapshot = await get_snapshot()
    rates = snapshot.exchange_rates
    if not rates:
        return {
            "league": config.league.league_name,
            "anchorId": "exalted",
            "optimalPaymentByPair": {},
            "crossRateFlips": [],
            "dataAvailable": False,
            "fetchedAt": datetime.now(timezone.utc).isoformat(),
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
        "anchorId": anchor,
        "optimalPaymentByPair": optimal_by_pair,
        "crossRateFlips": cross_rate_flips,
        "dataAvailable": True,
        "fetchedAt": datetime.now(timezone.utc).isoformat(),
    }
