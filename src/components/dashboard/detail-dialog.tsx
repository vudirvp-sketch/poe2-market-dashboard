// ============================================================================
// Detail Dialog — Item detail with price/volume charts + candlestick toggle
// ============================================================================
"use client";

import { useState } from "react";
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
import { TrendingUp, Activity, Loader2 } from "lucide-react";
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
import { Star } from "lucide-react";
import { useDashboardStore } from "@/lib/store";

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
  const { isFavorite, toggleFavorite } = useDashboardStore();

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
                  className="w-6 h-6 object-contain"
                />
              ) : null}
              {item.name}
              <Badge variant="outline" className="font-normal">
                {item.type}
              </Badge>
              <button
                className="ml-auto"
                onClick={() => toggleFavorite(item.id)}
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
              <p className="text-xs text-muted-foreground">Price</p>
              <p className="text-lg font-bold font-mono">
                {fmt(item.relativePrice ?? item.priceChaos)}
              </p>
            </div>
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">24h Change</p>
              <p
                className={`text-lg font-bold font-mono ${fmtChange(item.changePercent).color}`}
              >
                {fmtChange(item.changePercent).text}
              </p>
            </div>
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">7d Change</p>
              <p
                className={`text-lg font-bold font-mono ${fmtChange(item.sevenDayPriceChangePercent).color}`}
              >
                {fmtChange(item.sevenDayPriceChangePercent).text}
              </p>
            </div>
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">Volume</p>
              <p className="text-lg font-bold font-mono">
                {item.volume?.toLocaleString() ?? "—"}
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
              Hourly
            </Button>
            <Button
              variant={chartMode === "daily" ? "default" : "outline"}
              size="sm"
              onClick={() => setChartMode("daily")}
            >
              Daily (Candlestick)
            </Button>
          </div>

          {/* Charts */}
          {chartMode === "hourly" ? (
            detailHistoryLoading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : detailHistory && detailHistory.length > 1 ? (
              <div className="mt-4 space-y-4">
                {/* Price history AreaChart */}
                <div>
                  <h4 className="text-sm font-medium mb-2 flex items-center gap-1">
                    <TrendingUp className="h-4 w-4" /> Price History
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
                          formatter={(value: number) => [fmt(value), "Price"]}
                        />
                        <Area
                          type="monotone"
                          dataKey="relativePrice"
                          stroke="#8b5cf6"
                          fill="url(#priceGrad)"
                          strokeWidth={2}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Volume chart */}
                <div>
                  <h4 className="text-sm font-medium mb-2 flex items-center gap-1">
                    <Activity className="h-4 w-4" /> Trading Volume
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
                          formatter={(value: number) => [
                            value.toLocaleString(),
                            "Volume",
                          ]}
                        />
                        <Bar
                          dataKey="volume"
                          fill="#6366f1"
                          radius={[2, 2, 0, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-10">
                No history data available
              </p>
            )
          ) : // Daily candlestick mode
          dailyLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : dailyStats && dailyStats.length > 0 ? (
            <div className="mt-4 space-y-4">
              {/* Candlestick chart using ComposedChart */}
              <div>
                <h4 className="text-sm font-medium mb-2 flex items-center gap-1">
                  <TrendingUp className="h-4 w-4" /> Daily Candlestick
                </h4>
                <div className="h-[300px]">
                  <CandlestickChart data={dailyStats} />
                </div>
              </div>

              {/* Daily volume */}
              <div>
                <h4 className="text-sm font-medium mb-2 flex items-center gap-1">
                  <Activity className="h-4 w-4" /> Daily Volume
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
                        formatter={(value: number) => [
                          value.toLocaleString(),
                          "Volume",
                        ]}
                      />
                      <Bar
                        dataKey="volume"
                        fill="#6366f1"
                        radius={[2, 2, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-center text-muted-foreground py-10">
              No daily stats available
            </p>
          )}
        </>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Custom Candlestick Chart using Recharts ComposedChart
// ============================================================================
function CandlestickChart({ data }: { data: DailyStat[] }) {
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

  // Custom candlestick shape
  const CandlestickShape = (props: { x?: number; y?: number; width?: number; height?: number; payload?: typeof chartData[0] }) => {
    const { x = 0, width = 0, payload } = props;
    if (!payload) return null;

    const chartHeight = 250; // approximate inner height
    const allPrices = data.flatMap((d) => [d.high, d.low]);
    const minPrice = Math.min(...allPrices);
    const maxPrice = Math.max(...allPrices);
    const range = maxPrice - minPrice || 1;

    const yScale = (val: number) => chartHeight - ((val - minPrice) / range) * chartHeight;
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
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
