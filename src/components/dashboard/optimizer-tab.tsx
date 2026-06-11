// ============================================================================
// Optimizer Tab — Currency Path Optimizer + Rate Matrix Heatmap
//
// Two sections:
//   A) Currency Path Optimizer: find the optimal multi-hop conversion path
//      between two currencies, comparing against the direct rate.
//   B) Rate Matrix Heatmap: color-coded grid of all pairwise exchange rates.
// ============================================================================
"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  RefreshCw,
  Route,
  Grid3x3,
  TrendingUp,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n";
import {
  fetchApi,
  fmt,
  getFlipperErrorType,
} from "@/lib/types";
import type {
  OptimizerPathResponse,
  OptimizerMatrixResponse,
} from "@/lib/types";
import { FlipperBackendStatusCard } from "./flipper-backend-status-card";
import { DataFreshnessBadge } from "./data-freshness-badge";

// ---------------------------------------------------------------------------
// P2-1: Human-readable currency name mapping
// ---------------------------------------------------------------------------

/** Map api_id to human-readable display name for the heatmap. */
const CURRENCY_DISPLAY_NAMES: Record<string, string> = {
  exalted: "Exalted Orb",
  divine: "Divine Orb",
  chaos: "Chaos Orb",
  mirror: "Mirror of Kalandra",
  regret: "Orb of Regret",
  chance: "Orb of Chance",
  alchemy: "Orb of Alchemy",
  scouring: "Orb of Scouring",
  transmutation: "Orb of Transmutation",
  alteration: "Orb of Alteration",
  augmentation: "Orb of Augmentation",
  jeweller: "Jeweller's Orb",
  fusing: "Orb of Fusing",
  chromatic: "Chromatic Orb",
  vaal: "Vaal Orb",
  regal: "Regal Orb",
  blessed: "Blessed Orb",
  glassblower: "Glassblower's Bauble",
  gemcutter: "Gemcutter's Prism",
  chisel: "Cartographer's Chisel",
  annulment: "Orb of Annulment",
  binding: "Orb of Binding",
  horizon: "Orb of Horizons",
  harbinger: "Harbinger's Orb",
  fracturing: "Fracturing Orb",
  doom: "Orb of Doom",
  chance_scouring: "Chance/Scouring",
  prime_regrading: "Prime Regrading Lens",
  secondary_regrading: "Secondary Regrading Lens",
  unmaking: "Orb of Unmaking",
  socket: "Socket Currency",
};

/** Convert an api_id to a human-readable display name.
 *  Uses the lookup table, falls back to title-case capitalization. */
function getCurrencyDisplayName(apiId: string): string {
  if (CURRENCY_DISPLAY_NAMES[apiId]) return CURRENCY_DISPLAY_NAMES[apiId];
  // Fallback: capitalize first letter of each word, split by underscore/hyphen
  return apiId
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ---------------------------------------------------------------------------
// Component Props
// ---------------------------------------------------------------------------

interface OptimizerTabProps {
  /** Whether the flipper backend is online (checked at dashboard level) */
  backendOnline: boolean;
}

// ---------------------------------------------------------------------------
// Heatmap cell color helper
// ---------------------------------------------------------------------------

/** Returns Tailwind background class + text color class for a given rate cell */
function heatmapCellColor(rate: number | null): { bg: string; text: string } {
  if (rate === null) return { bg: "bg-muted/20", text: "text-muted-foreground" };
  if (rate === 1) return { bg: "bg-gray-500/20", text: "text-muted-foreground" };

  if (rate > 1) {
    // Green gradient: more intense for higher rates
    // Map 1.0–3.0+ to /20–/60
    const intensity = Math.min(Math.max((rate - 1) / 2, 0), 1); // 0..1
    const alpha = Math.round(20 + intensity * 40); // 20..60
    return { bg: `bg-emerald-500/${alpha}`, text: "text-emerald-300" };
  }

  // rate < 1: Red gradient
  const inverseRate = 1 / rate; // e.g. rate=0.5 → 2.0
  const intensity = Math.min(Math.max((inverseRate - 1) / 2, 0), 1);
  const alpha = Math.round(20 + intensity * 40);
  return { bg: `bg-red-500/${alpha}`, text: "text-red-300" };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function OptimizerTab({ backendOnline }: OptimizerTabProps) {
  const { t } = useI18n();

  // ---- Section A: Path Optimizer state ----
  const [fromCurrency, setFromCurrency] = useState("");
  const [toCurrency, setToCurrency] = useState("");
  const [amount, setAmount] = useState(1);

  // Trigger state: we only fetch when the user clicks "Find"
  const [pathQueryKey, setPathQueryKey] = useState<string | null>(null);

  const {
    data: pathData,
    isLoading: pathLoading,
    isError: pathError,
    error: pathErrorObj,
    refetch: refetchPath,
  } = useQuery<OptimizerPathResponse>({
    queryKey: ["flipperOptimizerPath", pathQueryKey],
    queryFn: () =>
      fetchApi<OptimizerPathResponse>("/api/flipper/optimizer/path", {
        from_currency: fromCurrency.trim().toLowerCase(),
        to_currency: toCurrency.trim().toLowerCase(),
        amount: String(amount),
        max_hops: "5",
      }),
    enabled: backendOnline && pathQueryKey !== null,
    staleTime: 30_000,
    retry: 1,
  });

  const pathInsufficientData =
    pathError && getFlipperErrorType(pathErrorObj) === "backend_insufficient_data";

  const handleFindPath = () => {
    if (!fromCurrency.trim() || !toCurrency.trim()) return;
    setPathQueryKey(`${fromCurrency}-${toCurrency}-${amount}-${Date.now()}`);
  };

  // ---- Section B: Rate Matrix state ----
  const [matrixLoaded, setMatrixLoaded] = useState(false);

  const {
    data: matrixData,
    isLoading: matrixLoading,
    isError: matrixError,
    error: matrixErrorObj,
    refetch: refetchMatrix,
  } = useQuery<OptimizerMatrixResponse>({
    queryKey: ["flipperOptimizerMatrix"],
    queryFn: () => fetchApi<OptimizerMatrixResponse>("/api/flipper/optimizer/matrix"),
    enabled: backendOnline && matrixLoaded,
    staleTime: 60_000,
    retry: 1,
  });

  const matrixInsufficientData =
    matrixError && getFlipperErrorType(matrixErrorObj) === "backend_insufficient_data";

  // Memoize heatmap cell colors
  const cellColors = useMemo(() => {
    if (!matrixData) return [];
    return matrixData.matrix.map((row) =>
      row.map((cell) => heatmapCellColor(cell))
    );
  }, [matrixData]);

  // ---- Render ----
  return (
    <div className="space-y-6">
      {/* Backend status card */}
      <FlipperBackendStatusCard
        backendOnline={backendOnline}
        insufficientData={pathInsufficientData || matrixInsufficientData}
        fetchedAt={pathData?.fetchedAt ?? matrixData?.fetchedAt}
        dataAvailable={pathData?.dataAvailable ?? matrixData?.dataAvailable}
        onRefresh={() => {
          refetchPath();
          refetchMatrix();
        }}
      />

      {/* Backend offline notice — optimizer requires the analytics backend */}
      {!backendOnline && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-2">
              <Route className="h-5 w-5 text-amber-500 shrink-0" aria-hidden="true" />
              <h3 className="text-sm font-semibold text-amber-600 dark:text-amber-400">
                {t("optimizerOfflineTitle") || "Optimizer requires the analytics backend"}
              </h3>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("optimizerOfflineDesc") ||
                "The Currency Path Optimizer and Rate Matrix require the FastAPI analytics backend to compute optimal conversion paths and pairwise rates. Start the backend to enable these features."}
            </p>
            <code className="text-xs block bg-muted px-2 py-1 rounded">
              uvicorn backend.main:app --reload --port 8000
            </code>
          </CardContent>
        </Card>
      )}

      {/* ================================================================ */}
      {/* Section A: Currency Path Optimizer                               */}
      {/* ================================================================ */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Route className="h-5 w-5" aria-hidden="true" />
            {t("optimizerPathTitle") || "Currency Path Optimizer"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Input row */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[140px]">
              <label
                className="text-xs font-medium text-muted-foreground mb-1 block"
                htmlFor="optimizer-from"
              >
                {t("optimizerFrom") || "From Currency"}
              </label>
              <Input
                id="optimizer-from"
                placeholder={t("optimizerCurrencyPlaceholder") || "e.g. chaos, divine"}
                value={fromCurrency}
                onChange={(e) => setFromCurrency(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleFindPath()}
                className="h-9"
              />
            </div>
            <div className="flex-1 min-w-[140px]">
              <label
                className="text-xs font-medium text-muted-foreground mb-1 block"
                htmlFor="optimizer-to"
              >
                {t("optimizerTo") || "To Currency"}
              </label>
              <Input
                id="optimizer-to"
                placeholder={t("optimizerCurrencyPlaceholder") || "e.g. chaos, divine"}
                value={toCurrency}
                onChange={(e) => setToCurrency(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleFindPath()}
                className="h-9"
              />
            </div>
            <div className="w-24">
              <label
                className="text-xs font-medium text-muted-foreground mb-1 block"
                htmlFor="optimizer-amount"
              >
                {t("optimizerAmount") || "Amount"}
              </label>
              <Input
                id="optimizer-amount"
                type="number"
                min={0.01}
                step={0.01}
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value) || 1)}
                className="h-9"
              />
            </div>
            <Button
              onClick={handleFindPath}
              disabled={!backendOnline || !fromCurrency.trim() || !toCurrency.trim() || pathLoading}
              className="h-9 gap-1.5"
            >
              {pathLoading ? (
                <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Route className="h-4 w-4" aria-hidden="true" />
              )}
              {t("optimizerFindPath") || "Find Optimal Path"}
            </Button>
          </div>

          {/* Results */}
          {pathError && !pathInsufficientData && (
            <Card className="border-red-500/30 bg-red-500/5" role="alert">
              <CardContent className="p-4 text-sm text-red-600 dark:text-red-400">
                {t("optimizerPathError") || "Failed to find optimal path. Check currency names and try again."}
              </CardContent>
            </Card>
          )}

          {pathInsufficientData && (
            <Card className="border-amber-500/30 bg-amber-500/5" role="alert">
              <CardContent className="p-4 text-sm text-amber-600 dark:text-amber-400">
                {t("optimizerInsufficientData") || "Insufficient data to compute optimal path. The backend may still be collecting market data."}
              </CardContent>
            </Card>
          )}

          {pathData && !pathError && (
            <div className="space-y-4">
              {/* Path visualization */}
              <div className="flex flex-wrap items-center gap-2 p-4 rounded-lg bg-muted/30 border">
                {pathData.path.map((currency, idx) => (
                  <span key={idx} className="flex items-center gap-2">
                    <Badge
                      variant={idx === 0 || idx === pathData.path.length - 1 ? "default" : "secondary"}
                      className="text-sm font-medium px-3 py-1"
                    >
                      {currency}
                    </Badge>
                    {idx < pathData.path.length - 1 && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                        <span className="font-mono">
                          {fmt(pathData.stepRates[idx])}
                        </span>
                      </span>
                    )}
                  </span>
                ))}
              </div>

              {/* Stats grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="p-3 rounded-lg bg-muted/20 border">
                  <p className="text-xs text-muted-foreground mb-1">
                    {t("optimizerEffectiveRate") || "Effective Rate"}
                  </p>
                  <p className="text-lg font-bold font-mono">
                    {fmt(pathData.effectiveRate, 4)}
                  </p>
                </div>

                <div className="p-3 rounded-lg bg-muted/20 border">
                  <p className="text-xs text-muted-foreground mb-1">
                    {t("optimizerOutput") || "Output Amount"}
                  </p>
                  <p className="text-lg font-bold font-mono">
                    {fmt(pathData.outputAmount, 4)}
                  </p>
                </div>

                <div className="p-3 rounded-lg bg-muted/20 border">
                  <p className="text-xs text-muted-foreground mb-1">
                    {t("optimizerHops") || "Hops"}
                  </p>
                  <p className="text-lg font-bold">{pathData.hops}</p>
                </div>

                {/* Direct rate comparison */}
                <div className="p-3 rounded-lg bg-muted/20 border">
                  <p className="text-xs text-muted-foreground mb-1">
                    {t("optimizerDirectRate") || "Direct Rate"}
                  </p>
                  <p className="text-lg font-bold font-mono">
                    {pathData.directRate !== null ? fmt(pathData.directRate, 4) : "—"}
                  </p>
                  {pathData.pathAdvantagePct !== null && (
                    <Badge
                      variant={pathData.pathAdvantagePct > 0 ? "default" : "destructive"}
                      className="mt-1 text-xs gap-1"
                    >
                      <TrendingUp className="h-3 w-3" aria-hidden="true" />
                      {pathData.pathAdvantagePct > 0 ? "+" : ""}
                      {pathData.pathAdvantagePct.toFixed(1)}%
                    </Badge>
                  )}
                </div>
              </div>

              {/* Data freshness — compact badge replaces inline Clock+text */}
              {pathData.fetchedAt && (
                <div className="flex items-center gap-2">
                  <DataFreshnessBadge
                    fetchedAt={pathData.fetchedAt}
                    dataAvailable={pathData.dataAvailable}
                    compact
                  />
                  {!pathData.dataAvailable && (
                    <Badge variant="outline" className="text-xs ml-2">
                      {t("optimizerPartialData") || "Partial data"}
                    </Badge>
                  )}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ================================================================ */}
      {/* Section B: Rate Matrix Heatmap                                   */}
      {/* ================================================================ */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Grid3x3 className="h-5 w-5" aria-hidden="true" />
              {t("optimizerMatrixTitle") || "Rate Matrix Heatmap"}
            </CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setMatrixLoaded(true);
                if (matrixData) refetchMatrix();
              }}
              disabled={!backendOnline || matrixLoading}
              className="h-8 gap-1.5"
            >
              {matrixLoading ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Grid3x3 className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {matrixData
                ? t("optimizerRefreshMatrix") || "Refresh Matrix"
                : t("optimizerLoadMatrix") || "Load Rate Matrix"
              }
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {matrixError && !matrixInsufficientData && (
            <Card className="border-red-500/30 bg-red-500/5 mb-4" role="alert">
              <CardContent className="p-4 text-sm text-red-600 dark:text-red-400">
                {t("optimizerMatrixError") || "Failed to load rate matrix."}
              </CardContent>
            </Card>
          )}

          {matrixInsufficientData && (
            <Card className="border-amber-500/30 bg-amber-500/5 mb-4" role="alert">
              <CardContent className="p-4 text-sm text-amber-600 dark:text-amber-400">
                {t("optimizerInsufficientData") || "Insufficient data to build rate matrix. The backend may still be collecting market data."}
              </CardContent>
            </Card>
          )}

          {matrixLoading && (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <RefreshCw className="h-5 w-5 animate-spin mr-2" aria-hidden="true" />
              {t("optimizerLoadingMatrix") || "Loading rate matrix..."}
            </div>
          )}

          {matrixData && !matrixLoading && (
            <div className="space-y-3">
              {/* Legend */}
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className="inline-block w-3 h-3 rounded-sm bg-emerald-500/40" aria-hidden="true" />
                  {t("optimizerRateAbove1") || "Rate > 1 (favorable)"}
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-3 h-3 rounded-sm bg-red-500/40" aria-hidden="true" />
                  {t("optimizerRateBelow1") || "Rate < 1 (unfavorable)"}
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-3 h-3 rounded-sm bg-gray-500/20" aria-hidden="true" />
                  {t("optimizerRateEquals1") || "Rate = 1 (diagonal)"}
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-3 h-3 rounded-sm bg-muted/20" aria-hidden="true" />
                  {t("optimizerRateNull") || "No data"}
                </span>
              </div>

              {/* Heatmap grid */}
              <div className="overflow-x-auto max-h-[600px] overflow-y-auto rounded-lg border">
                <div
                  className="inline-grid gap-px bg-border p-px min-w-full"
                  style={{
                    gridTemplateColumns: `auto repeat(${matrixData.currencies.length}, minmax(64px, 1fr))`,
                  }}
                  role="table"
                  aria-label={t("optimizerRateMatrixAria") || "Currency exchange rate matrix"}
                >
                  {/* Header row */}
                  <div className="bg-background px-2 py-1 text-xs font-medium text-muted-foreground sticky top-0 z-30" role="columnheader">
                    {" "}
                  </div>
                  {matrixData.currencies.map((currency) => (
                    <div
                      key={`h-${currency}`}
                      className="bg-background px-1 py-1 text-xs font-medium text-muted-foreground text-center truncate sticky top-0 z-20"
                      role="columnheader"
                      title={getCurrencyDisplayName(currency)}
                    >
                      {getCurrencyDisplayName(currency)}
                    </div>
                  ))}

                  {/* Data rows */}
                  {matrixData.currencies.map((rowCurrency, rowIdx) => (
                    <>
                      {/* Row header */}
                      <div
                        key={`r-${rowCurrency}`}
                        className="bg-background px-2 py-1 text-xs font-medium text-muted-foreground truncate sticky left-0 z-10 min-w-[80px]"
                        role="rowheader"
                        title={getCurrencyDisplayName(rowCurrency)}
                      >
                        {getCurrencyDisplayName(rowCurrency)}
                      </div>

                      {/* Cells */}
                      {matrixData.matrix[rowIdx]?.map((rate, colIdx) => {
                        const colors = cellColors[rowIdx]?.[colIdx] ?? { bg: "bg-muted/20", text: "text-muted-foreground" };
                        const isDiagonal = rowIdx === colIdx;
                        return (
                          <div
                            key={`c-${rowIdx}-${colIdx}`}
                            className={`${colors.bg} ${colors.text} px-1 py-1 text-xs font-mono text-center truncate`}
                            role="cell"
                            title={`${rowCurrency} → ${matrixData.currencies[colIdx]}: ${rate !== null ? rate.toFixed(4) : "N/A"}`}
                          >
                            {rate !== null ? (isDiagonal ? "1.0" : fmt(rate, 2)) : "—"}
                          </div>
                        );
                      })}
                    </>
                  ))}
                </div>
              </div>

              {/* Data freshness — compact badge replaces inline Clock+text */}
              {matrixData.fetchedAt && (
                <div className="flex items-center gap-2">
                  <DataFreshnessBadge
                    fetchedAt={matrixData.fetchedAt}
                    dataAvailable={matrixData.dataAvailable}
                    compact
                  />
                  <span className="text-xs text-muted-foreground">
                    {matrixData.size} × {matrixData.size} {t("optimizerCurrencies") || "currencies"}
                  </span>
                  {!matrixData.dataAvailable && (
                    <Badge variant="outline" className="text-xs ml-2">
                      {t("optimizerPartialData") || "Partial data"}
                    </Badge>
                  )}
                </div>
              )}
            </div>
          )}

          {!matrixLoaded && !matrixLoading && !matrixError && (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Grid3x3 className="h-8 w-8 mb-2 opacity-40" aria-hidden="true" />
              <p className="text-sm">
                {t("optimizerLoadMatrixPrompt") || "Click \"Load Rate Matrix\" to view all pairwise exchange rates."}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
