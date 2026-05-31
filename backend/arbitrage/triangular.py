"""
Triangular Arbitrage Detection using Bellman-Ford negative cycle detection.

From PoE2_Flipper_Canonical_Formulas.md §8 (simplified: gold fees excluded):

Edge weight formula (gold/commission excluded per project decision):
    effective_rate(u→v) = raw_rate(u→v)
    weight(u→v) = -ln(raw_rate(u→v))

NOTE: Gold/commission fees have been intentionally excluded from all
calculations. The raw exchange rate is used directly without fee
deduction. This simplifies the model and avoids the complexity of
direction-dependent fee asymmetry.

After detecting a negative cycle, validate by simulating with raw rates.
If simulated profit < 0.1%, discard (numerical artifact).
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

import numpy as np

from backend.models.currency import TriangularOpportunity

logger = logging.getLogger(__name__)


def _compute_confidence(
    cycle_names: list[str],
    total_volume: float,
    snapshot_time: datetime | None = None,
) -> float:
    """Compute confidence score for a detected arbitrage cycle.

    Phase 2 (Spec §11.2): Confidence is based on:
    1. Data freshness: how recent is the snapshot (max 1.0 if <5min old, decays)
    2. Volume: higher volume = more reliable rate
    3. Cycle length: shorter cycles are more likely to fill

    Formula:
        freshness = max(0.0, 1.0 - (minutes_since_snapshot / 60.0))
        volume_score = min(1.0, log1p(total_volume) / log1p(1000))
        length_penalty = 1.0 / len(cycle_names)
        confidence = freshness * volume_score * length_penalty * 3  # normalize
        confidence = min(1.0, confidence)

    Args:
        cycle_names: List of currency names in the cycle (including closing node)
        total_volume: Min volume across edges (bottleneck)
        snapshot_time: When the snapshot data was taken (None = assume fresh)

    Returns:
        Confidence score between 0.0 and 1.0
    """
    # 1. Data freshness
    freshness = 1.0  # assume fresh if no timestamp provided
    if snapshot_time is not None:
        now = datetime.now(timezone.utc)
        if snapshot_time.tzinfo is None:
            snapshot_time = snapshot_time.replace(tzinfo=timezone.utc)
        minutes_since = (now - snapshot_time).total_seconds() / 60.0
        freshness = max(0.0, 1.0 - (minutes_since / 60.0))

    # 2. Volume score
    volume_score = min(1.0, np.log1p(total_volume) / np.log1p(1000))

    # 3. Cycle length penalty (3-node = 0.33, 4-node = 0.25)
    length_penalty = 1.0 / len(cycle_names)

    # 4. Combine with normalization so a 3-node cycle with fresh, high-volume data ≈ 1.0
    confidence = freshness * volume_score * length_penalty * 3.0
    confidence = min(1.0, confidence)

    return confidence


def find_triangular_arbitrage(
    rates: dict[tuple[str, str], float],
    prices: dict[str, float],
    min_profit_pct: float = 0.1,
    pair_volumes: dict[tuple[str, str], float] | None = None,
    snapshot_time: datetime | None = None,
) -> list[TriangularOpportunity]:
    """Find triangular (and multi-hop) arbitrage opportunities using Bellman-Ford.

    Simplified: gold/commission fees are EXCLUDED from all calculations.
    The raw exchange rate is used directly (no fee deduction on edges).

    Args:
        rates: Dict mapping (currency_from, currency_to) to raw exchange rate
        prices: Current price of each currency in the reference currency
        min_profit_pct: Minimum profit percentage to report (default 0.1%)
        pair_volumes: Optional volume data per edge
        snapshot_time: When the snapshot data was taken

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

    # Build edge list — gold fees EXCLUDED, use raw_rate directly
    volumes_map = pair_volumes or {}
    edges = []
    for (u, v), raw_rate in rates.items():
        if raw_rate <= 0:
            continue
        weight = -np.log(raw_rate)
        edge_volume = volumes_map.get((u, v), 0.0)
        edges.append((curr_to_idx[u], curr_to_idx[v], weight, raw_rate, edge_volume))

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
            for u, v, w, *_ in edges:
                if dist[u] + w < dist[v]:
                    dist[v] = dist[u] + w
                    pred[v] = u
                    updated = True
            if not updated:
                break

        # Check for negative cycles
        for u, v, w, *_ in edges:
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

                # §8.3: Compute profit with raw rates (no fee deduction)
                cum_rate = 1.0
                step_rates = []
                step_volumes = []
                valid = True

                for i in range(len(cycle_names) - 1):
                    pair = (cycle_names[i], cycle_names[i + 1])
                    if pair not in rates:
                        valid = False
                        break
                    raw = rates[pair]
                    cum_rate *= raw
                    step_rates.append(raw)

                    # Phase 2 (Spec §11): Track volume per edge
                    edge_vol = volumes_map.get(pair, 0.0)
                    step_volumes.append(edge_vol)

                if not valid:
                    continue

                profit_pct = (cum_rate - 1.0) * 100

                # §8.4: Validation (anti-false-positive)
                if profit_pct < min_profit_pct:
                    continue  # numerical artifact

                # Phase 2 (Spec §11.1): Compute total volume (bottleneck = min across edges)
                total_volume = 0.0
                if step_volumes and any(v > 0 for v in step_volumes):
                    # Use min of non-zero volumes as bottleneck
                    nonzero_vols = [v for v in step_volumes if v > 0]
                    total_volume = min(nonzero_vols) if nonzero_vols else 0.0

                # Phase 2 (Spec §11.2): Compute confidence from data freshness and volume
                confidence = _compute_confidence(
                    cycle_names=cycle_names,
                    total_volume=total_volume,
                    snapshot_time=snapshot_time,
                )

                results.append(TriangularOpportunity(
                    cycle=cycle_names,
                    net_profit_pct=profit_pct,
                    step_rates=step_rates,
                    total_volume=total_volume,
                    confidence=confidence,
                ))

    return results
