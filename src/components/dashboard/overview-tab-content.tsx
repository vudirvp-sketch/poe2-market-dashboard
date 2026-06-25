"use client";

/**
 * OverviewTabContent — extracted from dashboard-page.tsx (P2-1, iter 72).
 *
 * The Overview tab is the default landing view. It composes four panels,
 * each wrapped in its own ErrorBoundary so a failure in one doesn't
 * blank out the others:
 *
 *   1. ContentPulseWidget (F4, iter 76) — "Что фармить сегодня" card with
 *      top rising/falling league mechanics + per-category item movers.
 *      Surfaces the F3 backend (/api/v1/content-pulse) on the main
 *      dashboard so the user sees actionable signals on first load.
 *   2. PhaseHintsWidget (F6, iter 78) — "League phase context" banner
 *      with the current phase (EARLY/MID/LATE) + bulleted advisory hints
 *      (Temporalis, skill gems 18-20 lvl, etc.). Surfaces the F6
 *      backend (/api/v1/phase-hints) directly below the Content Pulse
 *      widget so users see phase-aware context on first load.
 *   3. MarketOverview  — top movers + summary tiles.
 *   4. ComparativeChart — relative-performance chart against a
 *      reference currency.
 *
 * All state lives in the parent (Dashboard) — this component is a pure
 * presentational wrapper.
 *
 * Pattern: same props-passing convention as ExchangeTabContent (iter 71)
 * and CurrenciesTabContent / UniquesTabContent (iter 72).
 */

import { MarketOverview } from "@/components/dashboard/market-overview";
import { ComparativeChart } from "@/components/dashboard/comparative-chart";
import { ContentPulseWidget } from "@/components/dashboard/content-pulse-widget";
import { PhaseHintsWidget } from "@/components/dashboard/phase-hints-widget";
import { ErrorBoundary } from "@/components/dashboard/error-boundary";

import type { PoeItem } from "@/lib/types";
import type { TranslationKeys } from "@/lib/i18n/locales/en";

export interface OverviewTabContentProps {
  // Context
  realm: string;
  league: string;
  referenceCurrency: string;
  allItems: PoeItem[];
  backendOnline: boolean;

  // i18n
  t: (key: TranslationKeys, params?: Record<string, string | number>) => string;

  // Item click handler (drilled into MarketOverview)
  onItemClick: (item: PoeItem) => void;
}

export function OverviewTabContent(props: OverviewTabContentProps) {
  const {
    realm,
    league,
    referenceCurrency,
    allItems,
    backendOnline,
    t,
    onItemClick,
  } = props;

  return (
    <>
      {/* F4 (iter 76) — "Что фармить сегодня" widget.
          Placed FIRST on the Overview tab so the user sees actionable
          farming signals immediately on dashboard load, before the
          market overview / comparative chart. */}
      <ErrorBoundary fallbackTitle={t("fallbackContentPulse")}>
        <ContentPulseWidget backendOnline={backendOnline} />
      </ErrorBoundary>

      {/* F6 (iter 78) — Phase-aware hints banner.
          Placed directly below the Content Pulse widget so the user
          sees phase-aware advisory context (Temporalis, skill gems,
          etc.) alongside the live farming signals. The hint table is
          hardcoded and does NOT depend on the DataSnapshot — it only
          uses the PhaseDetector (which is always available). */}
      <ErrorBoundary fallbackTitle={t("fallbackPhaseHints")}>
        <PhaseHintsWidget backendOnline={backendOnline} />
      </ErrorBoundary>

      <ErrorBoundary fallbackTitle={t("fallbackMarketOverview")}>
        <MarketOverview
          realm={realm}
          league={league}
          onItemClick={onItemClick}
          backendOnline={backendOnline}
        />
      </ErrorBoundary>
      {/* Market Heatmap removed (iter 34) — consolidated into MarketOverview internally */}

      {/* P3-3: Comparative Analytics — integrated into Overview tab */}
      <ErrorBoundary fallbackTitle={t("fallbackComparativeAnalytics")}>
        <ComparativeChart
          realm={realm}
          league={league}
          referenceCurrency={referenceCurrency}
          allItems={allItems}
        />
      </ErrorBoundary>
    </>
  );
}
