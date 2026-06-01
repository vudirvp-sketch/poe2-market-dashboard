// ============================================================================
// Comparison Dialog — Overlay price histories of 2-4 items on one chart
// Normalizes all series to % change from first data point for fair comparison
// ============================================================================
"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { GitCompare, X, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { fmt, fetchApi } from "@/lib/types";
import type { PoeItem, PoeItemHistoryPoint } from "@/lib/types";
import { useDashboardStore } from "@/lib/store";
import { useI18n } from "@/lib/i18n";
import { DialogContentSkeleton } from "./skeletons";
import { useMemo } from "react";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

// Colors for up to 4 comparison lines
const COLORS = ["#8b5cf6", "#f59e0b", "#34d399", "#f87171"];
const COLOR_NAMES = ["Purple", "Amber", "Green", "Red"];

interface ComparisonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  realm: string;
  league: string;
  referenceCurrency?: string;
  allItems: PoeItem[] | undefined;
}

interface SeriesData {
  itemId: string;
  name: string;
  color: string;
  points: { timestamp: string; pctChange: number; rawPrice: number }[];
}

export function ComparisonDialog({
  open,
  onOpenChange,
  realm,
  league,
  referenceCurrency,
  allItems,
}: ComparisonDialogProps) {
  const { comparisonIds, removeFromComparison, clearComparison } =
    useDashboardStore();
  const { t } = useI18n();
  const reducedMotion = useReducedMotion();

  // Resolve item metadata from allItems
  const comparedItems = useMemo(() => {
    if (!allItems) return [];
    return comparisonIds
      .map((id) => allItems.find((i) => i.id === id))
      .filter((item): item is PoeItem => !!item);
  }, [comparisonIds, allItems]);

  // Fetch history for each compared item
  const histories = useQuery({
    queryKey: [
      "comparisonHistories",
      realm,
      league,
      comparisonIds,
      referenceCurrency,
    ],
    queryFn: async () => {
      const results = await Promise.all(
        comparisonIds.map(async (itemId) => {
          const data = await fetchApi<PoeItemHistoryPoint[]>(
            "/api/poe2/items",
            {
              realm,
              league,
              action: "history",
              itemId,
              logCount: "168",
              referenceCurrency: referenceCurrency || "",
            }
          );
          return { itemId, data };
        })
      );
      return results;
    },
    enabled: open && comparisonIds.length >= 2 && !!league,
    refetchOnWindowFocus: false,
  });

  // Build normalized chart data — merge all series into unified time buckets
  const { chartData, seriesMeta } = useMemo(() => {
    if (!histories.data || histories.data.length === 0)
      return { chartData: [], seriesMeta: [] as SeriesData[] };

    const series: SeriesData[] = histories.data.map((h, idx) => {
      const item = comparedItems.find((i) => i.id === h.itemId);
      const points = (h.data || []).map((p) => ({
        timestamp: p.timestamp,
        pctChange: 0,
        rawPrice: p.relativePrice ?? p.priceChaos ?? 0,
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
        itemId: h.itemId,
        name: item?.name || h.itemId,
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
          row[s.itemId] = closest.pctChange;
        }
      });
      return row;
    });

    return { chartData: merged, seriesMeta: series };
  }, [histories.data, comparedItems]);

  const isLoading = histories.isLoading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitCompare className="h-5 w-5 text-primary" />
            {t("itemComparison")}
          </DialogTitle>
        </DialogHeader>

        {/* Selected items chips */}
        <div className="flex flex-wrap gap-2 mt-2">
          {comparedItems.map((item, idx) => (
            <Badge
              key={item.id}
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
                {item.name}
              </span>
              <button
                onClick={() => removeFromComparison(item.id)}
                className="ml-1 hover:bg-muted rounded p-0.5"
                aria-label={t("removeFromComparison")}
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </Badge>
          ))}
          {comparisonIds.length < 2 && (
            <span className="text-xs text-muted-foreground">
              {t("selectAtLeast2Items")}
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs text-muted-foreground ml-auto"
            onClick={clearComparison}
            aria-label={t("clearAll")}
          >
            <Trash2 className="h-3 w-3 mr-1" aria-hidden="true" />
            {t("clearAll")}
          </Button>
        </div>

        {/* Chart */}
        {isLoading ? (
          <DialogContentSkeleton />
        ) : chartData.length > 1 && seriesMeta.length >= 2 ? (
          <div className="mt-4">
            <h4 className="text-sm font-medium mb-2">
              {t("priceChangeComparison")}
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
                      const meta = seriesMeta.find((s) => s.itemId === name);
                      const label = meta?.name || name;
                      return [`${value.toFixed(2)}%`, label];
                    }}
                  />
                  <Legend
                    formatter={(value: string) => {
                      const meta = seriesMeta.find((s) => s.itemId === value);
                      return meta?.name || value;
                    }}
                  />
                  {seriesMeta.map((s) => (
                    <Line
                      key={s.itemId}
                      type="monotone"
                      dataKey={s.itemId}
                      stroke={s.color}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4 }}
                      isAnimationActive={!reducedMotion}
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
                    <th className="py-2 px-3 text-left">{t("currentItem")}</th>
                    <th className="py-2 px-3 text-right">{t("currentPrice")}</th>
                    <th className="py-2 px-3 text-right">{t("startPrice")}</th>
                    <th className="py-2 px-3 text-right">{t("change")}</th>
                  </tr>
                </thead>
                <tbody>
                  {seriesMeta.map((s, idx) => {
                    const item = comparedItems.find(
                      (i) => i.id === s.itemId
                    );
                    const startPrice = s.points[0]?.rawPrice;
                    const endPrice =
                      s.points[s.points.length - 1]?.rawPrice;
                    const changePct =
                      startPrice && startPrice > 0
                        ? ((endPrice - startPrice) / startPrice) * 100
                        : null;
                    return (
                      <tr
                        key={s.itemId}
                        className="border-b border-border/50"
                      >
                        <td className="py-2 px-3 flex items-center gap-2">
                          <span
                            className="w-2.5 h-2.5 rounded-full inline-block"
                            style={{
                              backgroundColor: s.color,
                            }}
                          />
                          {item?.iconUrl ? (
                            <img
                              src={item.iconUrl}
                              alt=""
                              className="w-5 h-5 object-contain"
                            />
                          ) : null}
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
                                ? "text-emerald-500 dark:text-emerald-400"
                                : changePct < 0
                                ? "text-red-500 dark:text-red-400"
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
              {t("addItemsToCompare")}
            </p>
            <p className="text-xs mt-1">
              {t("needAtLeast2Items")}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
