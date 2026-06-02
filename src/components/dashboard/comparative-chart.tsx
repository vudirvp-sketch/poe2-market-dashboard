// ============================================================================
// Comparative Chart — P3-3: Comparative Analytics
//
// Normalizes multiple currencies to % change from a reference point and
// overlays them on a single chart. Also renders a correlation heatmap
// from portfolio backend data when available.
// ============================================================================
"use client";

import { useMemo, memo, useState } from "react";
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
import {
  GitCompare,
  X,
  Trash2,
  Grid3X3,
  Table2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { fmt, fetchApi } from "@/lib/types";
import type { PoeItem, PoeItemHistoryPoint } from "@/lib/types";
import { useDashboardStore } from "@/lib/store";
import { useI18n } from "@/lib/i18n";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

// Colors for up to 6 comparison lines
const COLORS = ["#8b5cf6", "#f59e0b", "#34d399", "#f87171", "#06b6d4", "#ec4899"];

interface SeriesData {
  itemId: string;
  name: string;
  color: string;
  points: { timestamp: string; pctChange: number; rawPrice: number }[];
}

interface ComparativeChartProps {
  open?: boolean;
  realm?: string;
  league?: string;
  referenceCurrency?: string;
  allItems?: PoeItem[];
}

/** P3-3: Normalize prices to % change from base index */
function normalizeToPercentChange(prices: number[], baseIndex: number = 0): number[] {
  if (prices.length === 0) return [];
  const basePrice = prices[baseIndex];
  if (basePrice === 0) return prices.map(() => 0);
  return prices.map((p) => ((p - basePrice) / basePrice) * 100);
}

/** P3-3: Compute pairwise Pearson correlation from aligned time series */
function computeCorrelation(
  seriesA: number[],
  seriesB: number[],
): number {
  const n = Math.min(seriesA.length, seriesB.length);
  if (n < 3) return 0;

  const a = seriesA.slice(0, n);
  const b = seriesB.slice(0, n);

  const meanA = a.reduce((s, v) => s + v, 0) / n;
  const meanB = b.reduce((s, v) => s + v, 0) / n;

  let covAB = 0;
  let varA = 0;
  let varB = 0;

  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    covAB += da * db;
    varA += da * da;
    varB += db * db;
  }

  if (varA === 0 || varB === 0) return 0;
  return covAB / Math.sqrt(varA * varB);
}

/** P3-3: Color for correlation value in heatmap */
function correlationColor(value: number): string {
  if (value > 0.7) return "rgba(34, 197, 94, 0.5)";      // strong positive — green
  if (value > 0.3) return "rgba(34, 197, 94, 0.25)";     // moderate positive
  if (value > -0.3) return "rgba(128, 128, 128, 0.1)";   // uncorrelated — gray
  if (value > -0.7) return "rgba(239, 68, 68, 0.25)";    // moderate negative
  return "rgba(239, 68, 68, 0.5)";                         // strong negative — red
}

export const ComparativeChart = memo(function ComparativeChart({
  realm,
  league,
  referenceCurrency,
  allItems,
}: ComparativeChartProps) {
  const { comparisonIds, removeFromComparison, clearComparison } =
    useDashboardStore();
  const { t } = useI18n();
  const reducedMotion = useReducedMotion();
  const [showCorrelation, setShowCorrelation] = useState(false);

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
              realm: realm ?? "",
              league: league ?? "",
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
    enabled: comparisonIds.length >= 2 && !!league,
    refetchOnWindowFocus: false,
  });

  // Build normalized chart data
  const { chartData, seriesMeta } = useMemo(() => {
    if (!histories.data || histories.data.length === 0)
      return { chartData: [], seriesMeta: [] as SeriesData[] };

    const series: SeriesData[] = histories.data.map((h, idx) => {
      const item = comparedItems.find((i) => i.id === h.itemId);
      const rawPrices = (h.data || []).map((p) => p.relativePrice ?? p.priceChaos ?? 0);
      const pctChanges = normalizeToPercentChange(rawPrices);

      const points = (h.data || []).map((p, i) => ({
        timestamp: p.timestamp,
        pctChange: pctChanges[i] ?? 0,
        rawPrice: p.relativePrice ?? p.priceChaos ?? 0,
      }));

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
        const closest = s.points.reduce((prev, curr) =>
          Math.abs(new Date(curr.timestamp).getTime() - new Date(ts).getTime()) <
          Math.abs(new Date(prev.timestamp).getTime() - new Date(ts).getTime())
            ? curr
            : prev
        );
        const diffHrs =
          Math.abs(new Date(closest.timestamp).getTime() - new Date(ts).getTime()) /
          (1000 * 60 * 60);
        if (diffHrs < 2) {
          row[s.itemId] = closest.pctChange;
        }
      });
      return row;
    });

    return { chartData: merged, seriesMeta: series };
  }, [histories.data, comparedItems]);

  // P3-3: Compute correlation matrix from aligned series data
  const correlationMatrix = useMemo(() => {
    if (seriesMeta.length < 2) return null;

    // Align time series for correlation
    const alignedSeries: { name: string; values: number[] }[] = seriesMeta.map((s) => ({
      name: s.name,
      values: s.points.map((p) => p.pctChange),
    }));

    // Truncate to same length
    const minLen = Math.min(...alignedSeries.map((s) => s.values.length));
    if (minLen < 3) return null;

    const names = alignedSeries.map((s) => s.name);
    const matrix: number[][] = [];

    for (let i = 0; i < alignedSeries.length; i++) {
      const row: number[] = [];
      for (let j = 0; j < alignedSeries.length; j++) {
        if (i === j) {
          row.push(1.0);
        } else {
          row.push(computeCorrelation(
            alignedSeries[i].values.slice(0, minLen),
            alignedSeries[j].values.slice(0, minLen),
          ));
        }
      }
      matrix.push(row);
    }

    return { names, matrix };
  }, [seriesMeta]);

  if (comparisonIds.length < 2) {
    return (
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
            <GitCompare className="h-4 w-4" aria-hidden="true" />
            {t("comparativeTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0">
          <div className="text-center py-6">
            <GitCompare className="h-8 w-8 text-muted-foreground mx-auto mb-2" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">{t("comparativeNoData")}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const isLoading = histories.isLoading;

  return (
    <Card>
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
            <GitCompare className="h-4 w-4" aria-hidden="true" />
            {t("comparativeTitle")}
          </CardTitle>
          {/* Toggle correlation matrix */}
          {correlationMatrix && (
            <Button
              variant={showCorrelation ? "default" : "outline"}
              size="sm"
              className="h-6 text-[10px] px-2"
              onClick={() => setShowCorrelation(!showCorrelation)}
            >
              <Grid3X3 className="h-3 w-3 mr-1" aria-hidden="true" />
              {t("comparativeCorrelationMatrix")}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0">
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
          <div className="flex items-center justify-center py-10">
            <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
          </div>
        ) : chartData.length > 1 && seriesMeta.length >= 2 ? (
          <div className="mt-4">
            <h4 className="text-sm font-medium mb-2">
              {t("priceChangeComparison")}
            </h4>
            <div className="h-[350px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
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

            {/* P3-3: Correlation Heatmap */}
            {showCorrelation && correlationMatrix && (
              <div className="mt-4">
                <h4 className="text-sm font-medium mb-2 flex items-center gap-1.5">
                  <Grid3X3 className="h-4 w-4" aria-hidden="true" />
                  {t("comparativeCorrelationMatrix")}
                </h4>
                <p className="text-[10px] text-muted-foreground mb-2">
                  {t("comparativeCorrelationNote")}
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr>
                        <th className="p-1.5 text-left text-muted-foreground" />
                        {correlationMatrix.names.map((name) => (
                          <th
                            key={name}
                            className="p-1.5 text-center font-medium text-muted-foreground truncate max-w-[80px]"
                            title={name}
                          >
                            {name.length > 8 ? name.slice(0, 7) + "…" : name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {correlationMatrix.names.map((rowName, i) => (
                        <tr key={rowName}>
                          <td
                            className="p-1.5 text-right font-medium text-muted-foreground truncate max-w-[80px]"
                            title={rowName}
                          >
                            {rowName.length > 8 ? rowName.slice(0, 7) + "…" : rowName}
                          </td>
                          {correlationMatrix.matrix[i].map((val, j) => (
                            <td
                              key={`${i}-${j}`}
                              className="p-1.5 text-center font-mono text-[10px] border border-border/30"
                              style={{ backgroundColor: correlationColor(val) }}
                            >
                              {i === j ? "1.00" : val.toFixed(2)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

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
                  {seriesMeta.map((s) => {
                    const item = comparedItems.find((i) => i.id === s.itemId);
                    const startPrice = s.points[0]?.rawPrice;
                    const endPrice = s.points[s.points.length - 1]?.rawPrice;
                    const changePct =
                      startPrice && startPrice > 0
                        ? ((endPrice - startPrice) / startPrice) * 100
                        : null;
                    return (
                      <tr key={s.itemId} className="border-b border-border/50">
                        <td className="py-2 px-3 flex items-center gap-2">
                          <span
                            className="w-2.5 h-2.5 rounded-full inline-block"
                            style={{ backgroundColor: s.color }}
                          />
                          {item?.iconUrl ? (
                            <img src={item.iconUrl} alt="" className="w-5 h-5 object-contain" />
                          ) : null}
                          <span className="font-medium">{s.name}</span>
                        </td>
                        <td className="py-2 px-3 text-right font-mono">{fmt(endPrice)}</td>
                        <td className="py-2 px-3 text-right font-mono">{fmt(startPrice)}</td>
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
                            ? `${changePct > 0 ? "+" : ""}${changePct.toFixed(2)}%`
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
            <p className="text-sm">{t("addItemsToCompare")}</p>
            <p className="text-xs mt-1">{t("needAtLeast2Items")}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
});
