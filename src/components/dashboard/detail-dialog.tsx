// ============================================================================
// Detail Dialog — Item detail with price/volume charts + candlestick toggle
// Task 6.11 fix: improved chartHeight measurement using ResizeObserver on
// the actual SVG plot area instead of hardcoded offset
// ============================================================================
"use client";

import { useState, useRef, useEffect, useCallback } from "react";
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
  ComposedChart,
  Line,
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
import type { PoeItem, PoeItemHistoryPoint, DailyStat } from "@/lib/types";
import { formatPrice } from "@/lib/utils";
import { Star } from "lucide-react";
import { useDashboardStore } from "@/lib/store";
import { useI18n } from "@/lib/i18n";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { ChartSkeleton } from "./skeletons";
import { EmptyState } from "./empty-state";

interface DetailDialogProps {
  item: PoeItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  realm: string;
  league: string;
  referenceCurrency?: string;
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
  const { isFavorite, toggleFavorite, uiState } = useDashboardStore();
  const { t } = useI18n();
  const reducedMotion = useReducedMotion();

  // Task 6.11: Accurate chart height measurement via ResizeObserver
  // Instead of hardcoded `chartHeight - 30`, we observe the actual rendered
  // SVG container and derive the plot area height from it.
  const candlestickContainerRef = useRef<HTMLDivElement>(null);
  const [candlestickChartHeight, setCandlestickChartHeight] = useState(270);
  // Track the actual chart plot area using a ResizeObserver on the Recharts SVG
  const chartSvgRef = useRef<SVGSVGElement | null>(null);

  // Measure the actual chart area after render
  useEffect(() => {
    if (!open || chartMode !== "daily" || !candlestickContainerRef.current) return;

    // The ResponsiveContainer creates a wrapper div; we need the SVG inside it
    const measureChart = () => {
      const container = candlestickContainerRef.current;
      if (!container) return;

      // Try to find the SVG rendered by ResponsiveContainer
      const svg = container.querySelector(".recharts-surface") as SVGSVGElement | null;
      if (svg) {
        chartSvgRef.current = svg;
        // The plot area height = SVG height - top margin - bottom margin (X axis)
        // Recharts default margins are typically { top: 5, right: 5, bottom: 5, left: 5 }
        // But with XAxis visible, bottom is ~30px. We use the actual SVG clientHeight.
        const svgHeight = svg.clientHeight || svg.getBoundingClientRect().height;
        if (svgHeight > 0) {
          // Subtract typical axis/padding height: XAxis (~30px) + top padding (~5px)
          const plotAreaHeight = svgHeight - 35;
          if (plotAreaHeight > 50) {
            setCandlestickChartHeight(plotAreaHeight);
          }
        }
      } else {
        // Fallback: use container height minus estimated axis/padding
        const containerHeight = container.clientHeight;
        if (containerHeight > 0) {
          const plotAreaHeight = containerHeight - 50; // XAxis + padding
          if (plotAreaHeight > 50) {
            setCandlestickChartHeight(plotAreaHeight);
          }
        }
      }
    };

    // Delay measurement to allow Recharts to render
    const timer = setTimeout(measureChart, 100);

    // Also observe container resize for responsive updates
    const container = candlestickContainerRef.current;
    const observer = new ResizeObserver(() => {
      measureChart();
    });
    if (container) observer.observe(container);

    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [chartMode, open]);

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

  // Daily OHLCV stats (candlestick)
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
    enabled: !!item && open && chartMode === "daily",
  });

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
          ) : // Daily candlestick mode
          dailyLoading ? (
            <ChartSkeleton height={300} />
          ) : dailyStats && dailyStats.length > 0 ? (
            <div className="mt-4 space-y-4">
              {/* Candlestick chart using ComposedChart */}
              <div>
                <h4 className="text-sm font-medium mb-2 flex items-center gap-1">
                  <TrendingUp className="h-4 w-4" aria-hidden="true" /> {t("dailyCandlestickTitle")}
                </h4>
                <div ref={candlestickContainerRef} className="h-[300px]">
                  <CandlestickChart data={dailyStats} chartHeight={candlestickChartHeight} reducedMotion={reducedMotion} />
                </div>
              </div>

              {/* Daily volume */}
              <div>
                <h4 className="text-sm font-medium mb-2 flex items-center gap-1">
                  <Activity className="h-4 w-4" aria-hidden="true" /> {t("dailyVolume")}
                </h4>
                <div className="h-[120px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dailyStats}>
                      <XAxis
                        dataKey="day"
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
              message={t("noDailyStats")}
            />
          )}
        </>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Custom Candlestick Chart using Recharts ComposedChart
// Task 6.11: chartHeight is now measured dynamically via ResizeObserver
// ============================================================================
function CandlestickChart({ data, chartHeight = 270, reducedMotion = false }: { data: DailyStat[]; chartHeight?: number; reducedMotion?: boolean }) {
  // For proper candlestick rendering, we use custom shapes
  const chartData = data.map((d) => ({
    ...d,
    dayLabel: new Date(d.day).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }),
    // Calculate wick positions (high-low range) and body (open-close range)
    bodyBottom: Math.min(d.open, d.close),
    bodyTop: Math.max(d.open, d.close),
    isUp: d.close >= d.open,
  }));

  // Compute Y-axis scale from data for accurate y-positioning
  const allPrices = data.flatMap((d) => [d.high, d.low]);
  const minPrice = Math.min(...allPrices);
  const maxPrice = Math.max(...allPrices);
  const range = maxPrice - minPrice || 1;

  // Custom candlestick shape — uses measured chartHeight for Y-coordinate mapping
  const CandlestickShape = (props: { x?: number; y?: number; width?: number; height?: number; payload?: typeof chartData[0] }) => {
    const { x = 0, width = 0, payload } = props;
    if (!payload) return null;

    const computedChartHeight = Math.max(chartHeight, 100); // Use the dynamically measured height
    const yScale = (val: number) => computedChartHeight - ((val - minPrice) / range) * computedChartHeight;
    const barWidth = Math.min(width * 0.6, 12);
    const centerX = x + width / 2;

    const color = payload.isUp ? "#34d399" : "#f87171";
    const fillColor = payload.isUp ? "rgba(52, 211, 153, 0.3)" : "rgba(248, 113, 113, 0.3)";

    return (
      <g>
        {/* Wick (high-low line) */}
        <line
          x1={centerX}
          x2={centerX}
          y1={yScale(payload.high)}
          y2={yScale(payload.low)}
          stroke={color}
          strokeWidth={1}
        />
        {/* Body (open-close rectangle) */}
        <rect
          x={centerX - barWidth / 2}
          y={yScale(payload.bodyTop)}
          width={barWidth}
          height={Math.max(yScale(payload.bodyBottom) - yScale(payload.bodyTop), 1)}
          fill={fillColor}
          stroke={color}
          strokeWidth={1}
        />
      </g>
    );
  };

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis
          dataKey="dayLabel"
          tick={{ fontSize: 10 }}
        />
        <YAxis
          tick={{ fontSize: 10 }}
          domain={["auto", "auto"]}
          tickFormatter={(v: number) => fmt(v, 1)}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "hsl(var(--card))",
            border: "1px solid hsl(var(--border))",
            borderRadius: "8px",
            fontSize: "12px",
          }}
          formatter={(_value: number, _name: string, props: { payload?: DailyStat }) => {
            const d = props.payload;
            if (!d) return ["", ""];
            return [
              <span key="o">
                O: {fmt(d.open)} H: {fmt(d.high)} L: {fmt(d.low)} C: {fmt(d.close)}
              </span>,
              "OHLC",
            ];
          }}
        />
        <Bar
          dataKey="close"
          shape={<CandlestickShape />}
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="close"
          stroke="#8b5cf6"
          strokeWidth={1}
          dot={false}
          strokeOpacity={0.5}
          isAnimationActive={!reducedMotion}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
