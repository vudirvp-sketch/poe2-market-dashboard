"use client";

/**
 * DashboardToolbar — extracted from dashboard-page.tsx (P2-1, iter 73, step 4a).
 *
 * Renders the tab strip + the secondary action-button row that sit above the
 * tab content area:
 *
 *   - `<TabsList>` with all 10 tab triggers (Overview / Currencies / Uniques /
 *     Exchange / Flips / Optimizer / Analyst / Liquid-chain / Graph / Watchlist).
 *   - Action buttons on the right: keyboard-shortcuts help, price alerts
 *     (with pluralised badge count), item comparison (visible only when ≥1
 *     item is selected for comparison), pair comparison (same conditional).
 *   - Category-filter chips for the Currencies / Uniques tabs.
 *
 * The component owns NO state. Every value and every callback is passed in as
 * a prop from the parent `Dashboard` — the same props-passing convention used
 * by the iter 71-72 tab extractions (`ExchangeTabContent`, `CurrenciesTabContent`,
 * `UniquesTabContent`, `OverviewTabContent`).
 *
 * The Tabs component is passed in as a render-prop wrapper because the parent
 * owns the `<Tabs value=... onValueChange=...>` scope — only the list and the
 * action row belong here. We render the TabsList + buttons in their normal
 * layout; the parent continues to render `<TabsContent>` siblings.
 */

import {
  Coins,
  Shield,
  ArrowLeftRight,
  Star,
  BarChart3,
  TrendingUp,
  Route,
  Keyboard,
  Bell,
  GitCompare,
  LineChart,
  Droplets,
  Gem,
  Sparkles,
  Activity,
} from "lucide-react";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import type { TranslationKeys } from "@/lib/i18n/locales/en";

/** One row in the category-filter chip strip. */
export interface CategoryChip {
  name: string;
  displayName: string;
  count: number;
}

export interface DashboardToolbarProps {
  // --- Active state (parent owns; this component just renders) ---
  categoryFilter: string;
  /** Categories to render as filter chips — already filtered to match the active tab. */
  currentCategories: CategoryChip[];
  /** True when the active tab is "currencies" or "uniques" — shows the chip strip. */
  showCategoryFilter: boolean;

  // --- Action-button state ---
  alertsCount: number;
  comparisonCount: number;
  pairComparisonCount: number;

  // --- Callbacks ---
  // NOTE: Tab switching is handled by the parent `<Tabs onValueChange=...>` scope —
  // the TabsTrigger elements here just declare their `value`.
  onCategoryChange: (category: string) => void;
  onShortcutsClick: () => void;
  onAlertsClick: () => void;
  onComparisonClick: () => void;
  onPairComparisonClick: () => void;

  // --- i18n ---
  t: (key: TranslationKeys, params?: Record<string, string | number>) => string;
  // `tp` takes the already-resolved template string (i.e. `t("_pl_xxx")`)
  // and applies pluralisation based on `count`.
  tp: (template: string, count: number, params?: Record<string, string | number>) => string;
}

export function DashboardToolbar(props: DashboardToolbarProps) {
  const {
    categoryFilter,
    currentCategories,
    showCategoryFilter,
    alertsCount,
    comparisonCount,
    pairComparisonCount,
    onCategoryChange,
    onShortcutsClick,
    onAlertsClick,
    onComparisonClick,
    onPairComparisonClick,
    t,
    tp,
  } = props;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
      <TabsList aria-label={t("ariaDashboardSections")}>
        <TabsTrigger value="overview" className="gap-1.5" aria-label={t("tabOverview")}>
          <BarChart3 className="h-4 w-4" aria-hidden="true" /> {t("tabOverview")}
        </TabsTrigger>
        <TabsTrigger value="currencies" className="gap-1.5" aria-label={t("tabCurrencies")}>
          <Coins className="h-4 w-4" aria-hidden="true" /> {t("tabCurrencies")}
        </TabsTrigger>
        <TabsTrigger value="uniques" className="gap-1.5" aria-label={t("tabUniques")}>
          <Shield className="h-4 w-4" aria-hidden="true" /> {t("tabUniques")}
        </TabsTrigger>
        <TabsTrigger value="exchange" className="gap-1.5" aria-label={t("tabExchange")}>
          <ArrowLeftRight className="h-4 w-4" aria-hidden="true" /> {t("tabExchange")}
        </TabsTrigger>
        {/* Arbitrage tab removed (iter 34) — merged into Flips */}
        <TabsTrigger value="flips" className="gap-1.5" aria-label={t("tabFlips")}>
          <TrendingUp className="h-4 w-4" aria-hidden="true" /> {t("tabFlips")}
        </TabsTrigger>
        <TabsTrigger value="optimizer" className="gap-1.5" aria-label={t("tabOptimizer") || "Optimizer"}>
          <Route className="h-4 w-4" aria-hidden="true" /> {t("tabOptimizer") || "Optimizer"}
        </TabsTrigger>
        <TabsTrigger value="analyst" className="gap-1.5" aria-label={t("tabAnalyst") || "Analyst"}>
          <LineChart className="h-4 w-4" aria-hidden="true" /> {t("tabAnalyst") || "Analyst"}
        </TabsTrigger>
        {/* F2 (iter 74): Storage Value tab — Hold/Sell decision per currency. */}
        <TabsTrigger value="storage-value" className="gap-1.5" aria-label={t("tabStorageValue")}>
          <Gem className="h-4 w-4" aria-hidden="true" /> {t("tabStorageValue")}
        </TabsTrigger>
        {/* F5 (iter 77): Speculation tab — BUY/SELL/HOLD signals per currency. */}
        <TabsTrigger value="speculation" className="gap-1.5" aria-label={t("tabSpeculation")}>
          <Sparkles className="h-4 w-4" aria-hidden="true" /> {t("tabSpeculation")}
        </TabsTrigger>
        {/* F7 / P8 (iter 97): Circuit Patterns tab — trajectory classification. */}
        <TabsTrigger value="circuit-patterns" className="gap-1.5" aria-label={t("tabCircuitPatterns")}>
          <Activity className="h-4 w-4" aria-hidden="true" /> {t("tabCircuitPatterns")}
        </TabsTrigger>
        <TabsTrigger value="liquid-chain" className="gap-1.5" aria-label={t("tabLiquidChain")}>
          <Droplets className="h-4 w-4" aria-hidden="true" /> {t("tabLiquidChain")}
        </TabsTrigger>
        <TabsTrigger value="watchlist" className="gap-1.5" aria-label={t("tabWatchlist")}>
          <Star className="h-4 w-4" aria-hidden="true" /> {t("tabWatchlist")}
        </TabsTrigger>
      </TabsList>

      <div className="flex items-center gap-2">
        {/* §3.2: Keyboard Shortcuts help button */}
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5"
          onClick={onShortcutsClick}
          aria-label={t("keyboardShortcuts")}
          title={t("keyboardShortcuts")}
        >
          <Keyboard className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>

        {/* Price Alerts button — with pluralization */}
        <Button
          variant={alertsCount > 0 ? "default" : "outline"}
          size="sm"
          className="h-8 gap-1.5"
          onClick={onAlertsClick}
          aria-label={alertsCount > 0 ? t("alertsCount", { "0": alertsCount }) : t("alerts")}
        >
          <Bell className="h-3.5 w-3.5" aria-hidden="true" />
          {alertsCount > 0
            ? tp(t("_pl_alertsCount"), alertsCount, { "0": alertsCount })
            : t("alerts")}
        </Button>

        {/* Item Comparison button — with pluralization */}
        {comparisonCount > 0 && (
          <Button
            variant={comparisonCount >= 2 ? "default" : "outline"}
            size="sm"
            className="h-8 gap-1.5"
            onClick={onComparisonClick}
            disabled={comparisonCount < 2}
            aria-label={t("compare", { "0": comparisonCount })}
          >
            <GitCompare className="h-3.5 w-3.5" aria-hidden="true" />
            {tp(t("_pl_compare"), comparisonCount, { "0": comparisonCount })}
          </Button>
        )}

        {/* Pair Comparison button */}
        {pairComparisonCount > 0 && (
          <Button
            variant={pairComparisonCount >= 2 ? "default" : "outline"}
            size="sm"
            className="h-8 gap-1.5"
            onClick={onPairComparisonClick}
            disabled={pairComparisonCount < 2}
            aria-label={t("pairCompare", { "0": pairComparisonCount })}
          >
            <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden="true" />
            {tp(t("_pl_pairCompare"), pairComparisonCount, { "0": pairComparisonCount })}
          </Button>
        )}

        {/* Category filter buttons (only for currencies/uniques) */}
        {showCategoryFilter && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("ariaCategoryFilter")}>
            <Badge
              variant={categoryFilter === "all" ? "default" : "outline"}
              className="cursor-pointer"
              onClick={() => onCategoryChange("all")}
              role="button"
              aria-pressed={categoryFilter === "all"}
              tabIndex={0}
            >
              {t("all")}
            </Badge>
            {currentCategories.map((cat) => (
              <Badge
                key={cat.name}
                variant={
                  categoryFilter === cat.name ? "default" : "outline"
                }
                className="cursor-pointer"
                onClick={() => onCategoryChange(cat.name)}
                role="button"
                aria-pressed={categoryFilter === cat.name}
                tabIndex={0}
              >
                {cat.displayName}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
