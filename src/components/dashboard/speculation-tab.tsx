// ============================================================================
// Speculation Tab — BUY/SELL/HOLD signals per currency (F5, iter 77).
//
// Wraps GET /api/flipper/speculation (proxied to FastAPI
// GET /api/v1/speculation — implemented in iter 77 as F5).
//
// Renders a sortable list of currencies with their z-score relative to the
// last N days of price_logs. Each row shows:
//
//   ┌──────────────────────────────────────────────────────────────────────┐
//   │  [BUY]  Circle Coin                  z = -2.34    p = 5.2%           │
//   │         ritual · 14 pts · mean 1.20  ± std 0.18    horizon: medium   │
//   │         ▁▂▃▄▅▆▇█ (mini-sparkline of last 14 price points)            │
//   └──────────────────────────────────────────────────────────────────────┘
//
// Rationale (PRODUCT_VISION §3.2):
//   - For each item: z-score of current_price vs 30-day rolling mean/std.
//   - Signal: BUY (z < -1.5), SELL (z > +1.5), HOLD (|z| ≤ 1.5).
//   - Sort: most extreme |z| first (most actionable signals on top).
//
// Graceful degradation:
//   - backendOffline → offline card with start-backend hint
//   - data_available=false → "no price history yet" notice
//   - other fetch errors → error card + retry
//   - empty signals list (everything stable) → "no actionable signals" notice
//   - loading → skeleton spinner
//
// Filters:
//   - Signal filter: ALL / BUY / SELL / HOLD (chips at the top)
//   - Days selector: 7 / 14 / 30 / 90 (default 30)
// ============================================================================

"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Minus,
  Activity,
  Sparkles,
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
import {
  fetchApi,
  fmt,
  type SpeculationResponse,
  type SpeculationSignal,
  type SpeculationSignalType,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SpeculationTabProps {
  /** Whether the FastAPI analytics backend is reachable (dashboard-level check). */
  backendOnline: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DAYS_PRESETS = [7, 14, 30, 90];
const DEFAULT_DAYS = 30;
const DEFAULT_LIMIT = 50;

type SignalFilterValue = "ALL" | SpeculationSignalType;
const FILTER_OPTIONS: SignalFilterValue[] = ["ALL", "BUY", "SELL", "HOLD"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format a z-score with sign and 2 decimals: -2.34 → "-2.34", +1.5 → "+1.50". */
function fmtZ(z: number | null | undefined): string {
  if (z === null || z === undefined || !Number.isFinite(z)) return "—";
  return `${z > 0 ? "+" : ""}${z.toFixed(2)}`;
}

/** Format a percentile: 5.2 → "5.2%", null → "—". */
function fmtPct(p: number | null | undefined): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return "—";
  return `${p.toFixed(1)}%`;
}

/** Title-case a category slug: "breach" → "Breach". */
function titleCase(s: string): string {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Map signal type → color classes for the badge. */
function signalBadgeClass(signal: SpeculationSignalType): string {
  switch (signal) {
    case "BUY":
      return "border-emerald-500/50 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10";
    case "SELL":
      return "border-red-500/50 text-red-600 dark:text-red-400 bg-red-500/10";
    default:
      return "border-amber-500/50 text-amber-600 dark:text-amber-400 bg-amber-500/10";
  }
}

/** Map signal type → icon element. */
function signalIcon(signal: SpeculationSignalType) {
  switch (signal) {
    case "BUY":
      return <TrendingUp className="h-4 w-4 text-emerald-500" aria-hidden="true" />;
    case "SELL":
      return <TrendingDown className="h-4 w-4 text-red-500" aria-hidden="true" />;
    default:
      return <Minus className="h-4 w-4 text-amber-500" aria-hidden="true" />;
  }
}

/** Map horizon hint → localized key (fallback to "unknown" if missing). */
function horizonKey(hint: string | undefined): TranslationKeys {
  switch (hint) {
    case "short":
      return "speculationHorizonShort";
    case "medium":
      return "speculationHorizonMedium";
    case "long":
      return "speculationHorizonLong";
    default:
      return "speculationHorizonUnknown";
  }
}

// ---------------------------------------------------------------------------
// Mini-sparkline (dependency-free SVG)
// ---------------------------------------------------------------------------

interface SparklineProps {
  points: { date: string; price: number }[];
  /** Width of the SVG in px. Height is fixed at 24px. */
  width?: number;
  /** Color of the line — defaults to a neutral foreground color. */
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
        data-testid="speculation-sparkline-empty"
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

  // Normalize each point to [0, height-2] with 1px padding top/bottom
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
      data-testid="speculation-sparkline"
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

export function SpeculationTab({ backendOnline }: SpeculationTabProps) {
  const { t } = useI18n();

  // ---- Local input state ----
  const [days, setDays] = useState<number>(DEFAULT_DAYS);
  const [signalFilter, setSignalFilter] = useState<SignalFilterValue>("ALL");

  // ---- Query ----
  // 30s staleTime — speculation signals change slowly (rolling 30d average),
  // no need to refetch on every dashboard focus. Retry once for transient blips.
  const { data, isLoading, isError, refetch } = useQuery<SpeculationResponse>({
    queryKey: ["speculation", days, signalFilter],
    queryFn: () =>
      fetchApi<SpeculationResponse>("/api/flipper/speculation", {
        days: String(days),
        limit: String(DEFAULT_LIMIT),
        signal: signalFilter,
      }),
    enabled: backendOnline,
    staleTime: 30_000,
    retry: 1,
  });

  // ---- Derived ----
  const signals = useMemo(() => data?.signals ?? [], [data]);
  const dataAvailable = data?.dataAvailable ?? false;
  const hasSignals = signals.length > 0;

  // ---- Render: backend offline ----
  if (!backendOnline) {
    return (
      <Card className="border-amber-500/30">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-5 w-5 text-amber-500" aria-hidden="true" />
            {t("speculationTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground pt-0 space-y-2">
          <p>{t("speculationOffline")}</p>
          <p className="text-xs text-muted-foreground/70">
            {t("speculationOfflineHint")}
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
            <Sparkles className="h-5 w-5 text-violet-500" aria-hidden="true" />
            {t("speculationTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground pt-0">
          {t("speculationLoading")}
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
            {t("speculationTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground pt-0">
          {t("speculationError")}
          <Button
            variant="ghost"
            size="sm"
            className="ml-2 h-7"
            onClick={() => refetch()}
            aria-label={t("speculationRefresh")}
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
            <Sparkles className="h-5 w-5 text-violet-500" aria-hidden="true" />
            {t("speculationTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground pt-0">
          {t("speculationNoData")}
        </CardContent>
      </Card>
    );
  }

  // ---- Main render: filter controls + signal list ----
  return (
    <Card data-testid="speculation-tab">
      <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
        <div className="flex flex-col gap-0.5">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-5 w-5 text-violet-500" aria-hidden="true" />
            {t("speculationTitle")}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            {t("speculationSubtitle", { 0: days })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Days selector */}
          <Select
            value={String(days)}
            onValueChange={(v) => setDays(Number(v))}
          >
            <SelectTrigger className="h-8 w-[110px]" aria-label={t("speculationDaysLabel")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DAYS_PRESETS.map((d) => (
                <SelectItem key={d} value={String(d)}>
                  {t("speculationDaysValue", { 0: d })}
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
            aria-label={t("speculationRefresh")}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="ml-1 text-xs">{t("speculationRefresh")}</span>
          </Button>
        </div>
      </CardHeader>

      <CardContent className="pt-0 space-y-4">
        {/* Signal filter chips */}
        <div
          className="flex flex-wrap gap-1.5"
          role="group"
          aria-label={t("speculationFilterLabel")}
        >
          {FILTER_OPTIONS.map((opt) => (
            <Badge
              key={opt}
              variant={signalFilter === opt ? "default" : "outline"}
              className="cursor-pointer"
              onClick={() => setSignalFilter(opt)}
              role="button"
              aria-pressed={signalFilter === opt}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSignalFilter(opt);
                }
              }}
              data-testid={`speculation-filter-${opt.toLowerCase()}`}
            >
              {opt === "ALL"
                ? t("speculationFilterAll")
                : opt === "BUY"
                  ? t("speculationFilterBuy")
                  : opt === "SELL"
                    ? t("speculationFilterSell")
                    : t("speculationFilterHold")}
            </Badge>
          ))}
        </div>

        {/* Signal list */}
        {!hasSignals ? (
          <p className="text-sm text-muted-foreground italic">
            {t("speculationNoSignals")}
          </p>
        ) : (
          <div className="space-y-2" data-testid="speculation-signals-list">
            {signals.map((sig) => (
              <SignalRow key={`${sig.apiId}-${sig.zScore}`} signal={sig} t={t} />
            ))}
          </div>
        )}

        {/* Footer with last-updated timestamp */}
        {data?.fetchedAt && (
          <p className="text-[10px] text-muted-foreground/70">
            <Activity className="inline h-3 w-3 mr-1" aria-hidden="true" />
            {t("speculationFetchedAt", { 0: new Date(data.fetchedAt).toLocaleString() })}
            {" · "}
            {t("speculationSignalCount", { 0: signals.length })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// SignalRow — renders a single BUY/SELL/HOLD signal
// ---------------------------------------------------------------------------

interface SignalRowProps {
  signal: SpeculationSignal;
  t: (key: TranslationKeys, params?: Record<string, string | number>) => string;
}

function SignalRow({ signal, t }: SignalRowProps) {
  const lineColor =
    signal.signal === "BUY"
      ? "text-emerald-500"
      : signal.signal === "SELL"
        ? "text-red-500"
        : "text-amber-500";

  return (
    <div
      data-testid={`speculation-signal-${signal.apiId}`}
      className="rounded-md border border-border/60 p-3 space-y-2 hover:bg-accent/30 transition-colors"
    >
      {/* Top row: signal badge + name + z-score + percentile */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Badge variant="outline" className={`text-xs ${signalBadgeClass(signal.signal)}`}>
            {signalIcon(signal.signal)}
            <span className="ml-1">{signal.signal}</span>
          </Badge>
          <span className="text-sm font-medium truncate" title={signal.text}>
            {signal.text}
          </span>
          {signal.category && (
            <span className="text-[11px] text-muted-foreground/80">
              · {titleCase(signal.category)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs font-mono shrink-0">
          <span title={t("speculationZScoreTitle")}>
            z = <span className={lineColor}>{fmtZ(signal.zScore)}</span>
          </span>
          <span title={t("speculationPercentileTitle")}>
            p = <span className={lineColor}>{fmtPct(signal.percentile)}</span>
          </span>
        </div>
      </div>

      {/* Middle row: stats + sparkline */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-[11px] text-muted-foreground/80 font-mono">
          {t("speculationSampleSize", { 0: signal.sampleSize })}
          {" · "}
          {t("speculationMean", { 0: fmt(signal.mean) })}
          {" ± "}
          {t("speculationStd", { 0: fmt(signal.std) })}
          {" · "}
          {t("speculationCurrent", { 0: fmt(signal.currentPrice) })}
          {" · "}
          {t(horizonKey(signal.horizonHint))}
        </div>
        <div className={lineColor}>
          <Sparkline points={signal.priceHistoryShort} color="currentColor" />
        </div>
      </div>
    </div>
  );
}
