// ============================================================================
// Forecast Tab — Price forecasts, anomaly detection, storage value decisions
// Integrates with the FastAPI flipper backend via Next.js proxy routes.
// Supports both polling (React Query) and live mode (WebSocket).
// ============================================================================
"use client";

import { useState, useMemo, memo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Circle,
  Server,
  RefreshCw,
  Activity,
  ShieldCheck,
  ArrowRightLeft,
  Info,
  Radio,
  Wifi,
  WifiOff,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
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
import { useI18n } from "@/lib/i18n";
import { fetchApi, FlipperApiError, type FlipperPhaseResponse, type StorageValueResponse, type StorageValueInputs } from "@/lib/types";
import { formatPrice } from "@/lib/utils";
import { useDashboardStore } from "@/lib/store";
import { useWebSocket } from "@/hooks/use-websocket";
import { ApiErrorFallback } from "./api-error-fallback";
import { TakeProfitCalculator } from "./take-profit-calculator";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ForecastModel {
  currency: string;
  modelName: string;
  pointForecast: number[];
  ciLower: number[];
  ciUpper: number[];
  timestamps: string[];
  lowConfidence: boolean;
  disagreement: boolean;
  mape: number | null;
}

interface ForecastResponse {
  currency: string;
  horizon: number;
  models: Record<string, ForecastModel>;
  disagreement: boolean;
  lowConfidence: boolean;
  isEventActive: boolean;
  dataPoints: number;
  fetchedAt: string;
  dataAvailable?: boolean;
}

interface AnomalyAlert {
  currency: string;
  alert_score: number;
  triggered_indicators: string[];
  direction: string;
  is_confirmed: boolean;
  timestamp: string;
}

interface AnomaliesResponse {
  anomalies: AnomalyAlert[];
  count: number;
  currencies_checked: number;
  min_alert_score: number;
  dataAvailable?: boolean;
}

// StorageValueResponse, StorageValueInputs, and FlipperPhaseResponse
// imported from @/lib/types (canonical camelCase definitions)

interface CurrencyOption {
  api_id: string;
  text: string;
}

// ---------------------------------------------------------------------------
// Popular currencies for the dropdown — static fallback (Fix 5.5)
//
// The primary source is now the /api/flipper/currencies endpoint.
// POPULAR_CURRENCIES is kept as a fallback when the API is unavailable
// or the backend is offline.
// ---------------------------------------------------------------------------

const POPULAR_CURRENCIES: CurrencyOption[] = [
  { api_id: "exalted", text: "Exalted Orb" },
  { api_id: "divine", text: "Divine Orb" },
  { api_id: "chaos", text: "Chaos Orb" },
  { api_id: "gold", text: "Gold" },
  { api_id: "regret", text: "Orb of Regret" },
  { api_id: "chance", text: "Orb of Chance" },
  { api_id: "alch", text: "Orb of Alchemy" },
  { api_id: "scour", text: "Orb of Scouring" },
  { api_id: "fusing", text: "Orb of Fusing" },
  { api_id: "jeweller", text: "Jeweller's Orb" },
  { api_id: "chrome", text: "Chromatic Orb" },
  { api_id: "vaal", text: "Vaal Orb" },
  { api_id: "blessed", text: "Blessed Orb" },
  { api_id: "chisel", text: "Cartographer's Chisel" },
  { api_id: "regal", text: "Regal Orb" },
  { api_id: "aug", text: "Orb of Augmentation" },
  { api_id: "trans", text: "Transmutation Orb" },
  { api_id: "altar", text: "Breachstone" },
  { api_id: "mirror", text: "Mirror of Kalandra" },
  { api_id: "annul", text: "Orb of Annulment" },
];

// ---------------------------------------------------------------------------
// P3-6: Forecast Recommendations — inline component
//
// Generates actionable trading recommendations based on forecast models,
// storage value decision, and anomaly detection signals.
// ---------------------------------------------------------------------------

interface ForecastRecommendationsProps {
  forecastData: ForecastResponse;
  storageData: StorageValueResponse;
  anomaliesData: AnomaliesResponse | undefined;
  baseCurrencyText: string | null;
  baseCurrencyApiId: string | null;
}

interface Recommendation {
  action: "BUY" | "SELL" | "HOLD" | "CONVERT" | "WAIT";
  confidence: "high" | "medium" | "low";
  reason: string;
  priceTarget: number | null;
  timeframe: string;
}

function ForecastRecommendations({
  forecastData,
  storageData,
  anomaliesData,
  baseCurrencyText,
  baseCurrencyApiId,
}: ForecastRecommendationsProps) {
  const recommendations = useMemo((): Recommendation[] => {
    const recs: Recommendation[] = [];
    const modelNames = Object.keys(forecastData.models);
    if (modelNames.length === 0) return recs;

    // 1. Primary recommendation from storage value decision
    const decision = storageData.decision;
    const ratio = storageData.ratio;
    const momentum = storageData.inputs?.momentum ?? 0;
    const volatility = storageData.inputs?.volatility ?? 0;

    // Determine confidence based on model agreement and data quality
    const hasDisagreement = forecastData.disagreement;
    const isLowConfidence = forecastData.lowConfidence;
    const hasAnomaly = (anomaliesData?.anomalies?.length ?? 0) > 0;
    const currencyAnomaly = anomaliesData?.anomalies?.find(
      (a) => a.currency === forecastData.currency
    );

    let confidence: "high" | "medium" | "low" = "medium";
    if (hasDisagreement || isLowConfidence) confidence = "low";
    else if (!hasAnomaly && modelNames.length >= 2) confidence = "high";

    // 2. Storage value recommendation
    if (decision === "BUY" || decision === "HOLD") {
      recs.push({
        action: decision,
        confidence,
        reason: ratio > 1
          ? `Storage value ratio ${ratio.toFixed(3)} > 1.0 indicates favorable holding conditions. Momentum: ${momentum > 0 ? "positive" : "negative"} (${momentum.toFixed(4)}).`
          : `Decision is ${decision} but ratio ${ratio.toFixed(3)} is near threshold. Monitor closely for changes.`,
        priceTarget: storageData.projectedPrice,
        timeframe: `${storageData.inputs?.horizonHours ?? "?"}h horizon`,
      });
    } else if (decision === "SELL" || decision === "CONVERT") {
      recs.push({
        action: decision,
        confidence,
        reason: ratio < 1
          ? `Storage value ratio ${ratio.toFixed(3)} < 1.0 suggests declining value. Projected price: ${formatPrice(storageData.projectedPrice, baseCurrencyText, baseCurrencyApiId, { digits: 4 })}.`
          : `Decision is ${decision} despite ratio near 1.0. Volatility: ${(volatility * 100).toFixed(2)}%.`,
        priceTarget: storageData.projectedPrice,
        timeframe: `${storageData.inputs?.horizonHours ?? "?"}h horizon`,
      });
    }

    // 3. Forecast trend recommendation
    const primaryModel = forecastData.models[modelNames[0]];
    const lastForecast = primaryModel.pointForecast[primaryModel.pointForecast.length - 1];
    const firstForecast = primaryModel.pointForecast[0];
    if (lastForecast != null && firstForecast != null && firstForecast > 0) {
      const forecastChange = ((lastForecast - firstForecast) / firstForecast) * 100;
      if (Math.abs(forecastChange) > 2) {
        recs.push({
          action: forecastChange > 0 ? "BUY" : "SELL",
          confidence: isLowConfidence ? "low" : "medium",
          reason: `Forecast trend: ${forecastChange > 0 ? "+" : ""}${forecastChange.toFixed(1)}% over forecast horizon (${modelNames[0]} model). ${isLowConfidence ? "Low confidence flag active." : ""}`,
          priceTarget: lastForecast,
          timeframe: `${primaryModel.pointForecast.length} periods`,
        });
      }
    }

    // 4. Anomaly-driven recommendation
    if (currencyAnomaly) {
      const direction = currencyAnomaly.direction;
      recs.push({
        action: direction === "up" ? "HOLD" : direction === "down" ? "SELL" : "WAIT",
        confidence: currencyAnomaly.is_confirmed ? "high" : "low",
        reason: `Anomaly detected (${direction}), alert score: ${currencyAnomaly.alert_score.toFixed(2)}. Indicators: ${currencyAnomaly.triggered_indicators.join(", ")}. ${currencyAnomaly.is_confirmed ? "Confirmed anomaly." : "Unconfirmed — observe."}`,
        priceTarget: null,
        timeframe: "Immediate",
      });
    }

    // 5. Volatility caution
    if (volatility > 0.05) {
      recs.push({
        action: "WAIT",
        confidence: "medium",
        reason: `High volatility (${(volatility * 100).toFixed(2)}%) increases risk. Consider reducing position size or waiting for stabilization before entering.`,
        priceTarget: null,
        timeframe: "Until volatility subsides",
      });
    }

    // If no recommendations generated, add a WAIT
    if (recs.length === 0) {
      recs.push({
        action: "WAIT",
        confidence: "medium",
        reason: "Insufficient signals for a clear recommendation. Data quality is acceptable but no strong directional bias detected.",
        priceTarget: null,
        timeframe: "Re-evaluate when new data arrives",
      });
    }

    return recs;
  }, [forecastData, storageData, anomaliesData, baseCurrencyText, baseCurrencyApiId]);

  const actionColors: Record<string, string> = {
    BUY: "border-emerald-500/50 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10",
    HOLD: "border-blue-500/50 text-blue-600 dark:text-blue-400 bg-blue-500/10",
    SELL: "border-red-500/50 text-red-600 dark:text-red-400 bg-red-500/10",
    CONVERT: "border-amber-500/50 text-amber-600 dark:text-amber-400 bg-amber-500/10",
    WAIT: "border-gray-500/50 text-gray-600 dark:text-gray-400 bg-gray-500/10",
  };

  const confidenceColors: Record<string, string> = {
    high: "border-emerald-500/50 text-emerald-600 dark:text-emerald-400",
    medium: "border-amber-500/50 text-amber-600 dark:text-amber-400",
    low: "border-red-500/50 text-red-600 dark:text-red-400",
  };

  return (
    <div className="space-y-3">
      {recommendations.map((rec, idx) => (
        <div
          key={idx}
          className="flex items-start gap-3 rounded-lg border p-3"
        >
          <Badge
            variant="outline"
            className={`text-xs px-2 py-1 font-bold shrink-0 ${actionColors[rec.action] ?? ""}`}
          >
            {rec.action}
          </Badge>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Badge
                variant="outline"
                className={`text-[9px] px-1.5 py-0 ${confidenceColors[rec.confidence] ?? ""}`}
              >
                {rec.confidence} confidence
              </Badge>
              {rec.timeframe && (
                <span className="text-[10px] text-muted-foreground">
                  {rec.timeframe}
                </span>
              )}
            </div>
            <p className="text-xs text-foreground leading-relaxed">
              {rec.reason}
            </p>
            {rec.priceTarget !== null && (
              <p className="text-xs text-muted-foreground mt-1 font-mono">
                Target: {formatPrice(rec.priceTarget, baseCurrencyText, baseCurrencyApiId, { digits: 4 })}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component Props
// ---------------------------------------------------------------------------

interface ForecastTabProps {
  /** Whether the flipper backend is online (checked at dashboard level) */
  backendOnline: boolean;
  /** Backend is online but upstream API is unreachable (degraded mode) */
  upstreamDegraded?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ForecastTab = memo(function ForecastTab({ backendOnline, upstreamDegraded }: ForecastTabProps) {
  const { t } = useI18n();
  const { uiState } = useDashboardStore();

  // Selected currency
  const [selectedCurrency, setSelectedCurrency] = useState("divine");

  // Live mode toggle — switches between polling (React Query) and WebSocket
  const [liveMode, setLiveMode] = useState(false);

  // Fix 5.5: Load currencies dynamically from the flipper backend API.
  // Falls back to POPULAR_CURRENCIES when the API is unavailable.
  const { data: apiCurrencies } = useQuery<CurrencyOption[]>({
    queryKey: ["flipper-currencies"],
    queryFn: async () => {
      try {
        const data = await fetchApi<Array<{ api_id: string; text: string }>>("/api/flipper/currencies");
        return Array.isArray(data) ? data : [];
      } catch {
        return [];
      }
    },
    staleTime: 10 * 60_000, // 10 min — currencies change rarely
    retry: 1,
    enabled: backendOnline,
  });

  // Use API currencies if available, otherwise fall back to hardcoded list
  const currencyOptions = useMemo(() => {
    return (apiCurrencies && apiCurrencies.length > 0)
      ? apiCurrencies
      : POPULAR_CURRENCIES;
  }, [apiCurrencies]);

  // ---- WebSocket connections for live mode ----
  const {
    data: wsForecastData,
    status: wsForecastStatus,
    lastUpdateAt: wsForecastUpdateAt,
  } = useWebSocket<ForecastResponse>(
    `/ws/forecast/${selectedCurrency}`,
    { enabled: liveMode && backendOnline },
  );

  const {
    data: wsStorageData,
    status: wsStorageStatus,
    lastUpdateAt: wsStorageUpdateAt,
  } = useWebSocket<StorageValueResponse>(
    `/ws/storage-value/${selectedCurrency}`,
    { enabled: liveMode && backendOnline },
  );

  // ---- Backend health check is done at dashboard level ----
  // backendOnline is passed as prop

  // ---- Phase info ----
  const { data: phaseData } = useQuery<FlipperPhaseResponse>({
    queryKey: ["flipper-phase"],
    queryFn: () => fetchApi<FlipperPhaseResponse>("/api/flipper/phase"),
    enabled: backendOnline,
    staleTime: 60_000,
    retry: 1,
  });

  // ---- Forecast data (polling mode) ----
  const {
    data: pollingForecastData,
    isLoading: forecastLoading,
    isError: forecastError,
    error: forecastErrorObj,
    refetch: refetchForecast,
  } = useQuery<ForecastResponse>({
    queryKey: ["flipper-forecast", selectedCurrency],
    queryFn: () =>
      fetchApi<ForecastResponse>(`/api/flipper/forecast/${selectedCurrency}`),
    enabled: backendOnline && !!selectedCurrency && !liveMode,
    staleTime: 60_000,
    retry: 1,
  });

  // ---- Anomalies ----
  const {
    data: anomaliesData,
    isLoading: anomaliesLoading,
  } = useQuery<AnomaliesResponse>({
    queryKey: ["flipper-anomalies"],
    queryFn: () => fetchApi<AnomaliesResponse>("/api/flipper/anomalies"),
    enabled: backendOnline,
    staleTime: 60_000,
    retry: 1,
  });

  // ---- Storage value (polling mode) ----
  const {
    data: pollingStorageData,
    isLoading: storageLoading,
    error: storageErrorObj,
  } = useQuery<StorageValueResponse>({
    queryKey: ["flipper-storage-value", selectedCurrency],
    queryFn: () =>
      fetchApi<StorageValueResponse>(`/api/flipper/storage-value/${selectedCurrency}`),
    enabled: backendOnline && !!selectedCurrency && !liveMode,
    staleTime: 60_000,
    retry: 1,
  });

  // ---- Merge data sources: use WS data when live, polling otherwise ----
  const forecastData = liveMode ? wsForecastData : pollingForecastData;
  const storageData = liveMode ? wsStorageData : pollingStorageData;

  // Detect 422/404 insufficient-data errors for better UX (polling only)
  const isForecastInsufficientData =
    !liveMode && forecastErrorObj instanceof FlipperApiError && (forecastErrorObj.status === 422 || forecastErrorObj.status === 404);
  const forecastInsufficientDetail =
    isForecastInsufficientData && forecastErrorObj instanceof FlipperApiError
      ? forecastErrorObj.detail
      : undefined;
  const isStorageInsufficientData =
    !liveMode && storageErrorObj instanceof FlipperApiError && (storageErrorObj.status === 422 || storageErrorObj.status === 404);
  const storageInsufficientDetail =
    isStorageInsufficientData && storageErrorObj instanceof FlipperApiError
      ? storageErrorObj.detail
      : undefined;

  // ---- Build chart data from forecast response ----
  const chartData = (() => {
    if (!forecastData?.models) return [];

    // Use the first available model for point forecast
    const modelNames = Object.keys(forecastData.models);
    if (modelNames.length === 0) return [];

    const primaryModel = forecastData.models[modelNames[0]];
    const timestamps = primaryModel.timestamps;

    // Build chart points: each point has timestamp, each model's forecast + CI
    return timestamps.map((ts, i) => {
      const point: Record<string, unknown> = {
        time: new Date(ts).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "2-digit",
        }),
      };

      for (const [modelName, model] of Object.entries(forecastData.models)) {
        if (i < model.pointForecast.length) {
          point[`${modelName}_forecast`] = model.pointForecast[i];
          point[`${modelName}_ci_lower`] = model.ciLower[i];
          point[`${modelName}_ci_upper`] = model.ciUpper[i];
        }
      }

      return point;
    });
  })();

  // Model names for chart areas
  const modelNames = forecastData ? Object.keys(forecastData.models) : [];

  // Color palette for models
  const modelColors = [
    { stroke: "#10b981", fill: "#10b981" }, // emerald
    { stroke: "#f59e0b", fill: "#f59e0b" }, // amber
    { stroke: "#6366f1", fill: "#6366f1" }, // indigo
    { stroke: "#ec4899", fill: "#ec4899" }, // pink
  ];

  // Loading state
  const isLoading = forecastLoading && backendOnline && !liveMode;

  // ---- WebSocket status indicator ----
  const wsStatus = (() => {
    if (!liveMode) return null;
    const combined = [wsForecastStatus, wsStorageStatus];
    if (combined.includes("connected")) return "connected";
    if (combined.includes("connecting")) return "connecting";
    return "disconnected";
  })();

  // ---- Render ----
  return (
    <div className="space-y-4">
      {/* ---- Header with backend status + live mode toggle ---- */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {/* Currency selector */}
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium" htmlFor="forecast-currency">
              {t("forecastCurrency")}:
            </label>
            <Select value={selectedCurrency} onValueChange={setSelectedCurrency}>
              <SelectTrigger id="forecast-currency" className="w-[180px] h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {currencyOptions.map((c) => (
                  <SelectItem key={c.api_id} value={c.api_id}>
                    {c.text}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Refresh (polling mode only) */}
          {backendOnline && !liveMode && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2"
              onClick={() => refetchForecast()}
              aria-label={t("refreshData")}
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          )}

          {/* Live mode toggle */}
          <Button
            variant={liveMode ? "default" : "outline"}
            size="sm"
            className="h-8 px-3 gap-1.5"
            onClick={() => setLiveMode(!liveMode)}
            disabled={!backendOnline}
            title={liveMode ? t("forecastPollingModeTooltip") : t("forecastLiveModeTooltip")}
            aria-pressed={liveMode}
          >
            <Radio className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="text-xs font-medium">{t("forecastLiveMode")}</span>
          </Button>
        </div>

        <div className="flex items-center gap-3">
          {/* WebSocket status indicator */}
          {liveMode && (
            <div className="flex items-center gap-1.5 text-xs">
              {wsStatus === "connected" ? (
                <>
                  <Wifi className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />
                  <span className="text-emerald-600 dark:text-emerald-400">
                    {t("forecastWsConnected")}
                  </span>
                </>
              ) : wsStatus === "connecting" ? (
                <>
                  <Wifi className="h-3.5 w-3.5 text-amber-500 animate-pulse" aria-hidden="true" />
                  <span className="text-amber-600 dark:text-amber-400">
                    {t("forecastWsConnecting")}
                  </span>
                </>
              ) : (
                <>
                  <WifiOff className="h-3.5 w-3.5 text-red-500" aria-hidden="true" />
                  <span className="text-red-600 dark:text-red-400">
                    {t("forecastWsDisconnected")}
                  </span>
                </>
              )}
              {wsForecastUpdateAt && (
                <span className="text-muted-foreground ml-1">
                  {t("forecastLastUpdate")}: {new Date(wsForecastUpdateAt).toLocaleTimeString()}
                </span>
              )}
            </div>
          )}

          {/* Backend status */}
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
        </div>
      </div>

      {/* ---- Backend unavailable ---- */}
      {!backendOnline && (
        <ApiErrorFallback
          errorKind="backend_offline"
          onRetry={() => refetchForecast()}
        />
      )}

      {/* ---- Upstream degraded ---- */}
      {backendOnline && upstreamDegraded && (
        <ApiErrorFallback
          errorKind="upstream_unreachable"
          onRetry={() => refetchForecast()}
        />
      )}

      {/* ---- Phase info ---- */}
      {backendOnline && phaseData && (
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <div className="flex items-center gap-1.5">
                <Activity className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <span className="font-medium">{t("forecastPhase")}:</span>
                <Badge variant="outline" className="text-xs capitalize">
                  {phaseData.phase}
                </Badge>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-muted-foreground">{t("forecastDaysSince")}:</span>
                <span className="font-mono">{phaseData.daysSinceRef}</span>
              </div>
              {/* recommended_strategy not in canonical FlipperPhaseResponse; removed */}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ---- Forecast Chart ---- */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
            <TrendingUp className="h-4 w-4" aria-hidden="true" />
            {t("forecastTitle", { "0": selectedCurrency })}
          </CardTitle>
          {forecastData && (
            <div className="flex flex-wrap items-center gap-3 mt-1">
              {forecastData.disagreement && (
                <Badge variant="outline" className="text-[10px] border-amber-500/50 text-amber-600 dark:text-amber-400 bg-amber-500/10">
                  {t("forecastDisagreement")}
                </Badge>
              )}
              {forecastData.lowConfidence && (
                <Badge variant="outline" className="text-[10px] border-red-500/50 text-red-600 dark:text-red-400 bg-red-500/10">
                  {t("forecastLowConfidence")}
                </Badge>
              )}
              {forecastData.isEventActive && (
                <Badge variant="outline" className="text-[10px] border-orange-500/50 text-orange-600 dark:text-orange-400 bg-orange-500/10">
                  {t("forecastEventActive")}
                </Badge>
              )}
              <span className="text-xs text-muted-foreground">
                {forecastData.dataPoints} {t("forecastDataPoints")}
              </span>
            </div>
          )}
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0">
          {isLoading ? (
            <Skeleton className="h-[300px] w-full" />
          ) : forecastData && forecastData.dataAvailable === false ? (
            <div className="text-center py-10">
              <AlertTriangle className="h-8 w-8 text-amber-500 mx-auto mb-2" aria-hidden="true" />
              <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
                {t("dataUnavailableTitle")}
              </p>
              <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
                {t("dataUnavailableDesc")}
              </p>
            </div>
          ) : forecastError && !liveMode ? (
            <ApiErrorFallback
              error={forecastErrorObj instanceof Error ? forecastErrorObj : String(forecastErrorObj ?? "")}
              onRetry={() => refetchForecast()}
              errorKind={isForecastInsufficientData ? "insufficient_data" : undefined}
            />
          ) : !backendOnline ? (
            <ApiErrorFallback errorKind="backend_offline" />
          ) : chartData.length === 0 ? (
            <div className="text-center py-10">
              <AlertTriangle className="h-8 w-8 text-muted-foreground mx-auto mb-2" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">{t("forecastNoData")}</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis
                  dataKey="time"
                  tick={{ fontSize: 10 }}
                  interval="preserveStartEnd"
                />
                <YAxis tick={{ fontSize: 10 }} width={60} />
                <Tooltip
                  contentStyle={{
                    fontSize: 11,
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />

                {modelNames.map((name, i) => {
                  const color = modelColors[i % modelColors.length];
                  return [
                    <Area
                      key={name}
                      type="monotone"
                      dataKey={`${name}_forecast`}
                      stroke={color.stroke}
                      fill="none"
                      strokeWidth={2}
                      dot={false}
                      name={`${name}`}
                    />,
                    <Area
                      key={`${name}-ci`}
                      type="monotone"
                      dataKey={`${name}_ci_upper`}
                      stroke="none"
                      fill={color.fill}
                      fillOpacity={0.08}
                      dot={false}
                      name={`${name} CI upper`}
                      hide
                    />,
                    <Area
                      key={`${name}-ci-lower`}
                      type="monotone"
                      dataKey={`${name}_ci_lower`}
                      stroke="none"
                      fill={color.fill}
                      fillOpacity={0.08}
                      dot={false}
                      name={`${name} CI lower`}
                      hide
                    />,
                  ];
                })}
              </AreaChart>
            </ResponsiveContainer>
          )}

          {/* Model details */}
          {forecastData?.models && modelNames.length > 0 && (
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {modelNames.map((name, i) => {
                const model = forecastData.models[name];
                const color = modelColors[i % modelColors.length];
                return (
                  <div
                    key={name}
                    className="rounded-lg border p-3 space-y-1"
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: color.stroke }}
                      />
                      <span className="text-sm font-medium">{name}</span>
                    </div>
                    <div className="text-xs text-muted-foreground space-y-0.5">
                      <p>
                        {t("forecastMape")}:{" "}
                        {model.mape !== null ? `${(model.mape * 100).toFixed(2)}%` : "—"}
                      </p>
                      <p>
                        {t("forecastPoints")}: {model.pointForecast.length}
                      </p>
                      {model.lowConfidence && (
                        <p className="text-amber-600 dark:text-amber-400">
                          {t("forecastModelLowConfidence")}
                        </p>
                      )}
                      {model.disagreement && (
                        <p className="text-red-600 dark:text-red-400">
                          {t("forecastModelDisagreement")}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---- Storage Value Decision ---- */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
            <ArrowRightLeft className="h-4 w-4" aria-hidden="true" />
            {t("forecastStorageValue", { "0": selectedCurrency })}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0">
          {storageLoading && backendOnline && !liveMode ? (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : !backendOnline ? (
            <ApiErrorFallback errorKind="backend_offline" compact />
          ) : storageData && storageData.dataAvailable === false ? (
            <div className="text-center py-6">
              <AlertTriangle className="h-6 w-6 text-amber-500 mx-auto mb-2" aria-hidden="true" />
              <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
                {t("dataUnavailableTitle")}
              </p>
              <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
                {t("dataUnavailableDesc")}
              </p>
            </div>
          ) : !storageData ? (
            <div className="text-center py-6">
              {isStorageInsufficientData ? (
                <>
                  <AlertTriangle className="h-6 w-6 text-amber-500 mx-auto mb-2" aria-hidden="true" />
                  <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
                    {t("storageValueInsufficientDataTitle")}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
                    {storageInsufficientDetail || t("storageValueInsufficientDataDesc")}
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">{t("forecastNoData")}</p>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {/* Decision badge */}
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium">{t("forecastDecision")}:</span>
                <Badge
                  variant="outline"
                  className={`text-sm px-3 py-1 font-semibold ${
                    storageData.decision === "BUY" || storageData.decision === "HOLD"
                      ? "border-emerald-500/50 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
                      : storageData.decision === "SELL" || storageData.decision === "CONVERT"
                      ? "border-red-500/50 text-red-600 dark:text-red-400 bg-red-500/10"
                      : "border-amber-500/50 text-amber-600 dark:text-amber-400 bg-amber-500/10"
                  }`}
                >
                  {storageData.decision === "BUY" || storageData.decision === "HOLD" ? (
                    <TrendingUp className="h-4 w-4 mr-1 inline" aria-hidden="true" />
                  ) : storageData.decision === "SELL" || storageData.decision === "CONVERT" ? (
                    <TrendingDown className="h-4 w-4 mr-1 inline" aria-hidden="true" />
                  ) : null}
                  {storageData.decision}
                </Badge>
              </div>

              {/* Value details */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">{t("forecastCurrentPrice")}</p>
                  <p className="text-lg font-bold font-mono">{formatPrice(storageData.currentPrice, uiState.baseCurrencyText, uiState.baseCurrencyApiId, { digits: 4 })}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">{t("forecastProjectedPrice")}</p>
                  <p className="text-lg font-bold font-mono">{formatPrice(storageData.projectedPrice, uiState.baseCurrencyText, uiState.baseCurrencyApiId, { digits: 4 })}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">{t("forecastNetAfterFees")}</p>
                  <p className="text-lg font-bold font-mono">{formatPrice(storageData.netValueAfterFees, uiState.baseCurrencyText, uiState.baseCurrencyApiId, { digits: 4 })}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">{t("forecastRatio")}</p>
                  <p className={`text-lg font-bold font-mono ${
                    storageData.ratio > 1
                      ? "text-emerald-600 dark:text-emerald-400"
                      : storageData.ratio < 1
                      ? "text-red-600 dark:text-red-400"
                      : ""
                  }`}>
                    {storageData.ratio.toFixed(4)}
                  </p>
                </div>
              </div>

              {/* Inputs */}
              <div className="text-xs text-muted-foreground grid grid-cols-2 sm:grid-cols-3 gap-2">
                <span>{t("forecastMomentumInput")}: {storageData.inputs?.momentum.toFixed(4)}</span>
                <span>{t("forecastVolatilityInput")}: {storageData.inputs?.volatility.toFixed(4)}</span>
                <span>{t("forecastHorizon")}: {storageData.inputs?.horizonHours}h</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---- P2-3: Take-Profit & Stop-Loss Calculator ---- */}
      {backendOnline && forecastData?.models && storageData && (
        <TakeProfitCalculator
          models={forecastData.models}
          currentPrice={storageData.currentPrice}
          currencyId={selectedCurrency}
          baseCurrencyText={uiState.baseCurrencyText}
          baseCurrencyApiId={uiState.baseCurrencyApiId}
        />
      )}

      {/* ---- P3-6: Forecast Recommendations ---- */}
      {backendOnline && forecastData?.models && storageData && (
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
              <Info className="h-4 w-4" aria-hidden="true" />
              Forecast Recommendations
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Based on ensemble forecast, storage value decision, and anomaly detection
            </p>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0">
            <ForecastRecommendations
              forecastData={forecastData}
              storageData={storageData}
              anomaliesData={anomaliesData}
              baseCurrencyText={uiState.baseCurrencyText}
              baseCurrencyApiId={uiState.baseCurrencyApiId}
            />
          </CardContent>
        </Card>
      )}

      {/* ---- Anomaly Alerts ---- */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            {t("forecastAnomalyTitle")}
          </CardTitle>
          {anomaliesData && (
            <p className="text-xs text-muted-foreground mt-1">
              {t("forecastAnomalyDesc", {
                "0": String(anomaliesData.count),
                "1": String(anomaliesData.currencies_checked),
              })}
            </p>
          )}
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0">
          {anomaliesLoading && backendOnline ? (
            <Skeleton className="h-24 w-full" />
          ) : !backendOnline ? (
            <ApiErrorFallback errorKind="backend_offline" compact />
          ) : anomaliesData && anomaliesData.dataAvailable === false ? (
            <div className="text-center py-6">
              <AlertTriangle className="h-8 w-8 text-amber-500 mx-auto mb-2" aria-hidden="true" />
              <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
                {t("dataUnavailableTitle")}
              </p>
              <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
                {t("dataUnavailableDesc")}
              </p>
            </div>
          ) : upstreamDegraded ? (
            <ApiErrorFallback errorKind="upstream_unreachable" compact />
          ) : !anomaliesData?.anomalies?.length ? (
            <div className="text-center py-6">
              <ShieldCheck className="h-8 w-8 text-emerald-500 mx-auto mb-2" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">{t("forecastNoAnomalies")}</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {anomaliesData.anomalies.map((anomaly, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-3 rounded-lg border p-3 hover:bg-muted/20 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{anomaly.currency}</span>
                      <Badge
                        variant="outline"
                        className={`text-[10px] px-1.5 py-0 font-semibold ${
                          anomaly.direction === "up"
                            ? "border-emerald-500/50 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
                            : anomaly.direction === "down"
                            ? "border-red-500/50 text-red-600 dark:text-red-400 bg-red-500/10"
                            : "border-amber-500/50 text-amber-600 dark:text-amber-400 bg-amber-500/10"
                        }`}
                      >
                        {anomaly.direction === "up" ? "↑" : anomaly.direction === "down" ? "↓" : "→"}{" "}
                        {anomaly.direction}
                      </Badge>
                      {anomaly.is_confirmed && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-emerald-500/50 text-emerald-600 dark:text-emerald-400">
                          {t("forecastConfirmed")}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-muted-foreground">
                        {t("forecastAlertScore")}: {anomaly.alert_score.toFixed(2)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {t("forecastIndicators")}: {anomaly.triggered_indicators.join(", ")}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <AlertTriangle
                      className={`h-4 w-4 ${
                        anomaly.alert_score >= 0.7
                          ? "text-red-500"
                          : anomaly.alert_score >= 0.4
                          ? "text-amber-500"
                          : "text-muted-foreground"
                      }`}
                      aria-hidden="true"
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
});
