"""
Tests for `backend/api/routes_optimizer.py`.

Covers:
- `_build_graph` — graph construction from exchange rates
- `_bellman_ford` — shortest-path on -log(rate) graph
- `_detect_negative_cycle_nodes` — P1-8 (iter 64): negative cycle / arbitrage detection
- `_collect_currencies` — unique currency extraction

P1-8 regression tests specifically guard against the previously buggy
behaviour where a profitable arbitrage cycle (product of rates around
the cycle > 1) caused `_bellman_ford` to silently return a stale path
instead of signalling that the optimal path is unbounded.
"""

from __future__ import annotations

import math

import pytest

from backend.api.routes_optimizer import (
    _bellman_ford,
    _build_graph,
    _collect_currencies,
    _detect_negative_cycle_nodes,
)
from backend.models.currency import ExchangeRate


# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------

def _make_rate(
    currency_from: str,
    currency_to: str,
    raw_rate: float,
    volume: int = 100,
) -> ExchangeRate:
    """Build an ExchangeRate with the minimum required fields."""
    return ExchangeRate(
        currency_from=currency_from,
        currency_to=currency_to,
        raw_rate=raw_rate,
        volume_traded=volume,
        stock_value=0.0,
        highest_stock=0,
    )


def _make_graph(rates: dict[str, ExchangeRate]) -> dict[str, list[tuple[str, float, float]]]:
    """Build the optimizer graph from a dict of ExchangeRate objects."""
    return _build_graph(rates)


# ---------------------------------------------------------------------------
# _build_graph tests
# ---------------------------------------------------------------------------

class TestBuildGraph:
    """Verify graph construction from exchange rates."""

    def test_forward_edge_weight(self):
        """u -> v edge weight = -log(rate)."""
        rates = {"a_b": _make_rate("a", "b", 10.0)}
        graph = _make_graph(rates)
        assert "a" in graph
        forward = [(v, w, r) for v, w, r in graph["a"] if v == "b"]
        assert len(forward) == 1
        _, weight, raw = forward[0]
        assert weight == pytest.approx(-math.log(10.0))
        assert raw == pytest.approx(10.0)

    def test_reverse_edge_weight(self):
        """Reverse edge v -> u has rate 1/r, weight = log(rate) = -log(1/r)."""
        rates = {"a_b": _make_rate("a", "b", 10.0)}
        graph = _make_graph(rates)
        assert "b" in graph
        reverse = [(v, w, r) for v, w, r in graph["b"] if v == "a"]
        assert len(reverse) == 1
        _, weight, raw = reverse[0]
        assert raw == pytest.approx(1.0 / 10.0)
        assert weight == pytest.approx(math.log(10.0))

    def test_skips_non_positive_rates(self):
        """Rates <= 0 are silently dropped."""
        rates = {
            "a_b": _make_rate("a", "b", 0.0),
            "c_d": _make_rate("c", "d", -1.0),
            "e_f": _make_rate("e", "f", 5.0),
        }
        graph = _make_graph(rates)
        # Only e -> f (and its reverse) should be in the graph
        assert "a" not in graph
        assert "c" not in graph
        assert "e" in graph
        assert "f" in graph


# ---------------------------------------------------------------------------
# _bellman_ford — basic shortest path tests
# ---------------------------------------------------------------------------

class TestBellmanFordBasic:
    """Verify the standard shortest-path behaviour on well-formed graphs."""

    def test_direct_edge(self):
        """Single-hop path is found when a direct edge exists."""
        rates = {"a_b": _make_rate("a", "b", 5.0)}
        graph = _make_graph(rates)
        result = _bellman_ford(graph, "a", "b", max_hops=3)
        assert result is not None
        path, step_rates = result
        assert path == ["a", "b"]
        assert step_rates == [pytest.approx(5.0)]

    def test_two_hop_chain_path(self):
        """Two-hop chain a -> b -> c is arbitrage-free and returns the path.

        Setup: a -> b at rate 5, b -> c at rate 2. No shortcut edge a -> c.
        All cycles in this graph: a -> b -> a (product 5 * 1/5 = 1),
        b -> c -> b (product 2 * 1/2 = 1). Both are zero cycles, NOT
        negative cycles — so no arbitrage, no negative-cycle signal.
        Bellman-Ford correctly returns the chain a -> b -> c.
        """
        rates = {
            "a_b": _make_rate("a", "b", 5.0),
            "b_c": _make_rate("b", "c", 2.0),
        }
        graph = _make_graph(rates)
        result = _bellman_ford(graph, "a", "c", max_hops=3)
        assert result is not None
        path, step_rates = result
        assert path == ["a", "b", "c"]
        assert step_rates == [pytest.approx(5.0), pytest.approx(2.0)]

    def test_three_node_chain_with_shortcut_is_arbitrage(self):
        """Any inconsistency between direct and indirect rates IS arbitrage.

        Setup: a -> b at 5, b -> c at 2, a -> c at 11 (direct beats indirect).
        Cycle a -> c -> b -> a (using reverse edges): 11 * (1/2) * (1/5) = 1.1 > 1.
        This is a profitable arbitrage cycle → algorithm returns None for
        any target on the cycle.
        """
        rates = {
            "a_b": _make_rate("a", "b", 5.0),
            "b_c": _make_rate("b", "c", 2.0),
            "a_c": _make_rate("a", "c", 11.0),
        }
        graph = _make_graph(rates)
        # All three nodes are on the arbitrage cycle.
        assert _bellman_ford(graph, "a", "b", max_hops=5) is None
        assert _bellman_ford(graph, "a", "c", max_hops=5) is None

    def test_returns_none_for_unreachable_target(self):
        """Target outside the connected component returns None."""
        rates = {
            "a_b": _make_rate("a", "b", 1.0),
            "c_d": _make_rate("c", "d", 1.0),
        }
        graph = _make_graph(rates)
        result = _bellman_ford(graph, "a", "d", max_hops=3)
        assert result is None

    def test_returns_none_for_missing_source(self):
        """Source not in graph returns None."""
        rates = {"a_b": _make_rate("a", "b", 1.0)}
        graph = _make_graph(rates)
        result = _bellman_ford(graph, "x", "b", max_hops=3)
        assert result is None

    def test_zero_hops_source_equals_target(self):
        """Source == target with max_hops >= 0 returns a degenerate path."""
        rates = {"a_b": _make_rate("a", "b", 1.0)}
        graph = _make_graph(rates)
        # When source == target, the while-loop in path reconstruction
        # never executes, so path = [source] and step_rates = [].
        result = _bellman_ford(graph, "a", "a", max_hops=3)
        assert result is not None
        path, step_rates = result
        assert path == ["a"]
        assert step_rates == []

    def test_respects_max_hops_limit(self):
        """Path longer than max_hops is not returned even if it would be better."""
        # a -> b -> c -> d at product 100, but max_hops=1 only allows a -> b
        rates = {
            "a_b": _make_rate("a", "b", 2.0),
            "b_c": _make_rate("b", "c", 5.0),
            "c_d": _make_rate("c", "d", 10.0),
        }
        graph = _make_graph(rates)
        result = _bellman_ford(graph, "a", "d", max_hops=1)
        # Cannot reach d in 1 hop
        assert result is None

    def test_negative_weights_handled_correctly(self):
        """Reverse edges where rate > 1 have negative weights — Dijkstra would fail here."""
        # 1 exalted = 10 chaos, so the reverse edge 1 chaos = 0.1 exalted
        # has weight -log(0.1) = log(10) > 0 (positive).
        # But the forward edge 1 exalted = 10 chaos has weight -log(10) < 0
        # (negative). Bellman-Ford must handle this correctly.
        rates = {"exalted_chaos": _make_rate("exalted", "chaos", 10.0)}
        graph = _make_graph(rates)
        # exalted -> chaos: direct, rate 10
        result = _bellman_ford(graph, "exalted", "chaos", max_hops=3)
        assert result is not None
        path, step_rates = result
        assert path == ["exalted", "chaos"]
        assert step_rates == [pytest.approx(10.0)]


# ---------------------------------------------------------------------------
# _detect_negative_cycle_nodes tests (P1-8)
# ---------------------------------------------------------------------------

class TestDetectNegativeCycle:
    """P1-8 (iter 64): negative cycle / arbitrage detection."""

    def test_no_cycle_returns_empty_set(self):
        """Healthy graph (no arbitrage) returns empty cycle set."""
        # a -> b at rate 2, b -> c at rate 3, c -> a at rate 1/6
        # Product around cycle: 2 * 3 * (1/6) = 1 → not profitable.
        rates = {
            "a_b": _make_rate("a", "b", 2.0),
            "b_c": _make_rate("b", "c", 3.0),
            "c_a": _make_rate("c", "a", 1.0 / 6.0),
        }
        graph = _make_graph(rates)
        # Run Bellman-Ford from `a` to populate dist + predecessor.
        dist = {"a": 0.0}
        predecessor: dict[str, tuple[str, float]] = {}
        for _ in range(5):
            updated = False
            for u in graph:
                if u not in dist:
                    continue
                for v, weight, raw in graph[u]:
                    new_dist = dist[u] + weight
                    if v not in dist or new_dist < dist[v]:
                        dist[v] = new_dist
                        predecessor[v] = (u, raw)
                        updated = True
            if not updated:
                break

        cycle = _detect_negative_cycle_nodes(graph, dist, predecessor)
        assert cycle == set()

    def test_profitable_cycle_detected(self):
        """Profitable arbitrage cycle is detected.

        a -> b at rate 2, b -> c at rate 3, c -> a at rate 0.5
        Product around cycle: 2 * 3 * 0.5 = 3 > 1 → profitable.
        In -log space the cycle has negative total weight.
        """
        rates = {
            "a_b": _make_rate("a", "b", 2.0),
            "b_c": _make_rate("b", "c", 3.0),
            "c_a": _make_rate("c", "a", 0.5),
        }
        graph = _make_graph(rates)
        # Run enough relaxation passes for the cycle to manifest.
        dist = {"a": 0.0}
        predecessor: dict[str, tuple[str, float]] = {}
        for _ in range(10):
            for u in graph:
                if u not in dist:
                    continue
                for v, weight, raw in graph[u]:
                    new_dist = dist[u] + weight
                    if v not in dist or new_dist < dist[v]:
                        dist[v] = new_dist
                        predecessor[v] = (u, raw)

        cycle = _detect_negative_cycle_nodes(graph, dist, predecessor)
        # All three nodes are on the cycle.
        assert cycle == {"a", "b", "c"}

    def test_cycle_isolated_from_source_not_flagged(self):
        """Cycle in unreachable component does not affect reachable component."""
        # Source component: a -> b at rate 2 (healthy)
        # Unreachable component: c -> d at rate 3, d -> c at rate 0.4 (cycle)
        rates = {
            "a_b": _make_rate("a", "b", 2.0),
            "c_d": _make_rate("c", "d", 3.0),
            "d_c": _make_rate("d", "c", 0.4),
        }
        graph = _make_graph(rates)
        dist = {"a": 0.0}
        predecessor: dict[str, tuple[str, float]] = {}
        for _ in range(10):
            for u in graph:
                if u not in dist:
                    continue
                for v, weight, raw in graph[u]:
                    new_dist = dist[u] + weight
                    if v not in dist or new_dist < dist[v]:
                        dist[v] = new_dist
                        predecessor[v] = (u, raw)

        cycle = _detect_negative_cycle_nodes(graph, dist, predecessor)
        # The c-d cycle is unreachable from `a`, so no nodes are affected.
        assert cycle == set()

    def test_empty_graph_returns_empty_set(self):
        """Empty graph → no cycles."""
        cycle = _detect_negative_cycle_nodes({}, {"a": 0.0}, {})
        assert cycle == set()


# ---------------------------------------------------------------------------
# _bellman_ford — negative cycle integration tests (P1-8)
# ---------------------------------------------------------------------------

class TestBellmanFordNegativeCycle:
    """End-to-end: _bellman_ford handles profitable arbitrage cycles."""

    def test_target_on_cycle_returns_none(self):
        """When target is on a negative cycle, return None.

        Without P1-8 the algorithm would return a stale path through
        the cycle. With P1-8 it logs a warning and returns None so the
        caller falls back to the direct edge.
        """
        # a -> b at rate 2, b -> a at rate 0.6
        # Product around cycle: 2 * 0.6 = 1.2 > 1 → profitable.
        rates = {
            "a_b": _make_rate("a", "b", 2.0),
            "b_a": _make_rate("b", "a", 0.6),
        }
        graph = _make_graph(rates)
        result = _bellman_ford(graph, "a", "b", max_hops=5)
        # Target `b` is on the profitable cycle → None.
        assert result is None

    def test_target_off_cycle_still_returns_path(self):
        """Target outside the cycle still gets its shortest path."""
        # Cycle: a <-> b profitable (2 * 0.6 = 1.2)
        # Off-cycle: a -> c at rate 4 (c is downstream of a but not on cycle)
        rates = {
            "a_b": _make_rate("a", "b", 2.0),
            "b_a": _make_rate("b", "a", 0.6),
            "a_c": _make_rate("a", "c", 4.0),
        }
        graph = _make_graph(rates)
        result = _bellman_ford(graph, "a", "c", max_hops=5)
        # c is not on the cycle, so we still get a path.
        assert result is not None
        path, step_rates = result
        assert path == ["a", "c"]
        assert step_rates == [pytest.approx(4.0)]

    def test_no_cycle_path_returned_normally(self):
        """Healthy graph: no None from cycle detection."""
        # a -> b at rate 2, b -> c at rate 3, c -> a at rate 1/6
        # Product = 1, not profitable.
        rates = {
            "a_b": _make_rate("a", "b", 2.0),
            "b_c": _make_rate("b", "c", 3.0),
            "c_a": _make_rate("c", "a", 1.0 / 6.0),
        }
        graph = _make_graph(rates)
        result = _bellman_ford(graph, "a", "c", max_hops=5)
        assert result is not None
        path, step_rates = result
        assert path[0] == "a"
        assert path[-1] == "c"
        # Product of step rates = effective rate, must be > 0.
        effective = 1.0
        for r in step_rates:
            effective *= r
        assert effective > 0

    def test_three_node_profitable_cycle(self):
        """Three-node arbitrage cycle is handled correctly."""
        # a -> b at 2, b -> c at 3, c -> a at 0.5
        # Product around cycle = 3 > 1 → profitable.
        rates = {
            "a_b": _make_rate("a", "b", 2.0),
            "b_c": _make_rate("b", "c", 3.0),
            "c_a": _make_rate("c", "a", 0.5),
        }
        graph = _make_graph(rates)
        # Target on cycle → None.
        assert _bellman_ford(graph, "a", "b", max_hops=5) is None
        assert _bellman_ford(graph, "a", "c", max_hops=5) is None


# ---------------------------------------------------------------------------
# _collect_currencies tests
# ---------------------------------------------------------------------------

class TestCollectCurrencies:
    """Verify unique currency extraction from exchange rates."""

    def test_returns_sorted_unique_currencies(self):
        rates = {
            "a_b": _make_rate("a", "b", 1.0),
            "b_c": _make_rate("b", "c", 1.0),
            "c_a": _make_rate("c", "a", 1.0),
        }
        currencies = _collect_currencies(rates)
        assert currencies == ["a", "b", "c"]

    def test_empty_rates_returns_empty_list(self):
        assert _collect_currencies({}) == []

    def test_single_pair_returns_two_currencies(self):
        rates = {"a_b": _make_rate("a", "b", 1.0)}
        assert _collect_currencies(rates) == ["a", "b"]

    def test_handles_duplicate_currencies(self):
        rates = {
            "a_b": _make_rate("a", "b", 1.0),
            "a_b_dup": _make_rate("a", "b", 2.0),
        }
        assert _collect_currencies(rates) == ["a", "b"]
