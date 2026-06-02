// ============================================================================
// Detail Dialog — Item detail with price/volume charts + candlestick toggle
// Task 6.11 fix: improved chartHeight measurement using ResizeObserver on
// the actual SVG plot area instead of hardcoded offset
//
// P3-2 (continued): Timeframe-aware OHLCV data fetching
//   - 1D: uses getItemDailyStats (official daily OHLCV from API)
//   - 1H/4H/1W: uses getMultiTimeframeOHLCV (aggregated from hourly history)
//   - When timeframe changes, the correct data source is fetched automatically
//   - Multi-timeframe alignments computed on the actual timeframe-specific data
// ============================================================================
"use client";

import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { TrendingUp, Activity } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { fmt, fmtChange, fetchApi } from "@/lib/types";
import type { PoeItem, PoeItemHistoryPoint, DailyStat, BenchmarksResponse } from "@/lib/types";
import { formatPrice } from "@/lib/utils";
import { Star } from "lucide-react";
import { useDashboardStore } from "@/lib/store";
import { useI18n } from "@/lib/i18n";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { ChartSkeleton } from "./skeletons";
import { EmptyState } from "./empty-state";
import { CandlestickChart, type OHLCVData, type Timeframe, computeTimeframeAlignments, type TimeframeAlignment } from "./candlestick-chart";

interface DetailDialogProps {
  item: PoeItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  realm: string;
  league: string;
  referenceCurrency?: string;
}

/** OHLCVCandle — matches the shape returned by /api/poe2/items?action=ohlcv */
interface OHLCVCandle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export function DetailDialog({
  item,
  open,
  onOpenChange,
  realm,
  league,
  referenceCurrency,
}: DetailDialogProps) {
  const [chartMode, setChartMode] = useState<"hourly" | "daily">("hourly");
  // P3-2: Timeframe state for candlestick chart
  const [candleTimeframe, setCandleTimeframe] = useState<Timeframe>("1D");
  const { isFavorite, toggleFavorite, uiState } = useDashboardStore();
  const { t } = useI18n();
  const reducedMotion = useReducedMotion();

  // Hourly price history
  const { data: detailHistory, isLoading: detailHistoryLoading } = useQuery({
    queryKey: ["itemHistory", realm, league, item?.id, referenceCurrency],
    queryFn: () =>
      fetchApi<PoeItemHistoryPoint[]>("/api/poe2/items", {
        realm,
        league,
        action: "history",
        itemId: item!.id,
        logCount: "168",
        referenceCurrency: referenceCurrency || "",
      }),
    enabled: !!item && open && chartMode === "hourly",
  });

  // Daily OHLCV stats (candlestick) — used ONLY when timeframe is 1D
  const { data: dailyStats, isLoading: dailyLoading } = useQuery({
    queryKey: ["itemDaily", realm, league, item?.id, referenceCurrency],
    queryFn: () =>
      fetchApi<DailyStat[]>("/api/poe2/items", {
        realm,
        league,
        action: "daily",
        itemId: item!.id,
        dayCount: "30",
        referenceCurrency: referenceCurrency || "",
      }),
    enabled: !!item && open && chartMode === "daily" && candleTimeframe === "1D",
    staleTime: 120_000,
    retry: 1,
  });

  // P3-2: Multi-timeframe OHLCV data — used when timeframe is 1H, 4H, or 1W
  const { data: multiTfOhlcv, isLoading: multiTfLoading } = useQuery({
    queryKey: ["itemOhlcv", realm, league, item?.id, candleTimeframe, referenceCurrency],
    queryFn: () =>
      fetchApi<OHLCVCandle[]>("/api/poe2/items", {
        realm,
        league,
        action: "ohlcv",
        itemId: item!.id,
        timeframe: candleTimeframe,
        referenceCurrency: referenceCurrency || "",
      }),
    enabled: !!item && open && chartMode === "daily" && (candleTimeframe === "1H" || candleTimeframe === "4H" || candleTimeframe === "1W"),
    staleTime: 120_000,
    retry: 1,
  });

  // P1-5: Fetch benchmark data for the detail panel
  const { data: benchmarkData } = useQuery<BenchmarksResponse>({
    queryKey: ["benchmark", item?.apiId],
    queryFn: () => fetchApi<BenchmarksResponse>(`/api/flipper/benchmarks/${item!.apiId}`),
    enabled: !!item?.apiId && open,
    staleTime: 120_000,
    retry: 0,
  });
  const benchmark = benchmarkData?.benchmark;

  // P3-2: Convert daily stats to OHLCV data — used for 1D timeframe
  const dailyOhlcvData = useMemo((): OHLCVData[] => {
    if (!dailyStats || !Array.isArray(dailyStats)) return [];
    return dailyStats
      .filter((d) => d.close > 0 && Number.isFinite(d.close))
      .map((d) => ({
        time: d.day?.slice(0, 10) ?? "",
        open: d.open ?? d.close,
        high: d.high ?? d.close,
        low: d.low ?? d.close,
        close: d.close,
        volume: d.volume ?? 0,
      }));
  }, [dailyStats]);

  // P3-2: Convert multi-timeframe OHLCV candles to the OHLCVData format
  // OHLCVCandle and OHLCVData have the same shape, but we map explicitly for safety
  const multiTfOhlcvData = useMemo((): OHLCVData[] => {
    if (!multiTfOhlcv || !Array.isArray(multiTfOhlcv)) return [];
    return multiTfOhlcv
      .filter((d) => d.close > 0 && Number.isFinite(d.close))
      .map((d) => ({
        time: typeof d.time === "string" ? d.time.slice(0, 16) : String(d.time),
        open: d.open ?? d.close,
        high: d.high ?? d.close,
        low: d.low ?? d.close,
        close: d.close,
        volume: d.volume ?? 0,
      }));
  }, [multiTfOhlcv]);

  // P3-2: Select the correct OHLCV data based on the active timeframe
  const ohlcvData = useMemo((): OHLCVData[] => {
    if (candleTimeframe === "1D") return dailyOhlcvData;
    return multiTfOhlcvData;
  }, [candleTimeframe, dailyOhlcvData, multiTfOhlcvData]);

  // P3-2: Compute multi-timeframe alignment from the ACTUAL timeframe-specific OHLCV data
  // When the user selects 1H/4H/1W, the alignment is computed from real candles at that timeframe,
  // not from daily data with approximated SMA periods.
  const timeframeAlignments = useMemo((): TimeframeAlignment[] => {
    return computeTimeframeAlignments(ohlcvData);
  }, [ohlcvData]);

  // Handle timeframe change — reset to 1D data when switching back
  const handleTimeframeChange = useCallback((tf: Timeframe) => {
    setCandleTimeframe(tf);
  }, []);

  // Determine loading state for candlestick chart
  const isCandleLoading = candleTimeframe === "1D" ? dailyLoading : multiTfLoading;

  if (!item) return null;
  const fav = isFavorite(item.id);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {item.iconUrl ? (
                <img
                  src={item.iconUrl}
                  alt=""
                  className="w-8 h-8 object-contain"
                />
              ) : null}
              {item.name}
              <Badge variant="outline" className="font-normal">
                {item.type}
              </Badge>
              <button
                className="ml-auto"
                onClick={() => toggleFavorite(item.id)}
                aria-label={fav ? t("removeFromFavorites") : t("addToFavorites")}
              >
                <Star
                  className={`h-5 w-5 ${
                    fav
                      ? "fill-yellow-400 text-yellow-400"
                      : "text-muted-foreground hover:text-yellow-400"
                  }`}
                />
              </button>
            </DialogTitle>
          </DialogHeader>

          {/* Key metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2">
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">{t("priceLabel")}</p>
              <p className="text-lg font-bold font-mono">
                {formatPrice(item.relativePrice ?? item.priceChaos, uiState.baseCurrencyText, uiState.baseCurrencyApiId)}
              </p>
            </div>
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">{t("change24h")}</p>
              <p
                className={`text-lg font-bold font-mono ${fmtChange(item.changePercent).color}`}
              >
                {fmtChange(item.changePercent).text}
              </p>
            </div>
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">{t("change7d")}</p>
              <p
                className={`text-lg font-bold font-mono ${fmtChange(item.sevenDayPriceChangePercent).color}`}
              >
                {fmtChange(item.sevenDayPriceChangePercent).text}
              </p>
            </div>
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">{t("volume")}</p>
              <p className="text-lg font-bold font-mono">
                {item.volume?.toLocaleString() ?? "\u2014"}
              </p>
            </div>
          </div>

          {/* P1-5: Benchmark Info Panel — 30-day range, percentile, vs avg */}
          {benchmark && (
            <div className="mt-3 rounded-lg border p-3 space-y-2">
              <h4 className="text-xs font-semibold flex items-center gap-1.5">
                <Activity className="h-3.5 w-3.5" aria-hidden="true" />
                {t("benchmark30dTitle")}
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <p className="text-[10px] text-muted-foreground">{t("benchmark30dLow")}</p>
                  <p className="text-sm font-mono font-medium">{fmt(benchmark.low30d)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">{t("benchmark30dHigh")}</p>
                  <p className="text-sm font-mono font-medium">{fmt(benchmark.high30d)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">{t("benchmarkPercentile")}</p>
                  <p className="text-sm font-mono font-medium">{benchmark.percentile30d.toFixed(0)}%</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">{t("benchmarkVsAvg")}</p>
                  <p className={`text-sm font-mono font-medium ${benchmark.currentVsAvg >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                    {benchmark.currentVsAvg >= 0 ? "+" : ""}{(benchmark.currentVsAvg * 100).toFixed(1)}%
                  </p>
                </div>
              </div>
              {/* Range position bar */}
              <div>
                <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-0.5">
                  <span>{t("benchmarkRangePosition")}</span>
                  <span>{(benchmark.rangePosition * 100).toFixed(0)}%</span>
                </div>
                <div className="h-2 w-full rounded-full bg-muted overflow-hidden" role="meter" aria-valuenow={benchmark.rangePosition * 100} aria-valuemin={0} aria-valuemax={100} aria-label={t("benchmarkRangePosition")}>
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${Math.max(3, benchmark.rangePosition * 100)}%`,
                      backgroundColor:
                        benchmark.rangePosition >= 0.8 ? "#f87171" :
                        benchmark.rangePosition >= 0.5 ? "#fbbf24" :
                        "#34d399",
                    }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Chart mode toggle */}
          <div className="flex gap-2 mt-3">
            <Button
              variant={chartMode === "hourly" ? "default" : "outline"}
              size="sm"
              onClick={() => setChartMode("hourly")}
            >
              {t("hourly")}
            </Button>
            <Button
              variant={chartMode === "daily" ? "default" : "outline"}
              size="sm"
              onClick={() => setChartMode("daily")}
            >
              {t("dailyCandlestick")}
            </Button>
          </div>

          {/* Charts */}
          {chartMode === "hourly" ? (
            detailHistoryLoading ? (
              <ChartSkeleton height={250} />
            ) : detailHistory && detailHistory.length > 1 ? (
              <div className="mt-4 space-y-4">
                {/* Price history AreaChart */}
                <div>
                  <h4 className="text-sm font-medium mb-2 flex items-center gap-1">
                    <TrendingUp className="h-4 w-4" aria-hidden="true" /> {t("priceHistory")}
                  </h4>
                  <div className="h-[250px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={detailHistory}>
                        <defs>
                          <linearGradient
                            id="priceGrad"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop
                              offset="5%"
                              stopColor="#8b5cf6"
                              stopOpacity={0.3}
                            />
                            <stop
                              offset="95%"
                              stopColor="#8b5cf6"
                              stopOpacity={0}
                            />
                          </linearGradient>
                        </defs>
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke="hsl(var(--border))"
                        />
                        <XAxis
                          dataKey="timestamp"
                          tick={{ fontSize: 10 }}
                          tickFormatter={(v: string) =>
                            new Date(v).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                            })
                          }
                        />
                        <YAxis
                          tick={{ fontSize: 10 }}
                          tickFormatter={(v: number) => fmt(v, 0)}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "hsl(var(--card))",
                            border: "1px solid hsl(var(--border))",
                            borderRadius: "8px",
                            fontSize: "12px",
                          }}
                          labelFormatter={(v: string) =>
                            new Date(v).toLocaleString()
                          }
                          formatter={(value: number) => [fmt(value), t("priceLabel")]}
                        />
                        <Area
                          type="monotone"
                          dataKey="relativePrice"
                          stroke="#8b5cf6"
                          fill="url(#priceGrad)"
                          strokeWidth={2}
                          isAnimationActive={!reducedMotion}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Volume chart */}
                <div>
                  <h4 className="text-sm font-medium mb-2 flex items-center gap-1">
                    <Activity className="h-4 w-4" aria-hidden="true" /> {t("tradingVolume")}
                  </h4>
                  <div className="h-[120px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={detailHistory}>
                        <XAxis
                          dataKey="timestamp"
                          tick={{ fontSize: 10 }}
                          tickFormatter={(v: string) =>
                            new Date(v).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                            })
                          }
                        />
                        <YAxis
                          tick={{ fontSize: 10 }}
                          tickFormatter={(v: number) =>
                            v >= 1000
                              ? `${(v / 1000).toFixed(0)}k`
                              : String(v)
                          }
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "hsl(var(--card))",
                            border: "1px solid hsl(var(--border))",
                            borderRadius: "8px",
                            fontSize: "12px",
                          }}
                          labelFormatter={(v: string) =>
                            new Date(v).toLocaleString()
                          }
                          formatter={(value: number) => [value.toLocaleString(), t("volume")]}
                        />
                        <Bar
                          dataKey="volume"
                          fill="#6366f1"
                          radius={[2, 2, 0, 0]}
                          isAnimationActive={!reducedMotion}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            ) : (
              <EmptyState
                kind="noResults"
                message={t("noHistory")}
              />
            )
          ) : // Daily candlestick mode — P3-2: timeframe-aware OHLCV data fetching
          isCandleLoading ? (
            <ChartSkeleton height={300} />
          ) : ohlcvData.length > 0 ? (
            <div className="mt-4">
              <CandlestickChart
                data={ohlcvData}
                title={`${item.name} — ${candleTimeframe} Candlestick`}
                showVolume={true}
                overlays={["sma20", "ema12", "rsi14"]}
                timeframe={candleTimeframe}
                onTimeframeChange={handleTimeframeChange}
                timeframeAlignments={timeframeAlignments}
              />
            </div>
          ) : (
            <EmptyState
              kind="noResults"
              message={t("noDailyStats")}
            />
          )}
        </>
      </DialogContent>
    </Dialog>
  );
}
