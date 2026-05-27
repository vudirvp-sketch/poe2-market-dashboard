// ============================================================================
// Arbitrage Calculator Tab (Feature 4.1)
// Detects currency conversion cycles where product of exchange rates > 1
// ============================================================================
"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, useCallback } from "react";
import {
  AlertTriangle,
  RefreshCw,
  ArrowRight,
  Loader2,
  TrendingUp,
  ArrowLeftRight,
  Coins,
  Search,
  CircleDot,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fmt, fetchApi } from "@/lib/types";
import type { ExchangePair } from "@/lib/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ArbitrageTabProps {
  realm: string;
  league: string;
}

interface GraphEdge {
  to: string;
  toName: string;
  toIconUrl: string | null;
  rate: number;
  logRate: number;
  volume: number;
}

interface ArbitrageCycle {
  /** Ordered list of currency IDs in the cycle (first == last to close) */
  nodes: string[];
  /** Human-readable names for each node */
  names: string[];
  /** Icon URLs for each node */
  icons: (string | null)[];
  /** Exchange rate for each edge in the cycle */
  rates: number[];
  /** Product of all rates along the cycle */
  product: number;
  /** Profit percentage = (product - 1) * 100 */
  profitPercent: number;
  /** Bottleneck volume (minimum volume across all edges) */
  minVolume: number;
  /** Number of edges in the cycle */
  length: number;
}

// ---------------------------------------------------------------------------
// Algorithm: find profitable cycles via DFS with log-transformation
// ---------------------------------------------------------------------------

const MIN_VOLUME = 10;
const MAX_CYCLE_LENGTH = 4;
const MAX_OPPORTUNITIES = 20;

function findArbitrageCycles(pairs: ExchangePair[]): ArbitrageCycle[] {
  // ----- Build adjacency list -----
  const graph = new Map<string, GraphEdge[]>();
  const currencyNames = new Map<string, string>();
  const currencyIcons = new Map<string, string | null>();

  for (const pair of pairs) {
    if (pair.volume < MIN_VOLUME) continue;
    if (pair.relativePrice <= 0 || !isFinite(pair.relativePrice)) continue;

    const { currency1Id, currency1Name, currency1IconUrl, currency2Id, currency2Name, currency2IconUrl, relativePrice, volume } = pair;

    // Store metadata
    currencyNames.set(currency1Id, currency1Name);
    currencyNames.set(currency2Id, currency2Name);
    currencyIcons.set(currency1Id, currency1IconUrl);
    currencyIcons.set(currency2Id, currency2IconUrl);

    // Edge: currency1 → currency2, rate = relativePrice
    const forwardRate = relativePrice;
    if (isFinite(forwardRate) && forwardRate > 0) {
      if (!graph.has(currency1Id)) graph.set(currency1Id, []);
      graph.get(currency1Id)!.push({
        to: currency2Id,
        toName: currency2Name,
        toIconUrl: currency2IconUrl,
        rate: forwardRate,
        logRate: Math.log(forwardRate),
        volume,
      });
    }

    // Edge: currency2 → currency1, rate = 1 / relativePrice
    const reverseRate = 1 / relativePrice;
    if (isFinite(reverseRate) && reverseRate > 0) {
      if (!graph.has(currency2Id)) graph.set(currency2Id, []);
      graph.get(currency2Id)!.push({
        to: currency1Id,
        toName: currency1Name,
        toIconUrl: currency1IconUrl,
        rate: reverseRate,
        logRate: Math.log(reverseRate),
        volume,
      });
    }
  }

  // ----- DFS to find profitable cycles -----
  const cycles: ArbitrageCycle[] = [];
  const seenCycleKeys = new Set<string>();

  // Normalize a cycle to a canonical key for deduplication
  // Rotate so the lexicographically smallest ID is first, then serialize
  function cycleKey(nodeIds: string[]): string {
    const n = nodeIds.length - 1; // last node == first node
    const ring = nodeIds.slice(0, n);
    let minIdx = 0;
    for (let i = 1; i < n; i++) {
      if (ring[i] < ring[minIdx]) minIdx = i;
    }
    const rotated = [...ring.slice(minIdx), ...ring.slice(0, minIdx)];
    return rotated.join("→");
  }

  function dfs(
    startId: string,
    currentId: string,
    path: string[],
    pathNames: string[],
    pathIcons: (string | null)[],
    pathRates: number[],
    pathVolumes: number[],
    logSum: number,
    visited: Set<string>
  ) {
    const edges = graph.get(currentId);
    if (!edges) return;

    for (const edge of edges) {
      // Found a cycle back to start
      if (edge.to === startId && path.length >= 2) {
        const totalLogSum = logSum + edge.logRate;
        if (totalLogSum > 0) {
          const product = Math.exp(totalLogSum);
          const profitPercent = (product - 1) * 100;
          const minVol = Math.min(...pathVolumes, edge.volume);

          const nodeIds = [...path, startId];
          const key = cycleKey(nodeIds);
          if (seenCycleKeys.has(key)) continue;
          seenCycleKeys.add(key);

          cycles.push({
            nodes: nodeIds,
            names: [...pathNames, currencyNames.get(startId) ?? startId],
            icons: [...pathIcons, currencyIcons.get(startId) ?? null],
            rates: [...pathRates, edge.rate],
            product,
            profitPercent,
            minVolume: minVol,
            length: nodeIds.length - 1,
          });
        }
        continue;
      }

      // Prune: max depth, already visited in this path, or logSum already too negative
      if (path.length >= MAX_CYCLE_LENGTH) continue;
      if (visited.has(edge.to)) continue;

      // Early pruning: if remaining possible improvement can't make logSum > 0
      // (Very rough bound — skip for simplicity, the search space is small enough)

      visited.add(edge.to);
      dfs(
        startId,
        edge.to,
        [...path, edge.to],
        [...pathNames, edge.toName],
        [...pathIcons, edge.toIconUrl],
        [...pathRates, edge.rate],
        [...pathVolumes, edge.volume],
        logSum + edge.logRate,
        visited
      );
      visited.delete(edge.to);
    }
  }

  // Start DFS from each currency node
  for (const startId of Array.from(graph.keys())) {
    dfs(startId, startId, [startId], [currencyNames.get(startId) ?? startId], [currencyIcons.get(startId) ?? null], [], [], 0, new Set([startId]));
  }

  // Sort by profit percentage descending, take top N
  cycles.sort((a, b) => b.profitPercent - a.profitPercent);
  return cycles.slice(0, MAX_OPPORTUNITIES);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ArbitrageTab({ realm, league }: ArbitrageTabProps) {
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Fetch exchange pairs
  const { data: pairs, isLoading, refetch } = useQuery({
    queryKey: ["exchangePairs", realm, league],
    queryFn: () =>
      fetchApi<ExchangePair[]>("/api/poe2/exchange", {
        realm,
        league,
        action: "pairs",
      }),
    enabled: !!league,
  });

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await refetch();
    setIsRefreshing(false);
  }, [refetch]);

  // Compute arbitrage cycles
  const { cycles, currencies, eligiblePairs } = useMemo(() => {
    if (!pairs) return { cycles: [], currencies: 0, eligiblePairs: 0 };

    const eligible = pairs.filter((p: ExchangePair) => p.volume >= MIN_VOLUME && p.relativePrice > 0 && isFinite(p.relativePrice));
    const uniqueCurrencies = new Set<string>();
    for (const p of eligible) {
      uniqueCurrencies.add(p.currency1Id);
      uniqueCurrencies.add(p.currency2Id);
    }

    const found = findArbitrageCycles(pairs);
    return { cycles: found, currencies: uniqueCurrencies.size, eligiblePairs: eligible.length };
  }, [pairs]);

  // ----- Render -----

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Warning banner */}
      <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
        <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-amber-500">Arbitrage opportunities are theoretical</p>
          <p className="text-xs text-muted-foreground mt-1">
            Arbitrage windows are brief. Market prices change rapidly. Always verify current rates before trading.
            Fees, slippage, and timing are not accounted for.
          </p>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card className="rounded-lg">
          <CardContent className="py-4 px-4">
            <div className="flex items-center gap-2">
              <ArrowLeftRight className="h-5 w-5 text-primary" />
              <p className="text-xs text-muted-foreground">Scanned Pairs</p>
            </div>
            <p className="text-2xl font-bold font-mono mt-1">{eligiblePairs}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              of {pairs?.length ?? 0} total (volume ≥ {MIN_VOLUME})
            </p>
          </CardContent>
        </Card>
        <Card className="rounded-lg">
          <CardContent className="py-4 px-4">
            <div className="flex items-center gap-2">
              <Coins className="h-5 w-5 text-primary" />
              <p className="text-xs text-muted-foreground">Currencies</p>
            </div>
            <p className="text-2xl font-bold font-mono mt-1">{currencies}</p>
            <p className="text-xs text-muted-foreground mt-0.5">unique tokens in graph</p>
          </CardContent>
        </Card>
        <Card className="rounded-lg">
          <CardContent className="py-4 px-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-emerald-400" />
              <p className="text-xs text-muted-foreground">Opportunities Found</p>
            </div>
            <p className="text-2xl font-bold font-mono mt-1 text-emerald-400">{cycles.length}</p>
            <p className="text-xs text-muted-foreground mt-0.5">cycles with positive profit</p>
          </CardContent>
        </Card>
      </div>

      {/* Refresh button */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium flex items-center gap-1.5">
          <Search className="h-4 w-4" />
          Arbitrage Opportunities
        </h3>
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          onClick={handleRefresh}
          disabled={isRefreshing}
        >
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isRefreshing ? "animate-spin" : ""}`} />
          Refresh Data
        </Button>
      </div>

      {/* Opportunities table */}
      {cycles.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <CircleDot className="h-12 w-12 mb-4" />
          <p className="text-lg mb-1">No arbitrage opportunities detected</p>
          <p className="text-sm text-center max-w-md">
            This is normal — efficient markets rarely have exploitable cycles.
            Try refreshing later or check a different league.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[1fr_80px_100px_100px] sm:grid-cols-[1fr_80px_120px_120px] bg-muted/50 px-4 py-2.5 text-xs font-medium text-muted-foreground">
            <div>Route</div>
            <div className="text-center">Length</div>
            <div className="text-right">Profit %</div>
            <div className="text-right">Min Volume</div>
          </div>

          {/* Table rows */}
          <div className="divide-y max-h-[600px] overflow-y-auto scrollbar-thin">
            {cycles.map((cycle, idx) => (
              <div
                key={idx}
                className="grid grid-cols-[1fr_80px_100px_100px] sm:grid-cols-[1fr_80px_120px_120px] px-4 py-3 hover:bg-muted/30 transition-colors items-center"
              >
                {/* Route */}
                <div className="flex items-center gap-1 flex-wrap min-w-0">
                  {cycle.nodes.map((nodeId, i) => {
                    const isLast = i === cycle.nodes.length - 1;
                    const name = cycle.names[i];
                    const icon = cycle.icons[i];
                    return (
                      <span key={`${nodeId}-${i}`} className="inline-flex items-center gap-0.5 shrink-0">
                        {icon ? (
                          <img
                            src={icon}
                            alt=""
                            className="w-4 h-4 object-contain"
                          />
                        ) : null}
                        <span className="text-xs font-medium truncate max-w-[100px]">
                          {name}
                        </span>
                        {!isLast && (
                          <ArrowRight className="h-3 w-3 text-muted-foreground mx-0.5 shrink-0" />
                        )}
                      </span>
                    );
                  })}
                </div>

                {/* Length */}
                <div className="text-center">
                  <Badge variant="secondary" className="text-xs font-mono">
                    {cycle.length}
                  </Badge>
                </div>

                {/* Profit */}
                <div className="text-right">
                  <span className="text-sm font-bold font-mono text-emerald-400">
                    +{cycle.profitPercent.toFixed(2)}%
                  </span>
                </div>

                {/* Min Volume */}
                <div className="text-right">
                  <span className="text-xs font-mono text-muted-foreground">
                    {fmt(cycle.minVolume, 0)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer note */}
      {cycles.length > 0 && (
        <p className="text-xs text-muted-foreground text-center">
          Showing top {Math.min(cycles.length, MAX_OPPORTUNITIES)} opportunities sorted by profit percentage.
          Cycle length limited to {MAX_CYCLE_LENGTH} edges. Pairs with volume &lt; {MIN_VOLUME} are excluded.
        </p>
      )}
    </div>
  );
}
