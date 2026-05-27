// ============================================================================
// Arbitrage Calculator Tab (Feature 4.1) — Advanced
// Detects currency conversion cycles where product of exchange rates > 1
// Accounts for: slippage model, trading fees, volume constraints
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
  Settings2,
  Info,
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
import { fmt, fetchApi } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
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
  nodes: string[];
  names: string[];
  icons: (string | null)[];
  rates: number[];
  /** Product of all rates (after slippage & fees) */
  product: number;
  /** Gross product (before slippage & fees) */
  grossProduct: number;
  /** Profit percentage = (product - 1) * 100 */
  profitPercent: number;
  /** Gross profit (before costs) */
  grossProfitPercent: number;
  /** Bottleneck volume (minimum volume across all edges) */
  minVolume: number;
  /** Maximum profitable volume considering slippage */
  maxProfitableVolume: number;
  /** Number of edges in the cycle */
  length: number;
  /** Total slippage cost across all edges */
  totalSlippage: number;
  /** Total fee cost across all edges */
  totalFees: number;
  /** Estimated net profit for a given trade size */
  estimatedProfit: (tradeSize: number) => number;
}

// ---------------------------------------------------------------------------
// Advanced Slippage Model
// ---------------------------------------------------------------------------

/**
 * Estimate slippage based on trade size relative to available volume.
 * Uses a square-root model: slippage = baseSlippage * sqrt(tradeSize / volume)
 *
 * @param tradeSize - Amount being traded
 * @param volume - 24h volume of the pair
 * @param baseSlippageBps - Base slippage in basis points (default: 10 = 0.1%)
 * @returns Slippage multiplier (e.g., 0.998 = 0.2% loss)
 */
function estimateSlippage(
  tradeSize: number,
  volume: number,
  baseSlippageBps: number = 10
): number {
  if (volume <= 0) return 0;
  // Square-root impact model
  const impactRatio = tradeSize / volume;
  const slippagePct = (baseSlippageBps / 10_000) * Math.sqrt(impactRatio);
  return 1 - slippagePct;
}

/**
 * Apply a flat trading fee per edge.
 * @param feeBps - Fee in basis points (default: 0, since PoE doesn't have explicit fees)
 * @returns Fee multiplier (e.g., 0.999 = 0.1% fee)
 */
function applyFee(rate: number, feeBps: number = 0): number {
  return rate * (1 - feeBps / 10_000);
}

// ---------------------------------------------------------------------------
// Algorithm: find profitable cycles via DFS with log-transformation
// ---------------------------------------------------------------------------

const MIN_VOLUME = 10;
const MAX_CYCLE_LENGTH = 4;
const MAX_OPPORTUNITIES = 20;

function findArbitrageCycles(
  pairs: ExchangePair[],
  feeBps: number,
  baseSlippageBps: number,
  defaultTradeSize: number
): ArbitrageCycle[] {
  // ----- Build adjacency list -----
  const graph = new Map<string, GraphEdge[]>();
  const currencyNames = new Map<string, string>();
  const currencyIcons = new Map<string, string | null>();

  for (const pair of pairs) {
    if (pair.volume < MIN_VOLUME) continue;
    if (pair.relativePrice <= 0 || !isFinite(pair.relativePrice)) continue;

    const {
      currency1Id,
      currency1Name,
      currency1IconUrl,
      currency2Id,
      currency2Name,
      currency2IconUrl,
      relativePrice,
      volume,
    } = pair;

    currencyNames.set(currency1Id, currency1Name);
    currencyNames.set(currency2Id, currency2Name);
    currencyIcons.set(currency1Id, currency1IconUrl);
    currencyIcons.set(currency2Id, currency2IconUrl);

    // Forward edge: currency1 → currency2
    const forwardRate = applyFee(relativePrice, feeBps);
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

    // Reverse edge: currency2 → currency1
    const reverseRate = applyFee(1 / relativePrice, feeBps);
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

  function cycleKey(nodeIds: string[]): string {
    const n = nodeIds.length - 1;
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
      if (edge.to === startId && path.length >= 2) {
        const totalLogSum = logSum + edge.logRate;
        if (totalLogSum > 0) {
          const grossProduct = Math.exp(
            logSum + Math.log(edge.rate / (1 - feeBps / 10_000 || 1))
          );
          const netProduct = Math.exp(totalLogSum);
          const profitPercent = (netProduct - 1) * 100;
          const grossProfitPercent = (grossProduct - 1) * 100;

          const nodeIds = [...path, startId];
          const key = cycleKey(nodeIds);
          if (seenCycleKeys.has(key)) continue;
          seenCycleKeys.add(key);

          const allVolumes = [...pathVolumes, edge.volume];
          const minVol = Math.min(...allVolumes);

          // Calculate slippage for each edge at default trade size
          let totalSlippage = 0;
          let totalFees = 0;
          for (const vol of allVolumes) {
            const slip = 1 - estimateSlippage(defaultTradeSize, vol, baseSlippageBps);
            totalSlippage += slip;
          }
          totalFees = allVolumes.length * (feeBps / 10_000);

          // Max volume where profit > 0 after slippage
          // Simple heuristic: scale until slippage eats all profit
          let maxProfitableVol = minVol;
          if (profitPercent > 0) {
            // Binary search for break-even volume
            let lo = 0;
            let hi = minVol;
            for (let iter = 0; iter < 20; iter++) {
              const mid = (lo + hi) / 2;
              let testProduct = 1;
              for (const vol of allVolumes) {
                testProduct *= estimateSlippage(mid, vol, baseSlippageBps);
              }
              testProduct *= Math.exp(totalLogSum); // base rates already include fees
              // Re-calculate from gross without fee adjustment for clean test
              let cleanProduct = 1;
              const allRates = [...pathRates, edge.rate];
              for (let i = 0; i < allRates.length; i++) {
                const slippageMult = estimateSlippage(mid, allVolumes[i], baseSlippageBps);
                cleanProduct *= allRates[i] * slippageMult;
              }
              if (cleanProduct > 1) {
                lo = mid;
              } else {
                hi = mid;
              }
            }
            maxProfitableVol = lo;
          }

          cycles.push({
            nodes: nodeIds,
            names: [...pathNames, currencyNames.get(startId) ?? startId],
            icons: [...pathIcons, currencyIcons.get(startId) ?? null],
            rates: [...pathRates, edge.rate],
            product: netProduct,
            grossProduct,
            profitPercent,
            grossProfitPercent,
            minVolume: minVol,
            maxProfitableVolume: Math.floor(maxProfitableVol),
            length: nodeIds.length - 1,
            totalSlippage,
            totalFees,
            estimatedProfit: (tradeSize: number) => {
              let result = tradeSize;
              const allRates = [...pathRates, edge.rate];
              for (let i = 0; i < allRates.length; i++) {
                const slippageMult = estimateSlippage(tradeSize, allVolumes[i], baseSlippageBps);
                result *= allRates[i] * slippageMult;
              }
              return result - tradeSize;
            },
          });
        }
        continue;
      }

      if (path.length >= MAX_CYCLE_LENGTH) continue;
      if (visited.has(edge.to)) continue;

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

  for (const startId of Array.from(graph.keys())) {
    dfs(
      startId,
      startId,
      [startId],
      [currencyNames.get(startId) ?? startId],
      [currencyIcons.get(startId) ?? null],
      [],
      [],
      0,
      new Set([startId])
    );
  }

  cycles.sort((a, b) => b.profitPercent - a.profitPercent);
  return cycles.slice(0, MAX_OPPORTUNITIES);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ArbitrageTab({ realm, league }: ArbitrageTabProps) {
  const { t } = useI18n();
  const [isRefreshing, setIsRefreshing] = useState(false);

  // --- Settings state ---
  const [feeBps, setFeeBps] = useState(0); // No explicit fees in PoE
  const [baseSlippageBps, setBaseSlippageBps] = useState(10); // 0.1% base slippage
  const [tradeSize, setTradeSize] = useState(100); // Default trade size for profit estimation
  const [showSettings, setShowSettings] = useState(false);

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

  // Compute arbitrage cycles with slippage/fee parameters
  const { cycles, currencies, eligiblePairs } = useMemo(() => {
    if (!pairs) return { cycles: [], currencies: 0, eligiblePairs: 0 };

    const eligible = pairs.filter(
      (p: ExchangePair) =>
        p.volume >= MIN_VOLUME &&
        p.relativePrice > 0 &&
        isFinite(p.relativePrice)
    );
    const uniqueCurrencies = new Set<string>();
    for (const p of eligible) {
      uniqueCurrencies.add(p.currency1Id);
      uniqueCurrencies.add(p.currency2Id);
    }

    const found = findArbitrageCycles(pairs, feeBps, baseSlippageBps, tradeSize);
    return {
      cycles: found,
      currencies: uniqueCurrencies.size,
      eligiblePairs: eligible.length,
    };
  }, [pairs, feeBps, baseSlippageBps, tradeSize]);

  // ----- Render -----

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="py-4 px-4">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-5 w-5 rounded" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-8 w-16 mt-1" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Skeleton className="h-[300px] w-full rounded-lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Warning banner */}
      <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
        <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-amber-500">
            {t("arbitrageTheoretical")}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {t("arbitrageTheoreticalDesc")}
          </p>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card className="rounded-lg">
          <CardContent className="py-4 px-4">
            <div className="flex items-center gap-2">
              <ArrowLeftRight className="h-5 w-5 text-primary" />
              <p className="text-xs text-muted-foreground">{t("scannedPairs")}</p>
            </div>
            <p className="text-2xl font-bold font-mono mt-1">
              {eligiblePairs}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t("ofTotal", { "0": pairs?.length ?? 0, "1": MIN_VOLUME })}
            </p>
          </CardContent>
        </Card>
        <Card className="rounded-lg">
          <CardContent className="py-4 px-4">
            <div className="flex items-center gap-2">
              <Coins className="h-5 w-5 text-primary" />
              <p className="text-xs text-muted-foreground">{t("currencies")}</p>
            </div>
            <p className="text-2xl font-bold font-mono mt-1">{currencies}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t("uniqueTokensInGraph")}
            </p>
          </CardContent>
        </Card>
        <Card className="rounded-lg">
          <CardContent className="py-4 px-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-emerald-400" />
              <p className="text-xs text-muted-foreground">
                {t("opportunitiesFound")}
              </p>
            </div>
            <p className="text-2xl font-bold font-mono mt-1 text-emerald-400">
              {cycles.length}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t("cyclesWithPositiveNetProfit")}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Settings + Refresh bar */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium flex items-center gap-1.5">
          <Search className="h-4 w-4" />
          {t("arbitrageOpportunities")}
        </h3>
        <div className="flex items-center gap-2">
          <Button
            variant={showSettings ? "default" : "outline"}
            size="sm"
            className="h-8 text-xs gap-1"
            onClick={() => setShowSettings(!showSettings)}
          >
            <Settings2 className="h-3.5 w-3.5" />
            {t("settings")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={handleRefresh}
            disabled={isRefreshing}
          >
            <RefreshCw
              className={`h-3.5 w-3.5 mr-1.5 ${
                isRefreshing ? "animate-spin" : ""
              }`}
            />
            {t("refresh")}
          </Button>
        </div>
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <Card>
          <CardContent className="py-4 px-4">
            <div className="flex items-center gap-2 mb-3">
              <Info className="h-4 w-4 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">
                {t("adjustSettings")}
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">
                  {t("tradingFeeBps")}
                </label>
                <Input
                  type="number"
                  min="0"
                  max="500"
                  step="1"
                  value={feeBps}
                  onChange={(e) => setFeeBps(Number(e.target.value))}
                  className="h-8 text-sm"
                />
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {t("poeNoFees")}
                </p>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">
                  {t("baseSlippageBps")}
                </label>
                <Input
                  type="number"
                  min="0"
                  max="500"
                  step="1"
                  value={baseSlippageBps}
                  onChange={(e) => setBaseSlippageBps(Number(e.target.value))}
                  className="h-8 text-sm"
                />
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {t("baseSlippageDesc")}
                </p>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">
                  {t("tradeSizeForProfit")}
                </label>
                <Input
                  type="number"
                  min="1"
                  step="10"
                  value={tradeSize}
                  onChange={(e) => setTradeSize(Number(e.target.value))}
                  className="h-8 text-sm"
                />
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {t("tradeSizeDesc")}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Opportunities table */}
      {cycles.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <CircleDot className="h-12 w-12 mb-4" />
          <p className="text-lg mb-1">{t("noArbitrage")}</p>
          <p className="text-sm text-center max-w-md">
            {t("noArbitrageDesc")}
          </p>
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[1fr_60px_80px_80px_80px_100px] sm:grid-cols-[1fr_60px_90px_90px_90px_120px] bg-muted/50 px-4 py-2.5 text-xs font-medium text-muted-foreground">
            <div>{t("route")}</div>
            <div className="text-center">{t("len")}</div>
            <div className="text-right">{t("netProfit")}</div>
            <div className="text-right">{t("gross")}</div>
            <div className="text-right">{t("slippage")}</div>
            <div className="text-right">{t("maxVol")}</div>
          </div>

          {/* Table rows */}
          <div className="divide-y max-h-[600px] overflow-y-auto scrollbar-thin">
            {cycles.map((cycle, idx) => {
              const estimatedNet = cycle.estimatedProfit(tradeSize);
              return (
                <div
                  key={idx}
                  className="grid grid-cols-[1fr_60px_80px_80px_80px_100px] sm:grid-cols-[1fr_60px_90px_90px_90px_120px] px-4 py-3 hover:bg-muted/30 transition-colors items-center"
                >
                  {/* Route */}
                  <div className="flex items-center gap-1 flex-wrap min-w-0">
                    {cycle.nodes.map((nodeId, i) => {
                      const isLast = i === cycle.nodes.length - 1;
                      const name = cycle.names[i];
                      const icon = cycle.icons[i];
                      return (
                        <span
                          key={`${nodeId}-${i}`}
                          className="inline-flex items-center gap-0.5 shrink-0"
                        >
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

                  {/* Net Profit */}
                  <div className="text-right">
                    <span className="text-sm font-bold font-mono text-emerald-400">
                      +{cycle.profitPercent.toFixed(2)}%
                    </span>
                    {tradeSize > 0 && (
                      <p
                        className={`text-[10px] font-mono ${
                          estimatedNet > 0 ? "text-emerald-400" : "text-red-400"
                        }`}
                      >
                        {estimatedNet > 0 ? "+" : ""}
                        {estimatedNet.toFixed(2)} {t("net")}
                      </p>
                    )}
                  </div>

                  {/* Gross Profit */}
                  <div className="text-right">
                    <span className="text-xs font-mono text-muted-foreground">
                      +{cycle.grossProfitPercent.toFixed(2)}%
                    </span>
                  </div>

                  {/* Slippage */}
                  <div className="text-right">
                    <span className="text-xs font-mono text-amber-400">
                      -{(cycle.totalSlippage * 100).toFixed(2)}%
                    </span>
                  </div>

                  {/* Max Volume */}
                  <div className="text-right">
                    <span className="text-xs font-mono text-muted-foreground">
                      {cycle.maxProfitableVolume.toLocaleString()}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Footer note */}
      {cycles.length > 0 && (
        <p className="text-xs text-muted-foreground text-center">
          {t("showingTopOpportunities", { "0": Math.min(cycles.length, MAX_OPPORTUNITIES), "1": MAX_CYCLE_LENGTH, "2": MIN_VOLUME, "3": baseSlippageBps, "4": feeBps })}
        </p>
      )}
    </div>
  );
}
