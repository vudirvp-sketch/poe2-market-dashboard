"""
API routes for price data.

Endpoints:
    GET /api/v1/prices              — all current prices for the configured league
    GET /api/v1/prices/heatmap      — 24h price change heatmap data (Phase 2, Spec Section 2)
    GET /api/v1/prices/{pair}       — current price for a specific pair (e.g. "divine/exalted")
    GET /api/v1/currencies          — currency metadata (names, icons, etc.)
    GET /api/v1/phase               — current league phase info

OPTIMIZATION: Uses DataSnapshot to avoid redundant API calls.
Before: each route made 15-30+ requests to ByCategory independently.
After: all routes share a single cached snapshot (~16 requests total per TTL window).
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query

from backend.config import get_settings
from backend.api.shared import get_phase_detector as _get_phase_detector
from backend.api.data_snapshot import get_snapshot
from backend.data.pipeline_cache import get_pipeline_cache
from backend.models.currency import PhaseInfo, CurrencyTier
from backend.api.response_models import (
    PhaseResponse, CurrenciesResponse, PricesResponse, HeatmapResponse,
    PriceForPairResponse, TiersResponse, BenchmarksResponse,
)
from backend.economy.clustering_helpers import (
    prepare_clustering_data,
    run_clustering_sync as _run_clustering_sync,
    CLUSTER_LABELS_CACHE_KEY,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["prices"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _compute_momentum_from_logs(
    price_logs: list[dict],
) -> dict:
    """Compute momentum/volatility/acceleration from price_logs dicts."""
    from backend.economy.momentum import PriceMomentumTracker

    if len(price_logs) < 2:
        return {"momentum": 0.0, "volatility": 0.001, "acceleration": 0.0}

    try:
        sorted_logs = sorted(
            [l for l in price_logs if l.get("price") is not None and l.get("time") is not None],
            key=lambda l: l["time"],
        )
        prices = [l["price"] for l in sorted_logs]
        if len(prices) < 2:
            return {"momentum": 0.0, "volatility": 0.001, "acceleration": 0.0}
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
        return {"momentum": 0.0, "volatility": 0.001, "acceleration": 0.0}


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/phase", response_model=PhaseResponse)
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


@router.get("/currencies", response_model=CurrenciesResponse)
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


@router.get("/prices", response_model=PricesResponse)
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
            "base_currency": config.league.base_currency,
            "stale": True,
            "data_available": False,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }

    # Get phase info
    detector = _get_phase_detector()
    phase_info = detector.get_phase_info()

    # Build momentum/volatility lookup from snapshot's currencies data
    momentum_lookup: dict[str, dict] = {}
    for api_id_lower, curr in snapshot.currencies.items():
        price_logs = curr.get("price_logs", [])
        momentum_lookup[api_id_lower] = _compute_momentum_from_logs(price_logs)
        # Also store by original-case api_id via DataSnapshot.get_currency
        orig_api_id = curr.get("api_id", "")
        if orig_api_id and orig_api_id != api_id_lower:
            momentum_lookup[orig_api_id] = momentum_lookup[api_id_lower]

    # Build response with momentum/volatility + cluster
    from backend.models.currency import ClusterLabel

    # Run currency clustering for cluster labels (cached via PipelineCache)
    pipeline_cache = get_pipeline_cache()
    cached_clustering = pipeline_cache.get(CLUSTER_LABELS_CACHE_KEY)
    if cached_clustering is not None and not cached_clustering.stale:
        cluster_labels = cached_clustering.value
    else:
        cluster_labels: dict[str, ClusterLabel] = {}
        try:
            # Use snapshot's prices_in_base for clustering fallback
            prices_in_base = snapshot.prices_in_base

            # Prepare clustering data using shared helper
            (cluster_price_histories, cluster_volumes,
             cluster_prices_now, cluster_prices_24h_ago) = prepare_clustering_data(
                rates=rates,
                currencies=snapshot.currencies,
                prices_in_base=prices_in_base,
                # routes_prices extracts from snapshot.currencies[].price_logs
                price_histories_prices=None,
                price_histories_timestamped=None,
            )

            # Offload CPU-bound clustering to ProcessPoolExecutor.
            # CurrencyClusterer.fit() uses sklearn KMeans which is CPU-heavy
            # and would block the event loop if run synchronously.
            # P2-13: use `get_process_pool()` so the pool is re-created if
            # a prior `lifespan` teardown (e.g. from a TestClient test)
            # shut it down.
            loop = asyncio.get_running_loop()
            executor = None
            try:
                from backend.main import get_process_pool
                executor = get_process_pool()
            except (ImportError, AttributeError):
                pass

            # Timeout for clustering computation (seconds).
            # KMeans with n_init=10 on 600+ currencies typically takes 3-10s.
            try:
                cluster_labels_raw = await asyncio.wait_for(
                    loop.run_in_executor(
                        executor,
                        _run_clustering_sync,
                        config,
                        cluster_price_histories,
                        cluster_volumes,
                        cluster_prices_now,
                        cluster_prices_24h_ago,
                    ),
                    timeout=30.0,
                )
            except asyncio.TimeoutError:
                logger.error("Clustering timed out after 30s — using empty labels")
                cluster_labels_raw = {}

            # Convert plain string labels back to ClusterLabel enums
            cluster_labels = {k: ClusterLabel(v) for k, v in cluster_labels_raw.items()}

            # Cache the result under the shared key
            pipeline_cache.put(CLUSTER_LABELS_CACHE_KEY, cluster_labels)
        except Exception as e:
            logger.error("Clustering in prices route failed: %s", e)
            cluster_labels = {}

    pairs_data = []
    for key, rate in rates.items():
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
            "volatility": round(from_momentum.get("volatility", 0.0), 6),
            "momentum": round(from_momentum.get("momentum", 0.0), 6),
            "acceleration": round(from_momentum.get("acceleration", 0.0), 6),
            "to_volatility": round(to_momentum.get("volatility", 0.0), 6),
            "to_momentum": round(to_momentum.get("momentum", 0.0), 6),
            "cluster_from": from_cluster,
            "cluster_to": to_cluster,
            "timestamp": rate.timestamp.isoformat() if rate.timestamp else None,
        })

    return {
        "league": config.league.league_name,
        "phase": phase_info.phase.value,
        "rates": pairs_data,
        "base_currency": config.league.base_currency,
        "stale": False,
        "data_available": True,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/prices/heatmap", response_model=HeatmapResponse)
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


@router.get("/prices/{pair:path}", response_model=PriceForPairResponse)
async def get_price_for_pair(pair: str):
    """Return current price for a specific currency pair (e.g. 'divine/exalted').

    OPTIMIZATION: Uses DataSnapshot to look up exchange rates instead
    of making a separate get_current_price() API call.
    """
    config = get_settings()
    snapshot = await get_snapshot()

    # Look up the pair from snapshot's exchange_rates
    # Pair format: "currency_from/currency_to"
    parts = pair.split("/")
    if len(parts) != 2:
        raise HTTPException(status_code=400, detail=f"Invalid pair format: {pair}. Expected 'from/to'.")

    curr_from, curr_to = parts[0].lower(), parts[1].lower()

    # Try to find the rate in snapshot
    rate = snapshot.exchange_rates.get(pair)
    if rate is None:
        # Try reverse lookup by constructing the key
        for key, r in snapshot.exchange_rates.items():
            if r.currency_from.lower() == curr_from and r.currency_to.lower() == curr_to:
                rate = r
                break

    if rate is None:
        # Fallback: derive from prices_in_base
        from_price = snapshot.prices_in_base.get(curr_from)
        to_price = snapshot.prices_in_base.get(curr_to)
        if from_price and to_price and to_price > 0:
            raw_rate = from_price / to_price
            spread_est = 0.01
            return {
                "pair": pair,
                "bid": raw_rate * (1 - spread_est / 2),
                "ask": raw_rate * (1 + spread_est / 2),
                "mid_price": raw_rate,
                "volume_24h": 0,
                "timestamp": snapshot.fetched_at.isoformat(),
                "stale": False,
                "data_available": True,
            }
        raise HTTPException(status_code=404, detail=f"No price data for pair: {pair}")

    # Derive mid/bid/ask from the rate
    mid_price = rate.raw_rate
    spread_est = max(0.005, min(0.05, 10.0 / max(rate.volume_traded, 1)))

    return {
        "pair": pair,
        "bid": mid_price * (1 - spread_est / 2),
        "ask": mid_price * (1 + spread_est / 2),
        "mid_price": mid_price,
        "volume_24h": rate.volume_traded,
        "timestamp": rate.timestamp.isoformat() if rate.timestamp else snapshot.fetched_at.isoformat(),
        "stale": False,
        "data_available": True,
    }


# ---------------------------------------------------------------------------
# P1-3: Tiers endpoint
# ---------------------------------------------------------------------------

@router.get("/tiers", response_model=TiersResponse)
async def get_tiers():
    """Return currency tier classifications for the configured league."""
    config = get_settings()
    snapshot = await get_snapshot()

    if not snapshot.tiers:
        return {
            "tiers": [],
            "boundaries": {
                "t0_min": config.tiers.boundaries.t0_min,
                "t1_min": config.tiers.boundaries.t1_min,
                "t2_min": config.tiers.boundaries.t2_min,
                "t3_min": config.tiers.boundaries.t3_min,
                "t4_min": config.tiers.boundaries.t4_min,
            },
            "data_available": False,
        }

    # Sort tiers by tier number then by relative_price descending
    sorted_tiers = sorted(
        snapshot.tiers.values(),
        key=lambda t: (t.tier, -t.relative_price),
    )

    return {
        "tiers": [
            {
                "api_id": t.api_id,
                "tier": t.tier,
                "tier_label": t.tier_label,
                "relative_price": round(t.relative_price, 6),
                "tier_anchor": t.tier_anchor,
            }
            for t in sorted_tiers
        ],
        "boundaries": {
            "t0_min": config.tiers.boundaries.t0_min,
            "t1_min": config.tiers.boundaries.t1_min,
            "t2_min": config.tiers.boundaries.t2_min,
            "t3_min": config.tiers.boundaries.t3_min,
            "t4_min": config.tiers.boundaries.t4_min,
        },
        "data_available": True,
    }


# ---------------------------------------------------------------------------
# P1-5: Benchmarks endpoint
# ---------------------------------------------------------------------------

@router.get("/benchmarks/{currency_api_id}", response_model=BenchmarksResponse)
async def get_benchmarks(
    currency_api_id: str,
    days: int = Query(30, ge=7, le=90, description="Lookback days"),
):
    """Return historical price benchmarks for a specific currency."""
    config = get_settings()
    snapshot = await get_snapshot()

    # Get current price from snapshot
    current_price = snapshot.get_current_price(currency_api_id)
    if current_price is None:
        current_price = snapshot.prices_in_base.get(currency_api_id.lower())

    if current_price is None:
        raise HTTPException(status_code=404, detail=f"No price data for currency: {currency_api_id}")

    # Get daily stats from the data provider
    from backend.api.shared import get_provider
    provider = get_provider()
    league = config.league.league_name

    try:
        # Find the item_id for this currency
        currency_info = snapshot.get_currency(currency_api_id)
        if not currency_info:
            raise HTTPException(status_code=404, detail=f"Currency not found: {currency_api_id}")

        item_id = currency_info.get("item_id", 0)
        if not item_id:
            raise HTTPException(status_code=404, detail=f"No item_id for currency: {currency_api_id}")

        daily_stats_raw = await provider.get_daily_stats(league, item_id, day_count=days)
    except Exception as e:
        logger.error("Failed to fetch daily stats for %s: %s", currency_api_id, e)
        # Return data_available=false instead of raising 503 — the frontend
        # handles this gracefully with a fallback UI rather than an error state.
        return {
            "currency_api_id": currency_api_id,
            "current_price": current_price,
            "benchmark": None,
            "data_available": False,
            "message": f"Historical data temporarily unavailable: {str(e)[:100]}",
        }

    if not daily_stats_raw:
        # No historical data available — return data_available=false instead of 404
        return {
            "currency_api_id": currency_api_id,
            "current_price": current_price,
            "benchmark": None,
            "data_available": False,
            "message": f"No historical data available for currency: {currency_api_id}",
        }

    # Normalize PascalCase API response to snake_case for compute_benchmarks()
    # POE2Scout DailyStatsHistory returns: Time, Open, High, Low, Close, Average, Volume
    if isinstance(daily_stats_raw, list):
        daily_stats = [
            {
                "close": d.get("Close") or d.get("close", 0),
                "high": d.get("High") or d.get("high", 0),
                "low": d.get("Low") or d.get("low", 0),
                "open": d.get("Open") or d.get("open", 0),
                "average": d.get("Average") or d.get("average", 0),
                "volume": d.get("Volume") or d.get("volume", 0),
            }
            for d in daily_stats_raw
        ]
    else:
        # If the response is a dict with a nested list, extract it
        items = daily_stats_raw.get("items") or daily_stats_raw.get("Items") or []
        daily_stats = [
            {
                "close": d.get("Close") or d.get("close", 0),
                "high": d.get("High") or d.get("high", 0),
                "low": d.get("Low") or d.get("low", 0),
                "open": d.get("Open") or d.get("open", 0),
                "average": d.get("Average") or d.get("average", 0),
                "volume": d.get("Volume") or d.get("volume", 0),
            }
            for d in items
        ]

    from backend.economy.benchmarks import compute_benchmarks
    benchmark = compute_benchmarks(daily_stats, current_price)

    if benchmark is None:
        return {
            "currency_api_id": currency_api_id,
            "current_price": current_price,
            "benchmark": None,
            "data_available": False,
            "message": "Insufficient historical data (need at least 7 days)",
        }

    return {
        "currency_api_id": currency_api_id,
        "current_price": current_price,
        "benchmark": {
            "low_30d": round(benchmark.low_30d, 6),
            "high_30d": round(benchmark.high_30d, 6),
            "range_position": round(benchmark.range_position, 4),
            "percentile_30d": round(benchmark.percentile_30d, 1),
            "current_vs_avg": round(benchmark.current_vs_avg, 4),
        },
        "days": days,
        "data_available": True,
    }
