// ============================================================================
// Arbitrage Tab — finds currency-exchange cycles with positive net profit
// Task 6.9: Confidence indicator + Time-Decay weighting
// ============================================================================
"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Settings,
  Info,
  ArrowRight,
  TrendingUp,
  Search,
  BarChart3,
  Layers,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/lib/i18n";
import { fmt, fetchApi } from "@/lib/types";
import type { ExchangePair } from "@/lib/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GraphEdge {
  from: string;
  to: string;
  rate: number;
  volume: number;
  fromName: string;
  toName: string;
}

interface ArbitrageCycle {
  route: string[];
  edges: GraphEdge[];
  grossProfit: number;
  netProfit: number;
  slippage: number;
  maxVolume: number;
  confidence: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Square-root impact slippage model.
 *  slippage_bps = base + base * sqrt(tradeSize / volume)
 *  Returns the slippage as a fraction (e.g. 0.005 = 0.5 %). */
function estimateSlippage(
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
function applyFee(rate: number, feeBps: number): number {
  return rate * (1 - feeBps / 10_000);
}

// ---------------------------------------------------------------------------
// Cycle-finding (DFS Bellman-Ford variant)
// ---------------------------------------------------------------------------

const MAX_CYCLE_LEN = 5;

function findArbitrageCycles(
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

  for (const p of pairs) {
    if ((p.volume ?? 0) < minVolume) continue;

    const c1 = p.currency1Id;
    const c2 = p.currency2Id;
    names.set(c1, p.currency1Name);
    names.set(c2, p.currency2Name);

    // Forward edge: c1 → c2
    const forwardRate = p.relativePrice ?? 0;
    // Time-decay: hoursSinceSnapshot placeholder = 0 (API doesn't provide timestamps per pair)
    const hoursSinceSnapshot = 0;
    const decayFactor = Math.exp(-decayLambda * hoursSinceSnapshot);

    if (forwardRate > 0) {
      const edge: GraphEdge = {
        from: c1,
        to: c2,
        rate: applyFee(forwardRate * decayFactor, feeBps),
        volume: p.volume ?? 0,
        fromName: p.currency1Name,
        toName: p.currency2Name,
      };
      if (!adj.has(c1)) adj.set(c1, []);
      adj.get(c1)!.push(edge);
    }

    // Reverse edge: c2 → c1
    const reverseRate = forwardRate > 0 ? 1 / forwardRate : 0;
    if (reverseRate > 0 && isFinite(reverseRate)) {
      const edge: GraphEdge = {
        from: c2,
        to: c1,
        rate: applyFee(reverseRate * decayFactor, feeBps),
        volume: p.volume ?? 0,
        fromName: p.currency2Name,
        toName: p.currency1Name,
      };
      if (!adj.has(c2)) adj.set(c2, []);
      adj.get(c2)!.push(edge);
    }
  }

  // ---- DFS to find cycles ----
  const results: ArbitrageCycle[] = [];
  const visited = new Set<string>();
  const path: string[] = [];
  const pathEdges: GraphEdge[] = [];

  function dfs(node: string, startNode: string, product: number): void {
    if (path.length > MAX_CYCLE_LEN) return;

    // Check for cycle back to start
    if (node === startNode && path.length >= 2) {
      // product already includes the full cycle multiplication
      const grossProfit = (product - 1) * tradeSize;

      // Estimate total slippage across all edges in the cycle
      let totalSlippage = 0;
      let minVolume = Infinity;
      for (const edge of pathEdges) {
        const edgeSlippage = estimateSlippage(
          tradeSize,
          edge.volume,
          baseSlippageBps,
        );
        totalSlippage += edgeSlippage;
        if (edge.volume < minVolume) minVolume = edge.volume;
      }

      // Net profit = gross - slippage cost
      const slippageCost = totalSlippage * tradeSize;
      const netProfit = grossProfit - slippageCost;

      // Confidence: how well the bottleneck volume supports the trade size
      const confidence = Math.min(1, minVolume / tradeSize);

      if (netProfit > 0) {
        results.push({
          route: [...path],
          edges: [...pathEdges],
          grossProfit,
          netProfit,
          slippage: totalSlippage,
          maxVolume: minVolume,
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

  // Sort by net profit descending, take top 50
  results.sort((a, b) => b.netProfit - a.netProfit);
  return results.slice(0, 50);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ArbitrageTabProps {
  realm?: string;
  league?: string;
}

export function ArbitrageTab({ realm, league }: ArbitrageTabProps) {
  const { t } = useI18n();

  // Settings state
  const [tradingFeeBps, setTradingFeeBps] = useState(0);
  const [baseSlippageBps, setBaseSlippageBps] = useState(10);
  const [tradeSize, setTradeSize] = useState(100);
  const [minVolume, setMinVolume] = useState(10);
  const [decayLambda, setDecayLambda] = useState(0);
  const [showSettings, setShowSettings] = useState(false);

  // Fetch exchange pairs
  const {
    data: pairs,
    isLoading,
    isError,
  } = useQuery<ExchangePair[]>({
    queryKey: ["exchangePairs", realm, league],
    queryFn: () =>
      fetchApi<ExchangePair[]>("/api/poe2/exchange", {
        realm: realm ?? "",
        league: league ?? "",
        action: "pairs",
      }),
    enabled: !!realm && !!league,
    staleTime: 60_000,
  });

  // Compute arbitrage cycles
  const cycles = useMemo(() => {
    if (!pairs || pairs.length === 0) return [];
    return findArbitrageCycles(
      pairs,
      tradeSize,
      tradingFeeBps,
      baseSlippageBps,
      minVolume,
      decayLambda,
    );
  }, [pairs, tradeSize, tradingFeeBps, baseSlippageBps, minVolume, decayLambda]);

  // Count unique currencies in graph
  const uniqueTokens = useMemo(() => {
    if (!pairs) return 0;
    const ids = new Set<string>();
    for (const p of pairs) {
      ids.add(p.currency1Id);
      ids.add(p.currency2Id);
    }
    return ids.size;
  }, [pairs]);

  // Pairs that pass the volume filter
  const scannedCount = useMemo(() => {
    if (!pairs) return 0;
    return pairs.filter((p) => (p.volume ?? 0) >= minVolume).length;
  }, [pairs, minVolume]);

  // Deduplicate cycles by route signature
  const uniqueCycles = useMemo(() => {
    const seen = new Set<string>();
    return cycles.filter((c) => {
      const sig = [...c.route].sort().join("-");
      if (seen.has(sig)) return false;
      seen.add(sig);
      return true;
    });
  }, [cycles]);

  // Loading skeleton
  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20 w-full" />
        <div className="grid grid-cols-3 gap-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <Card className="border-destructive/50">
        <CardContent className="p-6 text-center text-destructive">
          {t("failedToLoadData")}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* ---- Disclaimer ---- */}
      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardContent className="flex items-start gap-3 p-4">
          <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="text-sm">
            <p className="font-medium text-amber-600 dark:text-amber-400">
              {t("arbitrageTheoretical")}
            </p>
            <p className="text-muted-foreground mt-1">
              {t("arbitrageTheoreticalDesc")}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ---- Stats row ---- */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <Search className="h-3.5 w-3.5" aria-hidden="true" />
              {t("scannedPairs")}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0">
            <p className="text-2xl font-bold">{scannedCount}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t("ofTotal", { "0": String(pairs?.length ?? 0), "1": String(minVolume) })}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5" aria-hidden="true" />
              {t("currencies")}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0">
            <p className="text-2xl font-bold">{uniqueTokens}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t("uniqueTokensInGraph")}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />
              {t("opportunitiesFound")}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0">
            <p className="text-2xl font-bold">{uniqueCycles.length}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t("cyclesWithPositiveNetProfit")}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ---- Settings toggle ---- */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowSettings((v) => !v)}
          aria-expanded={showSettings}
          aria-controls="arbitrage-settings"
        >
          <Settings className="h-4 w-4 mr-1.5" aria-hidden="true" />
          {t("settings")}
        </Button>
        <span className="text-xs text-muted-foreground">
          {t("adjustSettings")}
        </span>
      </div>

      {/* ---- Settings panel ---- */}
      {showSettings && (
        <Card id="arbitrage-settings">
          <CardContent className="p-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Trading Fee */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="arb-fee-bps">
                  {t("tradingFeeBps")}
                </label>
                <p className="text-xs text-muted-foreground">{t("poeNoFees")}</p>
                <Input
                  id="arb-fee-bps"
                  type="number"
                  min={0}
                  max={1000}
                  step={1}
                  value={tradingFeeBps}
                  onChange={(e) => setTradingFeeBps(Number(e.target.value) || 0)}
                />
              </div>

              {/* Base Slippage */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="arb-slip-bps">
                  {t("baseSlippageBps")}
                </label>
                <p className="text-xs text-muted-foreground">{t("baseSlippageDesc")}</p>
                <Input
                  id="arb-slip-bps"
                  type="number"
                  min={0}
                  max={1000}
                  step={1}
                  value={baseSlippageBps}
                  onChange={(e) => setBaseSlippageBps(Number(e.target.value) || 0)}
                />
              </div>

              {/* Trade Size */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="arb-trade-size">
                  {t("tradeSizeForProfit")}
                </label>
                <p className="text-xs text-muted-foreground">{t("tradeSizeDesc")}</p>
                <Input
                  id="arb-trade-size"
                  type="number"
                  min={1}
                  max={1_000_000}
                  step={1}
                  value={tradeSize}
                  onChange={(e) => setTradeSize(Number(e.target.value) || 1)}
                />
              </div>

              {/* Min Volume */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="arb-min-vol">
                  {t("maxVol")}
                </label>
                <p className="text-xs text-muted-foreground">
                  {t("ofTotal", { "0": "", "1": String(minVolume) })}
                </p>
                <Input
                  id="arb-min-vol"
                  type="number"
                  min={0}
                  max={1_000_000}
                  step={1}
                  value={minVolume}
                  onChange={(e) => setMinVolume(Number(e.target.value) || 0)}
                />
              </div>

              {/* Decay Lambda */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <label className="text-sm font-medium" htmlFor="arb-decay-lambda">
                    {t("decayLambda")}
                  </label>
                  <span
                    className="relative group"
                    aria-label={t("timeDecayDesc")}
                  >
                    <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" aria-hidden="true" />
                    <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 text-xs bg-popover text-popover-foreground border rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
                      {t("timeDecayDesc")}
                    </span>
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">{t("timeDecayDesc")}</p>
                <Input
                  id="arb-decay-lambda"
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  value={decayLambda}
                  onChange={(e) => setDecayLambda(Number(e.target.value) || 0)}
                />
              </div>

              {/* Time Decay Label with tooltip */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <label className="text-sm font-medium">
                    {t("timeDecayLabel")}
                  </label>
                  <span
                    className="relative group"
                    aria-label={t("timeDecayDesc")}
                  >
                    <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" aria-hidden="true" />
                    <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 text-xs bg-popover text-popover-foreground border rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
                      {t("timeDecayDesc")}
                    </span>
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  &lambda; = {decayLambda.toFixed(2)} &mdash; {t("timeDecayDesc")}
                </p>
                <Select
                  value={decayLambda === 0 ? "0" : "custom"}
                  onValueChange={(v) => {
                    if (v === "0") setDecayLambda(0);
                  }}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">0 — No decay</SelectItem>
                    <SelectItem value="custom">Custom (use input)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ---- Opportunities table ---- */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
            <BarChart3 className="h-4 w-4" aria-hidden="true" />
            {t("arbitrageOpportunities")}
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            {t(
              "showingTopOpportunities",
              {
                "0": String(uniqueCycles.length),
                "1": String(MAX_CYCLE_LEN),
                "2": String(minVolume),
                "3": String(baseSlippageBps),
                "4": String(tradingFeeBps),
              },
            )}
          </p>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0">
          {uniqueCycles.length === 0 ? (
            <div className="text-center py-10">
              <AlertTriangle className="h-10 w-10 text-muted-foreground mx-auto mb-3" aria-hidden="true" />
              <p className="font-medium">{t("noArbitrage")}</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
                {t("noArbitrageDesc")}
              </p>
            </div>
          ) : (
            <div className="space-y-0">
              {/* Table header — 7 columns: Route, Len, Net Profit, Gross, Slippage, Confidence, Max Vol */}
              <div className="grid grid-cols-[1fr_60px_80px_80px_80px_80px_100px] gap-2 py-2 px-2 text-xs font-medium text-muted-foreground border-b border-border sticky top-0 bg-card z-10">
                <span>{t("route")}</span>
                <span className="text-center">{t("len")}</span>
                <span className="text-right">{t("netProfit")}</span>
                <span className="text-right">{t("gross")}</span>
                <span className="text-right">{t("slippage")}</span>
                <span className="text-center">{t("confidence")}</span>
                <span className="text-right">{t("maxVol")}</span>
              </div>

              {/* Table body */}
              <div className="max-h-96 overflow-y-auto" role="list" aria-label="Arbitrage opportunities">
                {uniqueCycles.map((cycle, idx) => {
                  const routeNames = cycle.route.map(
                    (id) => cycle.edges.find((e) => e.from === id)?.fromName ?? id,
                  );
                  // Add the start name at the end to close the loop
                  const startName =
                    cycle.edges[0]?.fromName ?? routeNames[0];
                  routeNames.push(startName);

                  return (
                    <div
                      key={idx}
                      className="grid grid-cols-[1fr_60px_80px_80px_80px_80px_100px] gap-2 py-2 px-2 text-sm border-b border-border/50 hover:bg-muted/20 transition-colors items-center"
                      role="listitem"
                    >
                      {/* Route */}
                      <div className="flex items-center gap-1 flex-wrap min-w-0">
                        {routeNames.map((name, i) => (
                          <span key={i} className="flex items-center gap-1">
                            <span className="truncate text-xs font-medium">
                              {name}
                            </span>
                            {i < routeNames.length - 1 && (
                              <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" aria-hidden="true" />
                            )}
                          </span>
                        ))}
                      </div>

                      {/* Length */}
                      <span className="text-center text-xs text-muted-foreground font-mono">
                        {cycle.edges.length}
                      </span>

                      {/* Net Profit */}
                      <span className="text-right font-mono text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                        +{fmt(cycle.netProfit)}
                      </span>

                      {/* Gross */}
                      <span className="text-right font-mono text-xs text-muted-foreground">
                        {fmt(cycle.grossProfit)}
                      </span>

                      {/* Slippage */}
                      <span className="text-right font-mono text-xs text-muted-foreground">
                        {(cycle.slippage * 100).toFixed(2)}%
                      </span>

                      {/* Confidence */}
                      <span className="flex justify-center">
                        <Badge
                          variant="outline"
                          className={`text-[10px] px-1.5 py-0 font-semibold ${
                            cycle.confidence >= 0.7
                              ? "border-emerald-500/50 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
                              : cycle.confidence >= 0.3
                              ? "border-amber-500/50 text-amber-600 dark:text-amber-400 bg-amber-500/10"
                              : "border-red-500/50 text-red-600 dark:text-red-400 bg-red-500/10"
                          }`}
                        >
                          {cycle.confidence >= 0.7
                            ? t("confidenceHigh")
                            : cycle.confidence >= 0.3
                            ? t("confidenceMedium")
                            : t("confidenceLow")}
                        </Badge>
                      </span>

                      {/* Max Volume */}
                      <span className="text-right font-mono text-xs text-muted-foreground">
                        {cycle.maxVolume.toLocaleString()}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
