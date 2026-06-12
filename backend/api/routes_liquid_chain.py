"""
API routes for Liquid Chain analysis — vendor reforge conversion chain profitability.

Endpoints:
    GET /api/v1/liquid-chain/analysis       — Full analysis for all configured chains
    GET /api/v1/liquid-chain/opportunities   — Only profitable steps and cumulative paths

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
from backend.api.response_models import LiquidChainAnalysisResponse, LiquidChainOpportunitiesResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/liquid-chain", tags=["liquid-chain"])


def _serialize_step(step) -> dict:
    """Serialize a LiquidChainStep to a JSON-friendly dict (snake_case).

    The flipper-proxy transformKeys() converts snake_case → camelCase
    for the frontend. PascalCase keys would pass through unchanged,
    causing 'Cannot read properties of undefined (reading .filter)'
    errors in the React component.
    """
    return {
        "api_id": step.api_id,
        "name_en": step.name_en,
        "name_ru": step.name_ru,
        "ratio": step.ratio,
        "price": round(step.price, 8),
        "input_cost": round(step.input_cost, 8),
        "output_value": round(step.output_value, 8),
        "profit": round(step.profit, 8),
        "profit_pct": round(step.profit_pct, 4),
    }


def _serialize_cumulative_path(path) -> dict:
    """Serialize a LiquidChainCumulativePath to a JSON-friendly dict (snake_case)."""
    return {
        "from_index": path.from_index,
        "to_index": path.to_index,
        "total_input_cost": round(path.total_input_cost, 8),
        "total_output_value": round(path.total_output_value, 8),
        "cumulative_ratio": path.cumulative_ratio,
        "profit": round(path.profit, 8),
        "profit_pct": round(path.profit_pct, 4),
    }


def _serialize_result(result: LiquidChainResult) -> dict:
    """Serialize a LiquidChainResult to a JSON-friendly dict (snake_case)."""
    return {
        "chain_name": result.chain_name,
        "category": result.category,
        "steps": [_serialize_step(s) for s in result.steps],
        "cumulative_paths": [_serialize_cumulative_path(p) for p in result.cumulative_paths],
        "best_step": result.best_step,
        "worst_step": result.worst_step,
        "data_available": result.data_available,
        "steps_with_data": result.steps_with_data,
        "total_steps": result.total_steps,
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


@router.get("/analysis", response_model=LiquidChainAnalysisResponse)
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


@router.get("/opportunities", response_model=LiquidChainOpportunitiesResponse)
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
            "chain_name": r.chain_name,
            "category": r.category,
            "profitable_steps": profitable_steps,
            "profitable_cumulative_paths": profitable_paths,
            "best_step": r.best_step,
            "worst_step": r.worst_step,
            "data_available": r.data_available,
            "steps_with_data": r.steps_with_data,
            "total_steps": r.total_steps,
        })

    return {
        "chains": filtered_chains,
        "data_available": any(r.data_available for r in results),
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }
