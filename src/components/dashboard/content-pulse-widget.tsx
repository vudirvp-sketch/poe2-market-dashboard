// ============================================================================
// Content Pulse Widget — "Что фармить сегодня" (F4, iter 76).
//
// Wraps GET /api/flipper/content-pulse (proxied to FastAPI
// GET /api/v1/content-pulse — implemented in iter 75 as F3).
//
// Renders a compact two-column card on the Overview tab (the dashboard's
// landing view), directly above MarketOverview:
//
//   ┌─────────────────────────────────────────────────────────────────────┐
//   │  🌱 Что фармить сегодня                                  [refresh]   │
//   │  Today's trade-volume signals per league mechanic.                  │
//   ├──────────────────────────────────┬──────────────────────────────────┤
//   │  RISING (worth farming)          │  FALLING (avoid for now)         │
//   │  ──────────────────────────────  │  ──────────────────────────────  │
//   │  ▲ Breach       +34% (7d)        │  ▼ Ritual       -28% (7d)        │
//   │     • Xoph's Catalyst  +12%      │     • Omni Rune        -8%       │
//   │     • Breachstone      +9%       │     • Ritual Vessel    -6%       │
//   │                                  │                                  │
//   │  ▲ Delirium     +18% (7d)        │  ▼ Expedition   -15% (7d)        │
//   │     • Simulacrum Shard  +5%      │     • Logbook         -4%        │
//   └──────────────────────────────────┴──────────────────────────────────┘
//
// Rationale
// ---------
// Per PRODUCT_VISION §3.5 + §3.6: the dashboard's "killer feature" is a
// one-glance view of which league mechanics are heating up (rising prices
// on shrinking supply → farm now) and which are cooling down (falling
// prices on growing supply → avoid). The F3 backend (iter 75) computes
// per-category today_volume + 7d/30d rolling averages + delta_7d_pct +
// signal (rising/falling/stable) + top-3 rising/falling items per
// category. This widget surfaces that data on the main dashboard.
//
// Graceful degradation
// --------------------
//   - backend offline → compact "offline" notice (no full-card takeover —
//     the rest of the Overview tab stays usable)
//   - data_available=false → "no data yet" notice (scheduler hasn't
//     populated price_histories from ByCategory)
//   - all categories stable → "no strong signals today" notice
//   - loading → skeleton spinner
// ============================================================================

"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Activity,
  Sparkles,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import type { TranslationKeys } from "@/lib/i18n/locales/en";
import { getCategoryDisplayName, getCurrencyDisplayName } from "@/lib/currency-names";
import {
  fetchApi,
  fmt,
  type ContentPulseResponse,
  type ContentPulseCategory,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ContentPulseWidgetProps {
  /** Whether the FastAPI analytics backend is reachable (dashboard-level check). */
  backendOnline: boolean;
  /** Optional: how many rising + falling categories to show. Default 2 each. */
  maxPerSide?: number;
}

// ---------------------------------------------------------------------------
// Default config — exported for tests
// ---------------------------------------------------------------------------

export const DEFAULT_MAX_PER_SIDE = 2;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format a signed percentage: 12.3 → "+12.30%", -4.5 → "-4.50%", null → "—". */
function fmtSignedPct(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
}

/** Title-case a category slug: "breach" → "Breach", "ritual" → "Ritual". */
function titleCase(s: string): string {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ContentPulseWidget({
  backendOnline,
  maxPerSide = DEFAULT_MAX_PER_SIDE,
}: ContentPulseWidgetProps) {
  const { t, locale } = useI18n();

  // ---- Query ----
  // 60s staleTime — content pulse changes slowly (rolling 7d average), no
  // need to refetch on every dashboard focus. Retry once for transient
  // network blips.
  const { data, isLoading, isError, refetch } = useQuery<ContentPulseResponse>({
    queryKey: ["contentPulse"],
    queryFn: () => fetchApi<ContentPulseResponse>("/api/flipper/content-pulse"),
    enabled: backendOnline,
    staleTime: 60_000,
    retry: 1,
  });

  // ---- Derived: split categories into rising / falling / stable ----
  // Filter out stable (|delta_7d_pct| < 10%) — those are noise for this widget.
  // Sort by |delta_7d_pct| desc (already sorted by backend, but defensive).
  const { rising, falling } = useMemo(() => {
    if (!data?.categories) return { rising: [], falling: [] };
    const r = data.categories
      .filter((c) => c.signal === "rising")
      .slice(0, maxPerSide);
    const f = data.categories
      .filter((c) => c.signal === "falling")
      .slice(0, maxPerSide);
    return { rising: r, falling: f };
  }, [data, maxPerSide]);

  const dataAvailable = data?.dataAvailable ?? false;
  const hasSignals = rising.length > 0 || falling.length > 0;

  // ---- Render: backend offline ----
  // Compact notice — doesn't take over the whole card. The widget is one
  // of several panels on the Overview tab; an offline state here shouldn't
  // hide the rest of the dashboard.
  if (!backendOnline) {
    return (
      <Card className="border-amber-500/30">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-5 w-5 text-amber-500" aria-hidden="true" />
            {t("contentPulseTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground pt-0">
          {t("contentPulseOffline")}
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
            {t("contentPulseTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground pt-0">
          {t("contentPulseLoading")}
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
            {t("contentPulseTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground pt-0">
          {t("contentPulseError")}
          <Button
            variant="ghost"
            size="sm"
            className="ml-2 h-7"
            onClick={() => refetch()}
            aria-label={t("contentPulseRefresh")}
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
            {t("contentPulseTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground pt-0">
          {t("contentPulseNoData")}
        </CardContent>
      </Card>
    );
  }

  // ---- Render: data available but no strong signals ----
  if (!hasSignals) {
    return (
      <Card>
        <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-5 w-5 text-violet-500" aria-hidden="true" />
            {t("contentPulseTitle")}
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            className="h-7"
            onClick={() => refetch()}
            aria-label={t("contentPulseRefresh")}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="ml-1 text-xs">{t("contentPulseRefresh")}</span>
          </Button>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground pt-0">
          {t("contentPulseNoSignals")}
        </CardContent>
      </Card>
    );
  }

  // ---- Main render: rising + falling columns ----
  return (
    <Card data-testid="content-pulse-widget">
      <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
        <div className="flex flex-col gap-0.5">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-5 w-5 text-violet-500" aria-hidden="true" />
            {t("contentPulseTitle")}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            {t("contentPulseSubtitle")}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7"
          onClick={() => refetch()}
          aria-label={t("contentPulseRefresh")}
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="ml-1 text-xs">{t("contentPulseRefresh")}</span>
        </Button>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid gap-4 md:grid-cols-2">
          {/* ====== RISING column ====== */}
          <div data-testid="content-pulse-rising" className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-emerald-600 dark:text-emerald-400">
              <TrendingUp className="h-4 w-4" aria-hidden="true" />
              {t("contentPulseRising")}
            </div>
            {rising.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">
                {t("contentPulseNoRising")}
              </p>
            ) : (
              rising.map((cat) => (
                <CategoryBlock
                  key={`rising-${cat.category}`}
                  category={cat}
                  side="rising"
                  t={t}
                  locale={locale}
                />
              ))
            )}
          </div>

          {/* ====== FALLING column ====== */}
          <div data-testid="content-pulse-falling" className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-red-600 dark:text-red-400">
              <TrendingDown className="h-4 w-4" aria-hidden="true" />
              {t("contentPulseFalling")}
            </div>
            {falling.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">
                {t("contentPulseNoFalling")}
              </p>
            ) : (
              falling.map((cat) => (
                <CategoryBlock
                  key={`falling-${cat.category}`}
                  category={cat}
                  side="falling"
                  t={t}
                  locale={locale}
                />
              ))
            )}
          </div>
        </div>

        {/* Footer with last-updated timestamp */}
        {data?.fetchedAt && (
          <p className="mt-4 text-[10px] text-muted-foreground/70">
            <Activity className="inline h-3 w-3 mr-1" aria-hidden="true" />
            {t("contentPulseFetchedAt", { 0: new Date(data.fetchedAt).toLocaleString() })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// CategoryBlock — renders one category's signal + top movers
// ---------------------------------------------------------------------------

interface CategoryBlockProps {
  category: ContentPulseCategory;
  side: "rising" | "falling";
  t: (key: TranslationKeys, params?: Record<string, string | number>) => string;
  locale: string;
}

function CategoryBlock({ category, side, t, locale }: CategoryBlockProps) {
  const isRising = side === "rising";
  const movers = isRising ? category.topRising : category.topFalling;
  const deltaLabel = fmtSignedPct(category.delta7dPct);

  // Color: rising → emerald, falling → red
  const badgeClass = isRising
    ? "border-emerald-500/50 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
    : "border-red-500/50 text-red-600 dark:text-red-400 bg-red-500/10";

  return (
    <div
      data-testid={`content-pulse-category-${side}-${category.category}`}
      className="rounded-md border border-border/60 p-3 space-y-2"
    >
      {/* Header: category name + 7d delta badge */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">
          {getCategoryDisplayName(category.category, locale) || titleCase(category.category)}
        </span>
        <Badge variant="outline" className={`text-xs ${badgeClass}`}>
          {deltaLabel} ({t("contentPulse7d")})
        </Badge>
      </div>

      {/* Movers list */}
      {movers.length === 0 ? (
        <p className="text-[11px] text-muted-foreground italic">
          {t("contentPulseNoMovers")}
        </p>
      ) : (
        <ul className="space-y-1">
          {movers.map((m) => (
            <li
              key={`${m.apiId}-${m.trendPct}`}
              className="flex items-center justify-between gap-2 text-xs"
            >
              <span className="truncate text-foreground/80" title={getCurrencyDisplayName(m.apiId, locale) || m.text}>
                {getCurrencyDisplayName(m.apiId, locale) || m.text}
              </span>
              <span
                className={
                  m.trendPct > 0
                    ? "text-emerald-600 dark:text-emerald-400 font-mono"
                    : m.trendPct < 0
                      ? "text-red-600 dark:text-red-400 font-mono"
                      : "text-muted-foreground font-mono"
                }
              >
                {fmtSignedPct(m.trendPct)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Volume meta line */}
      <p className="text-[10px] text-muted-foreground/70">
        {t("contentPulseVolumeToday", { 0: fmt(category.todayVolume) })}
        {" · "}
        {t("contentPulseItems", { 0: category.itemCount })}
      </p>
    </div>
  );
}
