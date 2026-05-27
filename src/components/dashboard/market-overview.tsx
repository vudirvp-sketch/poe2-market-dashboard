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
} from "recharts";
import {
  TrendingUp,
  TrendingDown,
  Activity,
  Loader2,
  BarChart3,
  Coins,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fmt, fmtChange, fetchApi, exportToCsv, exportToJson } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import type { SnapshotHistoryPoint, PoeItem, ExchangePair } from "@/lib/types";
import { useState, useMemo } from "react";

interface MarketOverviewProps {
  realm: string;
  league: string;
  onItemClick: (item: PoeItem) => void;
}

export function MarketOverview({ realm, league, onItemClick }: MarketOverviewProps) {
  const { t } = useI18n();
  const [topTimeframe, setTopTimeframe] = useState<"24h" | "7d">("24h");

  // Snapshot history for volume trend
  const { data: snapshotHistory, isLoading: snapshotLoading } = useQuery({
    queryKey: ["snapshotHistory", realm, league],
    queryFn: () =>
      fetchApi<SnapshotHistoryPoint[]>("/api/poe2/exchange", {
        realm,
        league,
        action: "history",
        limit: "168",
      }),
    enabled: !!league,
  });

  // All items for top gainers/losers
  const { data: allItems, isLoading: itemsLoading } = useQuery({
    queryKey: ["allItems", realm, league],
    queryFn: () =>
      fetchApi<PoeItem[]>("/api/poe2/items", { realm, league }),
    enabled: !!league,
  });

  // Exchange pairs for overview
  const { data: pairs, isLoading: pairsLoading } = useQuery({
    queryKey: ["exchangePairs", realm, league],
    queryFn: () =>
      fetchApi<ExchangePair[]>("/api/poe2/exchange", {
        realm,
        league,
        action: "pairs",
      }),
    enabled: !!league,
  });

  const isLoading = snapshotLoading || itemsLoading || pairsLoading;

  // Top movers
  const { topGainers, topLosers } = useMemo(() => {
    if (!allItems) return { topGainers: [], topLosers: [] };
    const validItems = allItems.filter(
      (i) =>
        (topTimeframe === "24h"
          ? i.changePercent != null
          : i.sevenDayPriceChangePercent != null) &&
        i.volume != null &&
        i.volume > 0
    );
    const sorted = [...validItems].sort((a, b) => {
      const aVal =
        topTimeframe === "24h"
          ? a.changePercent ?? 0
          : a.sevenDayPriceChangePercent ?? 0;
      const bVal =
        topTimeframe === "24h"
          ? b.changePercent ?? 0
          : b.sevenDayPriceChangePercent ?? 0;
      return bVal - aVal;
    });
    return {
      topGainers: sorted.slice(0, 10),
      topLosers: sorted.slice(-10).reverse(),
    };
  }, [allItems, topTimeframe]);

  // Market stats
  const totalVolume = useMemo(() => {
    return allItems?.reduce((sum, i) => sum + (i.volume ?? 0), 0) ?? 0;
  }, [allItems]);

  const trackedItems = allItems?.length ?? 0;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Market stats row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card>
          <CardContent className="py-4 px-4">
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
          <CardContent className="py-4 px-4">
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
          <CardContent className="py-4 px-4">
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary" />
              <p className="text-xs text-muted-foreground">{t("exchangePairs")}</p>
            </div>
            <p className="text-2xl font-bold font-mono mt-1">
              {pairs?.length ?? 0}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Volume trend chart */}
      {snapshotHistory && snapshotHistory.length > 1 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-1">
              <Activity className="h-4 w-4" /> {t("marketVolumeTrend")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={snapshotHistory}>
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
                  />
                </AreaChart>
              </ResponsiveContainer>
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                            className="w-4 h-4 object-contain"
                          />
                        ) : null}
                        <span className="text-xs font-medium truncate max-w-[150px]">
                          {item.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <ArrowUpRight className="h-3 w-3 text-emerald-400" />
                        <span className="text-xs font-mono text-emerald-400">
                          +{pct?.toFixed(1)}%
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
                            className="w-4 h-4 object-contain"
                          />
                        ) : null}
                        <span className="text-xs font-medium truncate max-w-[150px]">
                          {item.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <ArrowDownRight className="h-3 w-3 text-red-400" />
                        <span className="text-xs font-mono text-red-400">
                          {pct?.toFixed(1)}%
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
