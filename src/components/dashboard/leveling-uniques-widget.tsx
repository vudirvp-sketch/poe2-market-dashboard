// ============================================================================
// Leveling Uniques Widget — "Leveling Uniques Lifecycle" (P3, iter 100).
//
// Wraps GET /api/flipper/leveling-uniques (proxied to FastAPI
// GET /api/v1/leveling-uniques — implemented in iter 100 as P3).
//
// Renders a compact card on the Overview tab, directly below the PhaseHints
// widget. The card shows the current Day N of the league + a static table
// of well-known leveling uniques (Polcirkeln, Wall of Brambles, Mana Leech
// Support, etc.) with per-item:
//   - Lifecycle stage badge (PRE_PEAK / AT_PEAK / POST_PEAK)
//   - Recommendation badge (BUY/HOLD / SELL NOW / AVOID BUYING)
//   - Estimated current price (heuristic, NOT live market price)
//   - Peak day / peak price reference
//   - Days until/since peak
//   - Notes (localized via ?lang= query param)
//
//   ┌──────────────────────────────────────────────────────────────────────┐
//   │  📈 Leveling Uniques · Day 2 of league · 10 items tracked   [refresh]│
//   │  Currently at peak demand — SELL NOW if you have any of these.       │
//   │                                                                      │
//   │  Item                  Stage      Est. Price   Peak Day   Action      │
//   │  ─────────────────     ───────    ──────────   ────────   ───────     │
//   │  Polcirkeln Sapphire   AT_PEAK    ~15 exa      Day 2      SELL NOW    │
//   │  Wall of Brambles      AT_PEAK    ~8 exa       Day 2      SELL NOW    │
//   │  Mana Leech Support    PRE_PEAK   ~3 exa       Day 2      BUY/HOLD    │
//   │  ...                                                                 │
//   │                                                                      │
//   │  ⚠ Estimated prices are planning heuristics, NOT live market prices. │
//   │  Last updated: 2026-07-10 16:30:25 · 10 items                        │
//   └──────────────────────────────────────────────────────────────────────┘
//
// Rationale (PRODUCT_VISION §3.4 + docs/MARKET_PLAYBOOK.md §P3 + §C.5):
//   - PhaseDetector (backend/economy/lifecycle.py) determines the current
//     league day from `days_since_reference` (since league start or last
//     major patch).
//   - Each leveling unique has a typical "spike-then-crash" price pattern:
//     prices peak on Day 2 (when the early leveling wave reaches endgame),
//     then crash by Day 7+ as supply catches up.
//   - The widget surfaces the lifecycle stage for each unique so the user
//     knows whether to BUY/HOLD (PRE_PEAK), SELL NOW (AT_PEAK), or AVOID
//     BUYING (POST_PEAK).
//
// Immunity to KI-11: This widget only depends on PhaseDetector (which uses
// league_start_datetime from config.yaml, not the upstream POE2Scout API).
// It renders correctly even when the snapshot is empty (e.g. when the
// configured league slug returns 404 from upstream — see KI-11).
//
// Graceful degradation:
//   - backendOffline → compact "offline" notice (no full-card takeover)
//   - data_available=false → "no data" notice (only on exception)
//   - loading → skeleton spinner
//   - error → error card + retry
// ============================================================================

"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  RefreshCw,
  TrendingUp,
  CalendarClock,
  Info,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import type { TranslationKeys } from "@/lib/i18n/locales/en";
import {
  fetchApi,
  type LevelingUniquesResponse,
  type LevelingUnique,
  type LevelingUniqueStage,
  type LevelingUniqueRecommendation,
} from "@/lib/types";
// iter 150: unique-item name localization now uses the curated `nameRu`
// field from the backend (added iter 150 to `LevelingUniqueData`). The
// previous iter-148 implementation called `getUniqueDisplayName(name, "ru")`
// which performed a slug-based lookup against `UNIQUE_NAMES_RU` — but only
// ~1/10 leveling uniques had a matching poe2db slug (e.g. "Mind of the
// Council" matched but "Polcirkeln Sapphire Ring" did NOT match the poe2db
// slug "Polcirkeln"). The backend `nameRu` field is curated at the static
// table level in `backend/economy/leveling_uniques.py` — 4/10 items have a
// confirmed poe2db RU translation, the rest fall back to the EN `name`.
// This removes the fragile slug-mismatch dependency.

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface LevelingUniquesWidgetProps {
  /** Whether the FastAPI analytics backend is reachable (dashboard-level check). */
  backendOnline: boolean;
}

// ---------------------------------------------------------------------------
// Helpers — stage / recommendation badge classes + label keys
// ---------------------------------------------------------------------------

/** Map lifecycle stage → badge color classes.
 *  - PRE_PEAK  → blue (prices rising, opportunity to buy)
 *  - AT_PEAK   → amber (peak demand, time to sell)
 *  - POST_PEAK → muted (crash complete, low activity)
 */
function stageBadgeClass(stage: LevelingUniqueStage): string {
  switch (stage) {
    case "PRE_PEAK":
      return "border-blue-500/50 text-blue-600 dark:text-blue-400 bg-blue-500/10";
    case "AT_PEAK":
      return "border-amber-500/50 text-amber-600 dark:text-amber-400 bg-amber-500/10";
    case "POST_PEAK":
      return "border-muted-foreground/30 text-muted-foreground bg-muted/30";
    default:
      return "border-muted-foreground/30 text-muted-foreground bg-muted/30";
  }
}

/** Map lifecycle stage → localized label key. */
function stageLabelKey(stage: LevelingUniqueStage): TranslationKeys {
  switch (stage) {
    case "PRE_PEAK":
      return "levelingStagePrePeak";
    case "AT_PEAK":
      return "levelingStageAtPeak";
    case "POST_PEAK":
      return "levelingStagePostPeak";
    default:
      return "levelingStageUnknown";
  }
}

/** Map recommendation → badge color classes.
 *  - BUY_OR_HOLD   → emerald (opportunity, prices rising)
 *  - SELL_NOW      → red (urgent action, peak demand)
 *  - AVOID_BUYING  → muted (no action, prices crashing)
 */
function recommendationBadgeClass(rec: LevelingUniqueRecommendation): string {
  switch (rec) {
    case "BUY_OR_HOLD":
      return "border-emerald-500/50 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10";
    case "SELL_NOW":
      return "border-red-500/50 text-red-600 dark:text-red-400 bg-red-500/10";
    case "AVOID_BUYING":
      return "border-muted-foreground/30 text-muted-foreground bg-muted/30";
    default:
      return "border-muted-foreground/30 text-muted-foreground bg-muted/30";
  }
}

/** Map recommendation → localized label key. */
function recommendationLabelKey(rec: LevelingUniqueRecommendation): TranslationKeys {
  switch (rec) {
    case "BUY_OR_HOLD":
      return "levelingRecBuyOrHold";
    case "SELL_NOW":
      return "levelingRecSellNow";
    case "AVOID_BUYING":
      return "levelingRecAvoidBuying";
    default:
      return "levelingRecUnknown";
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function LevelingUniquesWidget({ backendOnline }: LevelingUniquesWidgetProps) {
  const { t, locale } = useI18n();

  // ---- Query ----
  // 5min staleTime — phase only changes once per day at most (when
  // days_since_reference crosses the early/mid or mid/late boundary).
  // The lifecycle stage for each unique only changes when crossing peak_day
  // or peak_day+1 boundaries — also once per day at most. No need to refetch
  // on every dashboard focus. Retry once for transient network blips.
  //
  // Forward `lang` to the backend so it returns the parallel Russian notes
  // for ru locale. The queryKey includes `locale` so switching language
  // triggers a refetch with the right locale.
  const lang = locale === "ru" ? "ru" : "en";
  const { data, isLoading, isError, refetch } = useQuery<LevelingUniquesResponse>({
    queryKey: ["levelingUniques", lang],
    queryFn: () =>
      fetchApi<LevelingUniquesResponse>("/api/flipper/leveling-uniques", { lang }),
    enabled: backendOnline,
    staleTime: 300_000,
    retry: 1,
  });

  const phase = data?.phase ?? "unknown";
  const currentDay = data?.currentDay ?? 0;
  const referenceCurrency = data?.referenceCurrency ?? "";
  const uniques = data?.uniques ?? [];
  const dataAvailable = data?.dataAvailable ?? false;

  // Count uniques by stage for the summary line.
  const atPeakCount = uniques.filter(
    (u) => u.currentLifecycleStage === "AT_PEAK",
  ).length;
  const prePeakCount = uniques.filter(
    (u) => u.currentLifecycleStage === "PRE_PEAK",
  ).length;
  const postPeakCount = uniques.filter(
    (u) => u.currentLifecycleStage === "POST_PEAK",
  ).length;

  // ---- Render: backend offline ----
  // Compact notice — doesn't take over the whole card. Same pattern as
  // the Phase Hints widget.
  if (!backendOnline) {
    return (
      <Card className="border-amber-500/30">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-5 w-5 text-amber-500" aria-hidden="true" />
            {t("levelingTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground pt-0">
          {t("levelingOffline")}
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
            <TrendingUp className="h-5 w-5 text-blue-500" aria-hidden="true" />
            {t("levelingTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground pt-0">
          {t("levelingLoading")}
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
            {t("levelingTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground pt-0">
          {t("levelingError")}
          <Button
            variant="ghost"
            size="sm"
            className="ml-2 h-7"
            onClick={() => refetch()}
            aria-label={t("levelingRefresh")}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </CardContent>
      </Card>
    );
  }

  // ---- Render: no data available (only on exception) ----
  if (!dataAvailable) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-5 w-5 text-blue-500" aria-hidden="true" />
            {t("levelingTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground pt-0">
          {t("levelingNoData")}
        </CardContent>
      </Card>
    );
  }

  // ---- Build the summary line based on the dominant stage ----
  let summaryKey: TranslationKeys;
  let summaryParams: Record<string, string | number> | undefined;
  if (atPeakCount > 0) {
    summaryKey = "levelingSummaryAtPeak";
    summaryParams = { 0: atPeakCount };
  } else if (prePeakCount > 0) {
    summaryKey = "levelingSummaryPrePeak";
    summaryParams = { 0: prePeakCount };
  } else {
    summaryKey = "levelingSummaryPostPeak";
    summaryParams = { 0: postPeakCount };
  }

  // ---- Main render: phase banner + uniques table ----
  return (
    <Card data-testid="leveling-uniques-widget">
      <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
        <div className="flex flex-col gap-0.5 min-w-0">
          <CardTitle className="flex items-center gap-2 text-base flex-wrap">
            <TrendingUp className="h-5 w-5 text-blue-500 shrink-0" aria-hidden="true" />
            {t("levelingTitle")}
            <span className="text-xs text-muted-foreground font-normal flex items-center gap-1">
              <CalendarClock className="h-3 w-3" aria-hidden="true" />
              {t("levelingDayCount", { 0: currentDay })}
            </span>
            <span className="text-xs text-muted-foreground/80 font-mono">
              · {t("levelingItemCount", { 0: uniques.length })}
            </span>
            {referenceCurrency && (
              <span className="text-xs text-muted-foreground/80 font-mono">
                · {t("levelingReferenceCurrency", { 0: referenceCurrency })}
              </span>
            )}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            {t(summaryKey, summaryParams)}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 shrink-0"
          onClick={() => refetch()}
          aria-label={t("levelingRefresh")}
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="ml-1 text-xs">{t("levelingRefresh")}</span>
        </Button>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        {uniques.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            {t("levelingNoUniques")}
          </p>
        ) : (
          <div className="space-y-2" data-testid="leveling-uniques-list">
            {/* Header row */}
            <div
              className="hidden md:grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-2 text-xs font-medium text-muted-foreground pb-1 border-b border-border/40"
              data-testid="leveling-uniques-header"
            >
              <span>{t("levelingColItem")}</span>
              <span>{t("levelingColStage")}</span>
              <span>{t("levelingColEstPrice")}</span>
              <span>{t("levelingColPeakDay")}</span>
              <span>{t("levelingColAction")}</span>
            </div>
            {uniques.map((u) => (
              <UniqueRow key={u.id} unique={u} t={t} locale={locale} />
            ))}
          </div>
        )}

        {/* Disclaimer about heuristic pricing */}
        <p className="text-[10px] text-muted-foreground/70 flex items-start gap-1">
          <Info className="h-3 w-3 mt-0.5 shrink-0" aria-hidden="true" />
          <span>{t("levelingDisclaimer")}</span>
        </p>

        {/* Footer with last-updated timestamp + counts */}
        {data?.fetchedAt && (
          <p className="text-[10px] text-muted-foreground/70">
            <CalendarClock className="inline h-3 w-3 mr-1" aria-hidden="true" />
            {t("levelingFetchedAt", { 0: new Date(data.fetchedAt).toLocaleString() })}
            {" · "}
            {t("levelingStageBreakdown", {
              0: prePeakCount,
              1: atPeakCount,
              2: postPeakCount,
            })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// UniqueRow — renders a single leveling unique in the table
// ---------------------------------------------------------------------------

interface UniqueRowProps {
  unique: LevelingUnique;
  t: (key: TranslationKeys, params?: Record<string, string | number>) => string;
  /** Active locale — used to pick RU display name when available (iter 150). */
  locale: string;
}

function UniqueRow({ unique, t, locale }: UniqueRowProps) {
  // iter 150: prefer the curated backend `nameRu` field when locale=ru and
  // the field is non-null; otherwise fall back to the EN `name`. The
  // `nameRu` field is sourced from poe2db's official RU pages at the
  // backend static-table level (see backend/economy/leveling_uniques.py).
  // Coverage: 4/10 items have a non-null nameRu (Polcirkeln / Megalomaniac
  // / Mind of the Council / Soul Tether); the other 6 fall back to EN.
  const displayName =
    locale === "ru" && unique.nameRu ? unique.nameRu : unique.name;

  return (
    <div
      data-testid={`leveling-unique-${unique.id}`}
      className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-2 text-sm py-2 border-b border-border/30 last:border-b-0"
    >
      {/* Item name + notes tooltip */}
      <div className="min-w-0">
        <div className="font-medium truncate" title={unique.notes}>
          {displayName}
        </div>
        {unique.notes && (
          <div
            className="text-[11px] text-muted-foreground/80 line-clamp-2 mt-0.5"
            data-testid={`leveling-unique-${unique.id}-notes`}
          >
            {unique.notes}
          </div>
        )}
      </div>

      {/* Stage badge */}
      <div className="flex items-center">
        <Badge
          variant="outline"
          className={`text-xs ${stageBadgeClass(unique.currentLifecycleStage)}`}
          data-testid={`leveling-unique-${unique.id}-stage`}
        >
          {t(stageLabelKey(unique.currentLifecycleStage))}
        </Badge>
      </div>

      {/* Estimated current price */}
      <div
        className="flex items-center font-mono text-xs"
        data-testid={`leveling-unique-${unique.id}-price`}
      >
        ~{unique.estimatedCurrentPriceExalted.toFixed(1)} exa
      </div>

      {/* Peak day + peak price */}
      <div
        className="flex items-center text-xs text-muted-foreground"
        data-testid={`leveling-unique-${unique.id}-peak`}
      >
        <span>
          {t("levelingPeakDayShort", { 0: unique.peakDay })}
          {" · "}
          {unique.peakPriceExalted.toFixed(1)} exa
        </span>
      </div>

      {/* Recommendation badge */}
      <div className="flex items-center">
        <Badge
          variant="outline"
          className={`text-xs ${recommendationBadgeClass(unique.recommendation)}`}
          data-testid={`leveling-unique-${unique.id}-rec`}
        >
          {t(recommendationLabelKey(unique.recommendation))}
        </Badge>
      </div>
    </div>
  );
}
