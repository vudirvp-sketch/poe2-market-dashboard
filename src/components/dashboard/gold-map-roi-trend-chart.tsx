// ============================================================================
// Gold Map ROI Trend Chart (P10 Phase 2, iter 132)
//
// SVG line chart showing the historical profitability (raw_profit_pct) of the
// best 3-way triangular cycle ending in Div over time. Consumes the
// /api/flipper/triangular/history endpoint (TD-3 Phase 3 persistence, iter 129).
//
// WHY raw_profit_pct (not computed expected_div)?
//   - expected_div depends on user inputs (gold_amount, map_cost, gold_per_div)
//     that don't have historical persistence — those are localStorage values
//     for "now", not a time-series.
//   - The historical signal we DO have is the cycle's raw_profit_pct — i.e.
//     "how profitable was the best 3-way chain at this timestamp?" This is
//     the input that drives the live calculator's `multiplier` field.
//   - The user can mentally map "higher line = better ROI window" without
//     us pretending to know their historical gold_per_div rate.
//
// Chart structure:
//   - X-axis: timestamp (5-min-bucket snapshots, up to `days` days back)
//   - Y-axis: raw_profit_pct (positive = profitable cycle)
//   - Single line: best (highest raw_profit_pct) cycle per timestamp
//   - Zero line: dashed horizontal at y=0 (above = profit, below = no profit)
//
// WHY single line (not one per cycle_key)?
//   - The triangular_cycles table persists ALL profitable cycles per snapshot
//     (often 5-20 per snapshot). Plotting all would be visual noise.
//   - For ROI trend, what matters is "the best opportunity at each moment",
//     so we pick the highest raw_profit_pct per timestamp.
//
// Refs:
//   - docs/design/P10-gold-map-roi-design.md §7 (UI layout) + §12 Phase 2
//   - docs/design/TD-3-4-5-9-persistence-gaps-design.md §4 (triangular_cycles schema)
//   - src/components/dashboard/storage-value-history-chart.tsx (SVG chart template)
// ============================================================================

"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp, Info, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/lib/i18n";
import { fetchApi, type TriangularCyclesHistoryResponse } from "@/lib/types";
import { formatLocaleDate } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_HEIGHT = 220;
const WIDTH = 760; // viewBox width — scales via CSS
const PADDING = { top: 16, right: 16, bottom: 28, left: 56 };

/** Allowed values for the Days selector. Matches the TD-3 route's `days`
 *  query param constraints (ge=1, le=90). */
const DAYS_OPTIONS = [1, 7, 14, 30, 90] as const;
type DaysOption = (typeof DAYS_OPTIONS)[number];
const DEFAULT_DAYS: DaysOption = 7;

// ---------------------------------------------------------------------------
// Pure helpers — exported for unit tests
// ---------------------------------------------------------------------------

export interface TrendPoint {
  /** Epoch ms (parsed from ISO timestamp). */
  timestamp: number;
  /** raw_profit_pct (null when missing/invalid — gap in the line). */
  rawProfitPct: number | null;
  /** Cycle_key (for tooltip / debugging). */
  cycleKey: string;
}

/**
 * Deduplicate persisted rows to one point per timestamp, keeping the highest
 * raw_profit_pct. Rows with null raw_profit_pct are kept (as gaps) only when
 * no other row exists for that timestamp — this preserves "no profitable
 * cycle detected" snapshots vs "no data".
 */
export function pickBestPerTimestamp(
  points: TriangularCyclesHistoryResponse["points"],
): TrendPoint[] {
  if (!points || points.length === 0) return [];
  const byTs = new Map<number, TrendPoint>();
  for (const p of points) {
    const ts = new Date(p.timestamp).getTime();
    if (!Number.isFinite(ts)) continue;
    const profit = p.rawProfitPct;
    const existing = byTs.get(ts);
    if (!existing) {
      byTs.set(ts, {
        timestamp: ts,
        rawProfitPct: Number.isFinite(profit as number) ? (profit as number) : null,
        cycleKey: p.cycleKey,
      });
      continue;
    }
    // Keep the higher profit (prefer non-null over null).
    if (
      existing.rawProfitPct === null &&
      Number.isFinite(profit as number)
    ) {
      byTs.set(ts, {
        timestamp: ts,
        rawProfitPct: profit as number,
        cycleKey: p.cycleKey,
      });
    } else if (
      existing.rawProfitPct !== null &&
      Number.isFinite(profit as number) &&
      (profit as number) > existing.rawProfitPct
    ) {
      byTs.set(ts, {
        timestamp: ts,
        rawProfitPct: profit as number,
        cycleKey: p.cycleKey,
      });
    }
  }
  // Sort ascending by timestamp (oldest first for line drawing).
  return Array.from(byTs.values()).sort((a, b) => a.timestamp - b.timestamp);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface GoldMapRoiTrendChartProps {
  /** Whether the FastAPI analytics backend is reachable. When false, the chart
   *  is replaced with an offline notice (no fetch is attempted). */
  backendOnline: boolean;
  /** Optional initial `days` value (defaults to 7). Caller can pass a value
   *  derived from URL search params if needed. */
  initialDays?: DaysOption;
}

export function GoldMapRoiTrendChart({
  backendOnline,
  initialDays = DEFAULT_DAYS,
}: GoldMapRoiTrendChartProps) {
  const { t, locale } = useI18n();
  const [days, setDays] = useState<DaysOption>(initialDays);

  const { data, isLoading, isError } = useQuery<TriangularCyclesHistoryResponse>({
    queryKey: ["gold-map-roi-trend", days],
    queryFn: () =>
      fetchApi<TriangularCyclesHistoryResponse>("/api/flipper/triangular/history", {
        days: String(days),
      }),
    enabled: backendOnline,
    staleTime: 60_000, // 1 min — history changes slowly (5-min-bucket writes)
    retry: 1,
  });

  // Stable `points` reference — `data?.points ?? []` would otherwise create a
  // new array on every render (when data is undefined), polluting downstream
  // useMemo deps. react-query already gives us a stable `data` reference via
  // structural sharing, so this memo only recomputes when data actually changes.
  const points = useMemo(() => data?.points ?? [], [data]);
  const dataAvailable = data?.dataAvailable ?? false;
  const trendPoints = useMemo(() => pickBestPerTimestamp(points), [points]);

  // ---- Geometry (SVG path + axes) ----
  const geometry = useMemo(() => {
    if (trendPoints.length < 2) return null;

    const tsMin = trendPoints[0].timestamp;
    const tsMax = trendPoints[trendPoints.length - 1].timestamp;
    const tRange = tsMax - tsMin || 1;

    const allProfits = trendPoints
      .map((p) => p.rawProfitPct)
      .filter((r): r is number => r != null && Number.isFinite(r));
    if (allProfits.length === 0) return null;

    let pMin = Math.min(...allProfits);
    let pMax = Math.max(...allProfits);
    // Always include 0 in the Y range so the zero line is visible.
    pMin = Math.min(pMin, 0);
    pMax = Math.max(pMax, 0);
    const pRange = pMax - pMin || pMax * 0.1 || 1;
    // Pad Y range a bit so the lines don't touch the edges.
    const pPad = pRange * 0.1;
    const yMin = pMin - pPad;
    const yMax = pMax + pPad;
    const yRange = yMax - yMin || 1;

    const innerW = WIDTH - PADDING.left - PADDING.right;
    const innerH = DEFAULT_HEIGHT - PADDING.top - PADDING.bottom;

    const xFor = (ts: number) => PADDING.left + ((ts - tsMin) / tRange) * innerW;
    const yFor = (r: number) => PADDING.top + (1 - (r - yMin) / yRange) * innerH;

    // Build SVG path string — null profits create gaps via "M" (move) commands.
    let path = "";
    let penDown = false;
    for (const p of trendPoints) {
      const r = p.rawProfitPct;
      if (r == null || !Number.isFinite(r)) {
        penDown = false;
        continue;
      }
      const x = xFor(p.timestamp);
      const y = yFor(r);
      path += `${penDown ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)} `;
      penDown = true;
    }
    path = path.trim();

    // Y-axis ticks: 4 evenly spaced values (includes 0 when in range).
    const yTicks = Array.from({ length: 5 }, (_, i) => yMin + (i / 4) * yRange);

    // X-axis ticks: up to 5 evenly spaced timestamps.
    const xTickCount = Math.min(5, trendPoints.length);
    const xTicks = Array.from({ length: xTickCount }, (_, i) => {
      const ts = tsMin + (i / (xTickCount - 1 || 1)) * tRange;
      return { ts, x: xFor(ts) };
    });

    // Zero line Y position.
    const zeroY = yFor(0);

    return { path, xTicks, yTicks, yMin, yMax, zeroY, innerW, innerH };
  }, [trendPoints]);

  // ---- Render: backend offline ----
  if (!backendOnline) {
    return (
      <Card data-testid="gold-map-roi-trend-chart">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-5 w-5 text-violet-500" aria-hidden="true" />
            {t("goldMapTrendTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground pt-0">
          {t("goldMapTrendOffline")}
        </CardContent>
      </Card>
    );
  }

  // ---- Render: error ----
  if (isError) {
    return (
      <Card data-testid="gold-map-roi-trend-chart" className="border-red-500/30">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-5 w-5 text-red-500" aria-hidden="true" />
            {t("goldMapTrendTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground pt-0">
          {t("goldMapTrendError")}
        </CardContent>
      </Card>
    );
  }

  // ---- Render: loading ----
  if (isLoading) {
    return (
      <Card data-testid="gold-map-roi-trend-chart">
        <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-5 w-5 text-violet-500" aria-hidden="true" />
            {t("goldMapTrendTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground pt-0">
          {t("goldMapTrendLoading")}
        </CardContent>
      </Card>
    );
  }

  // ---- Render: no data ----
  if (!dataAvailable || trendPoints.length < 2 || !geometry) {
    return (
      <Card data-testid="gold-map-roi-trend-chart">
        <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-5 w-5 text-violet-500" aria-hidden="true" />
            {t("goldMapTrendTitle")}
          </CardTitle>
          <DaysSelector days={days} onDaysChange={setDays} />
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground pt-0 flex items-start gap-2">
          <Info className="h-4 w-4 mt-0.5 shrink-0 text-sky-500" aria-hidden="true" />
          <span>{t("goldMapTrendEmpty")}</span>
        </CardContent>
      </Card>
    );
  }

  // ---- Render: chart ----
  const fmtDate = (ts: number) => formatLocaleDate(ts, locale);
  const fmtPct = (r: number) => {
    if (!Number.isFinite(r)) return "—";
    return `${r > 0 ? "+" : ""}${r.toFixed(2)}%`;
  };

  return (
    <Card data-testid="gold-map-roi-trend-chart">
      <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
        <div className="flex flex-col gap-0.5">
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-5 w-5 text-violet-500" aria-hidden="true" />
            {t("goldMapTrendTitle")}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            {t("goldMapTrendSubtitle", { 0: days })}
          </p>
        </div>
        <DaysSelector days={days} onDaysChange={setDays} />
      </CardHeader>
      <CardContent>
        <svg
          viewBox={`0 0 ${WIDTH} ${DEFAULT_HEIGHT}`}
          width="100%"
          height={DEFAULT_HEIGHT}
          role="img"
          aria-label={t("goldMapTrendTitle")}
          className="overflow-visible"
          data-testid="gold-map-roi-trend-chart-svg"
        >
          {/* Y-axis grid lines + labels */}
          {geometry.yTicks.map((r, i) => {
            const y =
              PADDING.top +
              (1 - (r - geometry.yMin) / (geometry.yMax - geometry.yMin || 1)) *
                geometry.innerH;
            return (
              <g key={`y-${i}`}>
                <line
                  x1={PADDING.left}
                  x2={WIDTH - PADDING.right}
                  y1={y}
                  y2={y}
                  stroke="currentColor"
                  className="text-muted-foreground/20"
                  strokeWidth={1}
                />
                <text
                  x={PADDING.left - 6}
                  y={y + 3}
                  textAnchor="end"
                  className="fill-muted-foreground text-[10px] font-mono"
                >
                  {fmtPct(r)}
                </text>
              </g>
            );
          })}

          {/* Zero line (dashed, more prominent) */}
          {geometry.zeroY > PADDING.top &&
            geometry.zeroY < DEFAULT_HEIGHT - PADDING.bottom && (
              <line
                x1={PADDING.left}
                x2={WIDTH - PADDING.right}
                y1={geometry.zeroY}
                y2={geometry.zeroY}
                stroke="currentColor"
                className="text-muted-foreground/50"
                strokeWidth={1.5}
                strokeDasharray="4 4"
                data-testid="gold-map-roi-trend-zero-line"
              />
            )}

          {/* X-axis labels */}
          {geometry.xTicks.map((tick, i) => (
            <text
              key={`x-${i}`}
              x={tick.x}
              y={DEFAULT_HEIGHT - PADDING.bottom + 16}
              textAnchor="middle"
              className="fill-muted-foreground text-[10px]"
            >
              {fmtDate(tick.ts)}
            </text>
          ))}

          {/* Trend line (single color — best-cycle profitability) */}
          <path
            d={geometry.path}
            fill="none"
            stroke="#8b5cf6"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            data-testid="gold-map-roi-trend-line"
          />
        </svg>

        {/* Legend + point count */}
        <div className="flex items-center gap-4 mt-3 text-xs">
          <div className="flex items-center gap-1.5">
            <span
              className="inline-block w-3 h-0.5 bg-violet-500"
              aria-hidden="true"
            />
            <span className="text-muted-foreground">
              {t("goldMapTrendLegendBestCycle")}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className="inline-block w-3 h-0.5 border-t border-dashed border-muted-foreground/50"
              aria-hidden="true"
            />
            <span className="text-muted-foreground">
              {t("goldMapTrendLegendZero")}
            </span>
          </div>
          <span className="text-muted-foreground/60 ml-auto">
            {t("goldMapTrendPointCount", { 0: trendPoints.length })}
          </span>
        </div>

        {/* Footer: cycle keys + source */}
        {data?.availableCycleKeys && data.availableCycleKeys.length > 0 && (
          <p className="text-[10px] text-muted-foreground/70 mt-2">
            {t("goldMapTrendCycleKeysCount", { 0: data.availableCycleKeys.length })}
            {" · "}
            {t("goldMapTrendFetchedAt", {
              0: new Date(data.fetchedAt).toLocaleString(),
            })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Days selector (internal sub-component)
// ---------------------------------------------------------------------------

interface DaysSelectorProps {
  days: DaysOption;
  onDaysChange: (d: DaysOption) => void;
}

function DaysSelector({ days, onDaysChange }: DaysSelectorProps) {
  const { t } = useI18n();
  return (
    <Select
      value={String(days)}
      onValueChange={(v) => onDaysChange(Number(v) as DaysOption)}
    >
      <SelectTrigger
        className="h-8 w-[110px] text-xs"
        aria-label={t("goldMapTrendDaysLabel")}
        data-testid="gold-map-roi-trend-days-select"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {DAYS_OPTIONS.map((d) => (
          <SelectItem key={d} value={String(d)}>
            {t("goldMapTrendDaysValue", { 0: d })}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
