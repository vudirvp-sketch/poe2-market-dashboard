"""
API routes for Liquid Chain analysis — vendor reforge conversion chain profitability.

Endpoints:
    GET /api/liquid-chain/analysis       — Full analysis for all configured chains
    GET /api/liquid-chain/opportunities   — Only profitable steps and cumulative paths

Prices are sourced from DataSnapshot (prices_in_base), which is already
populated by the periodic snapshot refresh. No additional API calls needed.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query

from backend.config import get_settings
from backend.api.data_snapshot import get_snapshot
from backend.arbitrage.liquid_chain import compute_liquid_chain
from backend.models.currency import LiquidChainResult

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/liquid-chain", tags=["liquid-chain"])


def _serialize_step(step) -> dict:
    """Serialize a LiquidChainStep to a JSON-friendly dict."""
    return {
        "ApiId": step.api_id,
        "NameEn": step.name_en,
        "NameRu": step.name_ru,
        "Ratio": step.ratio,
        "Price": round(step.price, 8),
        "InputCost": round(step.input_cost, 8),
        "OutputValue": round(step.output_value, 8),
        "Profit": round(step.profit, 8),
        "ProfitPct": round(step.profit_pct, 4),
    }


def _serialize_cumulative_path(path) -> dict:
    """Serialize a LiquidChainCumulativePath to a JSON-friendly dict."""
    return {
        "FromIndex": path.from_index,
        "ToIndex": path.to_index,
        "TotalInputCost": round(path.total_input_cost, 8),
        "TotalOutputValue": round(path.total_output_value, 8),
        "CumulativeRatio": path.cumulative_ratio,
        "Profit": round(path.profit, 8),
        "ProfitPct": round(path.profit_pct, 4),
    }


def _serialize_result(result: LiquidChainResult) -> dict:
    """Serialize a LiquidChainResult to a JSON-friendly dict."""
    return {
        "ChainName": result.chain_name,
        "Category": result.category,
        "Steps": [_serialize_step(s) for s in result.steps],
        "CumulativePaths": [_serialize_cumulative_path(p) for p in result.cumulative_paths],
        "BestStep": result.best_step,
        "WorstStep": result.worst_step,
        "DataAvailable": result.data_available,
        "StepsWithData": result.steps_with_data,
        "TotalSteps": result.total_steps,
    }


async def _compute_all_chains() -> list[LiquidChainResult]:
    """Compute analysis for all configured liquid chains.

    Uses DataSnapshot for prices — no additional API calls.
    """
    config = get_settings()
    chains = config.liquid_chain.chains

    if not chains:
        return []

    snapshot = await get_snapshot()
    prices = dict(snapshot.prices_in_base) if snapshot else {}

    results: list[LiquidChainResult] = []
    for chain_cfg in chains:
        try:
            result = compute_liquid_chain(chain_cfg, prices)
            results.append(result)
        except Exception as e:
            logger.error("Failed to compute liquid chain '%s': %s", chain_cfg.name, e)

    return results


@router.get("/analysis")
async def get_liquid_chain_analysis(
    chain: str | None = Query(None, description="Chain name filter (e.g. 'delirium_liquids')"),
):
    """Full analysis for all configured liquid chains.

    Returns per-step and cumulative profit/loss for each vendor reforge chain.
    Optionally filter by chain name.
    """
    config = get_settings()

    # Check if snapshot data is available
    from backend.api.data_snapshot import get_snapshot_manager
    snapshot_mgr = get_snapshot_manager()
    if snapshot_mgr.last_snapshot is None:
        return {
            "chains": [],
            "data_available": False,
            "message": "Snapshot is being collected. Try again in a few seconds.",
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }

    results = await _compute_all_chains()

    if chain is not None:
        results = [r for r in results if r.chain_name == chain]

    return {
        "chains": [_serialize_result(r) for r in results],
        "data_available": any(r.data_available for r in results),
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/opportunities")
async def get_liquid_chain_opportunities(
    min_profit_pct: float = Query(0.0, ge=-100.0, description="Minimum profit % threshold"),
    chain: str | None = Query(None, description="Chain name filter"),
):
    """Only profitable steps and cumulative paths across all chains.

    Filters to show only steps and cumulative paths where profit_pct >= min_profit_pct.
    Useful for quick scanning of profitable reforging opportunities.
    """
    config = get_settings()

    from backend.api.data_snapshot import get_snapshot_manager
    snapshot_mgr = get_snapshot_manager()
    if snapshot_mgr.last_snapshot is None:
        return {
            "chains": [],
            "data_available": False,
            "message": "Snapshot is being collected. Try again in a few seconds.",
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }

    results = await _compute_all_chains()

    if chain is not None:
        results = [r for r in results if r.chain_name == chain]

    # Filter to only profitable opportunities
    filtered_chains = []
    for r in results:
        profitable_steps = [
            _serialize_step(s) for s in r.steps
            if s.profit_pct >= min_profit_pct and s.input_cost > 0
        ]
        profitable_paths = [
            _serialize_cumulative_path(p) for p in r.cumulative_paths
            if p.profit_pct >= min_profit_pct
        ]

        filtered_chains.append({
            "ChainName": r.chain_name,
            "Category": r.category,
            "ProfitableSteps": profitable_steps,
            "ProfitableCumulativePaths": profitable_paths,
            "BestStep": r.best_step,
            "WorstStep": r.worst_step,
            "DataAvailable": r.data_available,
            "StepsWithData": r.steps_with_data,
            "TotalSteps": r.total_steps,
        })

    return {
        "chains": filtered_chains,
        "data_available": any(r.data_available for r in results),
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }
