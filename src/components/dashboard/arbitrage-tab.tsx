// ============================================================================
// Arbitrage Tab — Flipper-scored arbitrage opportunities + triangular cycles
// Uses the flipper backend for properly scored opportunities with real
// volume/volatility/momentum data and gold fee accounting.
// ============================================================================
"use client";

import { useState, useMemo, memo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useFlipsQuery } from "@/hooks/use-flips-query";
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
import { useI18n } from "@/lib/i18n";
import { fetchApi } from "@/lib/types";
import type {
  TriangularResponse,
  FlipperPhaseResponse,
} from "@/lib/types";
import { ApiErrorFallback } from "./api-error-fallback";
import { ArbitrageFlipperFlips } from "./arbitrage-flipper-flips";
import { ArbitrageFlipperTriangular } from "./arbitrage-flipper-triangular";
import { DataFreshnessBadge } from "./data-freshness-badge";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ArbitrageTabProps {
  realm?: string;
  league?: string;
  /** Whether the flipper backend is online (checked at dashboard level) */
  backendOnline: boolean;
  /** Whether the health check is still in progress (first load) */
  backendChecking?: boolean;
  /** Backend is online but upstream API is unreachable (degraded mode) */
  upstreamDegraded?: boolean;
}

export const ArbitrageTab = memo(function ArbitrageTab({ realm, league, backendOnline, backendChecking, upstreamDegraded }: ArbitrageTabProps) {
  const { t } = useI18n();

  // Flipper filter state
  const [flipMinScore, setFlipMinScore] = useState(0);
  const [flipMinVolume, setFlipMinVolume] = useState(0);

  // ---- Flipper: scored flips (shared query via useFlipsQuery) ----
  const {
    data: flipsData,
    isLoading: flipsLoading,
    isError: flipsError,
    error: flipsErrorObj,
    refetch: refetchFlips,
  } = useFlipsQuery({
    enabled: backendOnline,
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
    enabled: backendOnline,
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: 1,
  });

  // ---- Flipper: phase info ----
  const { data: phaseData } = useQuery<FlipperPhaseResponse>({
    queryKey: ["flipper-phase"],
    queryFn: () => fetchApi<FlipperPhaseResponse>("/api/flipper/phase"),
    enabled: backendOnline,
    staleTime: 60_000,
    retry: 1,
  });

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

  // Determine loading state
  const isLoading = flipsLoading || triLoading;

  // Loading skeleton
  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-4">
          <Card><CardContent className="py-4 px-4"><div className="h-16" /></CardContent></Card>
          <Card><CardContent className="py-4 px-4"><div className="h-16" /></CardContent></Card>
          <Card><CardContent className="py-4 px-4"><div className="h-16" /></CardContent></Card>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ---- Backend Status + Refresh + Freshness Badge ---- */}
      <div className="flex flex-wrap items-center gap-3">
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

        {/* Data freshness badge — compact for flipper tabs */}
        {backendOnline && flipsData?.fetchedAt && (
          <DataFreshnessBadge
            fetchedAt={flipsData.fetchedAt}
            dataAvailable={flipsData.dataAvailable}
            compact
          />
        )}

        {/* Refresh button */}
        {backendOnline && (
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

      {/* ---- Backend checking / unavailable warning ---- */}
      {backendChecking && !backendOnline ? (
        <ApiErrorFallback
          errorKind="backend_checking"
          onRetry={() => { refetchFlips(); refetchTri(); }}
        />
      ) : !backendOnline ? (
        <ApiErrorFallback
          errorKind="backend_offline"
          onRetry={() => { refetchFlips(); refetchTri(); }}
        />
      ) : null}

      {/* ---- Upstream degraded warning ---- */}
      {backendOnline && upstreamDegraded && (
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

      {/* ---- Gold fee warning ---- */}
      {(flipsData?.feeWarning?.goldFeesExcluded || triData?.feeWarning?.goldFeesExcluded) && (
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

      {/* ---- Cross-rate inconsistency warning ---- */}
      {triData?.crossRateWarning && triData.crossRateWarning.suspiciousTriplesCount > 0 && (
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

      {/* ---- Event status banner ---- */}
      {flipsData?.eventStatus?.anyActive && (
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
              {phaseData?.phase ?? league ?? "—"}
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
    </div>
  );
});
