// ============================================================================
// Storage Value History Chart — minimal SVG line chart for currency/mirror
// and currency/hinekora ratios over time (F2 follow-up, iter 75).
//
// Why SVG instead of Recharts/Chart.js?
//   - The dashboard already vendors a lot of chart libs; adding another for a
//     single 2-line chart would bloat the bundle.
//   - SVG keeps the component dependency-free, easy to test, and ~150 lines.
//   - If we later need tooltips/zoom, we can swap to Recharts without
//     changing the API of this component (props stay the same).
//
// Props:
//   points: StorageValueHistoryPoint[]  — time-series from the backend
//   currency: string                    — for axis labels
//   height?: number                     — chart height in px (default 200)
//
// The chart renders two lines:
//   - ratio_mirror   (blue, "Mirror")
//   - ratio_hinekora (emerald, "Hinekora")
// Lines are skipped when ratios are null (gaps in the line). When ALL ratios
// are null (e.g. mirror/hinekora not traded in this league), we show a
// "no reference data" notice instead of an empty chart.
// ============================================================================

"use client";

import { useMemo } from "react";
import { TrendingUp, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";
import type { StorageValueHistoryPoint } from "@/lib/types";

export interface StorageValueHistoryChartProps {
  points: StorageValueHistoryPoint[];
  currency: string;
  height?: number;
  loading?: boolean;
}

const DEFAULT_HEIGHT = 220;
const WIDTH = 760; // viewBox width — scales via CSS
const PADDING = { top: 16, right: 16, bottom: 28, left: 56 };

export function StorageValueHistoryChart({
  points,
  currency,
  height = DEFAULT_HEIGHT,
  loading = false,
}: StorageValueHistoryChartProps) {
  const { t } = useI18n();

  const hasAnyMirror = points.some((p) => p.ratioMirror != null);
  const hasAnyHinekora = points.some((p) => p.ratioHinekora != null);

  const geometry = useMemo(() => {
    if (!points || points.length < 2) return null;

    // X-axis: timestamps → [0, 1] linear scale
    const timestamps = points.map((p) => new Date(p.timestamp).getTime());
    const tMin = Math.min(...timestamps);
    const tMax = Math.max(...timestamps);
    const tRange = tMax - tMin || 1; // avoid div by zero

    // Y-axis: ratios (mirror + hinekora combined)
    const allRatios = [
      ...points.map((p) => p.ratioMirror),
      ...points.map((p) => p.ratioHinekora),
    ].filter((r): r is number => r != null && Number.isFinite(r));

    if (allRatios.length === 0) return null;

    const rMin = Math.min(...allRatios);
    const rMax = Math.max(...allRatios);
    const rRange = rMax - rMin || rMax * 0.1 || 1;

    // Pad Y range a bit so the lines don't touch the edges
    const rPad = rRange * 0.1;
    const yMin = Math.max(0, rMin - rPad);
    const yMax = rMax + rPad;
    const yRange = yMax - yMin || 1;

    const innerW = WIDTH - PADDING.left - PADDING.right;
    const innerH = height - PADDING.top - PADDING.bottom;

    const xFor = (ts: number) =>
      PADDING.left + ((ts - tMin) / tRange) * innerW;
    const yFor = (r: number) =>
      PADDING.top + (1 - (r - yMin) / yRange) * innerH;

    // Build SVG path strings — null ratios create gaps via "M" (move) commands
    const buildPath = (key: "ratioMirror" | "ratioHinekora") => {
      let path = "";
      let penDown = false;
      for (const p of points) {
        const r = p[key];
        if (r == null || !Number.isFinite(r)) {
          penDown = false;
          continue;
        }
        const ts = new Date(p.timestamp).getTime();
        const x = xFor(ts);
        const y = yFor(r);
        path += `${penDown ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)} `;
        penDown = true;
      }
      return path.trim();
    };

    // Y-axis ticks: 4 evenly spaced values
    const yTicks = Array.from({ length: 5 }, (_, i) => yMin + (i / 4) * yRange);

    // X-axis ticks: up to 5 evenly spaced timestamps
    const xTickCount = Math.min(5, points.length);
    const xTicks = Array.from({ length: xTickCount }, (_, i) => {
      const ts = tMin + (i / (xTickCount - 1 || 1)) * tRange;
      return { ts, x: xFor(ts) };
    });

    return {
      mirrorPath: buildPath("ratioMirror"),
      hinekoraPath: buildPath("ratioHinekora"),
      xTicks,
      yTicks,
      yMin,
      yMax,
      innerW,
      innerH,
    };
  }, [points, height]);

  // ---- Loading state ----
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-5 w-5" aria-hidden="true" />
            {t("storageValueHistoryTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {t("storageValueHistoryLoading")}
        </CardContent>
      </Card>
    );
  }

  // ---- No data states ----
  // Need at least 2 points to draw a line — anything less is treated as "no
  // history yet" (same UI as a truly empty list).
  if (!points || points.length < 2) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-5 w-5" aria-hidden="true" />
            {t("storageValueHistoryTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground flex items-start gap-2">
          <Info className="h-4 w-4 mt-0.5 shrink-0 text-sky-500" aria-hidden="true" />
          <span>{t("storageValueHistoryEmpty", { 0: currency })}</span>
        </CardContent>
      </Card>
    );
  }

  if (!geometry) {
    // We have points but no valid ratios (all mirror/hinekora ratios null)
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-5 w-5" aria-hidden="true" />
            {t("storageValueHistoryTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground flex items-start gap-2">
          <Info className="h-4 w-4 mt-0.5 shrink-0 text-sky-500" aria-hidden="true" />
          <span>{t("storageValueHistoryNoRatios", { 0: currency })}</span>
        </CardContent>
      </Card>
    );
  }

  // ---- Chart render ----
  const fmtDate = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };
  const fmtRatio = (r: number) => {
    if (r === 0) return "0";
    if (r < 0.001) return r.toExponential(2);
    if (r < 0.01) return r.toFixed(5);
    if (r < 1) return r.toFixed(4);
    return r.toFixed(3);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUp className="h-5 w-5" aria-hidden="true" />
          {t("storageValueHistoryTitle")}
          <span className="text-xs font-normal text-muted-foreground ml-2">
            {t("storageValueHistorySubtitle", { 0: currency })}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <svg
          viewBox={`0 0 ${WIDTH} ${height}`}
          width="100%"
          height={height}
          role="img"
          aria-label={t("storageValueHistoryTitle")}
          className="overflow-visible"
          data-testid="storage-value-history-chart-svg"
        >
          {/* Y-axis grid lines + labels */}
          {geometry.yTicks.map((r, i) => {
            const y = PADDING.top + (1 - (r - geometry.yMin) / (geometry.yMax - geometry.yMin || 1)) * geometry.innerH;
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
                  {fmtRatio(r)}
                </text>
              </g>
            );
          })}

          {/* X-axis labels */}
          {geometry.xTicks.map((tick, i) => (
            <text
              key={`x-${i}`}
              x={tick.x}
              y={height - PADDING.bottom + 16}
              textAnchor="middle"
              className="fill-muted-foreground text-[10px]"
            >
              {fmtDate(tick.ts)}
            </text>
          ))}

          {/* Hinekora line (rendered under mirror so mirror is on top) */}
          {hasAnyHinekora && (
            <path
              d={geometry.hinekoraPath}
              fill="none"
              stroke="#10b981"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}

          {/* Mirror line */}
          {hasAnyMirror && (
            <path
              d={geometry.mirrorPath}
              fill="none"
              stroke="#3b82f6"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}
        </svg>

        {/* Legend */}
        <div className="flex items-center gap-4 mt-3 text-xs">
          {hasAnyMirror && (
            <div className="flex items-center gap-1.5">
              <span
                className="inline-block w-3 h-0.5 bg-blue-500"
                aria-hidden="true"
              />
              <span className="text-muted-foreground">
                {t("storageValueHistoryMirrorLine")}
              </span>
            </div>
          )}
          {hasAnyHinekora && (
            <div className="flex items-center gap-1.5">
              <span
                className="inline-block w-3 h-0.5 bg-emerald-500"
                aria-hidden="true"
              />
              <span className="text-muted-foreground">
                {t("storageValueHistoryHinekoraLine")}
              </span>
            </div>
          )}
          <span className="text-muted-foreground/60 ml-auto">
            {t("storageValueHistoryPointCount", { 0: points.length })}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
