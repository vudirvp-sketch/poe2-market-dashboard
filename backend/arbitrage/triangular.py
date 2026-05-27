"""
Triangular Arbitrage Detection using Bellman-Ford negative cycle detection.

From PoE2_Flipper_Canonical_Formulas.md §8:

Edge weight formula (direction-dependent fees):
    gold_fee_fraction(u→v) = (gold_cost_per_unit[v] × qty_v × gold_to_chaos_rate) / trade_value_chaos
    effective_rate(u→v) = raw_rate(u→v) * (1 - gold_fee_fraction(u→v))
    weight(u→v) = -ln(effective_rate(u→v))

IMPORTANT: The fee fraction is DIRECTION-DEPENDENT. A→B and B→A have
DIFFERENT fee fractions because you receive different currencies in each
direction. This asymmetry is a core feature of PoE2's fee model.

After detecting a negative cycle, validate by simulating with raw rates.
If simulated profit < 0.1%, discard (numerical artifact).
"""

from __future__ import annotations

import logging
from typing import Optional

import numpy as np

from backend.economy.gold_cost_table import get_gold_cost_per_unit
from backend.models.currency import TriangularOpportunity

logger = logging.getLogger(__name__)


def find_triangular_arbitrage(
    rates: dict[tuple[str, str], float],
    gold_cost_per_unit: dict[str, int],
    prices_in_chaos: dict[str, float],
    gold_to_chaos_rate: float,
    min_profit_pct: float = 0.1,
    fallback_gold_cost: int = 200,
) -> list[TriangularOpportunity]:
    """Find triangular (and multi-hop) arbitrage opportunities using Bellman-Ford.

    From §8.6 Full Function Pseudocode — the core algorithm.

    Args:
        rates: Dict mapping (currency_from, currency_to) to raw exchange rate
        gold_cost_per_unit: Per-unit gold cost for each currency (api_id → gold cost)
        prices_in_chaos: Current price of each currency in Chaos Orbs
        gold_to_chaos_rate: How many Chaos Orbs per 1 gold
        min_profit_pct: Minimum profit percentage to report (default 0.1%)
        fallback_gold_cost: Default gold cost for unknown currencies

    Returns:
        List of TriangularOpportunity objects
    """
    # Build currency list
    currencies = set()
    for (u, v) in rates:
        currencies.add(u)
        currencies.add(v)
    currencies = sorted(currencies)
    n = len(currencies)
    curr_to_idx = {c: i for i, c in enumerate(currencies)}

    # Build edge list with weights (direction-dependent fees)
    edges = []
    for (u, v), raw_rate in rates.items():
        # §8.1: Compute fee fraction for receiving currency v
        qty_v = raw_rate  # for 1 unit of u
        price_v = prices_in_chaos.get(v, 0)
        if price_v <= 0:
            continue
        trade_value = qty_v * price_v

        per_unit_cost = gold_cost_per_unit.get(v, fallback_gold_cost)
        gold_fee = per_unit_cost * qty_v
        fee_chaos = gold_fee * gold_to_chaos_rate
        fee_fraction = fee_chaos / trade_value if trade_value > 0 else 0

        eff_rate = raw_rate * (1 - fee_fraction)
        if eff_rate <= 0:
            continue
        weight = -np.log(eff_rate)
        edges.append((curr_to_idx[u], curr_to_idx[v], weight, eff_rate, fee_fraction))

    if n == 0 or len(edges) == 0:
        return []

    results: list[TriangularOpportunity] = []
    seen_cycles: set[tuple[str, ...]] = set()

    # §8.5: Run Bellman-Ford from every node as source
    for source_idx in range(n):
        INF = float('inf')
        dist = [INF] * n
        pred = [-1] * n
        dist[source_idx] = 0.0

        # §8.2: Relax edges V-1 times
        for _ in range(n - 1):
            updated = False
            for u, v, w, _, _ in edges:
                if dist[u] + w < dist[v]:
                    dist[v] = dist[u] + w
                    pred[v] = u
                    updated = True
            if not updated:
                break

        # Check for negative cycles
        for u, v, w, _, _ in edges:
            if dist[u] != INF and dist[u] + w < dist[v]:
                # Extract the cycle (§8.2)
                # Walk back V steps via predecessor to ensure we're in the cycle
                node = v
                for _ in range(n):
                    node = pred[node]
                    if node == -1:
                        break

                if node == -1:
                    continue

                # Now walk from node via predecessors to extract the actual cycle
                cycle_idx = []
                current = node
                visited_order = []
                while True:
                    cycle_idx.append(current)
                    current = pred[current]
                    if current == -1:
                        break
                    if current in cycle_idx:
                        # Found the cycle — trim to just the cycle portion
                        start_idx = cycle_idx.index(current)
                        cycle_idx = cycle_idx[start_idx:]
                        cycle_idx.append(current)  # close the cycle
                        break

                if current == -1 or len(cycle_idx) < 2:
                    continue

                # Reverse to get the cycle in traversal order
                cycle_idx.reverse()

                # Convert to currency names
                cycle_names = [currencies[i] for i in cycle_idx]

                # Deduplicate cycles
                cycle_key = tuple(sorted(set(cycle_names)))
                if cycle_key in seen_cycles:
                    continue
                seen_cycles.add(cycle_key)

                # §8.3: Compute profit with raw rates and direction-dependent fees
                cum_rate = 1.0
                step_rates = []
                step_fees_gold = []
                step_fees_fraction = []
                valid = True
                total_volume = float('inf')

                for i in range(len(cycle_names) - 1):
                    pair = (cycle_names[i], cycle_names[i + 1])
                    if pair not in rates:
                        valid = False
                        break
                    raw = rates[pair]
                    qty_v = raw
                    price_v = prices_in_chaos.get(cycle_names[i + 1], 0)
                    if price_v <= 0:
                        valid = False
                        break
                    trade_value = qty_v * price_v
                    per_unit = gold_cost_per_unit.get(cycle_names[i + 1], fallback_gold_cost)
                    gold_fee = per_unit * qty_v
                    fee_chaos = gold_fee * gold_to_chaos_rate
                    fee_frac = fee_chaos / trade_value if trade_value > 0 else 0

                    eff = raw * (1 - fee_frac)
                    cum_rate *= eff
                    step_rates.append(raw)
                    step_fees_gold.append(gold_fee)
                    step_fees_fraction.append(fee_frac)

                if not valid:
                    continue

                profit_pct = (cum_rate - 1.0) * 100

                # §8.4: Validation (anti-false-positive)
                if profit_pct < min_profit_pct:
                    continue  # numerical artifact

                # Compute total volume (bottleneck = min volume across edges)
                # Use a simple heuristic: min volume across edges
                for i in range(len(cycle_names) - 1):
                    pair = (cycle_names[i], cycle_names[i + 1])
                    # We don't have volume in rates dict directly;
                    # this would need to be passed in. For now, use 0.
                    pass

                # Confidence based on data freshness
                confidence = min(1.0, len(cycle_names) / 5.0)  # rough heuristic

                results.append(TriangularOpportunity(
                    cycle=cycle_names,
                    net_profit_pct=profit_pct,
                    step_rates=step_rates,
                    step_fees_gold=step_fees_gold,
                    step_fees_fraction=step_fees_fraction,
                    total_volume=0.0,  # TODO: compute from actual volume data
                    confidence=confidence,
                ))

    return results
