// ============================================================================
// Liquid Chain Tab — Vendor reforge conversion chain profitability
// §12: Shows per-step profit/loss and cumulative reforge paths for delirium
// liquids. Ancient and Dense liquids do NOT reforge (ratio=1 on last step).
// ============================================================================
"use client";

import { memo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Droplets,
  ArrowRight,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Clock,
  AlertTriangle,
  Layers,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { fetchApi, fmt } from "@/lib/types";
import type {
  LiquidChainAnalysisResponse,
  LiquidChainResult,
  LiquidChainStep,
  LiquidChainCumulativePath,
} from "@/lib/types";
import { ApiErrorFallback } from "./api-error-fallback";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface LiquidChainTabProps {
  backendOnline: boolean;
  upstreamDegraded?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Profit coloring utility */
function profitColor(val: number): string {
  if (val > 0) return "text-emerald-600 dark:text-emerald-400";
  if (val < 0) return "text-red-500 dark:text-red-400";
  return "text-muted-foreground";
}

function profitBadge(val: number): string {
  if (val > 0) return "+";
  return "";
}

/** Check if a step is non-reforgeable (last step, ratio=1, no next step) */
function isNonReforgeable(step: LiquidChainStep, idx: number, total: number): boolean {
  // Last step always has ratio=1 in config (no further reforge target)
  // Also steps with ratio=1 that aren't the very first item
  return idx === total - 1 || (step.ratio === 1 && idx > 0);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Per-step chain row */
const ChainStepRow = memo(function ChainStepRow({
  step,
  idx,
  totalSteps,
  bestStep,
  worstStep,
}: {
  step: LiquidChainStep;
  idx: number;
  totalSteps: number;
  bestStep: number | null;
  worstStep: number | null;
}) {
  const { t } = useI18n();
  const noReforge = isNonReforgeable(step, idx, totalSteps);
  const isBest = bestStep === idx && step.profitPct > 0;
  const isWorst = worstStep === idx;

  return (
    <div
      className={`grid grid-cols-[1fr_50px_70px_70px_70px_70px] gap-2 py-2 px-2 text-sm border-b border-border/50 hover:bg-muted/20 transition-colors items-center ${
        noReforge ? "opacity-50" : ""
      }`}
      role="row"
    >
      {/* Name */}
      <div className="flex items-center gap-1.5 min-w-0" role="cell">
        <Droplets
          className={`h-3.5 w-3.5 shrink-0 ${
            isBest
              ? "text-emerald-500"
              : isWorst
              ? "text-red-400"
              : "text-muted-foreground"
          }`}
          aria-hidden="true"
        />
        <span className="truncate text-xs font-medium" title={step.nameRu || step.nameEn}>
          {step.nameEn}
        </span>
        {noReforge && (
          <Badge variant="outline" className="text-[9px] px-1 py-0 ml-1 border-amber-500/40 text-amber-600 dark:text-amber-400">
            {t("liquidChainNoReforge")}
          </Badge>
        )}
        {isBest && (
          <Badge variant="outline" className="text-[9px] px-1 py-0 ml-1 border-emerald-500/40 text-emerald-600 dark:text-emerald-400">
            {t("liquidChainBestStep")}
          </Badge>
        )}
      </div>

      {/* Ratio */}
      <span className="text-center font-mono text-xs text-muted-foreground" role="cell">
        {step.ratio > 1 ? `${step.ratio}:1` : "—"}
      </span>

      {/* Input Cost */}
      <span className="text-right font-mono text-xs" role="cell">
        {step.inputCost > 0 ? fmt(step.inputCost) : "—"}
      </span>

      {/* Output Value */}
      <span className="text-right font-mono text-xs" role="cell">
        {step.outputValue > 0 ? fmt(step.outputValue) : "—"}
      </span>

      {/* Profit */}
      <span className={`text-right font-mono text-xs font-semibold ${profitColor(step.profit)}`} role="cell">
        {step.inputCost > 0 && step.outputValue > 0
          ? `${profitBadge(step.profit)}${fmt(step.profit)}`
          : "—"}
      </span>

      {/* Profit % */}
      <span className={`text-right font-mono text-xs font-semibold ${profitColor(step.profitPct)}`} role="cell">
        {step.inputCost > 0 && step.outputValue > 0
          ? `${profitBadge(step.profitPct)}${step.profitPct.toFixed(2)}%`
          : "—"}
      </span>
    </div>
  );
});

/** Cumulative paths section */
const CumulativePathsSection = memo(function CumulativePathsSection({
  paths,
  steps,
}: {
  paths: LiquidChainCumulativePath[];
  steps: LiquidChainStep[];
}) {
  const { t } = useI18n();

  const profitablePaths = paths.filter((p) => p.profitPct > 0);

  if (profitablePaths.length === 0) return null;

  return (
    <Card className="mt-4">
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
          <Layers className="h-4 w-4" aria-hidden="true" />
          {t("liquidChainCumulativePaths")} ({profitablePaths.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0">
        <div className="space-y-0" role="table" aria-label={t("liquidChainCumulativePaths")}>
          <div
            className="grid grid-cols-[1fr_60px_70px_70px_70px] gap-2 py-2 px-2 text-xs font-medium text-muted-foreground border-b border-border"
            role="row"
          >
            <span role="columnheader">{t("liquidChainPath")}</span>
            <span className="text-right" role="columnheader">{t("liquidChainRatio")}</span>
            <span className="text-right" role="columnheader">{t("liquidChainInputCost")}</span>
            <span className="text-right" role="columnheader">{t("liquidChainOutput")}</span>
            <span className="text-right" role="columnheader">{t("liquidChainProfitPct")}</span>
          </div>
          <div className="max-h-48 overflow-y-auto" role="rowgroup">
            {profitablePaths.map((path, idx) => (
              <div
                key={idx}
                className="grid grid-cols-[1fr_60px_70px_70px_70px] gap-2 py-2 px-2 text-sm border-b border-border/50 hover:bg-muted/20 transition-colors items-center"
                role="row"
              >
                {/* Path: from → to */}
                <div className="flex items-center gap-1 text-xs" role="cell">
                  <span className="truncate">{steps[path.fromIndex]?.nameEn || `#${path.fromIndex}`}</span>
                  <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" aria-hidden="true" />
                  <span className="truncate">{steps[path.toIndex]?.nameEn || `#${path.toIndex}`}</span>
                </div>
                {/* Cumulative Ratio */}
                <span className="text-right font-mono text-xs text-muted-foreground" role="cell">
                  {path.cumulativeRatio}:1
                </span>
                {/* Input Cost */}
                <span className="text-right font-mono text-xs" role="cell">
                  {fmt(path.totalInputCost)}
                </span>
                {/* Output */}
                <span className="text-right font-mono text-xs" role="cell">
                  {fmt(path.totalOutputValue)}
                </span>
                {/* Profit % */}
                <span className={`text-right font-mono text-xs font-semibold ${profitColor(path.profitPct)}`} role="cell">
                  +{path.profitPct.toFixed(2)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
});

/** Display name for a chain based on its chainName from config */
function chainDisplayName(chainName: string, t: ReturnType<typeof useI18n>["t"]): string {
  // Map config chain names to i18n keys for human-readable titles.
  // This allows future chains to have proper display names.
  // Fallback: use the raw chainName from config if no i18n mapping exists.
  const NAMES: Record<string, string> = {
    delirium_liquids: "liquidChainTitle",
    ritual_omens: "ritualOmensTitle",
  };
  const i18nKey = NAMES[chainName];
  if (i18nKey) {
    return t(i18nKey as any);
  }
  return chainName;
}

/** Single chain card */
const ChainCard = memo(function ChainCard({
  chain,
}: {
  chain: LiquidChainResult;
}) {
  const { t } = useI18n();

  const profitableSteps = chain.steps.filter((s) => s.profitPct > 0 && s.inputCost > 0);
  const unprofitableSteps = chain.steps.filter((s) => s.profitPct < 0 && s.inputCost > 0);

  // Use i18n key for chain title if available, fallback to chain name
  const chainTitle = chainDisplayName(chain.chainName, t);

  return (
    <Card>
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
            <Droplets className="h-4 w-4" aria-hidden="true" />
            {chainTitle}
          </CardTitle>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{chain.stepsWithData}/{chain.totalSteps} {t("liquidChainStepsAvailable")}</span>
            {profitableSteps.length > 0 && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10">
                <TrendingUp className="h-3 w-3 mr-1" />{profitableSteps.length} {t("liquidChainProfitable")}
              </Badge>
            )}
            {unprofitableSteps.length > 0 && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-red-500/40 text-red-600 dark:text-red-400 bg-red-500/10">
                <TrendingDown className="h-3 w-3 mr-1" />{unprofitableSteps.length} {t("liquidChainUnprofitable")}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0">
        {/* Important notice about non-reforgeable liquids */}
        <div className="mb-3 p-2 bg-amber-500/10 border border-amber-500/20 rounded text-xs text-amber-700 dark:text-amber-300">
          {t("liquidChainNoReforgeNotice")}
        </div>

        {/* Steps table */}
        <div className="space-y-0" role="table" aria-label={t("liquidChainTitle")}>
          <div
            className="grid grid-cols-[1fr_50px_70px_70px_70px_70px] gap-2 py-2 px-2 text-xs font-medium text-muted-foreground border-b border-border sticky top-0 bg-card z-10"
            role="row"
          >
            <span role="columnheader">{t("liquidChainName")}</span>
            <span className="text-center" role="columnheader">{t("liquidChainRatioCol")}</span>
            <span className="text-right" role="columnheader">{t("liquidChainInputCost")}</span>
            <span className="text-right" role="columnheader">{t("liquidChainOutput")}</span>
            <span className="text-right" role="columnheader">{t("liquidChainProfit")}</span>
            <span className="text-right" role="columnheader">{t("liquidChainProfitPct")}</span>
          </div>
          <div className="max-h-80 overflow-y-auto" role="rowgroup">
            {chain.steps.map((step, idx) => (
              <ChainStepRow
                key={step.apiId}
                step={step}
                idx={idx}
                totalSteps={chain.totalSteps}
                bestStep={chain.bestStep}
                worstStep={chain.worstStep}
              />
            ))}
          </div>
        </div>

        {/* Cumulative paths */}
        <CumulativePathsSection paths={chain.cumulativePaths} steps={chain.steps} />
      </CardContent>
    </Card>
  );
});

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export const LiquidChainTab = memo(function LiquidChainTab({
  backendOnline,
  upstreamDegraded,
}: LiquidChainTabProps) {
  const { t } = useI18n();

  const {
    data: liquidChainData,
    error: liquidChainError,
    refetch,
    isPending: liquidChainLoading,
  } = useQuery<LiquidChainAnalysisResponse>({
    queryKey: ["flipper-liquid-chain"],
    queryFn: () => fetchApi<LiquidChainAnalysisResponse>("/api/flipper/liquid-chain"),
    enabled: backendOnline,
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: 1,
  });

  // -- States --
  if (!backendOnline) {
    return (
      <ApiErrorFallback errorKind="backend_offline" />
    );
  }

  if (upstreamDegraded) {
    return (
      <ApiErrorFallback errorKind="upstream_unreachable" />
    );
  }

  if (liquidChainLoading) {
    return (
      <div className="text-center py-8">
        <Clock className="h-8 w-8 text-amber-500 mx-auto mb-2 animate-pulse" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">{t("loading")}</p>
      </div>
    );
  }

  if (liquidChainData && liquidChainData.dataAvailable === false && liquidChainData.message) {
    return (
      <div className="text-center py-6">
        <Clock className="h-8 w-8 text-amber-500 mx-auto mb-2" aria-hidden="true" />
        <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
          {t("flipperCollectingDataTitle")}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          {t("flipperCollectingDataDesc")}
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="mt-3 h-7 text-xs gap-1.5"
          onClick={() => refetch()}
        >
          <RefreshCw className="h-3 w-3" aria-hidden="true" />
          {t("tryAgain")}
        </Button>
      </div>
    );
  }

  if (liquidChainError) {
    return (
      <ApiErrorFallback
        error={liquidChainError instanceof Error ? liquidChainError : String(liquidChainError ?? "")}
        onRetry={() => refetch()}
      />
    );
  }

  if (!liquidChainData?.chains?.length) {
    return (
      <div className="text-center py-6">
        <AlertTriangle className="h-8 w-8 text-muted-foreground mx-auto mb-2" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">{t("liquidChainNoData")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {liquidChainData.chains.map((chain) => (
        <ChainCard key={chain.chainName} chain={chain} />
      ))}
    </div>
  );
});
