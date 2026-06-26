"use client";

/**
 * ExchangeTabContent — extracted from dashboard-page.tsx (P2-1, iter 71).
 *
 * The Exchange tab is the largest inline JSX block in the dashboard
 * (≈256 lines). It owns the quick-filter chips, extended-filters panel,
 * view-mode toggle, volume/liquidity indicators, and the table/cards
 * view switch. All state lives in the parent (Dashboard) — this
 * component is a pure presentational wrapper that takes the already-
 * computed props and renders.
 *
 * Why extract: dashboard-page.tsx was a 1705-line god-component. Each
 * tab-specific subcomponent we extract makes the parent easier to read
 * and lets the Exchange tab be lazy-loaded independently in a future
 * iteration.
 */

import {
  Star,
  Filter,
  List,
  LayoutGrid,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { ExchangePairCard } from "@/components/dashboard/exchange-pair-card";
import { ExchangeTable } from "@/components/dashboard/exchange-table";
import { VolumeLiquidityIndicators } from "@/components/dashboard/volume-liquidity-indicators";
import { DataFreshnessBadge } from "@/components/dashboard/data-freshness-badge";
import { EmptyState } from "@/components/dashboard/empty-state";
import { ApiErrorFallback } from "@/components/dashboard/api-error-fallback";
import { ErrorBoundary } from "@/components/dashboard/error-boundary";
import { ExchangeTableSkeleton } from "@/components/dashboard/skeletons";
// iter 93: Best Payment primary view — top-10 cards strip.
import { BestPaymentTopList } from "@/components/dashboard/best-payment-top-list";
import type { BestPaymentTopListItem } from "@/hooks/use-optimal-payment";

import type {
  ExchangePair,
  OptimalPaymentResult,
  CrossRateFlip,
} from "@/lib/types";
import type { TranslationKeys } from "@/lib/i18n/locales/en";

// Re-import the slice of the store's uiState shape we need.
// We don't import the whole store here — the parent passes values in,
// which keeps this component testable in isolation.
export interface ExchangeTabContentProps {
  // Data
  exchangeFetchedAt: number;
  exchangeData: ExchangePair[] | undefined;
  exchangePairs: ExchangePair[];
  exchangeLoading: boolean;
  exchangeError: unknown;
  refetchExchange: () => void;

  // Loading / error state (computed by parent based on active tab)
  isLoading: boolean;
  // ApiErrorFallback accepts Error | string | null, so we constrain the
  // prop to the same union (React Query's `error` is `Error | null`).
  activeError: Error | string | null;

  // UI state (from store, passed in by parent)
  viewMode: "table" | "cards";
  activeFilter: "all" | "topVolume" | "favorites";
  favorites: string[];
  extendedFilters: {
    minVolume: number | null;
    maxVolume: number | null;
    minChange: number | null;
    maxChange: number | null;
  };
  extendedFiltersOpen: boolean;
  activeExtFilterCount: number;
  denseMode: boolean;

  // Optimal payment / cross-rates (computed by parent)
  optimalPaymentByPair: Map<string, OptimalPaymentResult>;
  crossRateFlips: CrossRateFlip[];
  anchorId: string;
  /** iter 93: Top-N best-payment opportunities (currencies + craft items),
   *  already filtered (savingsPct ≥1%) and sorted (savingsPct desc). */
  bestPaymentTopList: BestPaymentTopListItem[];

  // Highlight state (keyboard navigation)
  highlightedRowIndex: number | null;
  highlightedItemId: string | null;

  // Context
  realm: string;
  league: string;
  backendOnline: boolean;
  isExchangeTab: boolean; // tab === "exchange"

  // Store setters (passed in by parent)
  setExchangeViewMode: (mode: "table" | "cards") => void;
  setExchangeFilter: (filter: "all" | "topVolume" | "favorites") => void;
  setExchangeExtendedFilters: (filters: {
    minVolume: number | null;
    maxVolume: number | null;
    minChange: number | null;
    maxChange: number | null;
  }) => void;
  clearExchangeExtendedFilters: () => void;
  setExtendedFiltersOpen: (open: boolean) => void;

  // i18n
  t: (key: TranslationKeys, params?: Record<string, string | number>) => string;

  // Pair click handler
  onPairClick: (pair: ExchangePair) => void;
}

export function ExchangeTabContent(props: ExchangeTabContentProps) {
  const {
    exchangeFetchedAt,
    exchangeData,
    exchangePairs,
    exchangeLoading: _exchangeLoading,
    exchangeError,
    refetchExchange,
    isLoading,
    activeError,
    viewMode,
    activeFilter,
    favorites,
    extendedFilters,
    extendedFiltersOpen,
    activeExtFilterCount,
    denseMode,
    optimalPaymentByPair,
    crossRateFlips,
    anchorId,
    bestPaymentTopList,
    highlightedRowIndex,
    highlightedItemId,
    realm,
    league,
    backendOnline,
    isExchangeTab,
    setExchangeViewMode,
    setExchangeFilter,
    setExchangeExtendedFilters,
    clearExchangeExtendedFilters,
    setExtendedFiltersOpen,
    t,
    onPairClick,
  } = props;

  // Suppress unused-warning for the prop we keep in the interface for
  // future use (the parent's own loading flag, vs the global isLoading
  // which is gated on the active tab).
  void _exchangeLoading;

  return (
    <>
      {/* Data freshness badge for POE2Scout API tab */}
      {exchangeFetchedAt > 0 && (
        <DataFreshnessBadge
          fetchedAt={new Date(exchangeFetchedAt).toISOString()}
          dataAvailable={!!exchangeData}
          compact={denseMode}
        />
      )}
      {isLoading ? (
        <ExchangeTableSkeleton rows={15} />
      ) : activeError && !exchangeData ? (
        <ApiErrorFallback
          error={activeError}
          onRetry={() => refetchExchange()}
          title={t("failedToLoadData")}
        />
      ) : exchangePairs.length === 0 && !exchangeData ? (
        <EmptyState
          kind="noResults"
          message={t("noExchangePairs")}
          suggestion={undefined /* search-driven; parent owns search state */}
        />
      ) : (
        <>
          {/* iter 93: Best Payment primary view — top-10 cards strip.
              Renders ABOVE the filter chips/table so it's the first thing
              the user sees on the Exchange tab. Wrapped in ErrorBoundary
              so a bug in the new component can never blank the whole tab. */}
          <ErrorBoundary fallbackTitle={t("fallbackBestPayment")}>
            <BestPaymentTopList
              items={bestPaymentTopList}
              anchorId={anchorId}
              exchangeData={exchangeData}
              onPairClick={onPairClick}
            />
          </ErrorBoundary>

          {/* §1.1: View toggle + §1.2: Quick Filter Chips + §2.3: Extended Filters */}
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            {/* Quick Filter Chips (§1.2) */}
            <div className="flex items-center gap-1.5" role="group" aria-label={t("ariaExchangeFilters")}>
              <Badge
                variant={activeFilter === "all" ? "default" : "outline"}
                className="cursor-pointer"
                onClick={() => setExchangeFilter("all")}
                role="button"
                aria-pressed={activeFilter === "all"}
                tabIndex={0}
              >
                {t("allPairs")}
              </Badge>
              <Badge
                variant={activeFilter === "topVolume" ? "default" : "outline"}
                className="cursor-pointer"
                onClick={() => setExchangeFilter("topVolume")}
                role="button"
                aria-pressed={activeFilter === "topVolume"}
                tabIndex={0}
              >
                {t("topVolume")}
              </Badge>
              <Badge
                variant={activeFilter === "favorites" ? "default" : "outline"}
                className={`cursor-pointer ${
                  favorites.length === 0 ? "opacity-50 cursor-not-allowed" : ""
                }`}
                onClick={() => {
                  if (favorites.length > 0) {
                    setExchangeFilter("favorites");
                  }
                }}
                role="button"
                aria-pressed={activeFilter === "favorites"}
                aria-disabled={favorites.length === 0}
                tabIndex={0}
                title={favorites.length === 0 ? (t("favoritesEmptyTooltip")) : undefined}
              >
                <Star className="h-3 w-3 mr-1" aria-hidden="true" />
                {t("favorites")}
              </Badge>

              {/* §2.3: Extended Filters toggle button */}
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1 px-2"
                onClick={() => setExtendedFiltersOpen(!extendedFiltersOpen)}
                aria-expanded={extendedFiltersOpen}
                aria-label={t("filters")}
              >
                <Filter className="h-3.5 w-3.5" aria-hidden="true" />
                {t("filters")}
                {activeExtFilterCount > 0 && (
                  <Badge variant="secondary" className="ml-1 h-4 w-4 p-0 text-[10px] flex items-center justify-center rounded-full">
                    {activeExtFilterCount}
                  </Badge>
                )}
              </Button>
            </div>

            {/* View toggle: Table / Cards (§1.1) */}
            <div className="flex items-center gap-1" role="group" aria-label={t("ariaViewMode")}>
              <Button
                variant={viewMode === "table" ? "default" : "outline"}
                size="sm"
                className="h-7 text-xs gap-1 px-2"
                onClick={() => setExchangeViewMode("table")}
                aria-pressed={viewMode === "table"}
                aria-label={t("ariaTableView")}
              >
                <List className="h-3.5 w-3.5" aria-hidden="true" />
                {t("tableView")}
              </Button>
              <Button
                variant={viewMode === "cards" ? "default" : "outline"}
                size="sm"
                className="h-7 text-xs gap-1 px-2"
                onClick={() => setExchangeViewMode("cards")}
                aria-pressed={viewMode === "cards"}
                aria-label={t("ariaCardsView")}
              >
                <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" />
                {t("cardsView")}
              </Button>
            </div>
          </div>

          {/* §2.3: Extended Filters collapsible panel */}
          {extendedFiltersOpen && (
            <div className="mb-3 p-3 border border-border rounded-lg bg-muted/30" role="region" aria-label={t("ariaExtendedFilters")}>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {/* Min Volume */}
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">{t("minVolume")}</label>
                  <Input
                    type="number"
                    placeholder="0"
                    value={extendedFilters.minVolume ?? ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      setExchangeExtendedFilters({
                        ...extendedFilters,
                        minVolume: val === "" ? null : Number(val),
                      });
                    }}
                    className="h-7 text-xs"
                    min={0}
                  />
                </div>
                {/* Max Volume */}
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">{t("maxVolume")}</label>
                  <Input
                    type="number"
                    placeholder="∞"
                    value={extendedFilters.maxVolume ?? ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      setExchangeExtendedFilters({
                        ...extendedFilters,
                        maxVolume: val === "" ? null : Number(val),
                      });
                    }}
                    className="h-7 text-xs"
                    min={0}
                  />
                </div>
                {/* Min Change % */}
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">{t("minChange")}</label>
                  <Input
                    type="number"
                    placeholder="-∞"
                    value={extendedFilters.minChange ?? ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      setExchangeExtendedFilters({
                        ...extendedFilters,
                        minChange: val === "" ? null : Number(val),
                      });
                    }}
                    className="h-7 text-xs"
                  />
                </div>
                {/* Max Change % */}
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">{t("maxChange")}</label>
                  <Input
                    type="number"
                    placeholder="∞"
                    value={extendedFilters.maxChange ?? ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      setExchangeExtendedFilters({
                        ...extendedFilters,
                        maxChange: val === "" ? null : Number(val),
                      });
                    }}
                    className="h-7 text-xs"
                  />
                </div>
              </div>
              {/* Reset button */}
              {activeExtFilterCount > 0 && (
                <div className="mt-2 flex justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs"
                    onClick={() => clearExchangeExtendedFilters()}
                  >
                    {t("resetFilters")}
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* P2-4: Volume & Liquidity Indicators */}
          <ErrorBoundary fallbackTitle={t("fallbackVolumeLiquidity")}>
            <VolumeLiquidityIndicators
              realm={realm}
              league={league}
              backendOnline={backendOnline}
            />
          </ErrorBoundary>

          {/* Empty state for favorites filter */}
          {activeFilter === "favorites" && exchangePairs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground" role="status">
              <Star className="h-12 w-12 mb-4 opacity-30" aria-hidden="true" />
              <p className="text-lg mb-1">{t("noFavoritesYet")}</p>
              <p className="text-sm">{t("addFavoritesHint")}</p>
            </div>
          ) : viewMode === "table" ? (
            /* §1.1: Table-First Layout */
            <ExchangeTable
              pairs={exchangePairs}
              onPairClick={onPairClick}
              realm={realm}
              league={league}
              highlightedRowIndex={isExchangeTab ? highlightedRowIndex : null}
              highlightedItemId={highlightedItemId}
              exchangePairsForConversion={exchangeData ?? undefined}
              optimalPaymentByPair={optimalPaymentByPair}
              crossRateFlips={crossRateFlips}
              anchorId={anchorId}
            />
          ) : (
            /* Cards view (original) */
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2" role="list" aria-label={t("ariaExchangePairs")}>
              {exchangePairs.map((pair) => (
                <ExchangePairCard
                  key={pair.id}
                  pair={pair}
                  onClick={onPairClick}
                  realm={realm}
                  league={league}
                  showHoverPreview={true}
                  maxVolume={Math.max(...(exchangeData ?? []).map((p) => p.volume), 1)}
                  exchangePairsForConversion={exchangeData ?? undefined}
                  optimalPaymentResult={optimalPaymentByPair.get(pair.id) ?? undefined}
                />
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
