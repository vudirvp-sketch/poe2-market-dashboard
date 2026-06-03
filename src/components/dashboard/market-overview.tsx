// ============================================================================
// Market Overview Tab (Priority 2.1 + 2.3)
// ============================================================================
"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
} from "recharts";
import {
  TrendingUp,
  TrendingDown,
  Activity,
  BarChart3,
  Coins,
  ArrowLeftRight,
  ArrowUpRight,
  ArrowDownRight,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fmt, fmtChange, fetchApi, exportToCsv, exportToJson } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import type { SnapshotHistoryPoint, PoeItem, ExchangePair } from "@/lib/types";
import { useState, useMemo } from "react";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { MarketOverviewSkeleton } from "./skeletons";
import { DataFreshnessBadge } from "./data-freshness-badge";

interface HeatmapItem {
  currency: string;
  change24h: number;
}

// Response shape from /api/poe2/overview
interface OverviewResponse {
  topGainers: PoeItem[];
  topLosers: PoeItem[];
  topGainers7d: PoeItem[];
  topLosers7d: PoeItem[];
  stats: {
    totalVolume: number;
    trackedItems: number;
    exchangePairs: number;
  };
  snapshotHistory: SnapshotHistoryPoint[];
}

interface MarketOverviewProps {
  realm: string;
  league: string;
  onItemClick: (item: PoeItem) => void;
  backendOnline?: boolean;
}

const PIE_COLORS = [
  "#6366f1", "#8b5cf6", "#a78bfa", "#c084fc", "#e879f9",
  "#f472b6", "#fb923c", "#fbbf24", "#34d399", "#22d3ee",
];

export function MarketOverview({ realm, league, onItemClick, backendOnline }: MarketOverviewProps) {
  const { t } = useI18n();
  const [topTimeframe, setTopTimeframe] = useState<"24h" | "7d">("24h");
  const [trendTimeframe, setTrendTimeframe] = useState<"24h" | "7d">("7d");
  const reducedMotion = useReducedMotion();

  // Single aggregated overview query — replaces 3 separate queries
  // and uses the new /api/poe2/overview endpoint which fetches
  // currencies+uniques with PriceLogs for proper top movers data.
  const { data: overview, isLoading: overviewLoading, dataUpdatedAt: overviewFetchedAt } = useQuery<OverviewResponse>({
    queryKey: ["overview", realm, league],
    queryFn: () =>
      fetchApi<OverviewResponse>("/api/poe2/overview", { realm, league }),
    enabled: !!league,
    staleTime: 60_000,
    retry: 2,
  });

  // ---- Heatmap data ----
  // ENHANCEMENT: The heatmap now works even when the flipper backend is offline.
  // The /api/flipper/heatmap route falls back to POE2Scout API data when the
  // flipper backend returns empty results. Realm and league are passed so the
  // POE2Scout fallback knows which league to query.
  const { data: heatmapData } = useQuery<HeatmapItem[]>({
    queryKey: ["flipper-heatmap", realm, league],
    queryFn: () => fetchApi<HeatmapItem[]>("/api/flipper/heatmap", { realm, league }),
    enabled: !!league,
    staleTime: 60_000,
    retry: 1,
  });

  const isLoading = overviewLoading;

  // Fix 4.8: Dynamic heatmap scale based on 95th percentile of absolute changes.
  // The previous fixed ±10% range masked extreme movements (e.g. +50% looked
  // identical to +10%). Now the scale adapts to the data distribution.
  //
  // CRITICAL: This useMemo MUST be called before any conditional return.
  // Previously it was placed after the `if (isLoading) return ...` guard,
  // which violates the Rules of Hooks — React requires all hooks to be
  // called in the same order on every render. When isLoading flipped from
  // true to false, the hook count changed, causing React error #310
  // (Maximum update depth exceeded).
  const heatmapScale = useMemo(() => {
    if (!heatmapData || heatmapData.length === 0) return { min: -10, max: 10 };
    const validValues = heatmapData
      .map((item) => item.change24h)
      .filter((v) => v != null && isFinite(v));
    if (validValues.length === 0) return { min: -10, max: 10 };
    // Sort by absolute value
    const sorted = [...validValues].sort((a, b) => Math.abs(a) - Math.abs(b));
    // 95th percentile of absolute values
    const p95Index = Math.floor(sorted.length * 0.95);
    const p95Value = Math.abs(sorted[p95Index]);
    // Ensure minimum range of ±5% so small movements are still visible
    const range = Math.max(p95Value, 5);
    return { min: -range, max: range };
  }, [heatmapData]);

  // Top movers from overview response
  const topGainers = topTimeframe === "24h"
    ? overview?.topGainers ?? []
    : overview?.topGainers7d ?? [];

  const topLosers = topTimeframe === "24h"
    ? overview?.topLosers ?? []
    : overview?.topLosers7d ?? [];

  // Market stats
  const totalVolume = overview?.stats?.totalVolume ?? 0;
  const trackedItems = overview?.stats?.trackedItems ?? 0;
  const exchangePairsCount = overview?.stats?.exchangePairs ?? 0;

  // Compute median change 24h from top movers
  const medianChange = useMemo(() => {
    const allMovers = [
      ...(overview?.topGainers ?? []),
      ...(overview?.topLosers ?? []),
    ];
    const changes = allMovers
      .map((i) => i.changePercent)
      .filter((v): v is number => v != null);
    if (changes.length === 0) return null;
    changes.sort((a, b) => a - b);
    const mid = Math.floor(changes.length / 2);
    return changes.length % 2 !== 0
      ? changes[mid]
      : (changes[mid - 1] + changes[mid]) / 2;
  }, [overview]);

  // Filter snapshot history by trend timeframe
  const trendData = useMemo(() => {
    const history = overview?.snapshotHistory;
    if (!history || history.length === 0) return [];
    if (trendTimeframe === "7d") return history;
    // 24h: take the last 24 hours of data
    const latest = new Date(history[history.length - 1].timestamp).getTime();
    const cutoff = latest - 24 * 60 * 60 * 1000;
    return history.filter((p) => new Date(p.timestamp).getTime() >= cutoff);
  }, [overview?.snapshotHistory, trendTimeframe]);

  // §3.5: Category distribution for donut chart
  const categoryDistribution = useMemo(() => {
    const allItems = [
      ...(overview?.topGainers ?? []),
      ...(overview?.topLosers ?? []),
    ];
    const catCount = new Map<string, number>();
    for (const item of allItems) {
      const cat = item.category || item.type || t("all");
      catCount.set(cat, (catCount.get(cat) || 0) + 1);
    }
    return Array.from(catCount.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [overview]);

  // §3.5: Top movers as horizontal bar data
  const topMoversBarData = useMemo(() => {
    const movers = [
      ...topGainers.slice(0, 5).map((i) => ({
        name: i.name,
        change: topTimeframe === "24h" ? (i.changePercent ?? 0) : (i.sevenDayPriceChangePercent ?? 0),
        type: "gainer" as const,
      })),
      ...topLosers.slice(0, 5).map((i) => ({
        name: i.name,
        change: topTimeframe === "24h" ? (i.changePercent ?? 0) : (i.sevenDayPriceChangePercent ?? 0),
        type: "loser" as const,
      })),
    ];
    return movers.sort((a, b) => b.change - a.change);
  }, [topGainers, topLosers, topTimeframe]);

  if (isLoading) {
    return <MarketOverviewSkeleton />;
  }

  // Heatmap color helper: green for positive, red for negative, intensity proportional to magnitude
  // Uses the dynamic scale computed above
  const heatmapCellStyle = (change: number): React.CSSProperties => {
    const maxAbs = heatmapScale.max;
    const clamped = Math.max(-maxAbs, Math.min(maxAbs, change));
    const intensity = Math.abs(clamped) / maxAbs;
    if (clamped >= 0) {
      return { backgroundColor: `rgba(34, 197, 94, ${0.15 + intensity * 0.55})` };
    } else {
      return { backgroundColor: `rgba(239, 68, 68, ${0.15 + intensity * 0.55})` };
    }
  };

  return (
    <div className="space-y-6">
      {/* Data freshness badge for POE2Scout API tab */}
      {overviewFetchedAt > 0 && (
        <DataFreshnessBadge
          fetchedAt={new Date(overviewFetchedAt).toISOString()}
          dataAvailable={!!overview}
          compact
        />
      )}
      {/* §2.1: KPI Cards — 4 cards in a row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" aria-live="polite" aria-label={t("marketOverviewStats")}>
        <Card>
          <CardContent className="py-5 px-5">  {/* §1.6: increased padding */}
            <div className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" />
              <p className="text-xs text-muted-foreground">{t("totalVolume24h")}</p>
            </div>
            <p className="text-2xl font-bold font-mono mt-1">
              {totalVolume >= 1000000
                ? `${(totalVolume / 1000000).toFixed(1)}M`
                : totalVolume >= 1000
                ? `${(totalVolume / 1000).toFixed(1)}K`
                : totalVolume.toLocaleString()}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-5 px-5">
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary" />
              <p className="text-xs text-muted-foreground">{t("medianChange24h")}</p>
            </div>
            <p className={`text-2xl font-bold font-mono mt-1 ${
              medianChange != null
                ? medianChange >= 0 ? "text-emerald-400" : "text-red-400"
                : ""
            }`}>
              {medianChange != null
                ? `${medianChange >= 0 ? "▲" : "▼"} ${medianChange >= 0 ? "+" : ""}${medianChange.toFixed(1)}%`
                : "—"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-5 px-5">  {/* §1.6: increased padding */}
            <div className="flex items-center gap-2">
              <Coins className="h-5 w-5 text-primary" />
              <p className="text-xs text-muted-foreground">{t("trackedItems")}</p>
            </div>
            <p className="text-2xl font-bold font-mono mt-1">
              {trackedItems.toLocaleString()}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-5 px-5">  {/* §1.6: increased padding */}
            <div className="flex items-center gap-2">
              <ArrowLeftRight className="h-5 w-5 text-primary" />
              <p className="text-xs text-muted-foreground">{t("exchangePairs")}</p>
            </div>
            <p className="text-2xl font-bold font-mono mt-1">
              {exchangePairsCount}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* §2.1: Volume trend chart with 24h/7d toggle */}
      {trendData.length > 1 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium flex items-center gap-1">
                <Activity className="h-4 w-4" /> {t("marketVolumeTrend")}
              </CardTitle>
              <div className="flex gap-1">
                <Button
                  variant={trendTimeframe === "24h" ? "default" : "outline"}
                  size="sm"
                  className="h-6 text-xs px-2"
                  onClick={() => setTrendTimeframe("24h")}
                >
                  {t("timeframe24h")}
                </Button>
                <Button
                  variant={trendTimeframe === "7d" ? "default" : "outline"}
                  size="sm"
                  className="h-6 text-xs px-2"
                  onClick={() => setTrendTimeframe("7d")}
                >
                  {t("timeframe7d")}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendData}>
                  <defs>
                    <linearGradient id="volGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
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
                      v >= 1000000
                        ? `${(v / 1000000).toFixed(1)}M`
                        : v >= 1000
                        ? `${(v / 1000).toFixed(0)}K`
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
                    labelFormatter={(v: string) => new Date(v).toLocaleString()}
                  />
                  <Area
                    type="monotone"
                    dataKey="totalVolume"
                    stroke="#6366f1"
                    fill="url(#volGrad)"
                    strokeWidth={2}
                    isAnimationActive={!reducedMotion}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Price Heatmap — now works even when flipper backend is offline */}
      {heatmapData && heatmapData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t("overviewHeatmap")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1.5">
              {heatmapData.map((item) => (
                <div
                  key={item.currency}
                  className="flex flex-col items-center justify-center rounded px-2 py-1 min-w-[60px]"
                  style={heatmapCellStyle(item.change24h)}
                >
                  <span className="text-[10px] font-semibold">{item.currency}</span>
                  <span
                    className={`text-[10px] font-mono ${
                      item.change24h != null && item.change24h >= 0
                        ? "text-emerald-700 dark:text-emerald-300"
                        : "text-red-700 dark:text-red-300"
                    }`}
                  >
                    {item.change24h != null && item.change24h >= 0 ? "+" : ""}
                    {item.change24h != null ? item.change24h.toFixed(2) : "—"}%
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Top Gainers / Losers */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium">{t("topMovers")}</h3>
          <div className="flex gap-1">
            <Button
              variant={topTimeframe === "24h" ? "default" : "outline"}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setTopTimeframe("24h")}
            >
              {t("timeframe24h")}
            </Button>
            <Button
              variant={topTimeframe === "7d" ? "default" : "outline"}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setTopTimeframe("7d")}
            >
              {t("timeframe7d")}
            </Button>
          </div>
        </div>

        {/* §3.5: Horizontal Bar Chart for top movers */}
        {topMoversBarData.length > 0 && (
          <Card className="mb-4">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">{t("topMoversChart")}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topMoversBarData} layout="vertical" margin={{ left: 20, right: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                    <XAxis
                      type="number"
                      tick={{ fontSize: 10 }}
                      tickFormatter={(v: number) => `${v > 0 ? "+" : ""}${v.toFixed(0)}%`}
                    />
                    <YAxis
                      dataKey="name"
                      type="category"
                      width={100}
                      tick={{ fontSize: 10 }}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "8px",
                        fontSize: "12px",
                      }}
                      formatter={(v: number) => [`${v > 0 ? "+" : ""}${v.toFixed(1)}%`, t("change")]}
                    />
                    <Bar dataKey="change" radius={[0, 4, 4, 0]} isAnimationActive={!reducedMotion}>
                      {topMoversBarData.map((entry, idx) => (
                        <Cell
                          key={idx}
                          fill={entry.change >= 0 ? "#22c55e" : "#ef4444"}
                          fillOpacity={0.7 + Math.abs(entry.change) / Math.max(...topMoversBarData.map(d => Math.abs(d.change)), 1) * 0.3}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        )}

        {/* §3.5: Donut Chart for category distribution */}
        {categoryDistribution.length > 1 && (
          <Card className="mb-4">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">{t("categoryDistribution")}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4">
                <div className="h-[200px] w-[200px] shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={categoryDistribution}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={80}
                        paddingAngle={2}
                        dataKey="value"
                        isAnimationActive={!reducedMotion}
                      >
                        {categoryDistribution.map((_, idx) => (
                          <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                          fontSize: "12px",
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex-1 space-y-1">
                  {categoryDistribution.map((cat, idx) => (
                    <div key={cat.name} className="flex items-center gap-2 text-xs">
                      <span
                        className="w-3 h-3 rounded-sm shrink-0"
                        style={{ backgroundColor: PIE_COLORS[idx % PIE_COLORS.length] }}
                      />
                      <span className="truncate">{cat.name}</span>
                      <span className="ml-auto font-mono text-muted-foreground">{cat.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4" role="region" aria-label={t("topMovers")}>
          {/* Top Gainers */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-emerald-400 flex items-center gap-1">
                <TrendingUp className="h-4 w-4" /> {t("topGainers")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {topGainers.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t("noData")}</p>
              ) : (
                topGainers.map((item, idx) => {
                  const pct =
                    topTimeframe === "24h"
                      ? item.changePercent
                      : item.sevenDayPriceChangePercent;
                  return (
                    <div
                      key={item.id}
                      className="flex items-center justify-between py-1 px-2 rounded hover:bg-muted/30 cursor-pointer"
                      onClick={() => onItemClick(item)}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground w-4">
                          {idx + 1}
                        </span>
                        {item.iconUrl ? (
                          <img
                            src={item.iconUrl}
                            alt=""
                            className="w-6 h-6 object-contain"
                          />
                        ) : null}
                        <span className="text-xs font-medium truncate max-w-[150px]">
                          {item.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <ArrowUpRight className="h-3 w-3 text-emerald-400" />
                        <span className="text-xs font-mono text-emerald-400">
                          {pct != null ? `+${pct.toFixed(1)}%` : "—"}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>

          {/* Top Losers */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-red-400 flex items-center gap-1">
                <TrendingDown className="h-4 w-4" /> {t("topLosers")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {topLosers.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t("noData")}</p>
              ) : (
                topLosers.map((item, idx) => {
                  const pct =
                    topTimeframe === "24h"
                      ? item.changePercent
                      : item.sevenDayPriceChangePercent;
                  return (
                    <div
                      key={item.id}
                      className="flex items-center justify-between py-1 px-2 rounded hover:bg-muted/30 cursor-pointer"
                      onClick={() => onItemClick(item)}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground w-4">
                          {idx + 1}
                        </span>
                        {item.iconUrl ? (
                          <img
                            src={item.iconUrl}
                            alt=""
                            className="w-6 h-6 object-contain"
                          />
                        ) : null}
                        <span className="text-xs font-medium truncate max-w-[150px]">
                          {item.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <ArrowDownRight className="h-3 w-3 text-red-400" />
                        <span className="text-xs font-mono text-red-400">
                          {pct != null ? `${pct.toFixed(1)}%` : "—"}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
