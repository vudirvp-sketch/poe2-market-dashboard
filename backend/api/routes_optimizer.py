"""
API routes for the Currency Optimizer feature.

Endpoints:
    GET /api/v1/optimizer/path    — find the optimal conversion path between two currencies
    GET /api/v1/optimizer/matrix  — return the full rate matrix for all currency pairs

Uses Bellman-Ford algorithm on the exchange rate graph to find the best
multi-hop conversion path. Edge weights are -log(raw_rate) so that the
shortest path corresponds to the best effective rate.

NOTE: Previously used Dijkstra, but -log(rate) produces negative weights
when rate > 1 (e.g. 1 Chaos = 0.1 Exalted → -log(0.1) > 0, but the
reverse edge 1 Exalted = 10 Chaos → -log(10) < 0). Dijkstra requires
non-negative weights, so it produced incorrect results for paths containing
reverse edges where rate > 1. Bellman-Ford handles negative weights correctly.

P1-8 (iter 64): after `max_hops` relaxation passes the algorithm now
runs one additional pass to detect a negative cycle, which in -log(rate)
space corresponds to a profitable arbitrage opportunity (product of rates
around the cycle > 1). When the requested target lies on such a cycle,
the optimal path is undefined (unbounded profit), so the endpoint
returns an empty path and falls back to the direct edge if available.
"""

from __future__ import annotations

import logging
import math
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query

from backend.api.data_snapshot import get_snapshot
from backend.config import get_settings
from backend.data.unified_cache import get_pipeline_cache
from backend.api.response_models import OptimizerPathResponse, OptimizerMatrixResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/optimizer", tags=["optimizer"])


# ---------------------------------------------------------------------------
# Helper: Bellman-Ford shortest path on -log(rate) weighted graph
# ---------------------------------------------------------------------------

def _detect_negative_cycle_nodes(
    graph: dict[str, list[tuple[str, float, float]]],
    dist: dict[str, float],
    predecessor: dict[str, tuple[str, float]],
) -> set[str]:
    """Identify nodes lying on a negative cycle reachable from source.

    A negative cycle in the -log(rate) graph corresponds to a profitable
    arbitrage cycle: the product of raw rates around the cycle is > 1
    (i.e. sum of -log(rates) < 0). The standard Bellman-Ford signal is
    that after V-1 relaxations at least one edge can still be relaxed.

    This helper runs one extra relaxation pass over the current `dist`
    map. Any node whose distance can still decrease is on or downstream
    of a negative cycle. We then walk predecessor chains from those
    nodes to mark the actual cycle members (so callers can decide
    whether the target is affected).

    Args:
        graph: adjacency list — graph[u] = [(v, -log(rate), rate), ...]
        dist: distance map after the main relaxation phase
        predecessor: predecessor map after the main relaxation phase

    Returns:
        Set of node IDs that lie on a negative cycle. Empty set if no
        negative cycle is reachable.
    """
    # Pass 1: collect nodes whose distance can still be relaxed.
    # These are "affected" — on the cycle or downstream of it.
    affected: set[str] = set()
    for u in graph:
        if u not in dist:
            continue
        for v, weight, _ in graph[u]:
            new_dist = dist[u] + weight
            if v not in dist or new_dist < dist[v] - 1e-15:
                affected.add(v)

    if not affected:
        return set()

    # Pass 2: walk predecessor chains from affected nodes to find the
    # actual cycle members. A node is on a cycle iff it appears in its
    # own predecessor ancestry.
    cycle_nodes: set[str] = set()
    for start in affected:
        visited: list[str] = []
        current: str | None = start
        while current is not None and current not in visited:
            visited.append(current)
            pred = predecessor.get(current)
            current = pred[0] if pred else None
        if current is not None:
            # The cycle starts at `current` in the visited list.
            cycle_start_idx = visited.index(current)
            cycle_nodes.update(visited[cycle_start_idx:])

    return cycle_nodes


def _bellman_ford(
    graph: dict[str, list[tuple[str, float, float]]],
    source: str,
    target: str,
    max_hops: int = 5,
) -> tuple[list[str], list[float]] | None:
    """Find the shortest path (best rate) from source to target.

    Uses Bellman-Ford which correctly handles negative edge weights
    (unlike Dijkstra). Negative weights arise when rate > 1 and the
    edge weight is -log(rate).

    P1-8 (iter 64): after `max_hops` relaxation passes we run one
    additional pass to detect a negative cycle (profitable arbitrage).
    A negative cycle reachable from `source` means the shortest path
    to any node on or downstream of that cycle is unbounded — the
    product of rates around the cycle is > 1, so the trader could
    loop indefinitely for profit. In that case the "optimal" path is
    not well-defined; we log a warning and return None when the
    target is on the cycle, so the caller can fall back to the
    direct edge if any. When the target is *not* on the cycle we
    still return the reconstructed path (it is unaffected).

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
    # Initialize distances and predecessors
    dist: dict[str, float] = {source: 0.0}
    predecessor: dict[str, tuple[str, float]] = {}  # node -> (prev_node, raw_rate)

    # Collect all nodes
    nodes = set(graph.keys())
    for neighbors in graph.values():
        for neighbor, _, _ in neighbors:
            nodes.add(neighbor)

    # Relax edges up to max_hops times
    for iteration in range(max_hops):
        updated = False
        for u in graph:
            if u not in dist:
                continue
            for v, weight, raw_rate in graph[u]:
                new_dist = dist[u] + weight
                if v not in dist or new_dist < dist[v]:
                    dist[v] = new_dist
                    predecessor[v] = (u, raw_rate)
                    updated = True
        if not updated:
            break

    # P1-8: detect negative cycle (profitable arbitrage opportunity).
    # A negative cycle in -log(rate) space <=> product of raw rates
    # around the cycle > 1. If one is reachable from source, paths
    # through the cycle have unbounded profit, so the "optimal" path
    # is not well-defined.
    cycle_nodes = _detect_negative_cycle_nodes(graph, dist, predecessor)
    if cycle_nodes:
        logger.warning(
            "Negative cycle (arbitrage opportunity) detected in "
            "exchange rate graph. Cycle nodes: %s. Paths through "
            "these nodes have unbounded profit.",
            sorted(cycle_nodes),
        )
        if target in cycle_nodes:
            # Optimal path is undefined — caller should fall back to
            # direct edge if available (handled by endpoint below).
            return None

    # Check if target is reachable
    if target not in dist:
        return None

    # Reconstruct path from predecessor map
    path: list[str] = []
    step_rates: list[float] = []
    current = target
    visited = set()

    while current != source:
        if current in visited:
            # Defensive: path reconstruction cycle. With the explicit
            # negative-cycle detection above this should not trigger,
            # but if it ever does we refuse to return a broken path.
            return None
        visited.add(current)

        pred = predecessor.get(current)
        if pred is None:
            return None

        prev_node, rate = pred
        path.append(current)
        step_rates.append(rate)
        current = prev_node

    path.append(source)
    path.reverse()
    step_rates.reverse()

    return path, step_rates


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

@router.get("/path", response_model=OptimizerPathResponse)
async def get_optimal_path(
    from_currency: str = Query(..., description="Source currency api_id (e.g. 'chaos')"),
    to_currency: str = Query(..., description="Target currency api_id (e.g. 'divine')"),
    amount: float = Query(1.0, ge=0.001, description="Amount of source currency to convert"),
    max_hops: int = Query(5, ge=1, le=10, description="Maximum number of hops in the path"),
):
    """Find the optimal conversion path between two currencies.

    Uses Bellman-Ford algorithm on the exchange rate graph where edge weights
    are -log(raw_rate), so the shortest path corresponds to the best
    effective conversion rate. Bellman-Ford correctly handles negative
    weights that arise when rate > 1.

    P1-8 (iter 64): after the standard relaxation phase the algorithm
    checks for a negative cycle (profitable arbitrage: product of rates
    around a cycle > 1). When the requested `to_currency` lies on such
    a cycle, the optimal path is unbounded — the endpoint returns an
    empty `path` with `data_available: True`, and the caller can still
    use the reported `direct_rate` to fall back to a single-hop
    conversion.

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

    # Run Bellman-Ford (replaces Dijkstra — handles negative -log(rate) weights)
    result = _bellman_ford(graph, from_lower, to_lower, max_hops)

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


@router.get("/matrix", response_model=OptimizerMatrixResponse)
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
