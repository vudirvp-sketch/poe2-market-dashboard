// ============================================================================
// Mirror/Divine Arbitrage Tab — single-object rate detector (P7, iter 109).
//
// Wraps GET /api/flipper/mirror-divine-arb (proxied to FastAPI
// GET /api/v1/mirror-divine-arb — implemented in iter 108). The pure function
// lives in backend/economy/mirror_divine_arb.py (iter 108, 70 tests).
//
// *** Unlike speculation/circuit-patterns/intraday/weekly tabs which all
// render a PER-CURRENCY list of rows, this tab renders a SINGLE OBJECT —
// Mirror:Divine is ONE market, not a per-currency list. ***
//
// Layout (one big card, not a table):
//
//   ┌──────────────────────────────────────────────────────────────────────┐
//   │  [↕]  Mirror ↔ Divine Arbitrage              [days: 7|14|30|90] [↻]  │
//   │       Current Mirror:Divine rate vs the last 30-day window mean.    │
//   │                                                                      │
//   │  ┌──────────────────────────────┐  ┌──────────────────────────────┐  │
//   │  │  Signal                       │  │  Action                       │  │
//   │  │  [SELL MIRROR / BUY DIVINE]   │  │  [EXECUTE ARB]                │  │
//   │  └──────────────────────────────┘  └──────────────────────────────┘  │
//   │                                                                      │
//   │  ┌────────────────────────────────────────────────────────────────┐  │
//   │  │   Current rate            z-score           Deviation          │  │
//   │  │     125.40 Div/Mirror      +2.34            +1.87%             │  │
//   │  │   (huge font)             (red ≥+1.5,                           │  │
//   │  │                           blue ≤-1.5)                           │  │
//   │  └────────────────────────────────────────────────────────────────┘  │
//   │                                                                      │
//   │  ┌────────────────────────────────────────────────────────────────┐  │
//   │  │  Profit / Mirror: 2.34 Div  ·  Actionable: Yes                 │  │
//   │  └────────────────────────────────────────────────────────────────┘  │
//   │                                                                      │
//   │  ┌────────────────────────────────────────────────────────────────┐  │
//   │  │  Mean: 123.10   Std: 0.98   Min: 121.50   Max: 125.40   N: 14  │  │
//   │  └────────────────────────────────────────────────────────────────┘  │
//   │                                                                      │
//   │  ┌────────────────────────────────────────────────────────────────┐  │
//   │  │  ▁▂▃▄▅▆▇█ (rate sparkline over the lookback window)            │  │
//   │  └────────────────────────────────────────────────────────────────┘  │
//   │                                                                      │
//   │  Fetched: 2026-07-11 12:00:00 · 14 pts · 30-day window               │
//   └──────────────────────────────────────────────────────────────────────┘
//
// Rationale (PRODUCT_VISION §3.7 + docs/MARKET_PLAYBOOK.md §P7):
//   - Mirror:Divine is the most liquid high-value cross-rate in PoE2.
//   - When the rate deviates ≥ 1.5σ from its mean, swapping Mirror→Divine
//     (or vice versa) and back is a near-zero-risk arb.
//   - Profit threshold: |current - mean| ≥ 100 Div per Mirror to be
//     "actionable" (otherwise transaction friction eats the edge).
//
// Graceful degradation:
//   - backendOffline → offline card with start-backend hint
//   - data_available=false → "no price history yet" notice
//   - sample_size < 4 → "not enough rate points yet" notice
//   - other fetch errors → error card + retry
//   - loading → skeleton spinner
//
// Filters:
//   - Days selector: 7 / 14 / 30 / 90 (default 30).
// ============================================================================

"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  RefreshCw,
  ArrowUpDown,
  TrendingUp,
  TrendingDown,
  Minus,
  Activity,
  Zap,
  Eye,
  Pause,
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
  type MirrorDivineArbResponse,
  type MirrorDivineArbSignal,
  type MirrorDivineArbAction,
  type MirrorDivineArbRatePoint,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface MirrorDivineArbTabProps {
  /** Whether the FastAPI analytics backend is reachable (dashboard-level check). */
  backendOnline: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DAYS_PRESETS = [7, 14, 30, 90];
const DEFAULT_DAYS = 30;
const MIN_SAMPLE_SIZE = 4;

// ---------------------------------------------------------------------------
// Helpers — signal/action badges
// ---------------------------------------------------------------------------

/** Map signal → color classes for the signal badge. */
function signalBadgeClass(s: MirrorDivineArbSignal): string {
  switch (s) {
    case "SELL_MIRROR_BUY_DIVINE":
      // Mirror overvalued → sell the expensive one. Red-ish.
      return "border-red-500/50 text-red-600 dark:text-red-400 bg-red-500/10";
    case "SELL_DIVINE_BUY_MIRROR":
      // Mirror undervalued → buy the cheap one. Emerald-ish.
      return "border-emerald-500/50 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10";
    case "NEUTRAL":
    default:
      return "border-muted-foreground/40 text-muted-foreground bg-muted/20";
  }
}

/** Map signal → icon element. */
function signalIcon(s: MirrorDivineArbSignal) {
  switch (s) {
    case "SELL_MIRROR_BUY_DIVINE":
      return <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />;
    case "SELL_DIVINE_BUY_MIRROR":
      return <TrendingDown className="h-3.5 w-3.5" aria-hidden="true" />;
    case "NEUTRAL":
    default:
      return <Minus className="h-3.5 w-3.5" aria-hidden="true" />;
  }
}

/** Map signal → localized label key. */
function signalLabelKey(s: MirrorDivineArbSignal): TranslationKeys {
  switch (s) {
    case "SELL_MIRROR_BUY_DIVINE":
      return "mirrorDivineSignalSellMirror";
    case "SELL_DIVINE_BUY_MIRROR":
      return "mirrorDivineSignalSellDivine";
    case "NEUTRAL":
    default:
      return "mirrorDivineSignalNeutral";
  }
}

/** Map recommended_action → color classes for the action badge. */
function actionBadgeClass(a: MirrorDivineArbAction): string {
  switch (a) {
    case "EXECUTE_ARB":
      // Urgent — execute now. Fuchsia for high-impact.
      return "border-fuchsia-500/50 text-fuchsia-600 dark:text-fuchsia-400 bg-fuchsia-500/10";
    case "WATCH":
      // Standby. Amber.
      return "border-amber-500/50 text-amber-600 dark:text-amber-400 bg-amber-500/10";
    case "HOLD":
    default:
      return "border-muted-foreground/40 text-muted-foreground bg-muted/20";
  }
}

/** Map recommended_action → icon element. */
function actionIcon(a: MirrorDivineArbAction) {
  switch (a) {
    case "EXECUTE_ARB":
      return <Zap className="h-3.5 w-3.5" aria-hidden="true" />;
    case "WATCH":
      return <Eye className="h-3.5 w-3.5" aria-hidden="true" />;
    case "HOLD":
    default:
      return <Pause className="h-3.5 w-3.5" aria-hidden="true" />;
  }
}

/** Map recommended_action → localized label key. */
function actionLabelKey(a: MirrorDivineArbAction): TranslationKeys {
  switch (a) {
    case "EXECUTE_ARB":
      return "mirrorDivineActionExecute";
    case "WATCH":
      return "mirrorDivineActionWatch";
    case "HOLD":
    default:
      return "mirrorDivineActionHold";
  }
}

/** Format a signed z-score: +2.34 / -1.50 / 0.00. */
function fmtSignedZ(z: number | null | undefined): string {
  if (z === null || z === undefined || !Number.isFinite(z)) return "—";
  return `${z > 0 ? "+" : ""}${z.toFixed(2)}`;
}

/** Format a signed percentage: +1.87% / -0.50%. */
function fmtSignedPct(p: number | null | undefined): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return "—";
  return `${p > 0 ? "+" : ""}${p.toFixed(2)}%`;
}

// ---------------------------------------------------------------------------
// Mini-sparkline (dependency-free SVG) — mirrors the speculation/circuit
// Sparkline component. Renders an empty fallback when < 2 points.
// ---------------------------------------------------------------------------

interface SparklineProps {
  points: MirrorDivineArbRatePoint[];
  width?: number;
  color?: string;
}

function Sparkline({ points, width = 360, color = "currentColor" }: SparklineProps) {
  const height = 48;
  if (!points || points.length < 2) {
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        aria-hidden="true"
        data-testid="mirror-divine-sparkline-empty"
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

  const rates = points.map((p) => p.rate);
  const min = Math.min(...rates);
  const max = Math.max(...rates);
  const range = max - min || 1; // avoid div-by-zero when all rates identical

  const stepX = (width - 2) / (points.length - 1);
  const pathData = points
    .map((p, i) => {
      const x = 1 + i * stepX;
      const y = 1 + (height - 2) * (1 - (p.rate - min) / range);
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Mirror:Divine rate sparkline"
      data-testid="mirror-divine-sparkline"
    >
      <path
        d={pathData}
        fill="none"
        stroke={color}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MirrorDivineArbTab({ backendOnline }: MirrorDivineArbTabProps) {
  const { t } = useI18n();

  // ---- Local input state ----
  const [days, setDays] = useState<number>(DEFAULT_DAYS);

  // ---- Query: mirror/divine arb detector ----
  // 30s staleTime — rate changes slowly (rolling N-day window), no need to
  // refetch on every dashboard focus. Retry once for transient blips.
  const { data, isLoading, isError, refetch } = useQuery<MirrorDivineArbResponse>({
    queryKey: ["mirror-divine-arb", days],
    queryFn: () =>
      fetchApi<MirrorDivineArbResponse>("/api/flipper/mirror-divine-arb", {
        days: String(days),
      }),
    enabled: backendOnline,
    staleTime: 30_000,
    retry: 1,
  });

  // ---- Derived ----
  const dataAvailable = data?.dataAvailable ?? false;
  const sampleSize = data?.sampleSize ?? 0;
  const hasEnoughSamples = sampleSize >= MIN_SAMPLE_SIZE;

  // ---- Render: backend offline ----
  if (!backendOnline) {
    return (
      <Card className="border-amber-500/30">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ArrowUpDown className="h-5 w-5 text-amber-500" aria-hidden="true" />
            {t("mirrorDivineTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground pt-0 space-y-2">
          <p>{t("mirrorDivineOffline")}</p>
          <p className="text-xs text-muted-foreground/70">
            {t("mirrorDivineOfflineHint")}
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
            <ArrowUpDown className="h-5 w-5 text-violet-500" aria-hidden="true" />
            {t("mirrorDivineTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground pt-0">
          {t("mirrorDivineLoading")}
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
            {t("mirrorDivineTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground pt-0">
          {t("mirrorDivineError")}
          <Button
            variant="ghost"
            size="sm"
            className="ml-2 h-7"
            onClick={() => refetch()}
            aria-label={t("mirrorDivineRefresh")}
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
        <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <ArrowUpDown className="h-5 w-5 text-violet-500" aria-hidden="true" />
            {t("mirrorDivineTitle")}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Select
              value={String(days)}
              onValueChange={(v) => setDays(Number(v))}
            >
              <SelectTrigger className="h-8 w-[110px]" aria-label={t("mirrorDivineDaysLabel")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DAYS_PRESETS.map((d) => (
                  <SelectItem key={d} value={String(d)}>
                    {t("mirrorDivineDaysValue", { 0: d })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="sm"
              className="h-8"
              onClick={() => refetch()}
              aria-label={t("mirrorDivineRefresh")}
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground pt-0">
          {t("mirrorDivineNoData")}
        </CardContent>
      </Card>
    );
  }

  // ---- Render: not enough samples (data_available=true but < 4 rate points) ----
  // This is an edge case — backend's data_available flag already gates on
  // MIN_SAMPLE_SIZE=4, so this branch is defensive only.
  if (!hasEnoughSamples) {
    return (
      <Card data-testid="mirror-divine-arb-tab">
        <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
          <div className="flex flex-col gap-0.5">
            <CardTitle className="flex items-center gap-2 text-base">
              <ArrowUpDown className="h-5 w-5 text-violet-500" aria-hidden="true" />
              {t("mirrorDivineTitle")}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {t("mirrorDivineSubtitle", { 0: days })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select
              value={String(days)}
              onValueChange={(v) => setDays(Number(v))}
            >
              <SelectTrigger className="h-8 w-[110px]" aria-label={t("mirrorDivineDaysLabel")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DAYS_PRESETS.map((d) => (
                  <SelectItem key={d} value={String(d)}>
                    {t("mirrorDivineDaysValue", { 0: d })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="sm"
              className="h-8"
              onClick={() => refetch()}
              aria-label={t("mirrorDivineRefresh")}
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="ml-1 text-xs">{t("mirrorDivineRefresh")}</span>
            </Button>
          </div>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground pt-0">
          {t("mirrorDivineNoSample")}
        </CardContent>
      </Card>
    );
  }

  // ---- Main render: single-object card ----
  // Color the z-score based on magnitude — red for overvalued Mirror (z ≥ +1.5),
  // emerald for undervalued Mirror (z ≤ -1.5), muted otherwise.
  const zScoreColor =
    data?.zScore !== null && data?.zScore !== undefined && data.zScore >= 1.5
      ? "text-red-500"
      : data?.zScore !== null && data?.zScore !== undefined && data.zScore <= -1.5
        ? "text-emerald-500"
        : "text-muted-foreground";

  // Sparkline color matches the signal — red for SELL_MIRROR, emerald for
  // SELL_DIVINE, slate for NEUTRAL.
  const sparklineColor =
    data?.signal === "SELL_MIRROR_BUY_DIVINE"
      ? "rgb(239 68 68)" // red-500
      : data?.signal === "SELL_DIVINE_BUY_MIRROR"
        ? "rgb(16 185 129)" // emerald-500
        : "rgb(100 116 139)"; // slate-500

  return (
    <Card data-testid="mirror-divine-arb-tab">
      <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
        <div className="flex flex-col gap-0.5">
          <CardTitle className="flex items-center gap-2 text-base">
            <ArrowUpDown className="h-5 w-5 text-violet-500" aria-hidden="true" />
            {t("mirrorDivineTitle")}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            {t("mirrorDivineSubtitle", { 0: days })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Days selector */}
          <Select
            value={String(days)}
            onValueChange={(v) => setDays(Number(v))}
          >
            <SelectTrigger className="h-8 w-[110px]" aria-label={t("mirrorDivineDaysLabel")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DAYS_PRESETS.map((d) => (
                <SelectItem key={d} value={String(d)}>
                  {t("mirrorDivineDaysValue", { 0: d })}
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
            aria-label={t("mirrorDivineRefresh")}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="ml-1 text-xs">{t("mirrorDivineRefresh")}</span>
          </Button>
        </div>
      </CardHeader>

      <CardContent className="pt-0 space-y-4">
        {/* Signal + Action badges row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div
            className="rounded-md border border-border/60 p-3 space-y-1.5"
            data-testid="mirror-divine-signal-block"
          >
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
              {t("mirrorDivineSignalLabel")}
            </div>
            {data && (
              <Badge
                variant="outline"
                className={`text-xs ${signalBadgeClass(data.signal)}`}
                title={t(signalLabelKey(data.signal))}
              >
                {signalIcon(data.signal)}
                <span className="ml-1">{t(signalLabelKey(data.signal))}</span>
              </Badge>
            )}
          </div>
          <div
            className="rounded-md border border-border/60 p-3 space-y-1.5"
            data-testid="mirror-divine-action-block"
          >
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
              {t("mirrorDivineActionLabel")}
            </div>
            {data && (
              <Badge
                variant="outline"
                className={`text-xs ${actionBadgeClass(data.recommendedAction)}`}
                title={t(actionLabelKey(data.recommendedAction))}
              >
                {actionIcon(data.recommendedAction)}
                <span className="ml-1">{t(actionLabelKey(data.recommendedAction))}</span>
              </Badge>
            )}
          </div>
        </div>

        {/* Hero metrics: current rate / z-score / deviation */}
        <div
          className="rounded-md border border-border/60 p-4 grid grid-cols-1 sm:grid-cols-3 gap-3"
          data-testid="mirror-divine-hero"
        >
          <div className="space-y-0.5">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
              {t("mirrorDivineCurrentRate")}
            </div>
            <div
              className="text-2xl font-mono font-semibold"
              title={t("mirrorDivineCurrentRateTitle")}
              data-testid="mirror-divine-current-rate"
            >
              {fmt(data?.currentRate)}
            </div>
            <div className="text-[10px] text-muted-foreground/70">
              {t("mirrorDivineRateUnit")}
            </div>
          </div>
          <div className="space-y-0.5">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
              {t("mirrorDivineZScore")}
            </div>
            <div
              className={`text-2xl font-mono font-semibold ${zScoreColor}`}
              title={t("mirrorDivineZScoreTitle")}
              data-testid="mirror-divine-z-score"
            >
              {fmtSignedZ(data?.zScore)}
            </div>
            <div className="text-[10px] text-muted-foreground/70">
              {t("mirrorDivineZScoreHint")}
            </div>
          </div>
          <div className="space-y-0.5">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
              {t("mirrorDivineDeviation")}
            </div>
            <div
              className={`text-2xl font-mono font-semibold ${
                data?.deviationPct !== null && data?.deviationPct !== undefined && data.deviationPct > 0
                  ? "text-red-500"
                  : data?.deviationPct !== null && data?.deviationPct !== undefined && data.deviationPct < 0
                    ? "text-emerald-500"
                    : "text-muted-foreground"
              }`}
              title={t("mirrorDivineDeviationTitle")}
              data-testid="mirror-divine-deviation"
            >
              {fmtSignedPct(data?.deviationPct)}
            </div>
            <div className="text-[10px] text-muted-foreground/70">
              {t("mirrorDivineDeviationHint")}
            </div>
          </div>
        </div>

        {/* Profit potential + Actionable */}
        <div
          className="rounded-md border border-border/60 p-3 flex items-center justify-between gap-2 flex-wrap text-sm"
          data-testid="mirror-divine-profit-row"
        >
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">{t("mirrorDivineProfit")}</span>
            <span className="font-mono font-semibold" title={t("mirrorDivineProfitTitle")}>
              {fmt(data?.profitPotentialPerMirrorDiv)}
            </span>
            <span className="text-xs text-muted-foreground/70">{t("mirrorDivineRateUnit")}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">{t("mirrorDivineActionable")}</span>
            <Badge
              variant="outline"
              className={
                data?.isActionable
                  ? "border-fuchsia-500/50 text-fuchsia-600 dark:text-fuchsia-400 bg-fuchsia-500/10"
                  : "border-muted-foreground/40 text-muted-foreground bg-muted/20"
              }
            >
              {data?.isActionable ? t("mirrorDivineActionableYes") : t("mirrorDivineActionableNo")}
            </Badge>
          </div>
        </div>

        {/* Stats grid: mean / std / min / max / sample size */}
        <div
          className="rounded-md border border-border/60 p-3 grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs font-mono"
          data-testid="mirror-divine-stats"
        >
          <div className="space-y-0.5">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
              {t("mirrorDivineMean")}
            </div>
            <div title={t("mirrorDivineMeanTitle")}>{fmt(data?.meanRate)}</div>
          </div>
          <div className="space-y-0.5">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
              {t("mirrorDivineStd")}
            </div>
            <div title={t("mirrorDivineStdTitle")}>{fmt(data?.stdRate)}</div>
          </div>
          <div className="space-y-0.5">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
              {t("mirrorDivineMin")}
            </div>
            <div title={t("mirrorDivineMinTitle")}>{fmt(data?.minRate)}</div>
          </div>
          <div className="space-y-0.5">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
              {t("mirrorDivineMax")}
            </div>
            <div title={t("mirrorDivineMaxTitle")}>{fmt(data?.maxRate)}</div>
          </div>
          <div className="space-y-0.5">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
              {t("mirrorDivineSampleSizeLabel")}
            </div>
            <div title={t("mirrorDivineSampleSizeTitle")}>
              {t("mirrorDivineSampleSize", { 0: sampleSize })}
            </div>
          </div>
        </div>

        {/* Sparkline */}
        <div
          className="rounded-md border border-border/60 p-3"
          style={{ color: sparklineColor }}
          data-testid="mirror-divine-sparkline-block"
        >
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground/80 mb-1.5">
            {t("mirrorDivineSparklineLabel")}
          </div>
          <Sparkline
            points={data?.priceHistoryShort ?? []}
            width={360}
            color="currentColor"
          />
        </div>

        {/* Footer with last-updated timestamp */}
        {data?.fetchedAt && (
          <p className="text-[10px] text-muted-foreground/70">
            <Activity className="inline h-3 w-3 mr-1" aria-hidden="true" />
            {t("mirrorDivineFetchedAt", { 0: new Date(data.fetchedAt).toLocaleString() })}
            {" · "}
            {t("mirrorDivineSampleSize", { 0: sampleSize })}
            {" · "}
            {t("mirrorDivineDaysValue", { 0: days })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
