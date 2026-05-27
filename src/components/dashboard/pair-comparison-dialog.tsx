// ============================================================================
// Pair Comparison Dialog — Overlay exchange pair histories of 2-4 pairs on one chart
// Normalizes all series to % change from first data point for fair comparison
// ============================================================================
"use client";

import { useQuery } from "@tanstack/react-query";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";
import { GitCompare, X, Loader2, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { fmt, fetchApi } from "@/lib/types";
import type { ExchangePairHistoryPoint } from "@/lib/types";
import { useDashboardStore } from "@/lib/store";
import type { PairComparisonId } from "@/lib/store";
import { useMemo } from "react";

// Colors for up to 4 comparison lines
const COLORS = ["#8b5cf6", "#f59e0b", "#34d399", "#f87171"];

interface PairComparisonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  realm: string;
  league: string;
}

interface PairSeriesData {
  pairKey: string;
  name: string;
  color: string;
  points: { timestamp: string; pctChange: number; rawPrice: number }[];
}

export function PairComparisonDialog({
  open,
  onOpenChange,
  realm,
  league,
}: PairComparisonDialogProps) {
  const { pairComparisonIds, removePairFromComparison, clearPairComparison } =
    useDashboardStore();

  // Fetch history for each compared pair
  const histories = useQuery({
    queryKey: [
      "pairComparisonHistories",
      realm,
      league,
      pairComparisonIds.map((p) => `${p.currency1Id}_${p.currency2Id}`).join(","),
    ],
    queryFn: async () => {
      const results = await Promise.all(
        pairComparisonIds.map(async (pair) => {
          const data = await fetchApi<ExchangePairHistoryPoint[]>(
            "/api/poe2/currencies",
            {
              realm,
              league,
              action: "pairHistory",
              id1: pair.currency1Id,
              id2: pair.currency2Id,
              limit: "168",
            }
          );
          const pairKey = `${pair.currency1Id}_${pair.currency2Id}`;
          return { pairKey, data, label: pair.label };
        })
      );
      return results;
    },
    enabled: open && pairComparisonIds.length >= 2 && !!league,
    refetchOnWindowFocus: false,
  });

  // Build normalized chart data — merge all series into unified time buckets
  const { chartData, seriesMeta } = useMemo(() => {
    if (!histories.data || histories.data.length === 0)
      return { chartData: [], seriesMeta: [] as PairSeriesData[] };

    const series: PairSeriesData[] = histories.data.map((h, idx) => {
      const points = (h.data || []).map((p) => ({
        timestamp: p.timestamp,
        pctChange: 0,
        rawPrice: p.relativePrice ?? 0,
      }));

      // Normalize to % change from first data point
      if (points.length > 0) {
        const base = points[0].rawPrice;
        if (base > 0) {
          points.forEach((p) => {
            p.pctChange = ((p.rawPrice - base) / base) * 100;
          });
        }
      }

      return {
        pairKey: h.pairKey,
        name: h.label || h.pairKey,
        color: COLORS[idx % COLORS.length],
        points,
      };
    });

    // Collect all unique timestamps
    const timestampSet = new Set<string>();
    series.forEach((s) => s.points.forEach((p) => timestampSet.add(p.timestamp)));
    const timestamps = [...timestampSet].sort();

    // Build merged chart data with nearest-value interpolation
    const merged = timestamps.map((ts) => {
      const row: Record<string, number | string> = { timestamp: ts };
      series.forEach((s) => {
        // Find the closest point to this timestamp
        const closest = s.points.reduce((prev, curr) =>
          Math.abs(new Date(curr.timestamp).getTime() - new Date(ts).getTime()) <
          Math.abs(new Date(prev.timestamp).getTime() - new Date(ts).getTime())
            ? curr
            : prev
        );
        // Only include if within 2 hours
        const diffHrs =
          Math.abs(
            new Date(closest.timestamp).getTime() - new Date(ts).getTime()
          ) /
          (1000 * 60 * 60);
        if (diffHrs < 2) {
          row[s.pairKey] = closest.pctChange;
        }
      });
      return row;
    });

    return { chartData: merged, seriesMeta: series };
  }, [histories.data]);

  const isLoading = histories.isLoading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitCompare className="h-5 w-5 text-primary" />
            Exchange Pair Comparison
          </DialogTitle>
        </DialogHeader>

        {/* Selected pairs chips */}
        <div className="flex flex-wrap gap-2 mt-2">
          {pairComparisonIds.map((pair, idx) => {
            const pairKey = `${pair.currency1Id}_${pair.currency2Id}`;
            return (
              <Badge
                key={pairKey}
                variant="outline"
                className="flex items-center gap-1.5 pr-1"
                style={{
                  borderColor: COLORS[idx % COLORS.length],
                  color: COLORS[idx % COLORS.length],
                }}
              >
                <span className="flex items-center gap-1">
                  <span
                    className="w-2.5 h-2.5 rounded-full inline-block"
                    style={{ backgroundColor: COLORS[idx % COLORS.length] }}
                  />
                  {pair.label}
                </span>
                <button
                  onClick={() => removePairFromComparison(pairKey)}
                  className="ml-1 hover:bg-muted rounded p-0.5"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            );
          })}
          {pairComparisonIds.length < 2 && (
            <span className="text-xs text-muted-foreground">
              Select at least 2 pairs to compare
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs text-muted-foreground ml-auto"
            onClick={clearPairComparison}
          >
            <Trash2 className="h-3 w-3 mr-1" />
            Clear all
          </Button>
        </div>

        {/* Chart */}
        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">
              Loading comparison data...
            </span>
          </div>
        ) : chartData.length > 1 && seriesMeta.length >= 2 ? (
          <div className="mt-4">
            <h4 className="text-sm font-medium mb-2">
              Price Change Comparison (% from start)
            </h4>
            <div className="h-[350px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
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
                    tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                    labelFormatter={(v: string) => new Date(v).toLocaleString()}
                    formatter={(value: number, name: string) => {
                      const meta = seriesMeta.find((s) => s.pairKey === name);
                      const label = meta?.name || name;
                      return [`${value.toFixed(2)}%`, label];
                    }}
                  />
                  <Legend
                    formatter={(value: string) => {
                      const meta = seriesMeta.find((s) => s.pairKey === value);
                      return meta?.name || value;
                    }}
                  />
                  {seriesMeta.map((s) => (
                    <Line
                      key={s.pairKey}
                      type="monotone"
                      dataKey={s.pairKey}
                      stroke={s.color}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Summary table */}
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="py-2 px-3 text-left">Pair</th>
                    <th className="py-2 px-3 text-right">Current Price</th>
                    <th className="py-2 px-3 text-right">Start Price</th>
                    <th className="py-2 px-3 text-right">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {seriesMeta.map((s) => {
                    const startPrice = s.points[0]?.rawPrice;
                    const endPrice =
                      s.points[s.points.length - 1]?.rawPrice;
                    const changePct =
                      startPrice && startPrice > 0
                        ? ((endPrice - startPrice) / startPrice) * 100
                        : null;
                    return (
                      <tr
                        key={s.pairKey}
                        className="border-b border-border/50"
                      >
                        <td className="py-2 px-3 flex items-center gap-2">
                          <span
                            className="w-2.5 h-2.5 rounded-full inline-block"
                            style={{
                              backgroundColor: s.color,
                            }}
                          />
                          <span className="font-medium">{s.name}</span>
                        </td>
                        <td className="py-2 px-3 text-right font-mono">
                          {fmt(endPrice)}
                        </td>
                        <td className="py-2 px-3 text-right font-mono">
                          {fmt(startPrice)}
                        </td>
                        <td
                          className={`py-2 px-3 text-right font-mono ${
                            changePct != null
                              ? changePct > 0
                                ? "text-emerald-400"
                                : changePct < 0
                                ? "text-red-400"
                                : ""
                              : ""
                          }`}
                        >
                          {changePct != null
                            ? `${changePct > 0 ? "+" : ""}${changePct.toFixed(
                                2
                              )}%`
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
            <GitCompare className="h-10 w-10 mb-3" />
            <p className="text-sm">
              Add exchange pairs to comparison from the Exchange Pairs tab
            </p>
            <p className="text-xs mt-1">
              You need at least 2 pairs with history data
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
