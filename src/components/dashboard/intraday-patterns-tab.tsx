// ============================================================================
// Intraday Patterns Tab — time-of-day price pattern detector (P4, iter 98).
//
// Wraps GET /api/flipper/intraday-patterns (proxied to FastAPI
// GET /api/v1/intraday-patterns — implemented in iter 98). The pure function
// lives in backend/economy/intraday_patterns.py.
//
// Renders a heatmap: rows = currencies, columns = UTC hours 0..23. Each
// cell shows the per-hour mean price relative to the currency's overall
// mean — green = below mean (buy zone), red = above mean (sell zone).
// Buy window (min mean hour) and Sell window (max mean hour) are
// highlighted with emerald/amber borders.
//
//   ┌──────────────────────────────────────────────────────────────────────┐
//   │  Chaos Orb                    [BUY 0:00] [SELL 20:00]   range 100.0% │
//   │  ▓▓▓░░░░░░░░░░░░░░░░░▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░  (heatmap row)     │
//   │  4 pts · overall 20.00 · current 30.00                               │
//   └──────────────────────────────────────────────────────────────────────┘
//
// Rationale (PRODUCT_VISION + docs/MARKET_PLAYBOOK.md §P4):
//   - Asia-wake hours: farmers dump loot → supply spike → prices fall.
//   - US/EU-wake hours: demand spikes → prices rise.
//   - Buy at Asia-wake (min mean hour), sell at US/EU-wake (max mean hour).
//   - Significant pattern = |sell - buy| / overall > 10%.
//
// Graceful degradation:
//   - backendOffline → offline card with start-backend hint
//   - data_available=false → "no price history yet" notice
//   - other fetch errors → error card + retry
//   - empty patterns list → "no actionable patterns" notice
//   - loading → skeleton spinner
//
// Filters:
//   - Days selector: 7 / 14 / 30 / 90 (default 14).
//   - Significant-only toggle: hides currencies with range < 10%.
// ============================================================================

"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Clock,
  AlertTriangle,
  RefreshCw,
  TrendingDown,
  TrendingUp,
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
  type IntradayPatternsResponse,
  type IntradayPattern,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface IntradayPatternsTabProps {
  /** Whether the FastAPI analytics backend is reachable (dashboard-level check). */
  backendOnline: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DAYS_PRESETS = [7, 14, 30, 90];
const DEFAULT_DAYS = 14;
const DEFAULT_LIMIT = 50;
const HOURS = Array.from({ length: 24 }, (_, i) => i);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Title-case a category slug: "breach" → "Breach". */
function titleCase(s: string): string {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Format a UTC hour as "HH:00" (zero-padded). 0 → "00:00", 23 → "23:00". */
function fmtHour(h: number | null | undefined): string {
  if (h === null || h === undefined || !Number.isFinite(h)) return "—";
  return `${String(h).padStart(2, "0")}:00`;
}

/** Format a signed % with 1 decimal: -40.0 → "-40.0%", +100.0 → "+100.0%". */
function fmtSignedPct(p: number | null | undefined): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return "—";
  return `${p > 0 ? "+" : ""}${p.toFixed(1)}%`;
}

/**
 * Compute a heatmap cell color for a given hour's mean vs the overall mean.
 *
 * Returns a Tailwind class string. The color encodes deviation from the
 * currency's overall mean:
 *   - significantly below mean (>= 5% below) → emerald (buy zone)
 *   - slightly below mean (0..5% below)      → light emerald
 *   - at mean (within ±2%)                    → muted (neutral)
 *   - slightly above mean (0..5% above)      → light red
 *   - significantly above mean (>= 5% above) → red (sell zone)
 *   - no data (count=0)                      → very muted (no data)
 *
 * The 5% threshold is hardcoded — it matches the playbook's intuition
 * that a "buy window" needs at least a 5% discount to be actionable
 * (transaction spread will eat smaller edges).
 */
function cellColor(
  hourMean: number | null,
  overallMean: number,
  count: number,
): string {
  if (count === 0 || hourMean === null || overallMean <= 0) {
    return "bg-muted/20";
  }
  const devPct = ((hourMean - overallMean) / overallMean) * 100;
  if (devPct <= -5) return "bg-emerald-500/70";   // strong buy zone
  if (devPct < -2) return "bg-emerald-500/30";    // mild buy zone
  if (devPct <= 2) return "bg-muted/40";          // neutral
  if (devPct < 5) return "bg-red-500/30";         // mild sell zone
  return "bg-red-500/70";                          // strong sell zone
}

/** Cell title (tooltip) text for a heatmap cell. */
function cellTitle(
  hour: number,
  hourMean: number | null,
  overallMean: number,
  count: number,
): string {
  if (count === 0 || hourMean === null) {
    return `${fmtHour(hour)} — no data`;
  }
  const devPct = overallMean > 0
    ? ((hourMean - overallMean) / overallMean) * 100
    : 0;
  const sign = devPct >= 0 ? "+" : "";
  return `${fmtHour(hour)} — mean ${hourMean.toFixed(2)} (${sign}${devPct.toFixed(1)}% vs overall) · ${count} pts`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function IntradayPatternsTab({ backendOnline }: IntradayPatternsTabProps) {
  const { t, locale } = useI18n();

  // ---- Local input state ----
  const [days, setDays] = useState<number>(DEFAULT_DAYS);
  const [significantOnly, setSignificantOnly] = useState<boolean>(false);

  // ---- Query: intraday patterns ----
  // 30s staleTime — hourly aggregations change slowly (regression over
  // N-day window), no need to refetch on every dashboard focus.
  const { data, isLoading, isError, refetch } = useQuery<IntradayPatternsResponse>({
    queryKey: ["intraday-patterns", days],
    queryFn: () =>
      fetchApi<IntradayPatternsResponse>("/api/flipper/intraday-patterns", {
        days: String(days),
        limit: String(DEFAULT_LIMIT),
      }),
    enabled: backendOnline,
    staleTime: 30_000,
    retry: 1,
  });

  // ---- Derived ----
  const allPatterns = useMemo(() => data?.patterns ?? [], [data]);
  const patterns = useMemo(
    () => (significantOnly ? allPatterns.filter((p) => p.hasSignificantPattern) : allPatterns),
    [allPatterns, significantOnly],
  );
  const dataAvailable = data?.dataAvailable ?? false;
  const hasPatterns = patterns.length > 0;

  // ---- Render: backend offline ----
  if (!backendOnline) {
    return (
      <Card className="border-amber-500/30">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="h-5 w-5 text-amber-500" aria-hidden="true" />
            {t("intradayTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground pt-0 space-y-2">
          <p>{t("intradayOffline")}</p>
          <p className="text-xs text-muted-foreground/70">
            {t("intradayOfflineHint")}
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
            <Clock className="h-5 w-5 text-sky-500" aria-hidden="true" />
            {t("intradayTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground pt-0">
          {t("intradayLoading")}
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
            {t("intradayTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground pt-0">
          {t("intradayError")}
          <Button
            variant="ghost"
            size="sm"
            className="ml-2 h-7"
            onClick={() => refetch()}
            aria-label={t("intradayRefresh")}
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
            <Clock className="h-5 w-5 text-sky-500" aria-hidden="true" />
            {t("intradayTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground pt-0">
          {t("intradayNoData")}
        </CardContent>
      </Card>
    );
  }

  // ---- Main render: filter controls + heatmap ----
  return (
    <Card data-testid="intraday-patterns-tab">
      <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
        <div className="flex flex-col gap-0.5">
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="h-5 w-5 text-sky-500" aria-hidden="true" />
            {t("intradayTitle")}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            {t("intradaySubtitle", { 0: days })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Significant-only toggle */}
          <Badge
            variant={significantOnly ? "default" : "outline"}
            className="cursor-pointer"
            onClick={() => setSignificantOnly((v) => !v)}
            role="button"
            aria-pressed={significantOnly}
            tabIndex={0}
            data-testid="intraday-filter-significant"
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setSignificantOnly((v) => !v);
              }
            }}
          >
            {t("intradayFilterSignificant")}
          </Badge>
          {/* Days selector */}
          <Select
            value={String(days)}
            onValueChange={(v) => setDays(Number(v))}
          >
            <SelectTrigger className="h-8 w-[110px]" aria-label={t("intradayDaysLabel")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DAYS_PRESETS.map((d) => (
                <SelectItem key={d} value={String(d)}>
                  {t("intradayDaysValue", { 0: d })}
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
            aria-label={t("intradayRefresh")}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="ml-1 text-xs">{t("intradayRefresh")}</span>
          </Button>
        </div>
      </CardHeader>

      <CardContent className="pt-0 space-y-4">
        {/* Hour axis header (only shown when there are patterns) */}
        {hasPatterns && (
          <div className="overflow-x-auto">
            <div className="min-w-[640px]">
              <HourAxisHeader t={t} />
            </div>
          </div>
        )}

        {/* Pattern list / heatmap rows */}
        {!hasPatterns ? (
          <p className="text-sm text-muted-foreground italic">
            {significantOnly ? t("intradayNoSignificant") : t("intradayNoPatterns")}
          </p>
        ) : (
          <div className="space-y-2 overflow-x-auto" data-testid="intraday-patterns-list">
            <div className="min-w-[640px] space-y-2">
              {patterns.map((pat) => (
                <PatternRow
                  key={pat.apiId}
                  pattern={pat}
                  t={t}
                  locale={locale}
                />
              ))}
            </div>
          </div>
        )}

        {/* Legend */}
        {hasPatterns && (
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground/80">
            <span className="font-medium">{t("intradayLegendLabel")}:</span>
            <LegendSwatch colorClass="bg-emerald-500/70" label={t("intradayLegendBuy")} />
            <LegendSwatch colorClass="bg-emerald-500/30" label={t("intradayLegendMildBuy")} />
            <LegendSwatch colorClass="bg-muted/40" label={t("intradayLegendNeutral")} />
            <LegendSwatch colorClass="bg-red-500/30" label={t("intradayLegendMildSell")} />
            <LegendSwatch colorClass="bg-red-500/70" label={t("intradayLegendSell")} />
            <LegendSwatch colorClass="bg-muted/20" label={t("intradayLegendNoData")} />
          </div>
        )}

        {/* Footer with last-updated timestamp */}
        {data?.fetchedAt && (
          <p className="text-[10px] text-muted-foreground/70">
            <Clock className="inline h-3 w-3 mr-1" aria-hidden="true" />
            {t("intradayFetchedAt", { 0: new Date(data.fetchedAt).toLocaleString() })}
            {" · "}
            {t("intradayPatternCount", { 0: patterns.length })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// HourAxisHeader — renders the hour labels (00:00 .. 23:00) above the heatmap
// ---------------------------------------------------------------------------

function HourAxisHeader({ t }: { t: (key: TranslationKeys, params?: Record<string, string | number>) => string }) {
  return (
    <div
      className="flex items-center gap-0.5 pl-[180px] pr-[120px]"
      data-testid="intraday-hour-axis"
      aria-label={t("intradayHourAxisLabel")}
    >
      {HOURS.map((h) => (
        <div
          key={h}
          className="flex-1 text-center text-[9px] text-muted-foreground/60 font-mono"
        >
          {String(h).padStart(2, "0")}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// LegendSwatch — a single color swatch + label in the legend
// ---------------------------------------------------------------------------

function LegendSwatch({ colorClass, label }: { colorClass: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`inline-block h-3 w-3 rounded-sm ${colorClass}`} aria-hidden="true" />
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// PatternRow — renders a single currency's intraday pattern + heatmap row
// ---------------------------------------------------------------------------

interface PatternRowProps {
  pattern: IntradayPattern;
  t: (key: TranslationKeys, params?: Record<string, string | number>) => string;
  locale: string;
}

function PatternRow({ pattern, t, locale }: PatternRowProps) {
  // Color the range % based on significance
  const rangeColor = pattern.hasSignificantPattern
    ? "text-amber-600 dark:text-amber-400"
    : "text-muted-foreground";

  // Localize the category slug
  const categoryLabel = pattern.category
    ? (getCategoryDisplayName(pattern.category, locale) || titleCase(pattern.category))
    : "";

  // Localize the item name
  const itemLabel = getCurrencyDisplayName(pattern.apiId, locale) || pattern.text;

  return (
    <div
      data-testid={`intraday-pattern-${pattern.apiId}`}
      className="rounded-md border border-border/60 p-3 space-y-2 hover:bg-accent/30 transition-colors"
    >
      {/* Top row: name + buy/sell badges + range */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-sm font-medium truncate" title={itemLabel}>
            {itemLabel}
          </span>
          {categoryLabel && (
            <span className="text-[11px] text-muted-foreground/80">
              · {categoryLabel}
            </span>
          )}
          {pattern.hasSignificantPattern && (
            <Badge
              variant="outline"
              className="text-xs border-amber-500/50 text-amber-600 dark:text-amber-400 bg-amber-500/10"
              data-testid={`intraday-significant-${pattern.apiId}`}
            >
              {t("intradaySignificant")}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs font-mono shrink-0">
          {pattern.buyWindowHour !== null && (
            <Badge
              variant="outline"
              className="text-xs border-emerald-500/50 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
              title={t("intradayBuyWindowTitle")}
              data-testid={`intraday-buy-window-${pattern.apiId}`}
            >
              <TrendingDown className="h-3 w-3 mr-1" aria-hidden="true" />
              {t("intradayBuyWindow", { 0: fmtHour(pattern.buyWindowHour) })}
            </Badge>
          )}
          {pattern.sellWindowHour !== null && (
            <Badge
              variant="outline"
              className="text-xs border-red-500/50 text-red-600 dark:text-red-400 bg-red-500/10"
              title={t("intradaySellWindowTitle")}
              data-testid={`intraday-sell-window-${pattern.apiId}`}
            >
              <TrendingUp className="h-3 w-3 mr-1" aria-hidden="true" />
              {t("intradaySellWindow", { 0: fmtHour(pattern.sellWindowHour) })}
            </Badge>
          )}
          <span className={rangeColor} title={t("intradayRangeTitle")}>
            {t("intradayRange", { 0: fmtSignedPct(pattern.intradayRangePct) })}
          </span>
        </div>
      </div>

      {/* Heatmap row — 24 cells (one per UTC hour) */}
      <div
        className="flex items-center gap-0.5 h-7"
        data-testid={`intraday-heatmap-${pattern.apiId}`}
        role="img"
        aria-label={t("intradayHeatmapAriaLabel", { 0: itemLabel })}
      >
        {pattern.hourlyStats.map((hs) => {
          const isBuy = pattern.buyWindowHour === hs.hour;
          const isSell = pattern.sellWindowHour === hs.hour;
          // Highlight buy/sell window cells with a ring
          const ringClass = isBuy
            ? "ring-2 ring-emerald-500"
            : isSell
              ? "ring-2 ring-amber-500"
              : "";
          return (
            <div
              key={hs.hour}
              className={`flex-1 h-full rounded-sm ${cellColor(hs.mean, pattern.overallMean, hs.count)} ${ringClass}`}
              title={cellTitle(hs.hour, hs.mean, pattern.overallMean, hs.count)}
              data-testid={`intraday-cell-${pattern.apiId}-${hs.hour}`}
              data-hour={hs.hour}
              data-count={hs.count}
              data-is-buy={isBuy ? "true" : "false"}
              data-is-sell={isSell ? "true" : "false"}
            />
          );
        })}
      </div>

      {/* Bottom row: stats */}
      <div className="text-[11px] text-muted-foreground/80 font-mono">
        <span title={t("intradaySampleSizeTitle")}>
          {t("intradaySampleSize", { 0: pattern.sampleSize })}
        </span>
        {" · "}
        <span title={t("intradayOverallMeanTitle")}>
          {t("intradayOverallMean", { 0: fmt(pattern.overallMean) })}
        </span>
        {" · "}
        <span title={t("intradayCurrentPriceTitle")}>
          {t("intradayCurrent", { 0: fmt(pattern.currentPrice) })}
        </span>
        {pattern.buyWindowMean !== null && (
          <>
            {" · "}
            <span title={t("intradayBuyMeanTitle")}>
              {t("intradayBuyMean", { 0: fmt(pattern.buyWindowMean) })}
            </span>
          </>
        )}
        {pattern.sellWindowMean !== null && (
          <>
            {" · "}
            <span title={t("intradaySellMeanTitle")}>
              {t("intradaySellMean", { 0: fmt(pattern.sellWindowMean) })}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
