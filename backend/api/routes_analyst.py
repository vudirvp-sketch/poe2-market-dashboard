"""
API routes for League Analyst — trends, anomalies, league comparison, and auto-generated facts.

Endpoint:
    GET /api/v1/analyst/summary — Comprehensive league analysis summary
"""

from __future__ import annotations

import logging
import math
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from backend.config import get_settings
from backend.api.data_snapshot import get_snapshot
from backend.data.unified_cache import get_pipeline_cache
from backend.api.response_models import AnalystSummaryResponse
# P0-3 fix (iter 54): use the timestamp-aware 24h-ago helper instead of
# `prices[0]` (which is just the oldest point in the snapshot window —
# often days old, not 24h). The helper finds the price point closest to
# now-24h with a ±6h drift tolerance and returns None if no point is
# close enough, so change_24h_pct is None rather than bogus.
# P0-5 fix (iter 57): the helper now lives in `backend/economy/pricing.py`
# alongside `compute_transitive_prices` — both pricing helpers in one
# place, and the analyst route no longer has to import from a sibling
# `routes_arbitrage` module.
from backend.economy.pricing import find_price_24h_ago as _find_price_24h_ago

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/analyst", tags=["analyst"])


def _compute_trends(prices_in_base: dict[str, float],
                    price_histories: dict[str, list]) -> list[dict]:
    """Compute 24h and 7d trend data for all currencies."""
    trends = []
    for api_id, history_points in price_histories.items():
        if len(history_points) < 2:
            continue

        prices = [p.price for p in history_points]
        if len(prices) < 2:
            continue

        current = prices[-1]

        # 24h change — P0-3 fix: use timestamp-aware lookup instead of prices[0].
        # history_points is list[PricePoint] with .timestamp and .price.
        history_with_ts = [(p.timestamp, p.price) for p in history_points]
        price_24h_ago = _find_price_24h_ago(history_with_ts)
        change_24h = None
        if price_24h_ago and price_24h_ago > 0:
            change_24h = ((current - price_24h_ago) / price_24h_ago) * 100
        
        # Simple trend direction
        if change_24h is not None:
            if change_24h > 2:
                direction = "up"
            elif change_24h < -2:
                direction = "down"
            else:
                direction = "stable"
        else:
            direction = "unknown"
        
        trends.append({
            "api_id": api_id,
            "current_price": current,
            "change_24h_pct": round(change_24h, 2) if change_24h is not None else None,
            "direction": direction,
        })
    
    # Sort by absolute change (most volatile first)
    trends.sort(key=lambda t: abs(t.get("change_24h_pct") or 0), reverse=True)
    return trends


def _detect_anomalies_simple(prices_in_base: dict[str, float],
                              price_histories: dict[str, list]) -> list[dict]:
    """Simple anomaly detection based on z-score of price changes."""
    anomalies = []
    for api_id, history_points in price_histories.items():
        if len(history_points) < 5:
            continue
        
        prices = [p.price for p in history_points]
        if len(prices) < 5:
            continue
        
        # Compute price changes
        changes = [prices[i] - prices[i-1] for i in range(1, len(prices)) if prices[i-1] > 0]
        if not changes:
            continue
        
        mean_change = sum(changes) / len(changes)
        std_change = (sum((c - mean_change) ** 2 for c in changes) / len(changes)) ** 0.5
        
        if std_change < 1e-10:
            continue
        
        # Check if the latest change is anomalous (|z-score| > 2)
        latest_change = changes[-1] if changes else 0
        z_score = (latest_change - mean_change) / std_change
        
        if abs(z_score) > 2.0:
            anomalies.append({
                "api_id": api_id,
                "z_score": round(z_score, 2),
                "direction": "spike_up" if z_score > 0 else "spike_down",
                "current_price": prices[-1],
                "change_pct": round((latest_change / prices[-2]) * 100, 2) if len(prices) >= 2 and prices[-2] > 0 else None,
            })
    
    # Sort by absolute z-score (most anomalous first)
    anomalies.sort(key=lambda a: abs(a["z_score"]), reverse=True)
    return anomalies[:20]  # Top 20


def _generate_facts(trends: list[dict], anomalies: list[dict],
                    snapshot_data: dict) -> list[dict]:
    """Auto-generate interesting facts about the league economy.

    iter 88: each fact now carries a `template_id` + `params` so the frontend
    can format the text via i18n keys (analystFactBiggestGainer, etc.). The
    English `text` field is kept for backward compatibility.
    """
    facts = []
    
    # Fact: biggest movers
    big_movers_up = [t for t in trends if t.get("direction") == "up"][:3]
    big_movers_down = [t for t in trends if t.get("direction") == "down"][:3]
    
    if big_movers_up:
        top = big_movers_up[0]
        pct = top.get("change_24h_pct", 0) or 0
        facts.append({
            "type": "trend",
            "icon": "up",
            "text": f"{top['api_id']} is the biggest gainer (+{pct:.1f}% in 24h)",
            "severity": "info",
            "template_id": "biggest_gainer",
            "params": {"apiId": top["api_id"], "pct": round(pct, 1)},
        })
    
    if big_movers_down:
        top = big_movers_down[0]
        pct = top.get("change_24h_pct", 0) or 0
        facts.append({
            "type": "trend",
            "icon": "down",
            "text": f"{top['api_id']} is the biggest loser ({pct:.1f}% in 24h)",
            "severity": "warning",
            "template_id": "biggest_loser",
            "params": {"apiId": top["api_id"], "pct": round(pct, 1)},
        })
    
    # Fact: anomaly count
    if anomalies:
        count = len(anomalies)
        facts.append({
            "type": "anomaly",
            "icon": "alert",
            "text": f"{count} currencies showing unusual price activity",
            "severity": "warning" if count > 5 else "info",
            "template_id": "anomaly_activity",
            "params": {"count": count},
        })
    
    # Fact: market activity
    total_currencies = snapshot_data.get("total_currencies", 0)
    total_pairs = snapshot_data.get("total_pairs", 0)
    if total_currencies > 0:
        facts.append({
            "type": "market",
            "icon": "chart",
            "text": f"Tracking {total_currencies} currencies across {total_pairs} trading pairs",
            "severity": "info",
            "template_id": "tracking",
            "params": {"totalCurrencies": total_currencies, "totalPairs": total_pairs},
        })
    
    # Fact: stable currencies count
    stable_count = len([t for t in trends if t.get("direction") == "stable"])
    if stable_count > 0:
        facts.append({
            "type": "market",
            "icon": "shield",
            "text": f"{stable_count} currencies holding stable (less than 2% change)",
            "severity": "info",
            "template_id": "stable_count",
            "params": {"stableCount": stable_count},
        })
    
    return facts


@router.get("/summary", response_model=AnalystSummaryResponse)
async def get_league_summary():
    """Comprehensive league analysis: trends, anomalies, and auto-generated facts."""
    config = get_settings()

    # P0-1: Check if snapshot data is available before processing.
    # Return 200 with data_available=false instead of 503 so the frontend
    # can show a graceful fallback UI instead of an error.
    from backend.api.data_snapshot import get_snapshot_manager
    snapshot_mgr = get_snapshot_manager()
    if snapshot_mgr.last_snapshot is None:
        return {
            "league": config.league.league_name,
            "summary": {
                "total_currencies": 0,
                "total_pairs": 0,
                "trending_up": 0,
                "trending_down": 0,
                "stable": 0,
                "anomaly_count": 0,
            },
            "trends": [],
            "anomalies": [],
            "facts": [],
            "data_available": False,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }

    snapshot = await get_snapshot()
    
    # Build summary metadata
    total_currencies = len(snapshot.prices_in_base)
    total_pairs = len(snapshot.exchange_rates)
    
    # Compute trends
    pipeline_cache = get_pipeline_cache()
    cached_trends = pipeline_cache.get("analyst_trends")
    if cached_trends is not None and not cached_trends.stale:
        trends = cached_trends.value
    else:
        trends = _compute_trends(snapshot.prices_in_base, snapshot.price_histories)
        pipeline_cache.put("analyst_trends", trends)
    
    # Detect anomalies
    cached_anomalies = pipeline_cache.get("analyst_anomalies")
    if cached_anomalies is not None and not cached_anomalies.stale:
        anomalies = cached_anomalies.value
    else:
        anomalies = _detect_anomalies_simple(snapshot.prices_in_base, snapshot.price_histories)
        pipeline_cache.put("analyst_anomalies", anomalies)
    
    # Generate facts
    snapshot_data = {
        "total_currencies": total_currencies,
        "total_pairs": total_pairs,
    }
    facts = _generate_facts(trends, anomalies, snapshot_data)
    
    # Trend summary
    up_count = len([t for t in trends if t.get("direction") == "up"])
    down_count = len([t for t in trends if t.get("direction") == "down"])
    stable_count = len([t for t in trends if t.get("direction") == "stable"])
    
    return {
        "league": config.league.league_name,
        "summary": {
            "total_currencies": total_currencies,
            "total_pairs": total_pairs,
            "trending_up": up_count,
            "trending_down": down_count,
            "stable": stable_count,
            "anomaly_count": len(anomalies),
        },
        "trends": trends[:30],  # Top 30 by volatility
        "anomalies": anomalies,
        "facts": facts,
        "data_available": total_currencies > 0,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }
