// ============================================================================
// Arbitrage Helpers — Pure functions and types for client-side arbitrage
// cycle detection. Extracted from arbitrage-tab.tsx for testability and
// to keep the main component under 400 lines.
// ============================================================================

import type { ExchangePair } from "@/lib/types";

// ---------------------------------------------------------------------------
// Types — Client-side arbitrage
// ---------------------------------------------------------------------------

export interface GraphEdge {
  from: string;
  to: string;
  rate: number;
  volume: number;
  spread: number; // market spread applied to this edge
  fromName: string;
  toName: string;
}

export interface ArbitrageCycle {
  route: string[];
  edges: GraphEdge[];
  grossProfitPct: number;   // gross profit % based on mid-rates (before spread & slippage)
  netProfitPct: number;     // net profit % after deducting spread + slippage
  totalSpreadPct: number;   // total spread cost across all edges (%)
  slippage: number;         // slippage fraction (for display)
  maxVolume: number;
  confidence: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MAX_CYCLE_LEN = 5;

/** Upper bound for realistic arbitrage profit in PoE2.
 *  Anything above this threshold is a mathematical artifact caused by
 *  stale data, missing volumes, or the inherent limitation that the API
 *  provides only mid-prices (no separate bid/ask), so forward and reverse
 *  rates from the same pair are exact mirrors. Real arbitrage in PoE2
 *  is at most a few percent. */
export const MAX_REALISTIC_PROFIT_PCT = 10;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Square-root impact slippage model.
 *  slippage_bps = base + base * sqrt(tradeSize / volume)
 *  Returns the slippage as a fraction (e.g. 0.005 = 0.5 %). */
export function estimateSlippage(
  tradeSize: number,
  volume: number,
  baseSlippageBps: number,
): number {
  if (volume <= 0) return 1; // 100 % slippage if no volume
  const impactBps = baseSlippageBps * Math.sqrt(tradeSize / volume);
  return (baseSlippageBps + impactBps) / 10_000;
}

/** Apply a flat trading-fee deduction to a rate.
 *  effectiveRate = rate * (1 - feeBps / 10_000) */
export function applyFee(rate: number, feeBps: number): number {
  return rate * (1 - feeBps / 10_000);
}

/** Estimate market spread from volume, following §7.1.1 Canonical Formulas.
 *  volume_spread = 0.05 / (1 + log1p(volume) / 8)
 *  Result clamped to [0.01, 0.15] — 1% to 15%
 *  Returns the spread as a fraction (e.g. 0.03 = 3%). */
export function estimateSpreadFromVolume(volume: number): number {
  let volumeSpread: number;
  if (volume > 0) {
    volumeSpread = 0.05 / (1 + Math.log1p(volume) / 8);
  } else {
    volumeSpread = 0.08; // 8% for zero-volume pairs
  }
  return Math.max(0.01, Math.min(0.15, volumeSpread));
}

// ---------------------------------------------------------------------------
// Cycle-finding (DFS Bellman-Ford variant) — Client-side
// ---------------------------------------------------------------------------

export function findArbitrageCycles(
  pairs: ExchangePair[],
  tradeSize: number,
  feeBps: number,
  baseSlippageBps: number,
  minVolume: number,
  decayLambda: number,
): ArbitrageCycle[] {
  // ---- Build adjacency list ----
  const adj = new Map<string, GraphEdge[]>();
  const names = new Map<string, string>();

  let skippedPairs = 0;

  for (const p of pairs) {
    const pairVolume = p.volume ?? 0;
    if (pairVolume < minVolume) continue;

    // §3: Liquidity filter — edge must support tradeSize × 2
    if (pairVolume < tradeSize * 2) continue;

    const c1 = p.currency1Id;
    const c2 = p.currency2Id;
    names.set(c1, p.currency1Name);
    names.set(c2, p.currency2Name);

    // §1: Estimate realistic spread from volume (§7.1.1 Canonical Formulas)
    const spreadPct = estimateSpreadFromVolume(pairVolume);

    // ─── FIX: Correct cross-rate computation ───
    // POE2Scout API returns RelativePrice for EACH currency in the pair,
    // expressed in the base currency (e.g. Exalted). The cross-rate
    // (how many units of c2 you get for 1 unit of c1) is:
    //   crossRate(c1→c2) = relativePrice_c1 / relativePrice_c2
    const c1Rel = p.relativePrice ?? 0;
    const c2Rel = p.currency2RelativePrice ?? 0;

    // Skip pairs where either relative price is missing or zero
    if (c1Rel <= 0 || c2Rel <= 0) {
      skippedPairs++;
      continue;
    }

    // Forward edge: c1 → c2 — you sell 1 c1, receive c1Rel/c2Rel units of c2
    const forwardRate = c1Rel / c2Rel;
    // Reverse edge: c2 → c1 — you sell 1 c2, receive c2Rel/c1Rel units of c1
    const reverseRate = c2Rel / c1Rel;

    // Time-decay: hoursSinceSnapshot placeholder = 0 (API doesn't provide timestamps per pair)
    const hoursSinceSnapshot = 0;
    const decayFactor = Math.exp(-decayLambda * hoursSinceSnapshot);

    // Forward edge: c1 → c2
    // NOTE: We do NOT apply spread to the rate here. The mid-rate is used
    // as-is, and the full spread cost is subtracted in the net profit
    // formula below. Previously the code applied half-spread to each rate
    // AND subtracted full spread from profit — that's double-counting.
    {
      const edge: GraphEdge = {
        from: c1,
        to: c2,
        rate: applyFee(forwardRate * decayFactor, feeBps),
        volume: pairVolume,
        spread: spreadPct,
        fromName: p.currency1Name,
        toName: p.currency2Name,
      };
      if (!adj.has(c1)) adj.set(c1, []);
      adj.get(c1)!.push(edge);
    }

    // Reverse edge: c2 → c1
    if (reverseRate > 0 && isFinite(reverseRate)) {
      const edge: GraphEdge = {
        from: c2,
        to: c1,
        rate: applyFee(reverseRate * decayFactor, feeBps),
        volume: pairVolume,
        spread: spreadPct,
        fromName: p.currency2Name,
        toName: p.currency1Name,
      };
      if (!adj.has(c2)) adj.set(c2, []);
      adj.get(c2)!.push(edge);
    }
  }

  if (skippedPairs > 0) {
    console.warn(`[ArbitrageTab] Skipped ${skippedPairs} pairs due to missing relative price data`);
  }

  // ---- DFS to find cycles ----
  const results: ArbitrageCycle[] = [];
  const visited = new Set<string>();
  const path: string[] = [];
  const pathEdges: GraphEdge[] = [];

  function dfs(node: string, startNode: string, product: number): void {
    if (path.length > MAX_CYCLE_LEN) return;

    // Prune early: if product is already unrealistic, stop exploring
    if (product > 1 + MAX_REALISTIC_PROFIT_PCT / 100 + 1) return;

    // Check for cycle back to start
    if (node === startNode && path.length >= 2) {
      // §2: Calculate profit as PERCENTAGE, not absolute values
      const grossProfitPct = (product - 1) * 100;

      // Sanity check: reject unrealistic profits
      if (grossProfitPct > MAX_REALISTIC_PROFIT_PCT) return;

      // Total spread cost across all edges in the cycle
      let totalSpreadPct = 0;
      // Estimate total slippage across all edges in the cycle
      let totalSlippage = 0;
      let bottleneckVolume = Infinity;
      for (const edge of pathEdges) {
        totalSpreadPct += edge.spread * 100; // spread per edge in %
        const edgeSlippage = estimateSlippage(
          tradeSize,
          edge.volume,
          baseSlippageBps,
        );
        totalSlippage += edgeSlippage;
        if (edge.volume < bottleneckVolume) bottleneckVolume = edge.volume;
      }

      // Net profit % = gross profit % - total spread cost % - slippage cost %
      const slippagePct = totalSlippage * 100;
      const netProfitPct = grossProfitPct - totalSpreadPct - slippagePct;

      // §4: Minimum profit threshold based on cycle length
      // Each step introduces ~2% noise from relativePrice inaccuracy
      const minProfitPct = pathEdges.length * 2.0;
      if (netProfitPct < minProfitPct) return;

      // §5: Confidence with volume and length penalty
      const volumeConfidence = Math.min(1, bottleneckVolume / (tradeSize * 2));
      const lengthPenalty = 1 / Math.sqrt(pathEdges.length);
      const confidence = volumeConfidence * lengthPenalty;

      if (netProfitPct > 0) {
        results.push({
          route: [...path],
          edges: [...pathEdges],
          grossProfitPct,
          netProfitPct,
          totalSpreadPct,
          slippage: totalSlippage,
          maxVolume: bottleneckVolume,
          confidence,
        });
      }
      return; // don't continue DFS past the start
    }

    const neighbors = adj.get(node);
    if (!neighbors) return;

    for (const edge of neighbors) {
      if (visited.has(edge.to) && edge.to !== startNode) continue;
      // Avoid re-tracing the same edge in reverse immediately
      if (pathEdges.length > 0) {
        const prev = pathEdges[pathEdges.length - 1];
        if (edge.from === prev.to && edge.to === prev.from) continue;
      }

      visited.add(edge.to);
      path.push(edge.to);
      pathEdges.push(edge);

      dfs(edge.to, startNode, product * edge.rate);

      path.pop();
      pathEdges.pop();
      visited.delete(edge.to);
    }
  }

  // Start DFS from every node
  for (const startNode of adj.keys()) {
    path.length = 0;
    pathEdges.length = 0;
    visited.clear();
    visited.add(startNode);
    path.push(startNode);
    dfs(startNode, startNode, 1);
  }

  // Sort by net profit % descending, take top 50
  results.sort((a, b) => b.netProfitPct - a.netProfitPct);
  return results.slice(0, 50);
}
