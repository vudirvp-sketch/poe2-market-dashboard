"""
API routes for enhanced flip scanning with custom filters.

Endpoint:
    GET /api/v1/scanner/scan — Advanced flip opportunity scanner with custom filters
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Query

from backend.config import get_settings, AppConfig
from backend.data.pipeline_cache import get_pipeline_cache
from backend.api.routes_arbitrage import _build_flip_opportunities
from backend.api.response_models import ScannerResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/scanner", tags=["scanner"])


@router.get("/scan", response_model=ScannerResponse)
async def scan_flips(
    min_score: float = Query(0.0, ge=0.0, le=1.0, description="Minimum score filter"),
    max_score: float = Query(1.0, ge=0.0, le=1.0, description="Maximum score filter"),
    min_volume: int = Query(0, ge=0, description="Minimum 24h volume filter"),
    max_spread: float = Query(1.0, ge=0.0, le=1.0, description="Maximum spread filter"),
    min_spread: float = Query(0.0, ge=0.0, le=1.0, description="Minimum spread filter"),
    cluster: Optional[str] = Query(None, description="Cluster filter: stable, moderate, volatile_illiquid"),
    currency: Optional[str] = Query(None, description="Currency contains filter (partial match)"),
    sort_by: str = Query("score", description="Sort field: score, spread, volume_24h, momentum, volatility"),
    sort_dir: str = Query("desc", description="Sort direction: asc, desc"),
    limit: int = Query(50, ge=1, le=200, description="Max results"),
    include_stale: bool = Query(False, description="Include opportunities with stale data"),
):
    """Advanced flip scanner with custom filters and sorting.
    
    Unlike /api/arbitrage/flips which returns pre-filtered opportunities,
    this endpoint supports fine-grained filtering including spread ranges,
    cluster selection, currency substring matching, and custom sorting.
    """
    config = get_settings()
    pipeline_cache = get_pipeline_cache()
    
    # Reuse the existing flip opportunities builder (cached)
    cached = pipeline_cache.get("flip_opportunities")
    if cached is not None and not cached.stale:
        opportunities = cached.value
    else:
        try:
            opportunities = await _build_flip_opportunities(config)
            pipeline_cache.put("flip_opportunities", opportunities)
        except Exception as e:
            logger.warning("Failed to build flip opportunities for scanner: %s", e)
            if cached is not None:
                opportunities = cached.value
            else:
                opportunities = []
    
    # Apply filters
    filtered = []
    for o in opportunities:
        # Score range filter
        if o.score < min_score or o.score > max_score:
            continue
        
        # Volume filter
        if o.volume_24h < min_volume:
            continue
        
        # Spread range filter
        if o.spread < min_spread or o.spread > max_spread:
            continue
        
        # Cluster filter
        if cluster is not None and o.cluster.value != cluster:
            continue
        
        # Currency substring filter (case-insensitive)
        if currency is not None:
            if currency.lower() not in o.currency.lower():
                continue
        
        filtered.append(o)
    
    # Sort
    sort_key_map = {
        "score": lambda o: o.score,
        "spread": lambda o: o.spread,
        "volume_24h": lambda o: o.volume_24h,
        "momentum": lambda o: o.momentum,
        "volatility": lambda o: o.volatility,
    }
    sort_fn = sort_key_map.get(sort_by, sort_key_map["score"])
    reverse = sort_dir == "desc"
    filtered.sort(key=sort_fn, reverse=reverse)
    
    # Apply limit
    filtered = filtered[:limit]
    
    return {
        "league": config.league.league_name,
        "total": len(filtered),
        "opportunities": [
            {
                "currency": o.currency,
                "score": round(o.score, 4),
                "spread": round(o.spread, 6),
                "spread_after_fees": round(o.spread_after_fees, 6),
                "volume_24h": o.volume_24h,
                "momentum": round(o.momentum, 6),
                "volatility": round(o.volatility, 6),
                "cluster": o.cluster.value,
                "bid": round(o.bid, 6),
                "ask": round(o.ask, 6),
                "mid_price": round(o.mid_price, 6),
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
        "scan_params": {
            "min_score": min_score,
            "max_score": max_score,
            "min_volume": min_volume,
            "max_spread": max_spread,
            "min_spread": min_spread,
            "cluster": cluster,
            "currency": currency,
            "sort_by": sort_by,
            "sort_dir": sort_dir,
            "limit": limit,
        },
        "data_available": len(opportunities) > 0,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }
