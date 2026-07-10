// ============================================================================
// Weekly Patterns Tab — weekday/weekend price pattern detector (P5, iter 99).
//
// Wraps GET /api/flipper/weekly-patterns (proxied to FastAPI
// GET /api/v1/weekly-patterns — implemented in iter 99). The pure function
// lives in backend/economy/weekly_patterns.py.
//
// Renders a heatmap: rows = currencies, columns = 7 weekdays (Mon..Sun).
// Each cell shows the per-weekday mean price relative to the currency's
// overall mean — green = below mean (buy zone), red = above mean (sell
// zone). Buy day (min mean day) and Sell day (max mean day) are
// highlighted with emerald/amber borders.
//
//   ┌──────────────────────────────────────────────────────────────────────┐
//   │  Chaos Orb              [BUY Wed] [SELL Sat]   range 75.0%           │
//   │  ▓▓▓▓▓▓░░▓▓▓▓▓▓▓▓▓▓▓▓  (heatmap row, 7 cells)                       │
//   │  8 pts · overall 20.00 · current 30.00 · Δ weekend +25.0%           │
//   └──────────────────────────────────────────────────────────────────────┘
//
// Rationale (PRODUCT_VISION + docs/MARKET_PLAYBOOK.md §P5):
//   - Weekdays (Mon-Fri): supply is steady → prices are lower.
//   - Weekends (Sat-Sun): demand spikes → prices rise.
//   - Buy on weekday (min mean day), sell on weekend (max mean day).
//   - Significant pattern = |sell - buy| / overall > 10%.
//   - weekday_delta_pct > 0 = weekends MORE expensive (sell on weekend).
//
// Graceful degradation:
//   - backendOffline → offline card with start-backend hint
//   - data_available=false → "no price history yet" notice
//   - other fetch errors → error card + retry
//   - empty patterns list → "no actionable patterns" notice
//   - loading → skeleton spinner
//
// Filters:
//   - Weeks selector: 1 / 2 / 4 / 8 / 12 / 26 (default 4).
//   - Significant-only toggle: hides currencies with range < 10%.
// ============================================================================

"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Calendar,
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
  type WeeklyPatternsResponse,
  type WeeklyPattern,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface WeeklyPatternsTabProps {
  /** Whether the FastAPI analytics backend is reachable (dashboard-level check). */
  backendOnline: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WEEKS_PRESETS = [1, 2, 4, 8, 12, 26];
const DEFAULT_WEEKS = 4;
const DEFAULT_LIMIT = 50;

/** ISO weekday IDs 1..7 (Mon..Sun). Backend always returns 7 entries. */
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Title-case a category slug: "breach" → "Breach". */
function titleCase(s: string): string {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Map ISO weekday (1=Mon..7=Sun) to a short label. The label comes from
 *  the i18n bundle via the `weeklyWeekdayMon`..`weeklyWeekdaySun` keys —
 *  this helper just returns the i18n key suffix. */
function weekdayI18nKey(weekday: number): string {
  switch (weekday) {
    case 1: return "weeklyWeekdayMon";
    case 2: return "weeklyWeekdayTue";
    case 3: return "weeklyWeekdayWed";
    case 4: return "weeklyWeekdayThu";
    case 5: return "weeklyWeekdayFri";
    case 6: return "weeklyWeekdaySat";
    case 7: return "weeklyWeekdaySun";
    default: return "weeklyWeekdayMon";
  }
}

/** Format a signed % with 1 decimal: -40.0 → "-40.0%", +100.0 → "+100.0%". */
function fmtSignedPct(p: number | null | undefined): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return "—";
  return `${p > 0 ? "+" : ""}${p.toFixed(1)}%`;
}

/**
 * Compute a heatmap cell color for a given weekday's mean vs the overall
 * mean. Same logic as intraday-patterns-tab.tsx:cellColor — deviation from
 * the currency's overall mean.
 *
 * Returns a Tailwind class string. The color encodes deviation:
 *   - significantly below mean (>= 5% below) → emerald (buy zone)
 *   - slightly below mean (0..5% below)      → light emerald
 *   - at mean (within ±2%)                    → muted (neutral)
 *   - slightly above mean (0..5% above)      → light red
 *   - significantly above mean (>= 5% above) → red (sell zone)
 *   - no data (count=0)                      → very muted (no data)
 *
 * The 5% threshold matches the intraday tab — it's the intuition that a
 * "buy window" needs at least a 5% discount to be actionable.
 */
function cellColor(
  dayMean: number | null,
  overallMean: number,
  count: number,
): string {
  if (count === 0 || dayMean === null || overallMean <= 0) {
    return "bg-muted/20";
  }
  const devPct = ((dayMean - overallMean) / overallMean) * 100;
  if (devPct <= -5) return "bg-emerald-500/70";   // strong buy zone
  if (devPct < -2) return "bg-emerald-500/30";    // mild buy zone
  if (devPct <= 2) return "bg-muted/40";          // neutral
  if (devPct < 5) return "bg-red-500/30";         // mild sell zone
  return "bg-red-500/70";                          // strong sell zone
}

/** Cell title (tooltip) text for a heatmap cell. */
function cellTitle(
  weekday: number,
  dayMean: number | null,
  overallMean: number,
  count: number,
  weekdayLabel: string,
): string {
  if (count === 0 || dayMean === null) {
    return `${weekdayLabel} — no data`;
  }
  const devPct = overallMean > 0
    ? ((dayMean - overallMean) / overallMean) * 100
    : 0;
  const sign = devPct >= 0 ? "+" : "";
  return `${weekdayLabel} — mean ${dayMean.toFixed(2)} (${sign}${devPct.toFixed(1)}% vs overall) · ${count} pts`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function WeeklyPatternsTab({ backendOnline }: WeeklyPatternsTabProps) {
  const { t, locale } = useI18n();

  // ---- Local input state ----
  const [weeks, setWeeks] = useState<number>(DEFAULT_WEEKS);
  const [significantOnly, setSignificantOnly] = useState<boolean>(false);

  // ---- Query: weekly patterns ----
  // 5min staleTime — weekly aggregations change very slowly (regression
  // over N-week window), no need to refetch on every dashboard focus.
  const { data, isLoading, isError, refetch } = useQuery<WeeklyPatternsResponse>({
    queryKey: ["weekly-patterns", weeks],
    queryFn: () =>
      fetchApi<WeeklyPatternsResponse>("/api/flipper/weekly-patterns", {
        weeks: String(weeks),
        limit: String(DEFAULT_LIMIT),
      }),
    enabled: backendOnline,
    staleTime: 5 * 60_000,
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
            <Calendar className="h-5 w-5 text-amber-500" aria-hidden="true" />
            {t("weeklyTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground pt-0 space-y-2">
          <p>{t("weeklyOffline")}</p>
          <p className="text-xs text-muted-foreground/70">
            {t("weeklyOfflineHint")}
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
            <Calendar className="h-5 w-5 text-sky-500" aria-hidden="true" />
            {t("weeklyTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground pt-0">
          {t("weeklyLoading")}
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
            {t("weeklyTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground pt-0">
          {t("weeklyError")}
          <Button
            variant="ghost"
            size="sm"
            className="ml-2 h-7"
            onClick={() => refetch()}
            aria-label={t("weeklyRefresh")}
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
            <Calendar className="h-5 w-5 text-sky-500" aria-hidden="true" />
            {t("weeklyTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground pt-0">
          {t("weeklyNoData")}
        </CardContent>
      </Card>
    );
  }

  // ---- Main render: filter controls + heatmap ----
  return (
    <Card data-testid="weekly-patterns-tab">
      <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
        <div className="flex flex-col gap-0.5">
          <CardTitle className="flex items-center gap-2 text-base">
            <Calendar className="h-5 w-5 text-sky-500" aria-hidden="true" />
            {t("weeklyTitle")}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            {t("weeklySubtitle", { 0: weeks })}
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
            data-testid="weekly-filter-significant"
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setSignificantOnly((v) => !v);
              }
            }}
          >
            {t("weeklyFilterSignificant")}
          </Badge>
          {/* Weeks selector */}
          <Select
            value={String(weeks)}
            onValueChange={(v) => setWeeks(Number(v))}
          >
            <SelectTrigger className="h-8 w-[110px]" aria-label={t("weeklyWeeksLabel")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WEEKS_PRESETS.map((w) => (
                <SelectItem key={w} value={String(w)}>
                  {t("weeklyWeeksValue", { 0: w })}
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
            aria-label={t("weeklyRefresh")}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="ml-1 text-xs">{t("weeklyRefresh")}</span>
          </Button>
        </div>
      </CardHeader>

      <CardContent className="pt-0 space-y-4">
        {/* Weekday axis header (only shown when there are patterns) */}
        {hasPatterns && (
          <div className="overflow-x-auto">
            <div className="min-w-[520px]">
              <WeekdayAxisHeader t={t} />
            </div>
          </div>
        )}

        {/* Pattern list / heatmap rows */}
        {!hasPatterns ? (
          <p className="text-sm text-muted-foreground italic">
            {significantOnly ? t("weeklyNoSignificant") : t("weeklyNoPatterns")}
          </p>
        ) : (
          <div className="space-y-2 overflow-x-auto" data-testid="weekly-patterns-list">
            <div className="min-w-[520px] space-y-2">
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
            <span className="font-medium">{t("weeklyLegendLabel")}:</span>
            <LegendSwatch colorClass="bg-emerald-500/70" label={t("weeklyLegendBuy")} />
            <LegendSwatch colorClass="bg-emerald-500/30" label={t("weeklyLegendMildBuy")} />
            <LegendSwatch colorClass="bg-muted/40" label={t("weeklyLegendNeutral")} />
            <LegendSwatch colorClass="bg-red-500/30" label={t("weeklyLegendMildSell")} />
            <LegendSwatch colorClass="bg-red-500/70" label={t("weeklyLegendSell")} />
            <LegendSwatch colorClass="bg-muted/20" label={t("weeklyLegendNoData")} />
          </div>
        )}

        {/* Footer with last-updated timestamp */}
        {data?.fetchedAt && (
          <p className="text-[10px] text-muted-foreground/70">
            <Calendar className="inline h-3 w-3 mr-1" aria-hidden="true" />
            {t("weeklyFetchedAt", { 0: new Date(data.fetchedAt).toLocaleString() })}
            {" · "}
            {t("weeklyPatternCount", { 0: patterns.length })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// WeekdayAxisHeader — renders the weekday labels (Mon..Sun) above the heatmap
// ---------------------------------------------------------------------------

function WeekdayAxisHeader({ t }: { t: (key: TranslationKeys, params?: Record<string, string | number>) => string }) {
  return (
    <div
      className="flex items-center gap-0.5 pl-[180px] pr-[60px]"
      data-testid="weekly-weekday-axis"
      aria-label={t("weeklyWeekdayAxisLabel")}
    >
      {WEEKDAYS.map((d) => (
        <div
          key={d}
          className="flex-1 text-center text-[10px] text-muted-foreground/60 font-medium"
        >
          {t(weekdayI18nKey(d) as TranslationKeys)}
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
// PatternRow — renders a single currency's weekly pattern + heatmap row
// ---------------------------------------------------------------------------

interface PatternRowProps {
  pattern: WeeklyPattern;
  t: (key: TranslationKeys, params?: Record<string, string | number>) => string;
  locale: string;
}

function PatternRow({ pattern, t, locale }: PatternRowProps) {
  // Color the range % based on significance
  const rangeColor = pattern.hasSignificantPattern
    ? "text-amber-600 dark:text-amber-400"
    : "text-muted-foreground";

  // Color the weekday_delta % — positive (weekend expensive) = amber/sell hint,
  // negative (weekday expensive) = emerald/buy hint
  const deltaColor = pattern.weekdayDeltaPct > 0
    ? "text-red-600 dark:text-red-400"
    : pattern.weekdayDeltaPct < 0
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-muted-foreground";

  // Localize the category slug
  const categoryLabel = pattern.category
    ? (getCategoryDisplayName(pattern.category, locale) || titleCase(pattern.category))
    : "";

  // Localize the item name
  const itemLabel = getCurrencyDisplayName(pattern.apiId, locale) || pattern.text;

  return (
    <div
      data-testid={`weekly-pattern-${pattern.apiId}`}
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
              data-testid={`weekly-significant-${pattern.apiId}`}
            >
              {t("weeklySignificant")}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs font-mono shrink-0">
          {pattern.buyWindowDay !== null && (
            <Badge
              variant="outline"
              className="text-xs border-emerald-500/50 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
              title={t("weeklyBuyDayTitle")}
              data-testid={`weekly-buy-window-${pattern.apiId}`}
            >
              <TrendingDown className="h-3 w-3 mr-1" aria-hidden="true" />
              {t("weeklyBuyDay", { 0: t(weekdayI18nKey(pattern.buyWindowDay) as TranslationKeys) })}
            </Badge>
          )}
          {pattern.sellWindowDay !== null && (
            <Badge
              variant="outline"
              className="text-xs border-red-500/50 text-red-600 dark:text-red-400 bg-red-500/10"
              title={t("weeklySellDayTitle")}
              data-testid={`weekly-sell-window-${pattern.apiId}`}
            >
              <TrendingUp className="h-3 w-3 mr-1" aria-hidden="true" />
              {t("weeklySellDay", { 0: t(weekdayI18nKey(pattern.sellWindowDay) as TranslationKeys) })}
            </Badge>
          )}
          <span className={rangeColor} title={t("weeklyRangeTitle")}>
            {t("weeklyRange", { 0: fmtSignedPct(pattern.weeklyRangePct) })}
          </span>
        </div>
      </div>

      {/* Heatmap row — 7 cells (one per weekday Mon..Sun) */}
      <div
        className="flex items-center gap-0.5 h-7"
        data-testid={`weekly-heatmap-${pattern.apiId}`}
        role="img"
        aria-label={t("weeklyHeatmapAriaLabel", { 0: itemLabel })}
      >
        {pattern.dailyStats.map((ds) => {
          const isBuy = pattern.buyWindowDay === ds.weekday;
          const isSell = pattern.sellWindowDay === ds.weekday;
          // Highlight buy/sell window cells with a ring
          const ringClass = isBuy
            ? "ring-2 ring-emerald-500"
            : isSell
              ? "ring-2 ring-amber-500"
              : "";
          const weekdayLabel = t(weekdayI18nKey(ds.weekday) as TranslationKeys);
          return (
            <div
              key={ds.weekday}
              className={`flex-1 h-full rounded-sm ${cellColor(ds.mean, pattern.overallMean, ds.count)} ${ringClass}`}
              title={cellTitle(ds.weekday, ds.mean, pattern.overallMean, ds.count, weekdayLabel)}
              data-testid={`weekly-cell-${pattern.apiId}-${ds.weekday}`}
              data-weekday={ds.weekday}
              data-count={ds.count}
              data-is-buy={isBuy ? "true" : "false"}
              data-is-sell={isSell ? "true" : "false"}
            />
          );
        })}
      </div>

      {/* Bottom row: stats */}
      <div className="text-[11px] text-muted-foreground/80 font-mono">
        <span title={t("weeklySampleSizeTitle")}>
          {t("weeklySampleSize", { 0: pattern.sampleSize })}
        </span>
        {" · "}
        <span title={t("weeklyOverallMeanTitle")}>
          {t("weeklyOverallMean", { 0: fmt(pattern.overallMean) })}
        </span>
        {" · "}
        <span title={t("weeklyCurrentPriceTitle")}>
          {t("weeklyCurrent", { 0: fmt(pattern.currentPrice) })}
        </span>
        {pattern.buyWindowMean !== null && (
          <>
            {" · "}
            <span title={t("weeklyBuyMeanTitle")}>
              {t("weeklyBuyMean", { 0: fmt(pattern.buyWindowMean) })}
            </span>
          </>
        )}
        {pattern.sellWindowMean !== null && (
          <>
            {" · "}
            <span title={t("weeklySellMeanTitle")}>
              {t("weeklySellMean", { 0: fmt(pattern.sellWindowMean) })}
            </span>
          </>
        )}
        {" · "}
        <span
          className={deltaColor}
          title={t("weeklyWeekendDeltaTitle")}
        >
          {t("weeklyWeekendDelta", { 0: fmtSignedPct(pattern.weekdayDeltaPct) })}
        </span>
      </div>
    </div>
  );
}
