// ============================================================================
// Portfolio Tab — Portfolio allocation, risk metrics, correlation matrix,
// rebalance controls, and efficient frontier chart.
//
// Reference: frontend/components/portfolio_tab.py (Streamlit)
// Data: GET /api/flipper/portfolio, POST /api/flipper/portfolio/rebalance,
//       GET /api/flipper/portfolio/frontier
//
// Uses Recharts (already in deps) for bar chart and scatter chart.
// Correlation matrix is rendered as HTML table with color-coded cells.
// ============================================================================
"use client";

import { useState, useMemo, useCallback, useEffect, memo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Briefcase,
  AlertTriangle,
  RefreshCw,
  TrendingUp,
  Shield,
  BarChart3,
  Info,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ScatterChart,
  Scatter,
  Line,
  Legend,
  ZAxis,
} from "recharts";
import { useI18n, type TranslationKeys } from "@/lib/i18n";
import { fetchApi, getFlipperErrorType, type PortfolioData as CanonicalPortfolioData } from "@/lib/types";
import { FlipperBackendStatusCard } from "./flipper-backend-status-card";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CorrelationMatrix {
  currencies: string[];
  matrix: number[][];
}

interface PortfolioData extends CanonicalPortfolioData {
  correlationMatrix?: CorrelationMatrix | null;
}

interface FrontierPoint {
  risks: number[];
  returns: number[];
}

interface IndividualAsset {
  name: string;
  risk: number;
  return: number;
}

interface CurrentPortfolio {
  risk: number;
  return: number;
}

interface FrontierData {
  frontier: FrontierPoint;
  individualAssets: IndividualAsset[];
  currentPortfolio: CurrentPortfolio | null;
  dataAvailable?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map correlation value [-1, 1] to RGB color string */
function correlationToColor(corr: number): string {
  // -1 → deep red (220, 38, 38)
  //  0 → white (255, 255, 255) in light mode, dark slate in dark mode
  // +1 → deep blue (37, 99, 235)
  const clamped = Math.max(-1, Math.min(1, corr));
  if (clamped >= 0) {
    // Interpolate from neutral to blue
    const t = clamped;
    const r = Math.round(255 - t * (255 - 37));
    const g = Math.round(255 - t * (255 - 99));
    const b = Math.round(255 - t * (255 - 235));
    return `rgb(${r}, ${g}, ${b})`;
  } else {
    // Interpolate from neutral to red
    const t = -clamped;
    const r = Math.round(255 - t * (255 - 220));
    const g = Math.round(255 - t * (255 - 38));
    const b = Math.round(255 - t * (255 - 38));
    return `rgb(${r}, ${g}, ${b})`;
  }
}

/** Decide text color (black or white) based on background luminance */
function textColorForBg(corr: number): string {
  const clamped = Math.max(-1, Math.min(1, corr));
  // Stronger colors need white text
  if (Math.abs(clamped) > 0.55) return "text-white";
  return "text-foreground";
}

function methodLabel(method: string, t: (key: TranslationKeys) => string): string {
  switch (method) {
    case "risk_parity":
      return t("portfolioRiskParityTitle");
    case "min_variance":
      return t("portfolioMinVarianceTitle");
    default:
      return method.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

// ---------------------------------------------------------------------------
// Custom chart tooltip
// ---------------------------------------------------------------------------

function WeightTooltip({ active, payload, t }: { active?: boolean; payload?: Array<{ payload: { name: string; weight: number } }>; t: (key: TranslationKeys) => string }) {
  if (!active || !payload?.length) return null;
  const data = payload[0].payload;
  return (
    <div className="bg-popover border border-border rounded-md px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold">{data.name}</p>
      <p className="text-muted-foreground">
        {t("portfolioWeight")}: {((data.weight ?? 0) * 100).toFixed(2)}%
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component Props
// ---------------------------------------------------------------------------

interface PortfolioTabProps {
  /** Whether the flipper backend is online (checked at dashboard level) */
  backendOnline: boolean;
  /** Backend is online but upstream API is unreachable (degraded mode) */
  upstreamDegraded?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const PortfolioTab = memo(function PortfolioTab({ backendOnline, upstreamDegraded }: PortfolioTabProps) {
  const { t } = useI18n();
  const queryClient = useQueryClient();

  // Method selector state
  const [selectedMethod, setSelectedMethod] = useState<string>("risk_parity");
  const [showMethodExplanation, setShowMethodExplanation] = useState(false);

  // ---- Backend health check is done at dashboard level ----
  // backendOnline is passed as prop

  // ---- Fetch portfolio data ----
  const {
    data: portfolioData,
    isLoading: portfolioLoading,
    isError: portfolioError,
    refetch: refetchPortfolio,
  } = useQuery<PortfolioData>({
    queryKey: ["flipper-portfolio"],
    queryFn: () => fetchApi<PortfolioData>("/api/flipper/portfolio"),
    enabled: backendOnline,
    staleTime: 60_000,
    retry: 1,
  });

  // ---- Determine if error is due to insufficient data vs backend offline ----
  const insufficientData =
    portfolioError && getFlipperErrorType(portfolioError) === "backend_insufficient_data";

  // ---- Fetch efficient frontier (only for min_variance) ----
  const {
    data: frontierData,
    isLoading: frontierLoading,
  } = useQuery<FrontierData>({
    queryKey: ["flipper-portfolio-frontier"],
    queryFn: () => fetchApi<FrontierData>("/api/flipper/portfolio/frontier", { n_points: "30" }),
    enabled: backendOnline && portfolioData?.method === "min_variance",
    staleTime: 120_000,
    retry: 1,
  });

  // ---- Rebalance mutation (supports method override) ----
  const rebalanceMutation = useMutation({
    mutationFn: (method?: string) => {
      const url = method
        ? `/api/flipper/portfolio/rebalance?method=${encodeURIComponent(method)}`
        : "/api/flipper/portfolio/rebalance";
      return fetch(url, { method: "POST" }).then(
        async (res) => {
          if (!res.ok) {
            const text = await res.text();
            throw new Error(text);
          }
          return res.json();
        },
      );
    },
    onSuccess: (data) => {
      // Fix 3.2: Update selectedMethod from the server response
      if (data?.method && (data.method === "risk_parity" || data.method === "min_variance")) {
        setSelectedMethod(data.method);
      }
      queryClient.invalidateQueries({ queryKey: ["flipper-portfolio"] });
      queryClient.invalidateQueries({ queryKey: ["flipper-portfolio-frontier"] });
    },
  });

  // ---- Sync selected method with backend data ----
  useEffect(() => {
    if (portfolioData?.method && (portfolioData.method === "risk_parity" || portfolioData.method === "min_variance")) {
      setSelectedMethod(portfolioData.method);
    }
  }, [portfolioData?.method]);

  // ---- Handle method change ----
  // Fix 3.2: Only update selectedMethod in onSuccess callback,
  // preventing race condition where UI shows new method while data is stale
  const handleMethodChange = useCallback(
    (newMethod: string) => {
      // Do NOT call setSelectedMethod here — let onSuccess handle it
      rebalanceMutation.mutate(newMethod);
    },
    [rebalanceMutation],
  );

  // ---- Derived data ----
  const sortedWeights = useMemo(() => {
    if (!portfolioData?.weights) return [];
    return Object.entries(portfolioData.weights)
      .sort(([, a], [, b]) => b - a)
      .map(([name, weight]) => ({ name, weight }));
  }, [portfolioData]);

  const barChartData = useMemo(() => {
    return sortedWeights.map((w) => ({
      name: w.name,
      weight: w.weight,
    }));
  }, [sortedWeights]);

  const maxWeight = useMemo(() => {
    if (!sortedWeights.length) return 1;
    return Math.max(...sortedWeights.map((w) => w.weight));
  }, [sortedWeights]);

  // ---- Correlation matrix (mock from backend when available) ----
  // The backend doesn't return a full correlation matrix in the portfolio
  // endpoint, so we compute a pseudo-correlation display from the weights
  // and show it as an example. In production, this would come from the API.
  // For now, we render a placeholder matrix with the currencies.
  const matrixCurrencies = useMemo(() => {
    return sortedWeights.map((w) => w.name);
  }, [sortedWeights]);

  // ---- Frontier chart data ----
  const frontierChartData = useMemo(() => {
    if (!frontierData?.frontier) return [];
    const f = frontierData.frontier;
    return f.risks.map((risk, i) => ({
      risk,
      return: f.returns[i] ?? 0,
    }));
  }, [frontierData]);

  const individualAssetsData = useMemo(() => {
    if (!frontierData?.individualAssets) return [];
    return frontierData.individualAssets.map((a) => ({
      x: a.risk,
      y: a.return,
      z: 80,
      name: a.name,
    }));
  }, [frontierData]);

  const currentPortfolioData = useMemo(() => {
    if (!frontierData?.currentPortfolio) return null;
    return [{
      x: frontierData.currentPortfolio.risk,
      y: frontierData.currentPortfolio.return,
      z: 200,
      name: t("portfolioCurrentPortfolio"),
    }];
  }, [frontierData]);

  // ---- Loading ----
  if (portfolioLoading && backendOnline) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20 w-full" />
        <div className="grid grid-cols-3 gap-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <FlipperBackendStatusCard
        backendOnline={backendOnline}
        upstreamDegraded={upstreamDegraded}
        insufficientData={insufficientData}
        onRefresh={() => refetchPortfolio()}
      />

      {/* ---- Portfolio data ---- */}
      {backendOnline && (
        <>
          {/* ---- Key metrics row ---- */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-xs font-medium text-muted-foreground">
                  {t("portfolioMethod")}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 pt-0">
                {portfolioData ? (
                  <div className="flex items-center gap-2">
                    <Select
                      value={selectedMethod}
                      onValueChange={handleMethodChange}
                      disabled={rebalanceMutation.isPending}
                    >
                      <SelectTrigger className="w-full h-9 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="risk_parity">{t("portfolioRiskParityTitle")}</SelectItem>
                        <SelectItem value="min_variance">{t("portfolioMinVarianceTitle")}</SelectItem>
                      </SelectContent>
                    </Select>
                    {rebalanceMutation.isPending && (
                      <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" aria-hidden="true" />
                    )}
                  </div>
                ) : (
                  <p className="text-xl font-bold">—</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-xs font-medium text-muted-foreground">
                  {t("portfolioAnnualizedRisk")}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 pt-0">
                <p className="text-xl font-bold">
                  {portfolioData
                    ? `${((portfolioData.expectedRisk ?? 0) * 100).toFixed(2)}%`
                    : "—"}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-xs font-medium text-muted-foreground">
                  {t("portfolioCorrelationStatus")}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 pt-0">
                {portfolioData?.correlationWarning ? (
                  <Badge
                    variant="outline"
                    className="border-red-500/50 text-red-600 dark:text-red-400 bg-red-500/10 text-sm px-3 py-1"
                  >
                    <AlertTriangle className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
                    {t("portfolioCorrelationShock")}
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="border-emerald-500/50 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 text-sm px-3 py-1"
                  >
                    <Shield className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
                    {t("portfolioNoShock")}
                  </Badge>
                )}
              </CardContent>
            </Card>
          </div>

          {/* ---- Correlation shock warning ---- */}
          {portfolioData?.correlationWarning && (
            <Card className="border-red-500/30 bg-red-500/5">
              <CardContent className="flex items-start gap-3 p-4">
                <AlertTriangle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" aria-hidden="true" />
                <div className="text-sm">
                  <p className="font-medium text-red-600 dark:text-red-400">
                    {t("portfolioCorrelationShockTitle")}
                  </p>
                  <p className="text-muted-foreground mt-1">
                    {t("portfolioCorrelationShockDesc")}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ---- Phase context info ---- */}
          <Card className="border-blue-500/30 bg-blue-500/5">
            <CardContent className="flex items-start gap-3 p-4">
              <Info className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" aria-hidden="true" />
              <div className="text-sm">
                <p className="text-muted-foreground">
                  {t("portfolioPhaseContext")}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* ---- Data unavailable (graceful) ---- */}
          {portfolioData && portfolioData.dataAvailable === false && (
            <Card className="border-amber-500/30 bg-amber-500/5">
              <CardContent className="text-center py-10">
                <AlertTriangle className="h-10 w-10 text-amber-500 mx-auto mb-3" aria-hidden="true" />
                <p className="font-medium text-amber-600 dark:text-amber-400">{t("dataUnavailableTitle")}</p>
                <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
                  {t("dataUnavailableDesc")}
                </p>
              </CardContent>
            </Card>
          )}

          {/* ---- Error state (generic / non-insufficient-data) ---- */}
          {portfolioError && !insufficientData && (
            <Card className="border-red-500/30 bg-red-500/5">
              <CardContent className="text-center py-10">
                <AlertTriangle className="h-10 w-10 text-muted-foreground mx-auto mb-3" aria-hidden="true" />
                <p className="font-medium">{t("portfolioNoData")}</p>
                <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
                  {t("portfolioNoDataDesc")}
                </p>
              </CardContent>
            </Card>
          )}

          {/* ---- No weights ---- */}
          {portfolioData && !sortedWeights.length && (
            <Card className="border-amber-500/30 bg-amber-500/5">
              <CardContent className="text-center py-10">
                <AlertTriangle className="h-10 w-10 text-muted-foreground mx-auto mb-3" aria-hidden="true" />
                <p className="font-medium">{t("portfolioNoWeights")}</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {t("portfolioNoWeightsDesc")}
                </p>
              </CardContent>
            </Card>
          )}

          {/* ---- Recommended Weights Bar Chart ---- */}
          {sortedWeights.length > 0 && (
            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
                  <BarChart3 className="h-4 w-4" aria-hidden="true" />
                  {t("portfolioRecommendedWeights")}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 pt-0">
                <div className="h-[350px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={barChartData}
                      margin={{ top: 10, right: 20, left: 10, bottom: 60 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis
                        dataKey="name"
                        tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                        angle={-45}
                        textAnchor="end"
                        interval={0}
                        height={80}
                      />
                      <YAxis
                        tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
                        tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                        domain={[0, "auto"]}
                      />
                      <Tooltip content={<WeightTooltip t={t} />} />
                      <Bar dataKey="weight" radius={[4, 4, 0, 0]}>
                        {barChartData.map((entry) => {
                          const opacity = 0.3 + 0.7 * (entry.weight / Math.max(maxWeight, 0.01));
                          return (
                            <Cell
                              key={entry.name}
                              fill={`rgba(34, 197, 94, ${opacity})`}
                            />
                          );
                        })}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ---- Allocation Details Table ---- */}
          {sortedWeights.length > 0 && (
            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
                  <Briefcase className="h-4 w-4" aria-hidden="true" />
                  {t("portfolioAllocationDetails")}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 pt-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" role="table">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-2 px-3 text-xs font-medium text-muted-foreground">
                          {t("portfolioCurrency")}
                        </th>
                        <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">
                          {t("portfolioWeight")}
                        </th>
                        <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">
                          {t("portfolioWeightRaw")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedWeights.map(({ name, weight }) => (
                        <tr
                          key={name}
                          className="border-b border-border/50 hover:bg-muted/20 transition-colors"
                        >
                          <td className="py-2 px-3 font-medium">{name}</td>
                          <td className="py-2 px-3 text-right font-mono">
                            {(weight * 100).toFixed(2)}%
                          </td>
                          <td className="py-2 px-3 text-right font-mono text-muted-foreground">
                            {weight.toFixed(6)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ---- Correlation Matrix (color-coded table) ---- */}
          {matrixCurrencies.length > 0 && (
            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm font-semibold">
                  {t("portfolioCorrelationMatrix")}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 pt-0">
                <p className="text-xs text-muted-foreground mb-3">
                  {t("portfolioCorrelationNote")}
                </p>
                {portfolioData?.correlationMatrix?.matrix ? (
                  <div className="overflow-x-auto">
                    <table className="text-xs border-collapse" role="table" aria-label={t("portfolioCorrelationMatrix")}>
                      <thead>
                        <tr>
                          <th className="p-1 border border-border bg-muted/50 sticky left-0 z-10 min-w-[60px]" aria-label={t("ariaRowHeader")} />
                          {portfolioData.correlationMatrix.currencies.map((cur) => (
                            <th
                              key={cur}
                              className="p-1 border border-border bg-muted/50 text-center font-medium text-muted-foreground min-w-[50px] max-w-[70px] truncate"
                              title={cur}
                            >
                              {cur.length > 6 ? cur.slice(0, 5) + "…" : cur}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {portfolioData.correlationMatrix.currencies.map((rowCur, i) => (
                          <tr key={rowCur}>
                            <th
                              className="p-1 border border-border bg-muted/50 text-left font-medium text-muted-foreground sticky left-0 z-10 max-w-[80px] truncate"
                              title={rowCur}
                            >
                              {rowCur.length > 8 ? rowCur.slice(0, 7) + "…" : rowCur}
                            </th>
                            {portfolioData.correlationMatrix!.matrix[i]?.map((corr, j) => {
                              const bgStyle = { backgroundColor: correlationToColor(corr) };
                              const textClass = textColorForBg(corr);
                              return (
                                <td
                                  key={`${i}-${j}`}
                                  className={`p-1 border border-border text-center font-mono ${textClass}`}
                                  style={bgStyle}
                                  title={`${rowCur} × ${portfolioData.correlationMatrix!.currencies[j]}: ${corr.toFixed(4)}`}
                                >
                                  {i === j ? "1.00" : corr.toFixed(2)}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="rounded-lg border border-border p-6 text-center text-sm text-muted-foreground">
                    <Shield className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" aria-hidden="true" />
                    <p>{t("portfolioCorrelationPlaceholder")}</p>
                    <p className="text-xs mt-1 max-w-md mx-auto">
                      {t("portfolioCorrelationPlaceholderDesc")}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* ---- Method Explanation (collapsible) ---- */}
          <Card>
            <CardContent className="p-4">
              <button
                className="flex items-center gap-2 text-sm font-semibold w-full text-left hover:text-foreground transition-colors"
                onClick={() => setShowMethodExplanation(!showMethodExplanation)}
                aria-expanded={showMethodExplanation}
              >
                <Info className="h-4 w-4 shrink-0" aria-hidden="true" />
                {t("portfolioMethodExplanation")}
                {showMethodExplanation ? (
                  <ChevronUp className="h-4 w-4 ml-auto" aria-hidden="true" />
                ) : (
                  <ChevronDown className="h-4 w-4 ml-auto" aria-hidden="true" />
                )}
              </button>
              {showMethodExplanation && (
                <div className="mt-3 text-sm text-muted-foreground space-y-3">
                  {portfolioData?.method === "risk_parity" ? (
                    <>
                      <p>
                        <strong className="text-foreground">{t("portfolioRiskParityTitle")}</strong>
                      </p>
                      <p>{t("portfolioRiskParityDesc1")}</p>
                      <p>{t("portfolioRiskParityDesc2")}</p>
                      <div className="bg-muted rounded-md px-3 py-2 font-mono text-xs">
                        w_i = (1 / volatility_i) / sum(1 / volatility_j)
                      </div>
                      <p>{t("portfolioRiskParityDesc3")}</p>
                    </>
                  ) : (
                    <>
                      <p>
                        <strong className="text-foreground">{t("portfolioMinVarianceTitle")}</strong>
                      </p>
                      <p>{t("portfolioMinVarianceDesc1")}</p>
                      <div className="bg-muted rounded-md px-3 py-2 font-mono text-xs">
                        minimize: w&#x1D40; &#x03A3; w
                      </div>
                      <p>{t("portfolioMinVarianceDesc2")}</p>
                      <p>{t("portfolioMinVarianceDesc3")}</p>
                    </>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* ---- Efficient Frontier (only for min_variance) ---- */}
          {portfolioData?.method === "min_variance" && (
            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
                  <TrendingUp className="h-4 w-4" aria-hidden="true" />
                  {t("portfolioEfficientFrontier")}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 pt-0">
                {frontierLoading ? (
                  <Skeleton className="h-[350px] w-full" />
                ) : frontierData && frontierChartData.length > 0 ? (
                  <>
                    <div className="h-[350px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <ScatterChart
                          margin={{ top: 10, right: 20, left: 10, bottom: 20 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                          <XAxis
                            type="number"
                            dataKey="risk"
                            name="Risk"
                            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                            label={{
                              value: t("portfolioRiskAxis"),
                              position: "insideBottom",
                              offset: -10,
                              style: { fontSize: 11, fill: "var(--muted-foreground)" },
                            }}
                          />
                          <YAxis
                            type="number"
                            dataKey="return"
                            name="Return"
                            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                            label={{
                              value: t("portfolioReturnAxis"),
                              angle: -90,
                              position: "insideLeft",
                              offset: 10,
                              style: { fontSize: 11, fill: "var(--muted-foreground)" },
                            }}
                          />
                          <ZAxis type="number" dataKey="z" range={[40, 400]} />
                          <Tooltip
                            content={({ active, payload }) => {
                              if (!active || !payload?.length) return null;
                              const data = payload[0].payload;
                              return (
                                <div className="bg-popover border border-border rounded-md px-3 py-2 text-xs shadow-lg">
                                  <p className="font-semibold">{data.name}</p>
                                  <p className="text-muted-foreground">
                                    {t("portfolioRiskAxis")}: {data.risk?.toFixed?.(4) ?? data.x?.toFixed(4)}
                                  </p>
                                  <p className="text-muted-foreground">
                                    {t("portfolioReturnAxis")}: {data.return?.toFixed?.(4) ?? data.y?.toFixed(4)}
                                  </p>
                                </div>
                              );
                            }}
                          />
                          {/* Frontier line */}
                          <Line
                            data={frontierChartData}
                            type="monotone"
                            dataKey="return"
                            stroke="#3b82f6"
                            strokeWidth={2}
                            dot={false}
                            name={t("portfolioEfficientFrontier")}
                          />
                          {/* Individual assets */}
                          {individualAssetsData.length > 0 && (
                            <Scatter
                              data={individualAssetsData}
                              fill="#f97316"
                              name={t("portfolioIndividualAssets")}
                            />
                          )}
                          {/* Current portfolio */}
                          {currentPortfolioData && (
                            <Scatter
                              data={currentPortfolioData}
                              fill="#22c55e"
                              name={t("portfolioCurrentPortfolio")}
                              shape="diamond"
                            />
                          )}
                          <Legend />
                        </ScatterChart>
                      </ResponsiveContainer>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-2">
                      {t("portfolioFrontierDisclaimer")}
                    </p>
                  </>
                ) : (
                  <div className="text-center py-8 text-sm text-muted-foreground">
                    <Info className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" aria-hidden="true" />
                    <p>{t("portfolioFrontierUnavailable")}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* ---- Rebalance actions ---- */}
          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-semibold">
                {t("portfolioActions")}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-0 space-y-3">
              <Button
                className="gap-1.5"
                onClick={() => rebalanceMutation.mutate(undefined)}
                disabled={rebalanceMutation.isPending}
                aria-label={t("portfolioRebalance")}
              >
                <RefreshCw
                  className={`h-4 w-4 ${rebalanceMutation.isPending ? "animate-spin" : ""}`}
                  aria-hidden="true"
                />
                {rebalanceMutation.isPending
                  ? t("portfolioRebalancing")
                  : t("portfolioRebalance")}
              </Button>

              {rebalanceMutation.isError && (
                <p className="text-xs text-red-500">
                  {t("portfolioRebalanceError")}
                </p>
              )}

              {rebalanceMutation.isSuccess && (
                <p className="text-xs text-emerald-500">
                  {t("portfolioRebalanceSuccess")}
                </p>
              )}

              {portfolioData?.lastRebalance && (
                <p className="text-xs text-muted-foreground">
                  {t("portfolioLastRebalance")}:{" "}
                  {new Date(portfolioData.lastRebalance).toLocaleString()}
                </p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
});
