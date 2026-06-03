// ============================================================================
// Analyst Tab — League Analyst: trends, anomalies, and auto-generated facts
//
// Three sections:
//   A) Summary Cards — 6 metric cards (total currencies, pairs, trending up/down,
//      stable, anomalies)
//   B) Auto-generated Facts — list of insight cards with icons and severity badges
//   C) Top Movers + Anomalies — side-by-side lists of volatile and anomalous
//      currencies with direction badges and z-scores
// ============================================================================
"use client";

import { useQuery } from "@tanstack/react-query";
import {
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  BarChart3,
  Shield,
  Coins,
  ArrowLeftRight,
  Minus,
  Activity,
  RefreshCw,
  Clock,
  LineChart,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import {
  fetchApi,
  fmt,
  fmtChange,
  getFlipperErrorType,
} from "@/lib/types";
import type {
  AnalystSummaryResponse,
  CurrencyTrend,
  PriceAnomaly,
  LeagueFact,
} from "@/lib/types";
import { FlipperBackendStatusCard } from "./flipper-backend-status-card";

// ---------------------------------------------------------------------------
// Component Props
// ---------------------------------------------------------------------------

interface AnalystTabProps {
  /** Whether the flipper backend is online (checked at dashboard level) */
  backendOnline: boolean;
}

// ---------------------------------------------------------------------------
// Fact icon mapper
// ---------------------------------------------------------------------------

function factIcon(icon: string) {
  switch (icon) {
    case "up":
      return <TrendingUp className="h-4 w-4 text-emerald-500" aria-hidden="true" />;
    case "down":
      return <TrendingDown className="h-4 w-4 text-red-500" aria-hidden="true" />;
    case "alert":
      return <AlertTriangle className="h-4 w-4 text-amber-500" aria-hidden="true" />;
    case "chart":
      return <BarChart3 className="h-4 w-4 text-sky-500" aria-hidden="true" />;
    case "shield":
      return <Shield className="h-4 w-4 text-sky-500" aria-hidden="true" />;
    default:
      return <Activity className="h-4 w-4 text-muted-foreground" aria-hidden="true" />;
  }
}

// ---------------------------------------------------------------------------
// Summary card helper
// ---------------------------------------------------------------------------

interface SummaryCardDef {
  label: string;
  value: number;
  icon: React.ReactNode;
  colorClass: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AnalystTab({ backendOnline }: AnalystTabProps) {
  const { t } = useI18n();

  const {
    data: analystData,
    isLoading: analystLoading,
    isError: analystError,
    error: analystErrorObj,
    refetch: refetchAnalyst,
  } = useQuery<AnalystSummaryResponse>({
    queryKey: ["flipper-analyst-summary"],
    queryFn: () => fetchApi<AnalystSummaryResponse>("/api/flipper/analyst/summary"),
    enabled: backendOnline,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
  });

  const insufficientData =
    analystError && getFlipperErrorType(analystErrorObj) === "backend_insufficient_data";

  // ---- Summary cards data ----
  const summaryCards: SummaryCardDef[] = analystData
    ? [
        {
          label: t("analystTotalCurrencies") || "Total Currencies",
          value: analystData.summary.totalCurrencies,
          icon: <Coins className="h-5 w-5 text-muted-foreground" aria-hidden="true" />,
          colorClass: "text-foreground",
        },
        {
          label: t("analystTotalPairs") || "Total Pairs",
          value: analystData.summary.totalPairs,
          icon: <ArrowLeftRight className="h-5 w-5 text-muted-foreground" aria-hidden="true" />,
          colorClass: "text-foreground",
        },
        {
          label: t("analystTrendingUp") || "Trending Up",
          value: analystData.summary.trendingUp,
          icon: <TrendingUp className="h-5 w-5 text-emerald-500" aria-hidden="true" />,
          colorClass: "text-emerald-500",
        },
        {
          label: t("analystTrendingDown") || "Trending Down",
          value: analystData.summary.trendingDown,
          icon: <TrendingDown className="h-5 w-5 text-red-500" aria-hidden="true" />,
          colorClass: "text-red-500",
        },
        {
          label: t("analystStable") || "Stable",
          value: analystData.summary.stable,
          icon: <Minus className="h-5 w-5 text-sky-500" aria-hidden="true" />,
          colorClass: "text-sky-500",
        },
        {
          label: t("analystAnomalies") || "Anomalies",
          value: analystData.summary.anomalyCount,
          icon: <AlertTriangle className="h-5 w-5 text-amber-500" aria-hidden="true" />,
          colorClass: "text-amber-500",
        },
      ]
    : [];

  // ---- Top movers (first 10 trending currencies) ----
  const topMovers: CurrencyTrend[] = (analystData?.trends ?? []).slice(0, 10);

  // ---- Anomalies ----
  const anomalies: PriceAnomaly[] = analystData?.anomalies ?? [];

  // ---- Facts ----
  const facts: LeagueFact[] = analystData?.facts ?? [];

  // ---- Render ----
  return (
    <div className="space-y-6">
      {/* Backend status card */}
      <FlipperBackendStatusCard
        backendOnline={backendOnline}
        insufficientData={insufficientData}
        fetchedAt={analystData?.fetchedAt}
        dataAvailable={analystData?.dataAvailable}
        onRefresh={() => refetchAnalyst()}
      />

      {/* ================================================================ */}
      {/* Section A: Summary Cards                                         */}
      {/* ================================================================ */}
      {analystLoading && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-4">
                <div className="h-4 w-16 bg-muted rounded mb-2" />
                <div className="h-8 w-12 bg-muted rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {analystData && !analystLoading && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {summaryCards.map((card) => (
            <Card key={card.label}>
              <CardContent className="p-4">
                <div className="flex items-center gap-1.5 mb-1">
                  {card.icon}
                  <span className="text-xs text-muted-foreground truncate">{card.label}</span>
                </div>
                <p className={`text-2xl font-bold ${card.colorClass}`}>
                  {card.value}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ================================================================ */}
      {/* Section B: Auto-generated Facts                                  */}
      {/* ================================================================ */}
      {analystData && facts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <LineChart className="h-5 w-5" aria-hidden="true" />
              {t("analystFactsTitle") || "League Insights"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {facts.map((fact, idx) => (
                <div
                  key={idx}
                  className="flex items-start gap-3 p-3 rounded-lg border bg-muted/20"
                >
                  <div className="mt-0.5 shrink-0">{factIcon(fact.icon)}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm leading-snug">{fact.text}</p>
                    <Badge
                      variant="outline"
                      className={`mt-1.5 text-[10px] px-1.5 py-0 font-semibold ${
                        fact.severity === "warning"
                          ? "border-amber-500/50 text-amber-600 dark:text-amber-400 bg-amber-500/10"
                          : "border-sky-500/50 text-sky-600 dark:text-sky-400 bg-sky-500/10"
                      }`}
                    >
                      {fact.severity === "warning"
                        ? t("analystSeverityWarning") || "Warning"
                        : t("analystSeverityInfo") || "Info"}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ================================================================ */}
      {/* Section C: Top Movers + Anomalies                                */}
      {/* ================================================================ */}
      {analystData && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* ---- Top Movers ---- */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <TrendingUp className="h-5 w-5" aria-hidden="true" />
                {t("analystTopMovers") || "Top Movers (24h)"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {topMovers.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  {t("analystNoMovers") || "No trending data available yet"}
                </p>
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {topMovers.map((trend) => {
                    const change = fmtChange(trend.change24hPct);
                    return (
                      <div
                        key={trend.apiId}
                        className="flex items-center justify-between p-2.5 rounded-lg border bg-muted/10 hover:bg-muted/20 transition-colors"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <Badge
                            variant={
                              trend.direction === "up"
                                ? "default"
                                : trend.direction === "down"
                                ? "destructive"
                                : "secondary"
                            }
                            className="shrink-0 gap-1 text-xs"
                          >
                            {trend.direction === "up" && <TrendingUp className="h-3 w-3" aria-hidden="true" />}
                            {trend.direction === "down" && <TrendingDown className="h-3 w-3" aria-hidden="true" />}
                            {trend.direction === "stable" && <Minus className="h-3 w-3" aria-hidden="true" />}
                            {trend.direction === "unknown" && <Activity className="h-3 w-3" aria-hidden="true" />}
                          </Badge>
                          <span className="font-medium text-sm truncate">{trend.apiId}</span>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="text-xs text-muted-foreground font-mono">
                            {fmt(trend.currentPrice)}
                          </span>
                          <span className={`text-xs font-semibold ${change.color}`}>
                            {change.text}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* ---- Anomalies ---- */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertTriangle className="h-5 w-5" aria-hidden="true" />
                {t("analystAnomaliesTitle") || "Price Anomalies"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {anomalies.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  {t("analystNoAnomalies") || "No anomalies detected — market looks stable"}
                </p>
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {anomalies.map((anomaly) => {
                    const change = fmtChange(anomaly.changePct);
                    return (
                      <div
                        key={anomaly.apiId}
                        className="flex items-center justify-between p-2.5 rounded-lg border bg-muted/10 hover:bg-muted/20 transition-colors"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <Badge
                            variant={anomaly.direction === "spike_up" ? "default" : "destructive"}
                            className="shrink-0 gap-1 text-xs"
                          >
                            {anomaly.direction === "spike_up"
                              ? <TrendingUp className="h-3 w-3" aria-hidden="true" />
                              : <TrendingDown className="h-3 w-3" aria-hidden="true" />
                            }
                          </Badge>
                          <span className="font-medium text-sm truncate">{anomaly.apiId}</span>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <Badge
                            variant="outline"
                            className={`text-[10px] px-1.5 py-0 font-mono ${
                              Math.abs(anomaly.zScore) > 3
                                ? "border-red-500/50 text-red-600 dark:text-red-400"
                                : "border-amber-500/50 text-amber-600 dark:text-amber-400"
                            }`}
                          >
                            z: {anomaly.zScore.toFixed(1)}
                          </Badge>
                          <span className="text-xs text-muted-foreground font-mono">
                            {fmt(anomaly.currentPrice)}
                          </span>
                          <span className={`text-xs font-semibold ${change.color}`}>
                            {change.text}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ---- Data freshness ---- */}
      {analystData?.fetchedAt && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" aria-hidden="true" />
          <span>
            {t("analystDataFetched") || "Data fetched"}:{" "}
            {new Date(analystData.fetchedAt).toLocaleTimeString()}
          </span>
          {!analystData.dataAvailable && (
            <Badge variant="outline" className="text-xs ml-2">
              {t("analystPartialData") || "Partial data"}
            </Badge>
          )}
        </div>
      )}

      {/* ---- Error state (not insufficient-data) ---- */}
      {analystError && !insufficientData && backendOnline && (
        <Card className="border-red-500/30 bg-red-500/5" role="alert">
          <CardContent className="p-4 text-sm text-red-600 dark:text-red-400">
            {t("analystError") || "Failed to load league analyst data. The backend may be experiencing issues."}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
