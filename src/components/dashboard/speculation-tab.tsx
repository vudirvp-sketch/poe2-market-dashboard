// ============================================================================
// Speculation Tab — BUY/SELL/HOLD signals per currency (F5, iter 77) +
// Strategy Backtest panel (F5 follow-up, iter 80).
//
// Wraps GET /api/flipper/speculation (proxied to FastAPI
// GET /api/v1/speculation — implemented in iter 77 as F5) for the live
// signals list.
//
// Wraps GET /api/flipper/speculation/backtest (proxied to FastAPI
// GET /api/v1/speculation/backtest — implemented in iter 79 as F5 backend,
// wired into the frontend in iter 80) for the optional Backtest panel
// mounted BELOW the live signals list.
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
// Below the signals list — a collapsible "Strategy Backtest" panel:
//   - Toggle button (NOT autoload — backtest is compute-heavy)
//   - 3 day selectors: eval_days_ago / holding_days / lookback_days
//   - Aggregated stats: overall + BUY + SELL blocks
//     (count, win_rate, mean/median/best/worst return_pct)
//   - Signal breakdown: BUY N / SELL N / HOLD N + evaluated/unevaluated counts
//   - Top trades list (capped by `limit`, sorted by |return_pct| desc)
//
// Rationale (PRODUCT_VISION §3.2):
//   - For each item: z-score of current_price vs 30-day rolling mean/std.
//   - Signal: BUY (z < -1.5), SELL (z > +1.5), HOLD (|z| ≤ 1.5).
//   - Sort: most extreme |z| first (most actionable signals on top).
//   - Backtest: replay the same strategy on historical price_logs to measure
//     realised profitability per signal type.
//
// Graceful degradation:
//   - backendOffline → offline card with start-backend hint
//   - data_available=false → "no price history yet" notice
//   - other fetch errors → error card + retry
//   - empty signals list (everything stable) → "no actionable signals" notice
//   - loading → skeleton spinner
//   - Backtest panel:
//     - collapsed by default → only "Run backtest" toggle button visible
//     - expanded + loading → spinner text
//     - expanded + error → error card + refresh
//     - expanded + data_available=false → "no data yet" notice
//     - expanded + trades=[] → "no trades produced" notice
//     - expanded + trades>0 → stats + breakdown + trades list
//
// Filters:
//   - Signal filter: ALL / BUY / SELL / HOLD (chips at the top)
//     Also forwarded to the Backtest panel — so a BUY-only filter in the live
//     list also restricts the backtest to BUY trades.
//   - Days selector: 7 / 14 / 30 / 90 (default 30) — live signals only.
//   - Backtest day selectors: eval_days_ago (7/14/30/90), holding_days
//     (1/3/7/14/30), lookback_days (7/14/30/90) — independent of live days.
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
  History,
  Play,
  ChevronDown,
  ChevronUp,
  Layers,
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
  type SpeculationResponse,
  type SpeculationSignal,
  type SpeculationSignalType,
  type SpeculationBacktestResponse,
  type SpeculationBacktestStatsBlock,
  type SpeculationBacktestTrade,
  type FlipsResponse,
  type FlipOpportunity,
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

// Backtest panel day presets (F5 follow-up, iter 80)
// Defaults match backend DEFAULT_EVAL_DAYS_AGO=14 / DEFAULT_HOLDING_DAYS=7 /
// DEFAULT_LOOKBACK_DAYS=30 (see backend/economy/speculation_backtest.py).
const BACKTEST_EVAL_PRESETS = [7, 14, 30, 90];
const BACKTEST_HOLDING_PRESETS = [1, 3, 7, 14, 30];
const BACKTEST_LOOKBACK_PRESETS = [7, 14, 30, 90];
const BACKTEST_DEFAULT_EVAL_DAYS = 14;
const BACKTEST_DEFAULT_HOLDING_DAYS = 7;
const BACKTEST_DEFAULT_LOOKBACK_DAYS = 30;
const BACKTEST_LIMIT = 50;

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
  const { t, locale } = useI18n();

  // ---- Local input state ----
  const [days, setDays] = useState<number>(DEFAULT_DAYS);
  const [signalFilter, setSignalFilter] = useState<SignalFilterValue>("ALL");

  // ---- Query: speculation signals (primary) ----
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

  // ---- Query: /api/flipper/flips (iter 88, KI-1) ----
  // Fetch synthetic bid/ask spread data IN PARALLEL with speculation signals.
  // The flips endpoint computes synthetic spreads from volume-based formula
  // (see backend/api/routes_arbitrage.py). Joined to speculation signals by
  // api_id (first part of FlipOpportunity.currency, e.g. "divine" from
  // "divine/exalted"). 60s staleTime — synthetic spreads change slowly.
  // Gated on backendOnline + hasSignals to avoid firing on empty state.
  const { data: flipsData } = useQuery<FlipsResponse>({
    queryKey: ["flipperFlips", "speculation-join"],
    queryFn: () => fetchApi<FlipsResponse>("/api/flipper/flips"),
    enabled: backendOnline,
    staleTime: 60_000,
    retry: 1,
  });

  // ---- Build lookup map: api_id → FlipOpportunity (iter 88, KI-1) ----
  // FlipOpportunity.currency is "from/to" — we key by the FROM currency
  // (which is what speculation signals index on). When multiple flips exist
  // for the same from-currency, pick the one with the highest score (most
  // actionable). This is a heuristic — the joins are best-effort since
  // /flips indexes on PAIRS while /speculation indexes on ITEMS.
  //
  // KI-24 evaluation (iter 116): `react-hooks/preserve-manual-memoization` fires
  // here because the React Compiler infers `flipsData` as the dep, but the source
  // uses the narrower `[flipsData?.opportunities]`. The narrow dep is INTENTIONAL
  // — it leverages TanStack Query's structural sharing so the Map only rebuilds
  // when the `opportunities` array reference actually changes (not on every
  // `flipsData` parent-ref change). Removing the `useMemo` would be SAFE for
  // correctness (the result is only consumed during render at line ~508, no
  // downstream effect/useMemo deps read this ref), but would rebuild the Map on
  // every render — a performance regression since React Compiler is NOT enabled
  // in `next.config.ts` (no `reactCompiler: true` in `experimental`). The
  // eslint-disable silences the warning until the compiler is enabled; at that
  // point the `useMemo` can be removed entirely (the compiler will memoize the
  // Map automatically, and the structural-sharing benefit is preserved because
  // the compiler tracks property access precisely).
  // eslint-disable-next-line react-hooks/preserve-manual-memoization -- KI-24: narrow dep leverages TanStack structural sharing; useMemo kept because React Compiler is not enabled (would rebuild Map every render). Revisit after enabling reactCompiler in next.config.ts.
  const flipsByApiId = useMemo(() => {
    const map = new Map<string, FlipOpportunity>();
    if (!flipsData?.opportunities) return map;
    for (const opp of flipsData.opportunities) {
      const fromId = opp.currency.split("/")[0];
      if (!fromId) continue;
      const existing = map.get(fromId);
      // Keep the highest-scored flip per from-currency
      if (!existing || (opp.score ?? 0) > (existing.score ?? 0)) {
        map.set(fromId, opp);
      }
    }
    return map;
  }, [flipsData?.opportunities]);

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
              <SignalRow
                key={`${sig.apiId}-${sig.zScore}`}
                signal={sig}
                t={t}
                locale={locale}
                flip={flipsByApiId.get(sig.apiId)}
              />
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

        {/* ============ Backtest panel (F5 follow-up, iter 80) ============ */}
        {/* Mounted below the live signals list. NOT autoload — toggle button
            controls whether the backtest query is enabled. Backtest is
            compute-heavy (iterates every item with enough price history), so
            it's opt-in to avoid loading the backend on every Speculation tab
            visit. See PRODUCT_VISION §3.2 + AGENT_NAVIGATION invariant #33. */}
        <BacktestPanel
          backendOnline={backendOnline}
          signalFilter={signalFilter}
        />
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
  locale: string;
  /** iter 88 (KI-1): optional synthetic bid/ask spread from /api/flipper/flips.
   *  Undefined when no matching flip exists for this item's api_id. */
  flip?: FlipOpportunity;
}

function SignalRow({ signal, t, locale, flip }: SignalRowProps) {
  const [expanded, setExpanded] = useState(false);
  const lineColor =
    signal.signal === "BUY"
      ? "text-emerald-500"
      : signal.signal === "SELL"
        ? "text-red-500"
        : "text-amber-500";

  // iter 87: Compute potential profit % from mean-reversion assumption.
  // BUY  → price expected to revert UP toward mean   → profit = (mean - current) / current
  // SELL → price expected to revert DOWN toward mean → profit = (current - mean) / current
  // HOLD → no actionable signal                      → profit = 0
  const potentialProfitPct = useMemo(() => {
    if (signal.currentPrice == null || signal.currentPrice <= 0 || signal.mean == null) return null;
    if (signal.signal === "BUY")  return ((signal.mean - signal.currentPrice) / signal.currentPrice) * 100;
    if (signal.signal === "SELL") return ((signal.currentPrice - signal.mean) / signal.currentPrice) * 100;
    return 0;
  }, [signal.signal, signal.currentPrice, signal.mean]);

  // Localize the signal enum for display
  const signalLabel =
    signal.signal === "BUY"  ? t("speculationFilterBuy")
    : signal.signal === "SELL" ? t("speculationFilterSell")
    : t("speculationFilterHold");

  // Localize the category slug
  const categoryLabel = signal.category
    ? (getCategoryDisplayName(signal.category, locale) || titleCase(signal.category))
    : "";

  // Localize the item name
  const itemLabel = getCurrencyDisplayName(signal.apiId, locale) || signal.text;

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
            <span className="ml-1">{signalLabel}</span>
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
          <span title={t("speculationZScoreTitle")}>
            z = <span className={lineColor}>{fmtZ(signal.zScore)}</span>
          </span>
          <span title={t("speculationPercentileTitle")}>
            p = <span className={lineColor}>{fmtPct(signal.percentile)}</span>
          </span>
          {potentialProfitPct != null && (
            <span title={t("speculationPotentialProfitTitle")}>
              {t("speculationPotentialProfit")}:{" "}
              <span className={lineColor}>
                {potentialProfitPct > 0 ? "+" : ""}{potentialProfitPct.toFixed(1)}%
              </span>
            </span>
          )}
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
        <div className="flex items-center gap-2">
          <div className={lineColor}>
            <Sparkline points={signal.priceHistoryShort} color="currentColor" />
          </div>
          {/* iter 88 (KI-1): Expandable details toggle — only render when
              synthetic spread data is available for this item. */}
          {flip && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              aria-label={t("speculationSpreadDetails")}
              data-testid={`speculation-spread-toggle-${signal.apiId}`}
            >
              <Layers className="h-3 w-3" aria-hidden="true" />
              {expanded
                ? <ChevronUp className="h-3 w-3" aria-hidden="true" />
                : <ChevronDown className="h-3 w-3" aria-hidden="true" />}
            </Button>
          )}
        </div>
      </div>

      {/* iter 88 (KI-1): Expandable spread details — synthetic bid/ask from /flips.
          Shown only when the user clicks the toggle AND a matching FlipOpportunity
          exists for this item's api_id. */}
      {expanded && flip && (
        <div
          className="mt-2 pt-2 border-t border-border/40 grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px]"
          data-testid={`speculation-spread-details-${signal.apiId}`}
        >
          {/* Synthetic bid */}
          <div className="space-y-0.5">
            <p className="text-muted-foreground/70">{t("speculationSyntheticBid")}</p>
            <p className="font-mono text-emerald-500">{fmt(flip.bid)}</p>
          </div>
          {/* Synthetic ask */}
          <div className="space-y-0.5">
            <p className="text-muted-foreground/70">{t("speculationSyntheticAsk")}</p>
            <p className="font-mono text-red-500">{fmt(flip.ask)}</p>
          </div>
          {/* Synthetic spread */}
          <div className="space-y-0.5">
            <p className="text-muted-foreground/70">{t("speculationSyntheticSpread")}</p>
            <p className="font-mono">
              {flip.spread != null ? `${flip.spread.toFixed(2)}%` : "—"}
            </p>
          </div>
          {/* Mid price */}
          <div className="space-y-0.5">
            <p className="text-muted-foreground/70">{t("speculationSyntheticMid")}</p>
            <p className="font-mono">{fmt(flip.midPrice)}</p>
          </div>
          {/* Fair cross-rate + deviation (second row, full width) */}
          {flip.fairRate != null && (
            <div className="col-span-2 sm:col-span-4 space-y-0.5">
              <p className="text-muted-foreground/70">
                {t("speculationFairRateLabel")}: <span className="font-mono">{fmt(flip.fairRate)}</span>
                {flip.deviationPct != null && (
                  <>
                    {" · "}
                    {t("speculationDeviationLabel")}:{" "}
                    <span className={`font-mono ${Math.abs(flip.deviationPct) >= 5 ? "text-amber-500" : ""}`}>
                      {flip.deviationPct > 0 ? "+" : ""}{flip.deviationPct.toFixed(2)}%
                    </span>
                  </>
                )}
                {flip.volume24h != null && (
                  <>
                    {" · "}
                    {t("speculationVolumeLabel")}: <span className="font-mono">{fmt(flip.volume24h)}</span>
                  </>
                )}
              </p>
              <p className="text-muted-foreground/60 text-[10px] italic">
                {t("speculationSpreadDisclaimer")}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// BacktestPanel — optional collapsible panel that replays the BUY/SELL/HOLD
// strategy on historical price_logs and shows aggregated profitability.
// (F5 follow-up, iter 80)
//
// NOT autoload: the parent SpeculationTab mounts this panel below the live
// signals list, but the backtest query only fires when the user clicks the
// "Run backtest" toggle button. Rationale: backtest is significantly more
// expensive than the live signal (iterates every item with enough price
// history) — keeping it opt-in avoids loading the backend on every Speculation
// tab visit. See AGENT_NAVIGATION invariant #33.
//
// Props:
//   backendOnline — pass-through from parent (panel only renders when online;
//                   parent's offline card already short-circuits the whole tab)
//   signalFilter  — pass-through from parent's filter chip state. When parent
//                   filters to BUY-only, the backtest also restricts to BUY
//                   trades. HOLD-only is a no-op for backtest (HOLD signals
//                   never produce trades) but still produces a stats block.
// ===========================================================================

interface BacktestPanelProps {
  backendOnline: boolean;
  signalFilter: SignalFilterValue;
}

function BacktestPanel({ backendOnline, signalFilter }: BacktestPanelProps) {
  const { t, locale } = useI18n();

  // ---- Local input state ----
  const [showBacktest, setShowBacktest] = useState(false);
  const [evalDays, setEvalDays] = useState<number>(BACKTEST_DEFAULT_EVAL_DAYS);
  const [holdingDays, setHoldingDays] = useState<number>(BACKTEST_DEFAULT_HOLDING_DAYS);
  const [lookbackDays, setLookbackDays] = useState<number>(BACKTEST_DEFAULT_LOOKBACK_DAYS);

  // ---- Query ----
  // NOT autoload — `enabled` is gated on `showBacktest && backendOnline`.
  // 60s staleTime — backtest results don't change second-to-second.
  // retry: 1 — one retry for transient blips, then surface the error.
  const { data, isLoading, isError, refetch } = useQuery<SpeculationBacktestResponse>({
    queryKey: ["speculation-backtest", evalDays, holdingDays, lookbackDays, signalFilter],
    queryFn: () =>
      fetchApi<SpeculationBacktestResponse>("/api/flipper/speculation/backtest", {
        eval_days_ago: String(evalDays),
        holding_days: String(holdingDays),
        lookback_days: String(lookbackDays),
        limit: String(BACKTEST_LIMIT),
        signal: signalFilter,
      }),
    enabled: showBacktest && backendOnline,
    staleTime: 60_000,
    retry: 1,
  });

  // ---- Derived ----
  const trades = useMemo(() => data?.trades ?? [], [data]);
  const dataAvailable = data?.dataAvailable ?? false;
  const overallStats = data?.overallStats;
  const buyStats = data?.buyStats;
  const sellStats = data?.sellStats;
  const signalBreakdown = data?.signalBreakdown ?? { BUY: 0, SELL: 0, HOLD: 0 };
  const evaluatedCount = data?.evaluatedCount ?? 0;
  const unevaluatedCount = data?.unevaluatedCount ?? 0;

  // ---- Render: collapsed (default) ----
  // Only the toggle button is visible. No query is fired.
  if (!showBacktest) {
    return (
      <div
        className="border-t border-border/50 pt-3 mt-2"
        data-testid="speculation-backtest-panel-collapsed"
      >
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-center"
          onClick={() => setShowBacktest(true)}
          aria-label={t("speculationBacktestRunButton")}
          aria-expanded={false}
          data-testid="speculation-backtest-toggle"
        >
          <Play className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
          {t("speculationBacktestRunButton")}
          <ChevronDown className="h-3.5 w-3.5 ml-1.5" aria-hidden="true" />
        </Button>
      </div>
    );
  }

  // ---- Render: expanded ----
  return (
    <div
      className="border-t border-border/50 pt-3 mt-2 space-y-3"
      data-testid="speculation-backtest-panel"
    >
      {/* Header row: title + collapse button */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <History className="h-4 w-4 text-violet-500 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-sm font-medium leading-tight">{t("speculationBacktestTitle")}</p>
            <p className="text-[11px] text-muted-foreground leading-tight">
              {t("speculationBacktestSubtitle")}
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7"
          onClick={() => setShowBacktest(false)}
          aria-label={t("speculationBacktestHideButton")}
          aria-expanded={true}
          data-testid="speculation-backtest-toggle"
        >
          <ChevronUp className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
          <span className="text-xs">{t("speculationBacktestHideButton")}</span>
        </Button>
      </div>

      {/* Day selectors: eval_days_ago / holding_days / lookback_days */}
      <div className="flex items-end gap-2 flex-wrap">
        <DaySelector
          label={t("speculationBacktestEvalDaysLabel", { 0: evalDays })}
          presets={BACKTEST_EVAL_PRESETS}
          value={evalDays}
          onChange={setEvalDays}
          testId="speculation-backtest-eval-days"
        />
        <DaySelector
          label={t("speculationBacktestHoldingDaysLabel", { 0: holdingDays })}
          presets={BACKTEST_HOLDING_PRESETS}
          value={holdingDays}
          onChange={setHoldingDays}
          testId="speculation-backtest-holding-days"
        />
        <DaySelector
          label={t("speculationBacktestLookbackDaysLabel", { 0: lookbackDays })}
          presets={BACKTEST_LOOKBACK_PRESETS}
          value={lookbackDays}
          onChange={setLookbackDays}
          testId="speculation-backtest-lookback-days"
        />
        {/* Refresh button */}
        <Button
          variant="ghost"
          size="sm"
          className="h-8"
          onClick={() => refetch()}
          aria-label={t("speculationRefresh")}
          data-testid="speculation-backtest-refresh"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </div>

      {/* Loading state */}
      {isLoading && (
        <p className="text-sm text-muted-foreground italic" data-testid="speculation-backtest-loading">
          {t("speculationBacktestLoading")}
        </p>
      )}

      {/* Error state */}
      {isError && (
        <div
          className="rounded-md border border-red-500/30 bg-red-500/5 p-2 text-sm text-red-600 dark:text-red-400 flex items-center gap-2"
          data-testid="speculation-backtest-error"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{t("speculationBacktestError")}</span>
        </div>
      )}

      {/* No data available */}
      {!isLoading && !isError && !dataAvailable && (
        <p className="text-sm text-muted-foreground italic" data-testid="speculation-backtest-no-data">
          {t("speculationBacktestNoData")}
        </p>
      )}

      {/* No trades produced (dataAvailable=true but trades list is empty) */}
      {!isLoading && !isError && dataAvailable && trades.length === 0 && (
        <p className="text-sm text-muted-foreground italic" data-testid="speculation-backtest-no-trades">
          {t("speculationBacktestNoTrades")}
        </p>
      )}

      {/* Main content: stats + breakdown + trades list */}
      {!isLoading && !isError && dataAvailable && trades.length > 0 && (
        <div className="space-y-3" data-testid="speculation-backtest-content">
          {/* Stats blocks: Overall + BUY + SELL */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <StatsBlock
              title={t("speculationBacktestStatsOverall")}
              stats={overallStats}
              accent="overall"
              testId="speculation-backtest-stats-overall"
              t={t}
            />
            <StatsBlock
              title={t("speculationBacktestStatsBuy")}
              stats={buyStats}
              accent="buy"
              testId="speculation-backtest-stats-buy"
              t={t}
            />
            <StatsBlock
              title={t("speculationBacktestStatsSell")}
              stats={sellStats}
              accent="sell"
              testId="speculation-backtest-stats-sell"
              t={t}
            />
          </div>

          {/* Signal breakdown */}
          <div
            className="rounded-md border border-border/60 p-2 text-[11px] font-mono flex items-center gap-3 flex-wrap"
            data-testid="speculation-backtest-breakdown"
          >
            <span className="font-sans text-muted-foreground">{t("speculationBacktestBreakdownTitle")}:</span>
            <span className="text-emerald-600 dark:text-emerald-400">{t("speculationFilterBuy")} {signalBreakdown.BUY ?? 0}</span>
            <span className="text-red-600 dark:text-red-400">{t("speculationFilterSell")} {signalBreakdown.SELL ?? 0}</span>
            <span className="text-amber-600 dark:text-amber-400">{t("speculationFilterHold")} {signalBreakdown.HOLD ?? 0}</span>
            <span className="text-muted-foreground/70">·</span>
            <span>{t("speculationBacktestEvaluated", { 0: evaluatedCount })}</span>
            <span>{t("speculationBacktestUnevaluated", { 0: unevaluatedCount })}</span>
          </div>

          {/* Top trades list */}
          <div data-testid="speculation-backtest-trades">
            <p className="text-xs font-medium mb-1.5">{t("speculationBacktestTradesTitle")}</p>
            <div className="space-y-1">
              {trades.map((tr) => (
                <TradeRow key={`${tr.apiId}-${tr.entryDate}`} trade={tr} t={t} locale={locale} />
              ))}
            </div>
          </div>

          {/* Footer with fetched-at + trade count */}
          {data?.fetchedAt && (
            <p className="text-[10px] text-muted-foreground/70">
              <Activity className="inline h-3 w-3 mr-1" aria-hidden="true" />
              {t("speculationBacktestFetchedAt", { 0: new Date(data.fetchedAt).toLocaleString() })}
              {" · "}
              {t("speculationBacktestTradesCount", { 0: trades.length })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DaySelector — small reusable select for backtest day presets
// ---------------------------------------------------------------------------

interface DaySelectorProps {
  label: string;
  presets: number[];
  value: number;
  onChange: (v: number) => void;
  testId: string;
}

function DaySelector({ label, presets, value, onChange, testId }: DaySelectorProps) {
  return (
    <div className="flex flex-col gap-0.5" data-testid={testId}>
      <span className="text-[10px] text-muted-foreground/80 leading-none">{label}</span>
      <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
        <SelectTrigger className="h-8 w-[120px]" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {presets.map((d) => (
            <SelectItem key={d} value={String(d)}>
              {d}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ---------------------------------------------------------------------------
// StatsBlock — single stats card (overall / BUY / SELL)
// ---------------------------------------------------------------------------

interface StatsBlockProps {
  title: string;
  stats: SpeculationBacktestStatsBlock | undefined;
  accent: "overall" | "buy" | "sell";
  testId: string;
  t: (key: TranslationKeys, params?: Record<string, string | number>) => string;
}

function StatsBlock({ title, stats, accent, testId, t }: StatsBlockProps) {
  const accentClass =
    accent === "buy"
      ? "border-emerald-500/40 bg-emerald-500/5"
      : accent === "sell"
        ? "border-red-500/40 bg-red-500/5"
        : "border-border/60 bg-muted/20";

  // Format a return_pct with sign + 2 decimals: 12.34 → "+12.34%", -5.1 → "-5.10%"
  const fmtReturn = (n: number | undefined | null): string => {
    if (n === undefined || n === null || !Number.isFinite(n)) return "—";
    return `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
  };

  // Color a return value: green if >0, red if <0, muted if 0/null
  const returnColor = (n: number | undefined | null): string => {
    if (n === undefined || n === null || !Number.isFinite(n) || n === 0) return "text-muted-foreground";
    return n > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400";
  };

  const count = stats?.count ?? 0;
  const winRate = stats?.winRate ?? 0;
  const meanReturn = stats?.meanReturnPct ?? 0;
  const medianReturn = stats?.medianReturnPct ?? 0;
  const bestReturn = stats?.bestReturnPct ?? 0;
  const worstReturn = stats?.worstReturnPct ?? 0;

  return (
    <div
      className={`rounded-md border ${accentClass} p-2 space-y-1 text-[11px] font-mono`}
      data-testid={testId}
    >
      <div className="flex items-center justify-between font-sans text-xs font-medium">
        <span>{title}</span>
        <span className="text-muted-foreground">{count}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">{t("speculationBacktestWinRate")}</span>
        <span>{winRate.toFixed(1)}%</span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">{t("speculationBacktestMeanReturn")}</span>
        <span className={returnColor(meanReturn)}>{fmtReturn(meanReturn)}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">{t("speculationBacktestMedianReturn")}</span>
        <span className={returnColor(medianReturn)}>{fmtReturn(medianReturn)}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">{t("speculationBacktestBestReturn")}</span>
        <span className={returnColor(bestReturn)}>{fmtReturn(bestReturn)}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">{t("speculationBacktestWorstReturn")}</span>
        <span className={returnColor(worstReturn)}>{fmtReturn(worstReturn)}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TradeRow — single realised trade in the top-trades list
// ---------------------------------------------------------------------------

interface TradeRowProps {
  trade: SpeculationBacktestTrade;
  t: (key: TranslationKeys, params?: Record<string, string | number>) => string;
  locale: string;
}

function TradeRow({ trade, t, locale }: TradeRowProps) {
  const isProfit = trade.returnPct > 0;
  const isLoss = trade.returnPct < 0;
  const returnClass = isProfit
    ? "text-emerald-600 dark:text-emerald-400"
    : isLoss
      ? "text-red-600 dark:text-red-400"
      : "text-muted-foreground";

  return (
    <div
      data-testid={`speculation-backtest-trade-${trade.apiId}`}
      className="rounded-md border border-border/40 p-2 text-[11px] font-mono flex items-center justify-between gap-2 flex-wrap hover:bg-accent/30 transition-colors"
    >
      {/* Left: signal badge + item name + category */}
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <Badge variant="outline" className={`text-[10px] px-1 py-0 ${signalBadgeClass(trade.signal)}`}>
          {signalIcon(trade.signal)}
          <span className="ml-0.5">{trade.signal === "BUY" ? t("speculationFilterBuy") : trade.signal === "SELL" ? t("speculationFilterSell") : t("speculationFilterHold")}</span>
        </Badge>
        <span className="text-sm font-medium truncate font-sans" title={getCurrencyDisplayName(trade.apiId, locale) || trade.text}>
          {getCurrencyDisplayName(trade.apiId, locale) || trade.text}
        </span>
        {trade.category && (
          <span className="text-[10px] text-muted-foreground/80">
            · {getCategoryDisplayName(trade.category, locale) || titleCase(trade.category)}
          </span>
        )}
      </div>
      {/* Right: entry → exit + return_pct */}
      <div className="flex items-center gap-2 shrink-0">
        <span title={t("speculationBacktestTradeColEntry")}>
          {fmt(trade.entryPrice)}
        </span>
        <span className="text-muted-foreground/60">→</span>
        <span title={t("speculationBacktestTradeColExit")}>
          {fmt(trade.exitPrice)}
        </span>
        <span
          className={`font-semibold ${returnClass}`}
          title={t("speculationBacktestTradeColReturn")}
        >
          {trade.returnPct > 0 ? "+" : ""}{trade.returnPct.toFixed(2)}%
        </span>
      </div>
    </div>
  );
}
