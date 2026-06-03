"""
API routes for the Currency Optimizer feature.

Endpoints:
    GET /api/optimizer/path    — find the optimal conversion path between two currencies
    GET /api/optimizer/matrix  — return the full rate matrix for all currency pairs

Uses Dijkstra's algorithm on the exchange rate graph to find the best
multi-hop conversion path. Edge weights are -log(raw_rate) so that the
shortest path corresponds to the best effective rate.
"""

from __future__ import annotations

import heapq
import logging
import math
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query

from backend.api.data_snapshot import get_snapshot
from backend.config import get_settings
from backend.data.pipeline_cache import get_pipeline_cache

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/optimizer", tags=["optimizer"])


# ---------------------------------------------------------------------------
# Helper: Dijkstra shortest path on -log(rate) weighted graph
# ---------------------------------------------------------------------------

def _dijkstra(
    graph: dict[str, list[tuple[str, float, float]]],
    source: str,
    target: str,
    max_hops: int = 5,
) -> tuple[list[str], list[float]] | None:
    """Find the shortest path (best rate) from source to target.

    Args:
        graph: adjacency list — graph[u] = [(v, -log(rate), rate), ...]
        source: starting currency api_id
        target: destination currency api_id
        max_hops: maximum number of edges in the path

    Returns:
        (path, step_rates) if a path is found, else None.
        path is a list of currency api_ids.
        step_rates is a list of raw_rate values for each edge.
    """
    # Priority queue entries: (cumulative_weight, hops, current_node, path, step_rates)
    # We include hops to enforce max_hops constraint.
    pq: list[tuple[float, int, str, list[str], list[float]]] = [
        (0.0, 0, source, [source], [])
    ]
    # Best known weight to each (node, hops) pair — we allow revisiting
    # a node via a shorter cumulative weight regardless of hop count.
    best: dict[str, float] = {source: 0.0}

    while pq:
        cum_weight, hops, node, path, step_rates = heapq.heappop(pq)

        # Found the target
        if node == target:
            return path, step_rates

        # Prune if we've already found a better way to this node
        if cum_weight > best.get(node, float("inf")):
            continue

        # Can't go further
        if hops >= max_hops:
            continue

        for neighbor, neg_log_rate, raw_rate in graph.get(node, []):
            new_weight = cum_weight + neg_log_rate
            if new_weight < best.get(neighbor, float("inf")):
                best[neighbor] = new_weight
                heapq.heappush(
                    pq,
                    (
                        new_weight,
                        hops + 1,
                        neighbor,
                        path + [neighbor],
                        step_rates + [raw_rate],
                    ),
                )

    return None


# ---------------------------------------------------------------------------
# Helper: Build graph from exchange rates
# ---------------------------------------------------------------------------

def _build_graph(
    exchange_rates: dict,
) -> dict[str, list[tuple[str, float, float]]]:
    """Build an adjacency list graph from exchange rates.

    Each edge (u -> v) has weight = -log(raw_rate) so that Dijkstra
    finds the path with the highest cumulative product of rates.

    Args:
        exchange_rates: dict from DataSnapshot.exchange_rates
            keys are "{from}/{to}", values are ExchangeRate objects

    Returns:
        graph: adjacency list — graph[u] = [(v, -log(rate), rate), ...]
    """
    graph: dict[str, list[tuple[str, float, float]]] = {}

    for key, rate in exchange_rates.items():
        if rate.raw_rate <= 0:
            continue

        u = rate.currency_from
        v = rate.currency_to
        r = rate.raw_rate

        # Forward edge: u -> v with weight -log(r)
        weight = -math.log(r)
        graph.setdefault(u, []).append((v, weight, r))

        # Reverse edge: v -> u with rate 1/r, weight -log(1/r) = log(r)
        reverse_weight = math.log(r)
        reverse_rate = 1.0 / r
        graph.setdefault(v, []).append((u, reverse_weight, reverse_rate))

    return graph


# ---------------------------------------------------------------------------
# Helper: Collect all unique currencies from exchange rates
# ---------------------------------------------------------------------------

def _collect_currencies(exchange_rates: dict) -> list[str]:
    """Return sorted list of unique currency api_ids from exchange rates."""
    currencies: set[str] = set()
    for rate in exchange_rates.values():
        currencies.add(rate.currency_from)
        currencies.add(rate.currency_to)
    return sorted(currencies)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/path")
async def get_optimal_path(
    from_currency: str = Query(..., description="Source currency api_id (e.g. 'chaos')"),
    to_currency: str = Query(..., description="Target currency api_id (e.g. 'divine')"),
    amount: float = Query(1.0, ge=0.001, description="Amount of source currency to convert"),
    max_hops: int = Query(5, ge=1, le=10, description="Maximum number of hops in the path"),
):
    """Find the optimal conversion path between two currencies.

    Uses Dijkstra's algorithm on the exchange rate graph where edge weights
    are -log(raw_rate), so the shortest path corresponds to the best
    effective conversion rate.

    Compares the multi-hop path rate with the direct rate (if available)
    and reports the advantage percentage.
    """
    config = get_settings()
    pipeline_cache = get_pipeline_cache()

    # Check cache
    cache_key = f"optimizer_path:{from_currency}:{to_currency}:{amount}:{max_hops}"
    cached = pipeline_cache.get(cache_key)
    if cached is not None and not cached.stale:
        return cached.value

    snapshot = await get_snapshot()
    exchange_rates = snapshot.exchange_rates

    if not exchange_rates:
        return {
            "from_currency": from_currency,
            "to_currency": to_currency,
            "amount": amount,
            "path": [],
            "step_rates": [],
            "effective_rate": 0.0,
            "output_amount": 0.0,
            "direct_rate": None,
            "direct_output_amount": None,
            "path_advantage_pct": None,
            "hops": 0,
            "data_available": False,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }

    # Build graph
    graph = _build_graph(exchange_rates)

    # Normalize currency names to lowercase for lookup
    from_lower = from_currency.lower()
    to_lower = to_currency.lower()

    # Check if currencies exist in the graph
    if from_lower not in graph or to_lower not in graph:
        # Try to find the currency in the graph with case-insensitive match
        available = set(graph.keys())
        if from_lower not in available and from_currency not in available:
            raise HTTPException(
                status_code=404,
                detail=f"Currency '{from_currency}' not found in exchange rates. "
                       f"Available: {sorted(available)[:20]}...",
            )
        if to_lower not in available and to_currency not in available:
            raise HTTPException(
                status_code=404,
                detail=f"Currency '{to_currency}' not found in exchange rates. "
                       f"Available: {sorted(available)[:20]}...",
            )
        # Use the case-corrected versions
        if from_currency in available:
            from_lower = from_currency
        if to_currency in available:
            to_lower = to_currency

    # Run Dijkstra
    result = _dijkstra(graph, from_lower, to_lower, max_hops)

    if result is None:
        return {
            "from_currency": from_currency,
            "to_currency": to_currency,
            "amount": amount,
            "path": [],
            "step_rates": [],
            "effective_rate": 0.0,
            "output_amount": 0.0,
            "direct_rate": None,
            "direct_output_amount": None,
            "path_advantage_pct": None,
            "hops": 0,
            "data_available": True,
            "fetched_at": snapshot.fetched_at.isoformat() if snapshot.fetched_at else datetime.now(timezone.utc).isoformat(),
        }

    path, step_rates = result

    # Compute effective rate along the path
    effective_rate = 1.0
    for r in step_rates:
        effective_rate *= r
    output_amount = amount * effective_rate

    # Find direct rate if available
    direct_rate = None
    direct_output_amount = None
    path_advantage_pct = None

    # Look for direct edge in exchange_rates
    for rate in exchange_rates.values():
        if rate.currency_from == from_lower and rate.currency_to == to_lower:
            direct_rate = rate.raw_rate
            direct_output_amount = amount * direct_rate
            break
        elif rate.currency_to == from_lower and rate.currency_from == to_lower:
            # Reverse rate
            direct_rate = 1.0 / rate.raw_rate if rate.raw_rate > 0 else None
            if direct_rate is not None:
                direct_output_amount = amount * direct_rate
            break

    # Compute advantage percentage
    if direct_rate is not None and direct_rate > 0:
        path_advantage_pct = ((effective_rate / direct_rate) - 1.0) * 100.0

    response = {
        "from_currency": from_currency,
        "to_currency": to_currency,
        "amount": amount,
        "path": path,
        "step_rates": [round(r, 6) for r in step_rates],
        "effective_rate": round(effective_rate, 6),
        "output_amount": round(output_amount, 4),
        "direct_rate": round(direct_rate, 6) if direct_rate is not None else None,
        "direct_output_amount": round(direct_output_amount, 4) if direct_output_amount is not None else None,
        "path_advantage_pct": round(path_advantage_pct, 2) if path_advantage_pct is not None else None,
        "hops": len(step_rates),
        "data_available": True,
        "fetched_at": snapshot.fetched_at.isoformat() if snapshot.fetched_at else datetime.now(timezone.utc).isoformat(),
    }

    # Cache the result
    pipeline_cache.put(cache_key, response)

    return response


@router.get("/matrix")
async def get_rate_matrix():
    """Return the full rate matrix for all currency pairs in the snapshot.

    Builds an N×N matrix where matrix[i][j] = rate from currency_i to
    currency_j. Uses only currencies that appear in exchange_rates.

    For pairs without a direct rate, the value is None (null in JSON).
    The diagonal is always 1.0 (same currency).
    """
    config = get_settings()
    pipeline_cache = get_pipeline_cache()

    # Check cache
    cache_key = "optimizer_matrix"
    cached = pipeline_cache.get(cache_key)
    if cached is not None and not cached.stale:
        return cached.value

    snapshot = await get_snapshot()
    exchange_rates = snapshot.exchange_rates

    if not exchange_rates:
        return {
            "currencies": [],
            "matrix": [],
            "size": 0,
            "data_available": False,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }

    # Collect all unique currencies, sorted for deterministic ordering
    currencies = _collect_currencies(exchange_rates)
    n = len(currencies)

    # Build a lookup for direct rates: (from, to) -> raw_rate
    direct_rates: dict[tuple[str, str], float] = {}
    for rate in exchange_rates.values():
        direct_rates[(rate.currency_from, rate.currency_to)] = rate.raw_rate

    # Build the index mapping
    currency_index = {c: i for i, c in enumerate(currencies)}

    # Build the N×N matrix
    matrix: list[list[float | None]] = []
    for i, from_curr in enumerate(currencies):
        row: list[float | None] = []
        for j, to_curr in enumerate(currencies):
            if i == j:
                row.append(1.0)
            else:
                # Check direct rate
                rate = direct_rates.get((from_curr, to_curr))
                if rate is not None:
                    row.append(round(rate, 6))
                else:
                    # Check reverse rate
                    rev_rate = direct_rates.get((to_curr, from_curr))
                    if rev_rate is not None and rev_rate > 0:
                        row.append(round(1.0 / rev_rate, 6))
                    else:
                        row.append(None)
        matrix.append(row)

    response = {
        "currencies": currencies,
        "matrix": matrix,
        "size": n,
        "data_available": True,
        "fetched_at": snapshot.fetched_at.isoformat() if snapshot.fetched_at else datetime.now(timezone.utc).isoformat(),
    }

    # Cache the result
    pipeline_cache.put(cache_key, response)

    return response
