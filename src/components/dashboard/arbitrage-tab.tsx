// ============================================================================
// Arbitrage Tab — finds currency-exchange cycles with positive net profit
// Task 6.9: Confidence indicator + Time-Decay weighting
// Phase 2: Flipper mode toggle — integrates FastAPI backend scoring,
//           triangular arbitrage, event status, gold fees, clusters
// ============================================================================
"use client";

import { useState, useMemo, memo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useFlipsQuery, FLIPS_QUERY_KEY } from "@/hooks/use-flips-query";
import {
  AlertTriangle,
  Settings,
  Info,
  ArrowRight,
  TrendingUp,
  Search,
  BarChart3,
  Layers,
  Zap,
  Circle,
  Server,
  RefreshCw,
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
import {
  fmt,
  fetchApi,
} from "@/lib/types";
import type {
  ExchangePair,
  FlipOpportunity,
  TriangularCycle,
  TriangularResponse,
} from "@/lib/types";
import { ApiErrorFallback } from "./api-error-fallback";

// ---------------------------------------------------------------------------
// Types — Client-side arbitrage
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
// Flipper backend types — imported from @/lib/types (Single Source of Truth)
// Previously these were duplicated locally; now consolidated.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helpers — Client-side
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
// Cycle-finding (DFS Bellman-Ford variant) — Client-side
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
      // Fix 4.16: Renamed from minVolume to bottleneckVolume to avoid shadowing
      // the function parameter minVolume (filter threshold)
      let bottleneckVolume = Infinity;
      for (const edge of pathEdges) {
        const edgeSlippage = estimateSlippage(
          tradeSize,
          edge.volume,
          baseSlippageBps,
        );
        totalSlippage += edgeSlippage;
        if (edge.volume < bottleneckVolume) bottleneckVolume = edge.volume;
      }

      // Net profit = gross - slippage cost
      const slippageCost = totalSlippage * tradeSize;
      const netProfit = grossProfit - slippageCost;

      // Confidence: how well the bottleneck volume supports the trade size
      const confidence = Math.min(1, bottleneckVolume / tradeSize);

      if (netProfit > 0) {
        results.push({
          route: [...path],
          edges: [...pathEdges],
          grossProfit,
          netProfit,
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

  // Sort by net profit descending, take top 50
  results.sort((a, b) => b.netProfit - a.netProfit);
  return results.slice(0, 50);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type ArbitrageMode = "client" | "flipper";

interface ArbitrageTabProps {
  realm?: string;
  league?: string;
  /** Whether the flipper backend is online (checked at dashboard level) */
  backendOnline: boolean;
  /** Backend is online but upstream API is unreachable (degraded mode) */
  upstreamDegraded?: boolean;
}

export const ArbitrageTab = memo(function ArbitrageTab({ realm, league, backendOnline, upstreamDegraded }: ArbitrageTabProps) {
  const { t } = useI18n();

  // Mode toggle
  const [mode, setMode] = useState<ArbitrageMode>("client");

  // Settings state
  const [tradingFeeBps, setTradingFeeBps] = useState(0);
  const [baseSlippageBps, setBaseSlippageBps] = useState(10);
  const [tradeSize, setTradeSize] = useState(100);
  const [minVolume, setMinVolume] = useState(10);
  const [decayLambda, setDecayLambda] = useState(0);
  const [showSettings, setShowSettings] = useState(false);

  // Flipper filter state
  const [flipMinScore, setFlipMinScore] = useState(0);
  const [flipMinVolume, setFlipMinVolume] = useState(0);

  // Fix 4.1: Removed duplicate flipper-health useQuery.
  // The dashboard-level health check (dashboard-page.tsx) already queries
  // ["flipper-health"] and passes backendOnline as a prop. React Query
  // deduplicates by key, so the network request was already shared,
  // but having the same query in two places is a code smell.
  // The "phase" card now uses the `league` prop instead of phaseData?.league.

  // ---- Fetch exchange pairs (client-side mode) ----
  const {
    data: pairs,
    isLoading: pairsLoading,
    isError: pairsError,
    error: pairsErrorObj,
  } = useQuery<ExchangePair[]>({
    queryKey: ["exchangePairs", realm, league],
    queryFn: () =>
      fetchApi<ExchangePair[]>("/api/poe2/exchange", {
        realm: realm ?? "",
        league: league ?? "",
        action: "pairs",
      }),
    enabled: !!realm && !!league && mode === "client",
    staleTime: 60_000,
  });

  // ---- Flipper: scored flips (shared query via useFlipsQuery) ----
  const {
    data: flipsData,
    isLoading: flipsLoading,
    isError: flipsError,
    error: flipsErrorObj,
    refetch: refetchFlips,
  } = useFlipsQuery({
    minScore: flipMinScore,
    minVolume: flipMinVolume,
    enabled: mode === "flipper" && backendOnline,
    refetchInterval: false,  // no polling in arbitrage-tab; flips-tab polls
  });

  // ---- Flipper: triangular arbitrage ----
  const {
    data: triData,
    isLoading: triLoading,
    isError: triError,
    error: triErrorObj,
    refetch: refetchTri,
  } = useQuery<TriangularResponse>({
    queryKey: ["flipper-triangular"],
    queryFn: () => fetchApi<TriangularResponse>("/api/flipper/triangular"),
    enabled: mode === "flipper" && backendOnline,
    staleTime: 60_000,
    retry: 1,
  });

  // Compute arbitrage cycles (client-side)
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

  // Determine loading state based on mode
  const isLoading =
    mode === "client"
      ? pairsLoading
      : flipsLoading || triLoading;

  const isError =
    mode === "client"
      ? pairsError
      : flipsError;

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

  if (isError && mode === "client") {
    return (
      <ApiErrorFallback
        error={pairsErrorObj instanceof Error ? pairsErrorObj : String(pairsErrorObj ?? "")}
        errorKind="upstream_unreachable"
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* ---- Mode Toggle + Backend Status ---- */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5 rounded-lg border bg-muted/50 p-1">
          <button
            onClick={() => setMode("client")}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              mode === "client"
                ? "bg-background shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
            aria-pressed={mode === "client"}
          >
            {t("arbitrageModeClient")}
          </button>
          <button
            onClick={() => setMode("flipper")}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors flex items-center gap-1.5 ${
              mode === "flipper"
                ? "bg-background shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
            aria-pressed={mode === "flipper"}
          >
            <Zap className="h-3.5 w-3.5" aria-hidden="true" />
            {t("arbitrageModeFlipper")}
          </button>
        </div>

        {/* Backend status indicator */}
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Circle
            className={`h-2.5 w-2.5 ${
              backendOnline
                ? "fill-emerald-500 text-emerald-500"
                : "fill-red-500 text-red-500"
            }`}
            aria-hidden="true"
          />
          <Server className="h-3 w-3" aria-hidden="true" />
          {backendOnline
            ? t("flipperBackendOnline")
            : t("flipperBackendOffline")}
        </div>

        {/* Refresh button (flipper mode) */}
        {mode === "flipper" && backendOnline && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={() => {
              refetchFlips();
              refetchTri();
            }}
            aria-label={t("refreshData")}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        )}
      </div>

      {/* ---- Backend unavailable warning (flipper mode) ---- */}
      {mode === "flipper" && !backendOnline && (
        <ApiErrorFallback
          errorKind="backend_offline"
          onRetry={() => { refetchFlips(); refetchTri(); }}
        />
      )}

      {/* ---- Upstream degraded warning (flipper mode) ---- */}
      {mode === "flipper" && backendOnline && upstreamDegraded && (
        <ApiErrorFallback
          errorKind="upstream_unreachable"
          onRetry={() => { refetchFlips(); refetchTri(); }}
        />
      )}

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

      {/* ---- Event status banner (flipper mode) ---- */}
      {mode === "flipper" && flipsData?.event_status?.any_active && (
        <Card className="border-orange-500/30 bg-orange-500/5">
          <CardContent className="flex items-start gap-3 p-4">
            <Info className="h-5 w-5 text-orange-500 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="text-sm">
              <p className="font-medium text-orange-600 dark:text-orange-400">
                {t("flipperEventActive")}
              </p>
              {flipsData.event_status.affected_currencies.length > 0 && (
                <p className="text-muted-foreground mt-1">
                  {t("flipperAffectedCurrencies")}:{" "}
                  {flipsData.event_status.affected_currencies.join(", ")}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ============================================================ */}
      {/* CLIENT-SIDE MODE                                            */}
      {/* ============================================================ */}
      {mode === "client" && (
        <>
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

                  {/* Decay Lambda — Fix 3.1: Marked as non-functional since API
                      doesn't provide per-pair timestamps. The slider has no effect
                      because hoursSinceSnapshot is always 0. */}
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
                    {/* Fix 3.1: Show that decay is currently inactive */}
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      ⚠ No effect — API does not provide snapshot timestamps
                    </p>
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
                <div className="space-y-0" role="table" aria-label={t("arbitrageOpportunities")}>
                  {/* Table header */}
                  <div className="grid grid-cols-[1fr_60px_80px_80px_80px_80px_100px] gap-2 py-2 px-2 text-xs font-medium text-muted-foreground border-b border-border sticky top-0 bg-card z-10" role="row">
                    <span role="columnheader">{t("route")}</span>
                    <span className="text-center" role="columnheader">{t("len")}</span>
                    <span className="text-right" role="columnheader">{t("netProfit")}</span>
                    <span className="text-right" role="columnheader">{t("gross")}</span>
                    <span className="text-right" role="columnheader">{t("slippage")}</span>
                    <span className="text-center" role="columnheader">{t("confidence")}</span>
                    <span className="text-right" role="columnheader">{t("maxVol")}</span>
                  </div>

                  {/* Table body */}
                  <div className="max-h-96 overflow-y-auto" role="rowgroup">
                    {uniqueCycles.map((cycle, idx) => {
                      const routeNames = cycle.route.map(
                        (id) => cycle.edges.find((e) => e.from === id)?.fromName ?? id,
                      );
                      const startName =
                        cycle.edges[0]?.fromName ?? routeNames[0];
                      routeNames.push(startName);

                      return (
                        <div
                          key={idx}
                          className="grid grid-cols-[1fr_60px_80px_80px_80px_80px_100px] gap-2 py-2 px-2 text-sm border-b border-border/50 hover:bg-muted/20 transition-colors items-center"
                          role="row"
                        >
                          <div className="flex items-center gap-1 flex-wrap min-w-0" role="cell">
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

                          <span className="text-center text-xs text-muted-foreground font-mono" role="cell">
                            {cycle.edges.length}
                          </span>

                          <span className="text-right font-mono text-xs font-semibold text-emerald-600 dark:text-emerald-400" role="cell">
                            +{fmt(cycle.netProfit)}
                          </span>

                          <span className="text-right font-mono text-xs text-muted-foreground" role="cell">
                            {fmt(cycle.grossProfit)}
                          </span>

                          <span className="text-right font-mono text-xs text-muted-foreground" role="cell">
                            {(cycle.slippage * 100).toFixed(2)}%
                          </span>

                          <span className="flex justify-center" role="cell">
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

                          <span className="text-right font-mono text-xs text-muted-foreground" role="cell">
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
        </>
      )}

      {/* ============================================================ */}
      {/* FLIPPER MODE                                                */}
      {/* ============================================================ */}
      {mode === "flipper" && (
        <>
          {/* ---- Stats row ---- */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />
                  {t("flipperScoredFlips")}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 pt-0">
                <p className="text-2xl font-bold">{flipsData?.total ?? "—"}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t("flipperScoredFlipsDesc")}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Layers className="h-3.5 w-3.5" aria-hidden="true" />
                  {t("flipperTriangularCycles")}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 pt-0">
                <p className="text-2xl font-bold">{triData?.total ?? "—"}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t("flipperTriangularCyclesDesc")}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Zap className="h-3.5 w-3.5" aria-hidden="true" />
                  {t("flipperPhase")}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 pt-0">
                <p className="text-2xl font-bold capitalize">
                  {league ?? "—"}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t("flipperPhaseDesc")}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* ---- Flipper filters ---- */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="flip-min-score">
                {t("flipperMinScore")}
              </label>
              <Input
                id="flip-min-score"
                type="number"
                min={0}
                max={1}
                step={0.1}
                value={flipMinScore}
                onChange={(e) => setFlipMinScore(Number(e.target.value) || 0)}
                className="w-20 h-8 text-xs"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="flip-min-vol">
                {t("flipperMinVolume")}
              </label>
              <Input
                id="flip-min-vol"
                type="number"
                min={0}
                step={10}
                value={flipMinVolume}
                onChange={(e) => setFlipMinVolume(Number(e.target.value) || 0)}
                className="w-20 h-8 text-xs"
              />
            </div>
          </div>

          {/* ---- Scored Flip Opportunities ---- */}
          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
                <TrendingUp className="h-4 w-4" aria-hidden="true" />
                {t("flipperFlipOpportunities")}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-0">
              {!backendOnline ? (
                <ApiErrorFallback
                  errorKind="backend_offline"
                  onRetry={() => refetchFlips()}
                />
              ) : upstreamDegraded ? (
                <ApiErrorFallback
                  errorKind="upstream_unreachable"
                  onRetry={() => refetchFlips()}
                />
              ) : flipsData && flipsData.data_available === false ? (
                <div className="text-center py-10">
                  <AlertTriangle className="h-10 w-10 text-amber-500 mx-auto mb-3" aria-hidden="true" />
                  <p className="font-medium text-amber-600 dark:text-amber-400">{t("dataUnavailableTitle")}</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {t("dataUnavailableDesc")}
                  </p>
                </div>
              ) : flipsError ? (
                <ApiErrorFallback
                  error={flipsErrorObj instanceof Error ? flipsErrorObj : String(flipsErrorObj ?? "")}
                  onRetry={() => refetchFlips()}
                />
              ) : !flipsData?.opportunities?.length ? (
                <div className="text-center py-10">
                  <AlertTriangle className="h-10 w-10 text-muted-foreground mx-auto mb-3" aria-hidden="true" />
                  <p className="font-medium">{t("noArbitrage")}</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {t("noArbitrageDesc")}
                  </p>
                </div>
              ) : (
                <div className="space-y-0" role="table" aria-label={t("flipperFlipOpportunities")}>
                  {/* Table header */}
                  <div className="grid grid-cols-[1fr_60px_70px_70px_70px_80px_80px] gap-2 py-2 px-2 text-xs font-medium text-muted-foreground border-b border-border sticky top-0 bg-card z-10" role="row">
                    <span role="columnheader">{t("flipperCurrency")}</span>
                    <span className="text-center" role="columnheader">{t("flipperScore")}</span>
                    <span className="text-right" role="columnheader">{t("flipperSpread")}</span>
                    <span className="text-right" role="columnheader">{t("flipperMomentum")}</span>
                    <span className="text-right" role="columnheader">{t("flipperVolatility")}</span>
                    <span className="text-center" role="columnheader">{t("flipperCluster")}</span>
                    <span className="text-right" role="columnheader">{t("flipperVolume")}</span>
                  </div>

                  {/* Table body */}
                  <div className="max-h-96 overflow-y-auto" role="rowgroup">
                    {flipsData.opportunities.map((opp, idx) => (
                      <div
                        key={idx}
                        className="grid grid-cols-[1fr_60px_70px_70px_70px_80px_80px] gap-2 py-2 px-2 text-sm border-b border-border/50 hover:bg-muted/20 transition-colors items-center"
                        role="row"
                      >
                        {/* Currency pair */}
                        <span className="text-xs font-medium truncate" role="cell">
                          {opp.currency}
                        </span>

                        {/* Score */}
                        <span className="flex justify-center" role="cell">
                          <Badge
                            variant="outline"
                            className={`text-[10px] px-1.5 py-0 font-semibold ${
                              opp.score >= 0.7
                                ? "border-emerald-500/50 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
                                : opp.score >= 0.4
                                ? "border-amber-500/50 text-amber-600 dark:text-amber-400 bg-amber-500/10"
                                : "border-red-500/50 text-red-600 dark:text-red-400 bg-red-500/10"
                            }`}
                          >
                            {opp.score.toFixed(2)}
                          </Badge>
                        </span>

                        {/* Spread after fees */}
                        <span className="text-right font-mono text-xs text-muted-foreground" role="cell">
                          {(opp.spread_after_fees * 100).toFixed(2)}%
                        </span>

                        {/* Momentum */}
                        <span className={`text-right font-mono text-xs ${
                          opp.momentum > 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : opp.momentum < 0
                            ? "text-red-600 dark:text-red-400"
                            : "text-muted-foreground"
                        }`} role="cell">
                          {opp.momentum > 0 ? "+" : ""}
                          {opp.momentum.toFixed(4)}
                        </span>

                        {/* Volatility */}
                        <span className="text-right font-mono text-xs text-muted-foreground" role="cell">
                          {opp.volatility.toFixed(4)}
                        </span>

                        {/* Cluster */}
                        <span className="flex justify-center" role="cell">
                          <Badge
                            variant="outline"
                            className={`text-[10px] px-1.5 py-0 font-semibold ${
                              opp.cluster === "SAFE"
                                ? "border-emerald-500/50 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
                                : opp.cluster === "RISKY"
                                ? "border-red-500/50 text-red-600 dark:text-red-400 bg-red-500/10"
                                : "border-amber-500/50 text-amber-600 dark:text-amber-400 bg-amber-500/10"
                            }`}
                          >
                            {opp.cluster}
                          </Badge>
                        </span>

                        {/* Volume */}
                        <span className="text-right font-mono text-xs text-muted-foreground" role="cell">
                          {opp.volume_24h.toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ---- Triangular Arbitrage ---- */}
          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
                <Layers className="h-4 w-4" aria-hidden="true" />
                {t("flipperTriangularTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-0">
              {!backendOnline ? (
                <ApiErrorFallback errorKind="backend_offline" compact />
              ) : upstreamDegraded ? (
                <ApiErrorFallback errorKind="upstream_unreachable" compact />
              ) : triData && triData.data_available === false ? (
                <div className="text-center py-6">
                  <AlertTriangle className="h-8 w-8 text-amber-500 mx-auto mb-2" aria-hidden="true" />
                  <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
                    {t("dataUnavailableTitle")}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t("dataUnavailableDesc")}
                  </p>
                </div>
              ) : triError ? (
                <ApiErrorFallback
                  error={triErrorObj instanceof Error ? triErrorObj : String(triErrorObj ?? "")}
                  onRetry={() => refetchTri()}
                  compact
                />
              ) : !triData?.opportunities?.length ? (
                <div className="text-center py-6">
                  <AlertTriangle className="h-8 w-8 text-muted-foreground mx-auto mb-2" aria-hidden="true" />
                  <p className="text-sm text-muted-foreground">
                    {t("flipperNoTriangular")}
                  </p>
                </div>
              ) : (
                <div className="space-y-0" role="table" aria-label={t("flipperTriangularTitle")}>
                  {/* Table header */}
                  <div className="grid grid-cols-[1fr_80px_80px_80px] gap-2 py-2 px-2 text-xs font-medium text-muted-foreground border-b border-border sticky top-0 bg-card z-10" role="row">
                    <span role="columnheader">{t("flipperCycle")}</span>
                    <span className="text-right" role="columnheader">{t("flipperNetProfitPct")}</span>
                    <span className="text-center" role="columnheader">{t("confidence")}</span>
                    <span className="text-right" role="columnheader">{t("flipperTotalVolume")}</span>
                  </div>

                  {/* Table body */}
                  <div className="max-h-64 overflow-y-auto" role="rowgroup">
                    {triData.opportunities.map((tri, idx) => (
                      <div
                        key={idx}
                        className="grid grid-cols-[1fr_80px_80px_80px] gap-2 py-2 px-2 text-sm border-b border-border/50 hover:bg-muted/20 transition-colors items-center"
                        role="row"
                      >
                        {/* Cycle */}
                        <div className="flex items-center gap-1 flex-wrap min-w-0" role="cell">
                          {tri.cycle.map((c, i) => (
                            <span key={i} className="flex items-center gap-1">
                              <span className="truncate text-xs font-medium">{c}</span>
                              {i < tri.cycle.length - 1 && (
                                <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" aria-hidden="true" />
                              )}
                            </span>
                          ))}
                        </div>

                        {/* Net profit % */}
                        <span className="text-right font-mono text-xs font-semibold text-emerald-600 dark:text-emerald-400" role="cell">
                          +{tri.net_profit_pct.toFixed(2)}%
                        </span>

                        {/* Confidence */}
                        <span className="flex justify-center" role="cell">
                          <Badge
                            variant="outline"
                            className={`text-[10px] px-1.5 py-0 font-semibold ${
                              tri.confidence >= 0.7
                                ? "border-emerald-500/50 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
                                : tri.confidence >= 0.3
                                ? "border-amber-500/50 text-amber-600 dark:text-amber-400 bg-amber-500/10"
                                : "border-red-500/50 text-red-600 dark:text-red-400 bg-red-500/10"
                            }`}
                          >
                            {tri.confidence >= 0.7
                              ? t("confidenceHigh")
                              : tri.confidence >= 0.3
                              ? t("confidenceMedium")
                              : t("confidenceLow")}
                          </Badge>
                        </span>

                        {/* Total volume */}
                        <span className="text-right font-mono text-xs text-muted-foreground" role="cell">
                          {tri.total_volume.toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
});
