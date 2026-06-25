// ============================================================================
// Phase Hints Widget — "League phase context" (F6, iter 78).
//
// Wraps GET /api/flipper/phase-hints (proxied to FastAPI
// GET /api/v1/phase-hints — implemented in iter 78 as F6).
//
// Renders a compact info banner on the Overview tab, directly below the
// Content Pulse widget. The banner shows the current league phase
// (EARLY / MID / LATE) + days since league start + a bulleted list of
// phase-relevant advisory hints (Temporalis, skill gems 18-20 lvl,
// Breach/Ritual catalysts, etc.).
//
//   ┌──────────────────────────────────────────────────────────────────────┐
//   │  🌙 Mid League · Day 25                                  [refresh]   │
//   │  Weeks 3-6. Liquidity deepens, spreads tighten. Best window for     │
//   │  triangular arbitrage and scaling into high-level skill gems.        │
//   │                                                                      │
//   │  • Skill gems 18-20 lvl — demand rising                              │
//   │    Builds are stabilizing and players are min-maxing — demand for    │
//   │    high-level skill gems typically peaks in MID phase.               │
//   │    → List 18-20 lvl gems at market; check z-score in Speculation tab.│
//   │                                                                      │
//   │  • Temporalis price rising                                            │
//   │    First wave of dedicated farmers reaches endgame — Temporalis      │
//   │    prices typically climb through MID phase as supply tightens.      │
//   │    → Hold Temporalis if you have it; do not sell into weakness yet.  │
//   │  ... (2 more hints)                                                  │
//   └──────────────────────────────────────────────────────────────────────┘
//
// Rationale (PRODUCT_VISION §3.4):
//   - PhaseDetector (backend/economy/lifecycle.py) determines the current
//     league phase from `days_since_reference` (since league start or last
//     major patch).
//   - Each phase has well-known farming/selling patterns (Temporalis
//     floor→peak, skill gems low→high demand, etc.).
//   - This widget surfaces those patterns as advisory context — NOT as
//     automated trade signals. The actual quantitative signals come from
//     F5 Speculation (z-score) and F4 Content Pulse (volume deltas).
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
  Activity,
  CalendarClock,
  Compass,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import type { TranslationKeys } from "@/lib/i18n/locales/en";
import {
  fetchApi,
  type PhaseHintsResponse,
  type PhaseHint,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface PhaseHintsWidgetProps {
  /** Whether the FastAPI analytics backend is reachable (dashboard-level check). */
  backendOnline: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map phase string → color classes for the badge.
 *  - early  → emerald (fresh league, opportunities)
 *  - mid    → violet  (mature league, deep liquidity)
 *  - late   → amber   (declining league, narrow spreads)
 *  - unknown→ muted   (degraded state)
 */
function phaseBadgeClass(phase: string): string {
  switch (phase) {
    case "early":
      return "border-emerald-500/50 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10";
    case "mid":
      return "border-violet-500/50 text-violet-600 dark:text-violet-400 bg-violet-500/10";
    case "late":
      return "border-amber-500/50 text-amber-600 dark:text-amber-400 bg-amber-500/10";
    default:
      return "border-muted-foreground/30 text-muted-foreground bg-muted/30";
  }
}

/** Map phase string → localized label key. */
function phaseLabelKey(phase: string): TranslationKeys {
  switch (phase) {
    case "early":
      return "phaseHintsLabelEarly";
    case "mid":
      return "phaseHintsLabelMid";
    case "late":
      return "phaseHintsLabelLate";
    default:
      return "phaseHintsLabelUnknown";
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PhaseHintsWidget({ backendOnline }: PhaseHintsWidgetProps) {
  const { t, locale } = useI18n();

  // ---- Query ----
  // 5min staleTime — phase only changes once per day at most (when
  // days_since_reference crosses the early/mid or mid/late boundary).
  // No need to refetch on every dashboard focus. Retry once for transient
  // network blips.
  //
  // iter 87: Forward `lang` to the backend so it returns the parallel
  // Russian hint table for ru locale. The queryKey includes `locale` so
  // switching language triggers a refetch with the right locale.
  const lang = locale === "ru" ? "ru" : "en";
  const { data, isLoading, isError, refetch } = useQuery<PhaseHintsResponse>({
    queryKey: ["phaseHints", lang],
    queryFn: () => fetchApi<PhaseHintsResponse>("/api/flipper/phase-hints", { lang }),
    enabled: backendOnline,
    staleTime: 300_000,
    retry: 1,
  });

  const phase = data?.phase ?? "unknown";
  const phaseLabel = data?.phaseLabel ?? "";
  const phaseSummary = data?.phaseSummary ?? "";
  const daysSinceReference = data?.daysSinceReference ?? 0;
  const referenceCurrency = data?.referenceCurrency ?? "";
  const hints = data?.hints ?? [];
  const dataAvailable = data?.dataAvailable ?? false;

  // ---- Render: backend offline ----
  // Compact notice — doesn't take over the whole card. Same pattern as
  // the Content Pulse widget.
  if (!backendOnline) {
    return (
      <Card className="border-amber-500/30">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Compass className="h-5 w-5 text-amber-500" aria-hidden="true" />
            {t("phaseHintsTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground pt-0">
          {t("phaseHintsOffline")}
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
            <Compass className="h-5 w-5 text-violet-500" aria-hidden="true" />
            {t("phaseHintsTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground pt-0">
          {t("phaseHintsLoading")}
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
            {t("phaseHintsTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground pt-0">
          {t("phaseHintsError")}
          <Button
            variant="ghost"
            size="sm"
            className="ml-2 h-7"
            onClick={() => refetch()}
            aria-label={t("phaseHintsRefresh")}
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
            <Compass className="h-5 w-5 text-violet-500" aria-hidden="true" />
            {t("phaseHintsTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground pt-0">
          {t("phaseHintsNoData")}
        </CardContent>
      </Card>
    );
  }

  // ---- Main render: phase banner + hints list ----
  return (
    <Card data-testid="phase-hints-widget">
      <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
        <div className="flex flex-col gap-0.5 min-w-0">
          <CardTitle className="flex items-center gap-2 text-base flex-wrap">
            <Compass className="h-5 w-5 text-violet-500 shrink-0" aria-hidden="true" />
            {t("phaseHintsTitle")}
            <Badge
              variant="outline"
              className={`text-xs ${phaseBadgeClass(phase)}`}
              data-testid="phase-hints-phase-badge"
            >
              {t(phaseLabelKey(phase))}
            </Badge>
            <span className="text-xs text-muted-foreground font-normal flex items-center gap-1">
              <CalendarClock className="h-3 w-3" aria-hidden="true" />
              {t("phaseHintsDayCount", { 0: daysSinceReference })}
            </span>
            {referenceCurrency && (
              <span className="text-xs text-muted-foreground/80 font-mono">
                · {t("phaseHintsReferenceCurrency", { 0: referenceCurrency })}
              </span>
            )}
          </CardTitle>
          {phaseSummary && (
            <p className="text-xs text-muted-foreground">
              {phaseSummary}
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 shrink-0"
          onClick={() => refetch()}
          aria-label={t("phaseHintsRefresh")}
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="ml-1 text-xs">{t("phaseHintsRefresh")}</span>
        </Button>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        {hints.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            {t("phaseHintsNoHints")}
          </p>
        ) : (
          <ul className="space-y-3" data-testid="phase-hints-list">
            {hints.map((hint) => (
              <HintRow key={hint.id} hint={hint} t={t} />
            ))}
          </ul>
        )}

        {/* Footer with last-updated timestamp */}
        {data?.fetchedAt && (
          <p className="text-[10px] text-muted-foreground/70">
            <Activity className="inline h-3 w-3 mr-1" aria-hidden="true" />
            {t("phaseHintsFetchedAt", { 0: new Date(data.fetchedAt).toLocaleString() })}
            {" · "}
            {t("phaseHintsHintCount", { 0: hints.length })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// HintRow — renders a single phase-aware hint
// ---------------------------------------------------------------------------

interface HintRowProps {
  hint: PhaseHint;
  t: (key: TranslationKeys, params?: Record<string, string | number>) => string;
}

function HintRow({ hint, t }: HintRowProps) {
  return (
    <li
      data-testid={`phase-hint-${hint.id}`}
      className="rounded-md border border-border/60 p-3 space-y-1.5"
    >
      {/* Hint title */}
      <div className="flex items-start gap-2">
        <span
          className="text-violet-500 mt-0.5 shrink-0"
          aria-hidden="true"
          data-testid={`phase-hint-${hint.id}-bullet`}
        >
          •
        </span>
        <span className="text-sm font-medium">{hint.title}</span>
      </div>

      {/* Detail (one-sentence explanation) */}
      <p className="text-xs text-muted-foreground pl-4">
        {hint.detail}
      </p>

      {/* Action (imperative, with arrow) */}
      <p className="text-xs text-foreground/90 pl-4">
        <span className="text-violet-500 font-medium" aria-hidden="true">→ </span>
        <span className="font-medium">{t("phaseHintsActionLabel")}: </span>
        {hint.action}
      </p>
    </li>
  );
}
