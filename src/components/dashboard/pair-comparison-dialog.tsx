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
import type { ExchangePairHistoryPoint } from "@/lib/types";
import { useDashboardStore } from "@/lib/store";
import { useI18n } from "@/lib/i18n";
import { formatLocaleDate } from "@/lib/utils";
import { DialogContentSkeleton } from "./skeletons";
import type { PairComparisonId } from "@/lib/store";
import { useMemo } from "react";
// iter 148 (KI-34 fix): re-derive the pair label at render time using the
// current locale. Previously, `pair.label` was frozen at add-time (whatever
// locale the user was in when they clicked "Compare"), so switching locale
// didn't refresh the chip/legend/summary labels. Now we re-derive from
// `pair.currency1Id` / `pair.currency2Id` via `getCurrencyDisplayName` on
// every render, with the stored `label` as a fallback for unknown apiIds.
import { getCurrencyDisplayName } from "@/lib/currency-names";

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
  const { t, locale } = useI18n();

  // iter 148 (KI-34 fix): re-derive the pair label from the apiIds on every
  // render so it follows the active locale. The stored `pair.label` is used
  // as a fallback when `getCurrencyDisplayName` returns null for either
  // currency (e.g. an apiId that's not in our RU translation map).
  const liveLabel = (pair: PairComparisonId): string => {
    const c1 = getCurrencyDisplayName(pair.currency1Id, locale);
    const c2 = getCurrencyDisplayName(pair.currency2Id, locale);
    if (c1 && c2) return `${c1} / ${c2}`;
    return pair.label;
  };

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
              // Use numeric ItemIds — the CurrencyPairHistory API expects integers
              id1: String(pair.currency1ItemId),
              id2: String(pair.currency2ItemId),
              limit: "168",
            }
          );
          const pairKey = `${pair.currency1Id}_${pair.currency2Id}`;
          // iter 148 (KI-34 fix): store the PAIR object on the query result
          // so we can re-derive `liveLabel` at render time after locale changes.
          return { pairKey, data, pair };
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
        // iter 148 (KI-34 fix): re-derive the label from the stored pair +
        // current locale. Previously this used `h.label` which was frozen at
        // add-time, causing the dialog to show stale labels when the user
        // switched locale after adding pairs to comparison.
        name: h.pair ? liveLabel(h.pair) : h.pairKey,
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
    // iter 148: `liveLabel` reads `locale` (closure); add it to deps so the
    // seriesMeta names refresh when the user switches locale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [histories.data, locale]);

  const isLoading = histories.isLoading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitCompare className="h-5 w-5 text-primary" />
            {t("exchangePairComparison")}
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
                  {/* iter 148 (KI-34 fix): chip label is re-derived on every
                      render so it follows the active locale. Previously this
                      rendered `pair.label` which was frozen at add-time. */}
                  {liveLabel(pair)}
                </span>
                <button
                  onClick={() => removePairFromComparison(pairKey)}
                  className="ml-1 hover:bg-muted rounded p-0.5"
                  aria-label={t("removeFromComparison")}
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </Badge>
            );
          })}
          {pairComparisonIds.length < 2 && (
            <span className="text-xs text-muted-foreground">
              {t("selectAtLeast2Pairs")}
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs text-muted-foreground ml-auto"
            onClick={clearPairComparison}
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
                      formatLocaleDate(v, locale)
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
                    <th className="py-2 px-3 text-left">{t("pair")}</th>
                    <th className="py-2 px-3 text-right">{t("currentPrice")}</th>
                    <th className="py-2 px-3 text-right">{t("startPrice")}</th>
                    <th className="py-2 px-3 text-right">{t("change")}</th>
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
              {t("addPairsToCompare")}
            </p>
            <p className="text-xs mt-1">
              {t("needAtLeast2Pairs")}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
