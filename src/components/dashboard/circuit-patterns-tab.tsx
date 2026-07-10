// ============================================================================
// Circuit Patterns Tab — trajectory classification per currency (F7 / P8,
// iter 97).
//
// Wraps GET /api/flipper/circuit-patterns (proxied to FastAPI
// GET /api/v1/circuit-patterns — implemented in iter 97). The pure function
// lives in backend/economy/circuit_patterns.py (iter 96, 75 tests).
//
// Renders a sortable list of currencies with their trajectory archetype
// over the last N days. Each row shows:
//
//   ┌──────────────────────────────────────────────────────────────────────┐
//   │  [EXPONENTIAL_GROWTH]  [HOLD_FOR_GROWTH]  Chaos Orb                  │
//   │  +1200.0% · slope 8.5%/d · vol 0.42 · R² 0.94 · 14 pts · 32.00       │
//   │  ▁▂▃▄▅▆▇█ (mini-sparkline of last 14 price points)                   │
//   └──────────────────────────────────────────────────────────────────────┘
//
// Rationale (PRODUCT_VISION §3.7 + docs/MARKET_PLAYBOOK.md §P8):
//   - For each item: classify trajectory into one of 7 archetypes
//     (EXPONENTIAL_GROWTH / LINEAR_GROWTH / PEAK_THEN_DECLINE /
//      MEAN_REVERTING / VOLATILE / DECLINING / STABLE).
//   - recommended_action derived from archetype:
//     HOLD_FOR_GROWTH (exp/lin) | SELL_NOW (peak) | AVOID (declining) |
//     WATCH (volatile) | NEUTRAL (mean-rev / stable).
//   - Sort: most action first (largest |total_change_pct| first).
//
// Graceful degradation:
//   - backendOffline → offline card with start-backend hint
//   - data_available=false → "no price history yet" notice
//   - other fetch errors → error card + retry
//   - empty patterns list → "no actionable patterns" notice
//   - loading → skeleton spinner
//
// Filters:
//   - Trajectory filter: ALL / EXPONENTIAL_GROWTH / LINEAR_GROWTH /
//     PEAK_THEN_DECLINE / MEAN_REVERTING / VOLATILE / DECLINING / STABLE
//     (chips at the top).
//   - Days selector: 7 / 14 / 30 / 90 (default 30).
// ============================================================================

"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Minus,
  Radio,
  Eye,
  Ban,
  Gauge,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/lib/i18n";
import type { TranslationKeys } from "@/lib/i18n/locales/en";
import { getCurrencyDisplayName, getCategoryDisplayName } from "@/lib/currency-names";
import {
  fetchApi,
  fmt,
  type CircuitPatternsResponse,
  type CircuitPattern,
  type CircuitTrajectory,
  type CircuitRecommendedAction,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface CircuitPatternsTabProps {
  /** Whether the FastAPI analytics backend is reachable (dashboard-level check). */
  backendOnline: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DAYS_PRESETS = [7, 14, 30, 90];
const DEFAULT_DAYS = 30;
const DEFAULT_LIMIT = 50;

type TrajectoryFilterValue = "ALL" | CircuitTrajectory;
const FILTER_OPTIONS: TrajectoryFilterValue[] = [
  "ALL",
  "EXPONENTIAL_GROWTH",
  "LINEAR_GROWTH",
  "PEAK_THEN_DECLINE",
  "MEAN_REVERTING",
  "VOLATILE",
  "DECLINING",
  "STABLE",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Title-case a category slug: "breach" → "Breach". */
function titleCase(s: string): string {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Format a signed % with 1 decimal: -40.0 → "-40.0%", +1200.0 → "+1200.0%". */
function fmtSignedPct(p: number | null | undefined): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return "—";
  return `${p > 0 ? "+" : ""}${p.toFixed(1)}%`;
}

/** Map trajectory → color classes for the trajectory badge. */
function trajectoryBadgeClass(t: CircuitTrajectory): string {
  switch (t) {
    case "EXPONENTIAL_GROWTH":
      return "border-emerald-500/50 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10";
    case "LINEAR_GROWTH":
      return "border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/5";
    case "PEAK_THEN_DECLINE":
      return "border-amber-500/50 text-amber-600 dark:text-amber-400 bg-amber-500/10";
    case "VOLATILE":
      return "border-fuchsia-500/50 text-fuchsia-600 dark:text-fuchsia-400 bg-fuchsia-500/10";
    case "DECLINING":
      return "border-red-500/50 text-red-600 dark:text-red-400 bg-red-500/10";
    case "MEAN_REVERTING":
      return "border-sky-500/40 text-sky-600 dark:text-sky-400 bg-sky-500/5";
    case "STABLE":
    default:
      return "border-muted-foreground/40 text-muted-foreground bg-muted/20";
  }
}

/** Map trajectory → icon element. */
function trajectoryIcon(t: CircuitTrajectory) {
  switch (t) {
    case "EXPONENTIAL_GROWTH":
      return <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />;
    case "LINEAR_GROWTH":
      return <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />;
    case "PEAK_THEN_DECLINE":
      return <Minus className="h-3.5 w-3.5" aria-hidden="true" />;
    case "VOLATILE":
      return <Radio className="h-3.5 w-3.5" aria-hidden="true" />;
    case "DECLINING":
      return <TrendingDown className="h-3.5 w-3.5" aria-hidden="true" />;
    case "MEAN_REVERTING":
      return <Activity className="h-3.5 w-3.5" aria-hidden="true" />;
    case "STABLE":
    default:
      return <Gauge className="h-3.5 w-3.5" aria-hidden="true" />;
  }
}

/** Map trajectory → localized label key. */
function trajectoryLabelKey(t: CircuitTrajectory): TranslationKeys {
  switch (t) {
    case "EXPONENTIAL_GROWTH":
      return "circuitTrajExpGrowth";
    case "LINEAR_GROWTH":
      return "circuitTrajLinGrowth";
    case "PEAK_THEN_DECLINE":
      return "circuitTrajPeak";
    case "MEAN_REVERTING":
      return "circuitTrajMeanRev";
    case "VOLATILE":
      return "circuitTrajVolatile";
    case "DECLINING":
      return "circuitTrajDeclining";
    case "STABLE":
    default:
      return "circuitTrajStable";
  }
}

/** Map trajectory filter value → localized label key. */
function filterLabelKey(f: TrajectoryFilterValue): TranslationKeys {
  if (f === "ALL") return "circuitFilterAll";
  return trajectoryLabelKey(f);
}

/** Map recommended_action → color classes for the action badge. */
function actionBadgeClass(a: CircuitRecommendedAction): string {
  switch (a) {
    case "HOLD_FOR_GROWTH":
      return "border-emerald-500/50 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10";
    case "SELL_NOW":
      return "border-amber-500/50 text-amber-600 dark:text-amber-400 bg-amber-500/10";
    case "AVOID":
      return "border-red-500/50 text-red-600 dark:text-red-400 bg-red-500/10";
    case "WATCH":
      return "border-fuchsia-500/50 text-fuchsia-600 dark:text-fuchsia-400 bg-fuchsia-500/10";
    case "NEUTRAL":
    default:
      return "border-muted-foreground/40 text-muted-foreground bg-muted/20";
  }
}

/** Map recommended_action → icon element. */
function actionIcon(a: CircuitRecommendedAction) {
  switch (a) {
    case "HOLD_FOR_GROWTH":
      return <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />;
    case "SELL_NOW":
      return <TrendingDown className="h-3.5 w-3.5" aria-hidden="true" />;
    case "AVOID":
      return <Ban className="h-3.5 w-3.5" aria-hidden="true" />;
    case "WATCH":
      return <Eye className="h-3.5 w-3.5" aria-hidden="true" />;
    case "NEUTRAL":
    default:
      return <Minus className="h-3.5 w-3.5" aria-hidden="true" />;
  }
}

/** Map recommended_action → localized label key. */
function actionLabelKey(a: CircuitRecommendedAction): TranslationKeys {
  switch (a) {
    case "HOLD_FOR_GROWTH":
      return "circuitActionHoldForGrowth";
    case "SELL_NOW":
      return "circuitActionSellNow";
    case "AVOID":
      return "circuitActionAvoid";
    case "WATCH":
      return "circuitActionWatch";
    case "NEUTRAL":
    default:
      return "circuitActionNeutral";
  }
}

// ---------------------------------------------------------------------------
// Mini-sparkline (dependency-free SVG) — mirrors the speculation-tab
// Sparkline component. Renders an empty fallback when < 2 points.
// ---------------------------------------------------------------------------

interface SparklineProps {
  points: { date: string; price: number }[];
  width?: number;
  color?: string;
}

function Sparkline({ points, width = 120, color = "currentColor" }: SparklineProps) {
  const height = 24;
  if (!points || points.length < 2) {
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        aria-hidden="true"
        data-testid="circuit-sparkline-empty"
      >
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke="currentColor"
          strokeWidth={1}
          strokeDasharray="2 2"
          className="text-muted-foreground/30"
        />
      </svg>
    );
  }

  const prices = points.map((p) => p.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1; // avoid div-by-zero when all prices identical

  const stepX = (width - 2) / (points.length - 1);
  const pathData = points
    .map((p, i) => {
      const x = 1 + i * stepX;
      const y = 1 + (height - 2) * (1 - (p.price - min) / range);
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      data-testid="circuit-sparkline"
    >
      <path
        d={pathData}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CircuitPatternsTab({ backendOnline }: CircuitPatternsTabProps) {
  const { t, locale } = useI18n();

  // ---- Local input state ----
  const [days, setDays] = useState<number>(DEFAULT_DAYS);
  const [trajectoryFilter, setTrajectoryFilter] = useState<TrajectoryFilterValue>("ALL");

  // ---- Query: circuit patterns ----
  // 30s staleTime — trajectories change slowly (regression over N-day
  // window), no need to refetch on every dashboard focus. Retry once for
  // transient blips.
  const { data, isLoading, isError, refetch } = useQuery<CircuitPatternsResponse>({
    queryKey: ["circuit-patterns", days, trajectoryFilter],
    queryFn: () =>
      fetchApi<CircuitPatternsResponse>("/api/flipper/circuit-patterns", {
        days: String(days),
        limit: String(DEFAULT_LIMIT),
        trajectory: trajectoryFilter,
      }),
    enabled: backendOnline,
    staleTime: 30_000,
    retry: 1,
  });

  // ---- Derived ----
  const patterns = useMemo(() => data?.patterns ?? [], [data]);
  const dataAvailable = data?.dataAvailable ?? false;
  const hasPatterns = patterns.length > 0;

  // ---- Render: backend offline ----
  if (!backendOnline) {
    return (
      <Card className="border-amber-500/30">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-5 w-5 text-amber-500" aria-hidden="true" />
            {t("circuitTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground pt-0 space-y-2">
          <p>{t("circuitOffline")}</p>
          <p className="text-xs text-muted-foreground/70">
            {t("circuitOfflineHint")}
          </p>
        </CardContent>
      </Card>
    );
  }

  // ---- Render: loading ----
  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-5 w-5 text-violet-500" aria-hidden="true" />
            {t("circuitTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground pt-0">
          {t("circuitLoading")}
        </CardContent>
      </Card>
    );
  }

  // ---- Render: error ----
  if (isError) {
    return (
      <Card className="border-red-500/30">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-5 w-5 text-red-500" aria-hidden="true" />
            {t("circuitTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground pt-0">
          {t("circuitError")}
          <Button
            variant="ghost"
            size="sm"
            className="ml-2 h-7"
            onClick={() => refetch()}
            aria-label={t("circuitRefresh")}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </CardContent>
      </Card>
    );
  }

  // ---- Render: no data available yet ----
  if (!dataAvailable) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-5 w-5 text-violet-500" aria-hidden="true" />
            {t("circuitTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground pt-0">
          {t("circuitNoData")}
        </CardContent>
      </Card>
    );
  }

  // ---- Main render: filter controls + patterns list ----
  return (
    <Card data-testid="circuit-patterns-tab">
      <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
        <div className="flex flex-col gap-0.5">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-5 w-5 text-violet-500" aria-hidden="true" />
            {t("circuitTitle")}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            {t("circuitSubtitle", { 0: days })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Days selector */}
          <Select
            value={String(days)}
            onValueChange={(v) => setDays(Number(v))}
          >
            <SelectTrigger className="h-8 w-[110px]" aria-label={t("circuitDaysLabel")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DAYS_PRESETS.map((d) => (
                <SelectItem key={d} value={String(d)}>
                  {t("circuitDaysValue", { 0: d })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* Refresh button */}
          <Button
            variant="ghost"
            size="sm"
            className="h-8"
            onClick={() => refetch()}
            aria-label={t("circuitRefresh")}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="ml-1 text-xs">{t("circuitRefresh")}</span>
          </Button>
        </div>
      </CardHeader>

      <CardContent className="pt-0 space-y-4">
        {/* Trajectory filter chips */}
        <div
          className="flex flex-wrap gap-1.5"
          role="group"
          aria-label={t("circuitFilterLabel")}
        >
          {FILTER_OPTIONS.map((opt) => {
            // Derive a short test-id suffix from the option value.
            // ALL → "all", EXPONENTIAL_GROWTH → "exponential",
            // LINEAR_GROWTH → "linear", PEAK_THEN_DECLINE → "peak",
            // MEAN_REVERTING → "mean-rev", VOLATILE → "volatile",
            // DECLINING → "declining", STABLE → "stable".
            const testSuffix =
              opt === "ALL"
                ? "all"
                : opt === "PEAK_THEN_DECLINE"
                  ? "peak"
                  : opt === "MEAN_REVERTING"
                    ? "mean-rev"
                    : opt
                        .toLowerCase()
                        .replace(/_growth$/, "");
            return (
              <Badge
                key={opt}
                variant={trajectoryFilter === opt ? "default" : "outline"}
                className="cursor-pointer"
                onClick={() => setTrajectoryFilter(opt)}
                role="button"
                aria-pressed={trajectoryFilter === opt}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setTrajectoryFilter(opt);
                  }
                }}
                data-testid={`circuit-filter-${testSuffix}`}
              >
                {t(filterLabelKey(opt))}
              </Badge>
            );
          })}
        </div>

        {/* Pattern list */}
        {!hasPatterns ? (
          <p className="text-sm text-muted-foreground italic">
            {t("circuitNoPatterns")}
          </p>
        ) : (
          <div className="space-y-2" data-testid="circuit-patterns-list">
            {patterns.map((pat) => (
              <PatternRow
                key={`${pat.apiId}-${pat.trajectory}`}
                pattern={pat}
                t={t}
                locale={locale}
              />
            ))}
          </div>
        )}

        {/* Footer with last-updated timestamp */}
        {data?.fetchedAt && (
          <p className="text-[10px] text-muted-foreground/70">
            <Activity className="inline h-3 w-3 mr-1" aria-hidden="true" />
            {t("circuitFetchedAt", { 0: new Date(data.fetchedAt).toLocaleString() })}
            {" · "}
            {t("circuitPatternCount", { 0: patterns.length })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// PatternRow — renders a single trajectory classification
// ---------------------------------------------------------------------------

interface PatternRowProps {
  pattern: CircuitPattern;
  t: (key: TranslationKeys, params?: Record<string, string | number>) => string;
  locale: string;
}

function PatternRow({ pattern, t, locale }: PatternRowProps) {
  // Color the total_change_pct based on sign — green for positive, red for
  // negative, muted for near-zero.
  const changeColor =
    pattern.totalChangePct > 0
      ? "text-emerald-500"
      : pattern.totalChangePct < 0
        ? "text-red-500"
        : "text-muted-foreground";

  // Sparkline color matches the trajectory archetype — visual hint at a glance.
  const sparklineColor =
    pattern.trajectory === "EXPONENTIAL_GROWTH" || pattern.trajectory === "LINEAR_GROWTH"
      ? "rgb(16 185 129)" // emerald-500
      : pattern.trajectory === "PEAK_THEN_DECLINE"
        ? "rgb(245 158 11)" // amber-500
        : pattern.trajectory === "DECLINING"
          ? "rgb(239 68 68)" // red-500
          : pattern.trajectory === "VOLATILE"
            ? "rgb(217 70 239)" // fuchsia-500
            : "rgb(100 116 139)"; // slate-500 (MEAN_REVERTING / STABLE)

  // Localize the category slug
  const categoryLabel = pattern.category
    ? (getCategoryDisplayName(pattern.category, locale) || titleCase(pattern.category))
    : "";

  // Localize the item name
  const itemLabel = getCurrencyDisplayName(pattern.apiId, locale) || pattern.text;

  return (
    <div
      data-testid={`circuit-pattern-${pattern.apiId}`}
      className="rounded-md border border-border/60 p-3 space-y-2 hover:bg-accent/30 transition-colors"
    >
      {/* Top row: trajectory badge + action badge + name + total_change_pct */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Badge
            variant="outline"
            className={`text-xs ${trajectoryBadgeClass(pattern.trajectory)}`}
            title={t(trajectoryLabelKey(pattern.trajectory))}
          >
            {trajectoryIcon(pattern.trajectory)}
            <span className="ml-1">{t(trajectoryLabelKey(pattern.trajectory))}</span>
          </Badge>
          <Badge
            variant="outline"
            className={`text-xs ${actionBadgeClass(pattern.recommendedAction)}`}
            title={t(actionLabelKey(pattern.recommendedAction))}
          >
            {actionIcon(pattern.recommendedAction)}
            <span className="ml-1">{t(actionLabelKey(pattern.recommendedAction))}</span>
          </Badge>
          <span className="text-sm font-medium truncate" title={itemLabel}>
            {itemLabel}
          </span>
          {categoryLabel && (
            <span className="text-[11px] text-muted-foreground/80">
              · {categoryLabel}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs font-mono shrink-0">
          <span title={t("circuitTotalChangeTitle")}>
            <span className={changeColor}>
              {fmtSignedPct(pattern.totalChangePct)}
            </span>
          </span>
        </div>
      </div>

      {/* Middle row: stats + sparkline */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-[11px] text-muted-foreground/80 font-mono">
          <span title={t("circuitSampleSizeTitle")}>
            {t("circuitSampleSize", { 0: pattern.sampleSize })}
          </span>
          {" · "}
          <span title={t("circuitSlopeTitle")}>
            {t("circuitSlope", { 0: pattern.recentSlopePctPerDay.toFixed(2) })}
          </span>
          {" · "}
          <span title={t("circuitVolatilityTitle")}>
            {t("circuitVolatility", { 0: pattern.volatilityCv.toFixed(2) })}
          </span>
          {" · "}
          <span title={t("circuitRSquaredTitle")}>
            {t("circuitRSquared", { 0: pattern.rSquared.toFixed(2) })}
          </span>
          {" · "}
          <span title={t("circuitCurrentPriceTitle")}>
            {t("circuitCurrent", { 0: fmt(pattern.currentPrice) })}
          </span>
          {pattern.daysSincePeak !== null && (
            <>
              {" · "}
              <span title={t("circuitDaysSincePeakTitle")}>
                {t("circuitDaysSincePeak", { 0: pattern.daysSincePeak })}
              </span>
            </>
          )}
        </div>
        <div style={{ color: sparklineColor }}>
          <Sparkline points={pattern.priceHistoryShort} color="currentColor" />
        </div>
      </div>
    </div>
  );
}
