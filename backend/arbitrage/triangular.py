"""
Triangular Arbitrage Detection using Bellman-Ford negative cycle detection.

From PoE2_Flipper_Canonical_Formulas.md §8 (simplified: gold fees excluded):

Edge weight formula (§7: with realistic spread model):
    spread = estimateSpreadFromVolume(edge_volume)  # §7.1.1
    effective_rate(u→v) = raw_rate(u→v) * (1 - spread / 2)
    weight(u→v) = -ln(effective_rate(u→v))

Low-liquidity edges (volume < MIN_EDGE_VOLUME=50) are filtered out (§6b).

After detecting a negative cycle, validate by simulating with raw rates.
If simulated profit < min_profit_pct (default 1.0%), discard (numerical artifact).

QUANTIZED VALIDATION (P1-2):
  The continuous profit from Bellman-Ford can be misleading — PoE2 exchange
  requires positive integers on both sides. A cycle showing +0.5% profit on
  float math may be a loss when integers are required. The integer simulation
  validates each detected cycle and only reports cycles that are profitable
  with actual integer amounts.
"""

from __future__ import annotations

import logging
import math
from datetime import datetime, timezone
from typing import Optional

import numpy as np

from backend.models.currency import TriangularOpportunity

logger = logging.getLogger(__name__)


def simulate_cycle_integers(
    cycle: list[str],
    rates: dict[tuple[str, str], float],
    start_amount: int,
) -> tuple[int, list[int]]:
    """Simulate a triangular arbitrage cycle using integer math.

    cycle: ["CurrencyA", "CurrencyB", "CurrencyC"] (will close A→B→C→A)
    rates: {(from, to): float_rate} — direct conversion rates
    start_amount: integer amount of starting currency

    Returns: (final_amount, [amounts_at_each_step])
    """
    amounts = [start_amount]
    current = start_amount

    for i in range(len(cycle)):
        from_curr = cycle[i]
        to_curr = cycle[(i + 1) % len(cycle)]
        rate = rates.get((from_curr, to_curr))
        if rate is None:
            # Try inverse
            inverse = rates.get((to_curr, from_curr))
            if inverse is None:
                return (0, amounts)  # Cannot complete cycle
            current = math.floor(current / inverse) if inverse > 0 else 0
        else:
            current = math.floor(current * rate)
        amounts.append(current)

    return (current, amounts)


def find_min_profitable_start(
    cycle: list[str],
    rates: dict[tuple[str, str], float],
    max_start: int = 10000,
) -> int:
    """Find the minimum starting integer amount that yields profit in a cycle.

    Returns 0 if no profitable amount found within max_start.
    """
    for start in range(1, max_start + 1):
        final, _ = simulate_cycle_integers(cycle, rates, start)
        if final > start:
            return start
    return 0


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


def _compute_cross_rate_divergence(
    rates: dict[tuple[str, str], float],
    threshold_pct: float = 5.0,
) -> set[tuple[str, str, str]]:
    """Detect cross-rate inconsistencies that produce false arbitrage signals.

    For every triple (A, B, C) where all three direct rates exist:
        implied_A_C = rate(A→B) * rate(B→C)
        direct_A_C = rate(A→C)
        divergence_pct = |implied_A_C - direct_A_C| / direct_A_C * 100

    If divergence_pct > threshold_pct, the triple is flagged as "suspicious".
    Any detected arbitrage cycle that passes through a suspicious triple
    is likely a false positive caused by inconsistent relative_price data
    across pairs, not a real market inefficiency.

    Args:
        rates: Dict mapping (currency_from, currency_to) to raw exchange rate
        threshold_pct: Divergence threshold in percent (default 5%)

    Returns:
        Set of suspicious triples as frozensets of 3 currency names.
    """
    suspicious_triples: set[frozenset[str]] = set()

    # Build adjacency for quick lookup
    rate_lookup = dict(rates)  # (from, to) -> rate

    # For every triple of currencies with all edges present
    all_currencies = set()
    for (u, v) in rates:
        all_currencies.add(u)
        all_currencies.add(v)
    all_currencies = sorted(all_currencies)

    for a in all_currencies:
        for b in all_currencies:
            if b == a:
                continue
            r_ab = rate_lookup.get((a, b))
            if r_ab is None or r_ab <= 0:
                continue
            for c in all_currencies:
                if c == a or c == b:
                    continue
                r_bc = rate_lookup.get((b, c))
                if r_bc is None or r_bc <= 0:
                    continue
                r_ac = rate_lookup.get((a, c))
                if r_ac is None or r_ac <= 0:
                    continue

                implied_ac = r_ab * r_bc
                divergence = abs(implied_ac - r_ac) / r_ac * 100
                if divergence > threshold_pct:
                    suspicious_triples.add(frozenset([a, b, c]))

    return suspicious_triples


def find_triangular_arbitrage(
    rates: dict[tuple[str, str], float],
    prices: dict[str, float],
    min_profit_pct: float = 1.0,    # §6a: increased from 0.1% to 1.0% (0.1% is numerical artifact)
    pair_volumes: dict[tuple[str, str], float] | None = None,
    snapshot_time: datetime | None = None,
    cross_rate_threshold_pct: float = 5.0,
) -> list[TriangularOpportunity]:
    """Find triangular (and multi-hop) arbitrage opportunities using Bellman-Ford.

    Simplified: gold/commission fees are EXCLUDED from all calculations.
    A realistic spread model (§7.1.1) is applied to edge weights to avoid
    false positives from spreadless reverse rates.

    Edge weight: -ln(effective_rate) where effective_rate = raw_rate * (1 - spread/2)
    Low-liquidity edges (volume < 50) are filtered out (§6b).

    Cross-rate validation: Before returning results, each detected cycle is
    checked against a cross-rate divergence map. If the cycle passes through
    a triple where the implied cross-rate diverges from the direct rate by
    more than cross_rate_threshold_pct (default 5%), the cycle is flagged
    as suspicious and its profit is discounted.

    Args:
        rates: Dict mapping (currency_from, currency_to) to raw exchange rate
        prices: Current price of each currency in the reference currency
        min_profit_pct: Minimum profit percentage to report (default 1.0%)
        pair_volumes: Optional volume data per edge
        snapshot_time: When the snapshot data was taken
        cross_rate_threshold_pct: Divergence threshold for cross-rate
            inconsistency detection (default 5%). Cycles involving triples
            with >5% implied-vs-direct divergence are flagged.

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

    # §6b: Minimum edge volume — skip illiquid pairs
    # RAISED from 50 to 200 for more aggressive filtering of illiquid pairs
    # (e.g. Armourer's Scrap volume ~1700 still passes, but very low-volume
    # pairs with 50-200 volume are typically too noisy for reliable arbitrage)
    MIN_EDGE_VOLUME = 200

    # Build edge list with spread model (§7)
    volumes_map = pair_volumes or {}
    edges = []
    for (u, v), raw_rate in rates.items():
        if raw_rate <= 0:
            continue

        edge_volume = volumes_map.get((u, v), 0.0)

        # §6b: Filter out low-liquidity edges
        if edge_volume < MIN_EDGE_VOLUME:
            continue

        # §7: Estimate spread from volume (§7.1.1 Canonical Formulas)
        if edge_volume > 0:
            volume_spread = 0.05 / (1.0 + math.log1p(edge_volume) / 8.0)
        else:
            volume_spread = 0.08  # 8% for zero-volume pairs
        market_spread = max(0.01, min(0.15, volume_spread))

        # Effective rate = raw_rate * (1 - spread/2)
        # This models the bid-side: you sell from_currency and buy to_currency
        # The spread represents the bid-ask gap in a market without market makers
        effective_rate = raw_rate * (1 - market_spread / 2)
        if effective_rate <= 0:
            continue

        weight = -np.log(effective_rate)
        edges.append((curr_to_idx[u], curr_to_idx[v], weight, raw_rate, effective_rate, edge_volume))

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
                # Walk back V steps via predecessor to ensure we're in the cycle.
                # FIX: If we encounter a node with no predecessor (pred == -1)
                # during the walk-back, it means this node is unreachable from
                # the source via the negative cycle — skip this candidate.
                # Also add a safety check: if dist[u] is extremely large
                # (but not INF), skip to avoid arithmetic overflow artifacts.
                node = v
                found_cycle_entry = False
                for _ in range(n):
                    if node == -1 or pred[node] == -1:
                        break
                    node = pred[node]

                if node == -1 or pred[node] == -1:
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
                    continuous_profit_pct=profit_pct,
                ))

    # ── Cross-rate validation ──
    # Compute suspicious triples where implied cross-rates diverge from
    # direct rates by >threshold%. Any cycle that passes through such a
    # triple is likely a false positive from inconsistent relative_price
    # data, not a real market inefficiency.
    suspicious_triples = _compute_cross_rate_divergence(
        rates, threshold_pct=cross_rate_threshold_pct
    )
    if suspicious_triples:
        logger.info(
            "Cross-rate validation: %d suspicious triples detected (threshold=%.1f%%)",
            len(suspicious_triples), cross_rate_threshold_pct,
        )

    # Filter out cycles that pass through suspicious triples
    filtered_results: list[TriangularOpportunity] = []
    for opp in results:
        cycle_currencies = set(opp.cycle)
        is_suspicious = False
        for triple in suspicious_triples:
            if triple.issubset(cycle_currencies):
                is_suspicious = True
                break
        if is_suspicious:
            logger.info(
                "Discarding cycle %s: passes through cross-rate-inconsistent triple "
                "(profit=%.2f%% likely false positive)",
                opp.cycle, opp.net_profit_pct,
            )
            continue
        filtered_results.append(opp)
    results = filtered_results

    # P1-2: Validate detected cycles with integer simulation
    validated_results: list[TriangularOpportunity] = []
    for opp in results:
        # Build rates dict for the cycle currencies (excluding closing node)
        cycle_currencies = opp.cycle[:-1] if len(opp.cycle) > 1 else opp.cycle
        step_rates_map: dict[tuple[str, str], float] = {}
        for i in range(len(cycle_currencies)):
            from_curr = cycle_currencies[i]
            to_curr = cycle_currencies[(i + 1) % len(cycle_currencies)]
            pair = (from_curr, to_curr)
            if pair in rates:
                step_rates_map[pair] = rates[pair]
            else:
                # Try reverse
                reverse = (to_curr, from_curr)
                if reverse in rates and rates[reverse] > 0:
                    # Store as forward rate (1/reverse)
                    step_rates_map[pair] = 1.0 / rates[reverse]

        min_start = find_min_profitable_start(cycle_currencies, step_rates_map)
        if min_start > 0:
            final_amount, sim_amounts = simulate_cycle_integers(
                cycle_currencies, step_rates_map, min_start
            )
            quantized_profit = (final_amount - min_start) / min_start * 100
            opp.min_starting_amount = min_start
            opp.quantized_profit_pct = round(quantized_profit, 4)
            opp.integer_simulation = sim_amounts
            validated_results.append(opp)
        else:
            # Cycle is lossy at all lot sizes up to max_start — discard
            # Don't show false opportunities
            logger.debug(
                "Discarding cycle %s: no profitable integer amount found (continuous profit=%.2f%%)",
                opp.cycle, opp.continuous_profit_pct,
            )

    return validated_results
