// ============================================================================
// Arbitrage Tab — finds currency-exchange cycles with positive net profit
// Task 6.9: Confidence indicator + Time-Decay weighting
// Phase 2: Flipper mode toggle — integrates FastAPI backend scoring,
//           triangular arbitrage, event status, gold fees, clusters
//
// ШАГ 3: Refactored from 1369-line monolith into:
//   - arbitrage-helpers.ts      (types + pure functions + cycle finder)
//   - arbitrage-client-table.tsx (client-side mode display)
//   - arbitrage-flipper-flips.tsx (flipper scored flips table)
//   - arbitrage-flipper-triangular.tsx (triangular arb table)
//   - arbitrage-settings.tsx    (settings panel)
// ============================================================================
"use client";

import { useState, useMemo, memo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useFlipsQuery, FLIPS_QUERY_KEY } from "@/hooks/use-flips-query";
import {
  AlertTriangle,
  Info,
  Zap,
  Circle,
  Server,
  RefreshCw,
  Coins,
  Layers,
  TrendingUp,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/lib/i18n";
import { fetchApi } from "@/lib/types";
import type {
  ExchangePair,
  TriangularResponse,
} from "@/lib/types";
import { ApiErrorFallback } from "./api-error-fallback";
import { findArbitrageCycles } from "./arbitrage-helpers";
import { ArbitrageClientTable } from "./arbitrage-client-table";
import { ArbitrageFlipperFlips } from "./arbitrage-flipper-flips";
import { ArbitrageFlipperTriangular } from "./arbitrage-flipper-triangular";
import { ArbitrageSettings } from "./arbitrage-settings";

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
    minScore: 0,    // Bug 2.4 fix: always fetch full data; filter client-side
    minVolume: 0,   // Bug 2.4 fix: always fetch full data; filter client-side
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

  // Bug 2.4 fix: Filter flip opportunities client-side
  const filteredFlipsData = useMemo(() => {
    if (!flipsData) return flipsData;
    const filtered = flipsData.opportunities.filter((opp) => {
      if (flipMinScore > 0 && (opp.score ?? 0) < flipMinScore) return false;
      if (flipMinVolume > 0 && (opp.volume24h ?? 0) < flipMinVolume) return false;
      return true;
    });
    return {
      ...flipsData,
      opportunities: filtered,
      total: filtered.length,
    };
  }, [flipsData, flipMinScore, flipMinVolume]);

  // Determine loading state based on mode
  const isLoading =
    mode === "client"
      ? pairsLoading
      : flipsLoading || triLoading;

  const isError =
    mode === "client"
      ? pairsError
      : flipsError;

  // Loading skeleton — 4.4: Using Skeleton component instead of animate-pulse divs
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

      {/* ---- Client-mode limitation note ---- */}
      {mode === "client" && (
        <Card className="border-blue-500/30 bg-blue-500/5">
          <CardContent className="flex items-start gap-3 p-4">
            <Info className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="text-sm">
              <p className="font-medium text-blue-600 dark:text-blue-400">
                {t("arbitrageClientModeNote")}
              </p>
              <p className="text-muted-foreground mt-1">
                {t("arbitrageClientModeNoteDesc")}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ---- Gold fee warning (flipper mode) ---- */}
      {mode === "flipper" && (flipsData?.feeWarning?.goldFeesExcluded || triData?.feeWarning?.goldFeesExcluded) && (
        <Card className="border-orange-500/30 bg-orange-500/5" role="alert" aria-live="polite">
          <CardContent className="flex items-start gap-3 p-4">
            <Coins className="h-5 w-5 text-orange-500 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="text-sm">
              <p className="font-medium text-orange-600 dark:text-orange-400">
                {t("flipsGoldFeesExcluded")}
              </p>
              <p className="text-muted-foreground mt-1">
                {t("flipsGoldFeesExcludedDesc")}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ---- Cross-rate inconsistency warning (flipper mode) ---- */}
      {mode === "flipper" && triData?.crossRateWarning && triData.crossRateWarning.suspiciousTriplesCount > 0 && (
        <Card className="border-red-500/30 bg-red-500/5" role="alert" aria-live="polite">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertTriangle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="text-sm">
              <p className="font-medium text-red-600 dark:text-red-400">
                {t("crossRateWarningTitle")}
              </p>
              <p className="text-muted-foreground mt-1">
                {t("crossRateWarningDesc")}
              </p>
              {triData.crossRateWarning.affectedCurrencies.length > 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  {t("flipperAffectedCurrencies")}: {triData.crossRateWarning.affectedCurrencies.join(", ")}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ---- Event status banner (flipper mode) ---- */}
      {mode === "flipper" && flipsData?.eventStatus?.anyActive && (
        <Card className="border-orange-500/30 bg-orange-500/5">
          <CardContent className="flex items-start gap-3 p-4">
            <Info className="h-5 w-5 text-orange-500 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="text-sm">
              <p className="font-medium text-orange-600 dark:text-orange-400">
                {t("flipperEventActive")}
              </p>
              {flipsData.eventStatus.affectedCurrencies.length > 0 && (
                <p className="text-muted-foreground mt-1">
                  {t("flipperAffectedCurrencies")}:{" "}
                  {flipsData.eventStatus.affectedCurrencies.join(", ")}
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
          <ArbitrageSettings
            tradingFeeBps={tradingFeeBps}
            setTradingFeeBps={setTradingFeeBps}
            baseSlippageBps={baseSlippageBps}
            setBaseSlippageBps={setBaseSlippageBps}
            tradeSize={tradeSize}
            setTradeSize={setTradeSize}
            minVolume={minVolume}
            setMinVolume={setMinVolume}
            decayLambda={decayLambda}
            setDecayLambda={setDecayLambda}
            showSettings={showSettings}
            setShowSettings={setShowSettings}
          />
          <ArbitrageClientTable
            pairs={pairs}
            cycles={cycles}
            minVolume={minVolume}
            baseSlippageBps={baseSlippageBps}
            tradingFeeBps={tradingFeeBps}
          />
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
              <CardContent className="py-4 px-4">
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />
                  {t("flipperScoredFlips")}
                </div>
                <p className="text-2xl font-bold mt-1">{flipsData?.total ?? "—"}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t("flipperScoredFlipsDesc")}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="py-4 px-4">
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Layers className="h-3.5 w-3.5" aria-hidden="true" />
                  {t("flipperTriangularCycles")}
                </div>
                <p className="text-2xl font-bold mt-1">{triData?.total ?? "—"}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t("flipperTriangularCyclesDesc")}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="py-4 px-4">
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Zap className="h-3.5 w-3.5" aria-hidden="true" />
                  {t("flipperPhase")}
                </div>
                <p className="text-2xl font-bold capitalize mt-1">
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
          <ArbitrageFlipperFlips
            flipsData={filteredFlipsData}
            flipsError={flipsError}
            flipsErrorObj={flipsErrorObj}
            backendOnline={backendOnline}
            upstreamDegraded={upstreamDegraded}
            onRetry={() => refetchFlips()}
          />

          {/* ---- Triangular Arbitrage ---- */}
          <ArbitrageFlipperTriangular
            triData={triData}
            triError={triError}
            triErrorObj={triErrorObj}
            backendOnline={backendOnline}
            upstreamDegraded={upstreamDegraded}
            onRetry={() => refetchTri()}
          />
        </>
      )}
    </div>
  );
});
