// ============================================================================
// Comparative Chart — P3-3: Comparative Analytics
//
// Normalizes multiple currencies to % change from a reference point and
// overlays them on a single chart. Also renders a correlation heatmap
// from portfolio backend data when available.
//
// P3-3 update: Replaced HTML <table> correlation display with a visual
// SVG heatmap featuring gradient colors, cell hover tooltips, and a
// continuous color scale (red ← gray → green).
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

/**
 * P3-3: Continuous color mapping for correlation value.
 * Uses a smooth gradient: red (-1) → gray (0) → green (+1)
 * Returns an HSL color string for use in SVG/CSS.
 */
function correlationToColor(value: number): string {
  // Clamp to [-1, 1]
  const v = Math.max(-1, Math.min(1, value));
  if (v > 0) {
    // Positive: interpolate from neutral gray (hsl(0,0%,85%)) to green (hsl(142,71%,45%))
    // Using a blend approach for smoothness
    const t = v; // 0..1
    const h = 142 * t;
    const s = 10 + 61 * t; // 10% → 71%
    const l = 85 - 40 * t;  // 85% → 45%
    return `hsl(${h}, ${s}%, ${l}%)`;
  } else {
    // Negative: interpolate from neutral gray (hsl(0,0%,85%)) to red (hsl(0,84%,60%))
    const t = -v; // 0..1
    const h = 0;
    const s = 10 + 74 * t; // 10% → 84%
    const l = 85 - 25 * t;  // 85% → 60%
    return `hsl(${h}, ${s}%, ${l}%)`;
  }
}

/** P3-3: Text color for readability on the heatmap cell background */
function correlationTextColor(value: number): string {
  const v = Math.abs(value);
  // Dark text for light backgrounds (low correlation), white text for dark (high correlation)
  if (v > 0.6) return "#ffffff";
  if (v > 0.3) return "#1f2937";
  return "#6b7280";
}

/** P3-3: Backend correlation matrix response shape */
interface BackendCorrelationResponse {
  currencies: string[];
  matrix: number[][];
  dataAvailable: boolean;
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
  const [hoveredCell, setHoveredCell] = useState<{row: number; col: number} | null>(null);

  // P3-3: Fetch backend correlation matrix (Step 3 — primary source)
  const { data: backendCorrelation } = useQuery<BackendCorrelationResponse>({
    queryKey: ["portfolioCorrelation"],
    queryFn: () => fetchApi<BackendCorrelationResponse>("/api/flipper/portfolio/correlation"),
    staleTime: 120_000,
    retry: 0,
  });

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
      const rawPrices = (h.data || []).map((p) => p.relativePrice ?? p.chaosEquivalentRate ?? 0);
      const pctChanges = normalizeToPercentChange(rawPrices);

      const points = (h.data || []).map((p, i) => ({
        timestamp: p.timestamp,
        pctChange: pctChanges[i] ?? 0,
        rawPrice: p.relativePrice ?? p.chaosEquivalentRate ?? 0,
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
  // Priority: backend correlation matrix > client-side computation
  const correlationMatrix = useMemo(() => {
    if (seriesMeta.length < 2) return null;

    // P3-3 Step 3: Try to use backend correlation matrix
    if (backendCorrelation?.dataAvailable && backendCorrelation.currencies.length >= 2) {
      // Map compared item apiIds to backend currency names
      const comparedApiIds = comparedItems.map((item) => item.apiId?.toLowerCase());
      const backendCurrencies = backendCorrelation.currencies.map((c) => c.toLowerCase());

      // BUG FIX (2026-06-04): Track which items have no correlation data
      // (e.g. uniques whose apiId is a numeric ItemId, not a currency api_id
      // like "divine", "chaos"). The backend correlation matrix only covers
      // currency exchange items, not unique items.
      const itemsWithoutCorrelation: string[] = [];

      // Find indices of compared currencies in the backend matrix
      const indices: number[] = [];
      const names: string[] = [];
      for (const item of comparedItems) {
        const idx = backendCurrencies.indexOf(item.apiId?.toLowerCase() ?? "");
        if (idx >= 0) {
          indices.push(idx);
          names.push(item.name);
        } else {
          itemsWithoutCorrelation.push(item.name);
        }
      }

      if (indices.length >= 2) {
        // Extract sub-matrix for compared currencies only
        const subMatrix: number[][] = [];
        for (const rowIdx of indices) {
          const row: number[] = [];
          for (const colIdx of indices) {
            row.push(backendCorrelation.matrix[rowIdx]?.[colIdx] ?? 0);
          }
          subMatrix.push(row);
        }
        return {
          names,
          matrix: subMatrix,
          source: "backend" as const,
          itemsWithoutCorrelation: itemsWithoutCorrelation.length > 0 ? itemsWithoutCorrelation : undefined,
        };
      }
    }

    // Fallback: client-side computation from % change data
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

    return { names, matrix, source: "client" as const };
  }, [seriesMeta, backendCorrelation, comparedItems]);

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

            {/* P3-3: Correlation Heatmap — SVG-based visual heatmap */}
            {showCorrelation && correlationMatrix && (
              <div className="mt-4">
                <h4 className="text-sm font-medium mb-2 flex items-center gap-1.5">
                  <Grid3X3 className="h-4 w-4" aria-hidden="true" />
                  {t("comparativeCorrelationMatrix")}
                </h4>
                <p className="text-[10px] text-muted-foreground mb-2">
                  {t("comparativeCorrelationNote")}
                  {"source" in correlationMatrix && correlationMatrix.source === "backend" && (
                    <span className="ml-1 text-emerald-500">({t("comparativeCorrelationBackend")})</span>
                  )}
                </p>
                {/* BUG FIX (2026-06-04): Show "no correlation data" warning for items
                    not in the backend correlation matrix (e.g. uniques). These items
                    use numeric ItemIds as apiId which don't match the currency exchange
                    api_ids like "divine", "chaos" used by the backend. */}
                {"itemsWithoutCorrelation" in correlationMatrix && correlationMatrix.itemsWithoutCorrelation && (
                  <div className="mb-2 px-2 py-1.5 rounded-md bg-amber-500/10 border border-amber-500/20 text-[10px] text-amber-600 dark:text-amber-400">
                    <span className="font-medium">⚠</span>{" "}
                    {t("comparativeNoCorrelation") || "No correlation data available for:"}{" "}
                    {correlationMatrix.itemsWithoutCorrelation.join(", ")}
                    {" "}
                    ({t("comparativeNotInExchange") || "not traded on currency exchange"})
                  </div>
                )}
                <CorrelationHeatmap
                  names={correlationMatrix.names}
                  matrix={correlationMatrix.matrix}
                  hoveredCell={hoveredCell}
                  onHoverCell={setHoveredCell}
                />
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
                            : "\u2014"}
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

// ============================================================================
// P3-3: SVG-based Correlation Heatmap Component
//
// Replaces the old HTML <table> with a visual heatmap featuring:
//   - Continuous gradient coloring (red ← gray → green)
//   - Cell hover highlighting with tooltip-style value display
//   - Diagonal cells styled as self-correlation (always 1.00)
//   - Responsive sizing that adapts to the number of compared items
// ============================================================================

interface CorrelationHeatmapProps {
  names: string[];
  matrix: number[][];
  hoveredCell: { row: number; col: number } | null;
  onHoverCell: (cell: { row: number; col: number } | null) => void;
}

function CorrelationHeatmap({ names, matrix, hoveredCell, onHoverCell }: CorrelationHeatmapProps) {
  const n = names.length;
  if (n < 2) return null;

  // Sizing constants
  const labelWidth = 80;  // Width for row labels on the left
  const headerHeight = 60; // Height for column labels on top (rotated text)
  const cellSize = Math.min(50, Math.max(30, 240 / n)); // Adaptive cell size
  const totalWidth = labelWidth + n * cellSize;
  const totalHeight = headerHeight + n * cellSize;

  // Hovered cell info for the tooltip overlay
  const hoveredValue = hoveredCell !== null
    ? matrix[hoveredCell.row]?.[hoveredCell.col]
    : null;
  const hoveredRowName = hoveredCell !== null ? names[hoveredCell.row] : null;
  const hoveredColName = hoveredCell !== null ? names[hoveredCell.col] : null;

  return (
    <div className="overflow-x-auto">
      <svg
        width={totalWidth}
        height={totalHeight}
        viewBox={`0 0 ${totalWidth} ${totalHeight}`}
        className="w-full max-w-[600px]"
      >
        {/* Column headers (rotated -45deg) */}
        {names.map((name, j) => {
          const x = labelWidth + j * cellSize + cellSize / 2;
          const y = headerHeight - 4;
          const displayName = name.length > 10 ? name.slice(0, 9) + "\u2026" : name;
          return (
            <g key={`col-${j}`}>
              <title>{name}</title>
              <text
                x={x}
                y={y}
                transform={`rotate(-45, ${x}, ${y})`}
                textAnchor="start"
                fontSize={9}
                fill="currentColor"
                className="text-muted-foreground"
              >
                {displayName}
              </text>
            </g>
          );
        })}

        {/* Row labels */}
        {names.map((name, i) => {
          const y = headerHeight + i * cellSize + cellSize / 2;
          const displayName = name.length > 10 ? name.slice(0, 9) + "\u2026" : name;
          return (
            <g key={`row-${i}`}>
              <title>{name}</title>
              <text
                x={labelWidth - 6}
                y={y + 3}
                textAnchor="end"
                fontSize={9}
                fill="currentColor"
                className="text-muted-foreground"
              >
                {displayName}
              </text>
            </g>
          );
        })}

        {/* Heatmap cells */}
        {matrix.map((row, i) =>
          row.map((val, j) => {
            const x = labelWidth + j * cellSize;
            const y = headerHeight + i * cellSize;
            const isDiagonal = i === j;
            const isHovered = hoveredCell?.row === i && hoveredCell?.col === j;
            const isRowHovered = hoveredCell?.row === i || hoveredCell?.col === j;

            // Background color
            const bgColor = isDiagonal
              ? "hsl(220, 20%, 40%)" // Diagonal: dark slate blue
              : correlationToColor(val);

            // Border/outline for hovered cells
            const strokeColor = isHovered
              ? "#ffffff"
              : isRowHovered
              ? "rgba(255,255,255,0.3)"
              : "rgba(0,0,0,0.1)";
            const strokeWidth = isHovered ? 2 : 0.5;

            // Text color
            const textColor = isDiagonal
              ? "#ffffff"
              : correlationTextColor(val);

            // Display value
            const displayVal = isDiagonal ? "1.00" : val.toFixed(2);

            return (
              <g
                key={`cell-${i}-${j}`}
                onMouseEnter={() => onHoverCell({ row: i, col: j })}
                onMouseLeave={() => onHoverCell(null)}
                className="cursor-crosshair"
              >
                <title>{`${names[i]} vs ${names[j]}: ${isDiagonal ? "1.00" : val.toFixed(3)}`}</title>
                <rect
                  x={x + 0.5}
                  y={y + 0.5}
                  width={cellSize - 1}
                  height={cellSize - 1}
                  rx={3}
                  ry={3}
                  fill={bgColor}
                  stroke={strokeColor}
                  strokeWidth={strokeWidth}
                  opacity={isHovered ? 1 : isRowHovered ? 0.95 : 0.85}
                  style={{ transition: "opacity 0.15s, stroke 0.15s" }}
                />
                <text
                  x={x + cellSize / 2}
                  y={y + cellSize / 2 + 3.5}
                  textAnchor="middle"
                  fontSize={cellSize < 35 ? 8 : 10}
                  fontWeight={isDiagonal ? "bold" : "normal"}
                  fontFamily="monospace"
                  fill={textColor}
                >
                  {displayVal}
                </text>
              </g>
            );
          })
        )}

        {/* Color scale legend at the bottom of the SVG */}
        <defs>
          <linearGradient id="corrGradient" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={correlationToColor(-1)} />
            <stop offset="50%" stopColor={correlationToColor(0)} />
            <stop offset="100%" stopColor={correlationToColor(1)} />
          </linearGradient>
        </defs>
      </svg>

      {/* Color scale legend below SVG */}
      <div className="mt-2 flex items-center gap-2 max-w-[600px]">
        <span className="text-[9px] text-red-500 font-medium">-1.0</span>
        <div
          className="flex-1 h-3 rounded-sm"
          style={{ background: "linear-gradient(to right, " + correlationToColor(-1) + ", " + correlationToColor(0) + ", " + correlationToColor(1) + ")" }}
        />
        <span className="text-[9px] text-emerald-500 font-medium">+1.0</span>
      </div>

      {/* Hover tooltip — shows the exact correlation for the hovered pair */}
      {hoveredCell !== null && hoveredValue !== null && hoveredRowName && hoveredColName && (
        <div className="mt-1 text-[10px] text-muted-foreground font-mono">
          <span className="font-medium">{hoveredRowName}</span>
          {" vs "}
          <span className="font-medium">{hoveredColName}</span>
          {": "}
          <span
            className="font-bold"
            style={{ color: hoveredCell.row === hoveredCell.col ? "hsl(220, 20%, 60%)" : correlationToColor(hoveredValue) }}
          >
            {hoveredCell.row === hoveredCell.col ? "1.000" : hoveredValue.toFixed(3)}
          </span>
        </div>
      )}
    </div>
  );
}
