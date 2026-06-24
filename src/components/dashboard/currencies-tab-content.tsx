"use client";

/**
 * CurrenciesTabContent — extracted from dashboard-page.tsx (P2-1, iter 72).
 *
 * The Currencies tab shows a paginated grid of currency items. It owns
 * the data-freshness badge, loading/empty/error states, the
 * virtual-vs-static grid switch (based on item count), and pagination.
 * All state lives in the parent (Dashboard) — this component is a pure
 * presentational wrapper that takes the already-computed props and
 * renders.
 *
 * Why extract: dashboard-page.tsx was a 1466-line god-component (after
 * the iter 71 ExchangeTabContent extraction). Pulling the Currencies
 * tab JSX out continues the P2-1 multi-iter split, using the exact
 * same props-passing pattern established in iter 71.
 */

import { DataFreshnessBadge } from "@/components/dashboard/data-freshness-badge";
import { ApiErrorFallback } from "@/components/dashboard/api-error-fallback";
import { EmptyState } from "@/components/dashboard/empty-state";
import { CurrencyCard } from "@/components/dashboard/currency-card";
import { VirtualCurrencyGrid } from "@/components/dashboard/virtual-currency-grid";
import { Pagination } from "@/components/dashboard/pagination";
import { CurrencyGridSkeleton } from "@/components/dashboard/skeletons";

import type { PoeItem, ExchangePair, PaginatedResponse } from "@/lib/types";
import type { TranslationKeys } from "@/lib/i18n/locales/en";

export interface CurrenciesTabContentProps {
  // Data
  currenciesFetchedAt: number;
  currenciesData: PaginatedResponse<PoeItem> | undefined;
  refetchCurrencies: () => void;

  // Pagination
  currenciesPage: number;
  currenciesPerPage: number;
  setCurrenciesPage: (page: number) => void;
  setCurrenciesPerPage: (perPage: number) => void;

  // Loading / error state (computed by parent based on active tab)
  isLoading: boolean;
  activeError: Error | string | null;

  // Search (used only for the empty-state suggestion copy)
  search: string;

  // Virtualization flag (computed by parent based on item count)
  useVirtualCurrencies: boolean;

  // UI state (from store, passed in by parent)
  denseMode: boolean;

  // Highlight state (search-result pulse)
  highlightedItemId: string | null;

  // Context
  realm: string;
  league: string;
  referenceCurrency: string;
  exchangeData: ExchangePair[] | undefined;

  // i18n
  t: (key: TranslationKeys, params?: Record<string, string | number>) => string;

  // Item click handler
  onItemClick: (item: PoeItem) => void;
}

export function CurrenciesTabContent(props: CurrenciesTabContentProps) {
  const {
    currenciesFetchedAt,
    currenciesData,
    refetchCurrencies,
    currenciesPage,
    currenciesPerPage,
    setCurrenciesPage,
    setCurrenciesPerPage,
    isLoading,
    activeError,
    search,
    useVirtualCurrencies,
    denseMode,
    highlightedItemId,
    realm,
    league,
    referenceCurrency,
    exchangeData,
    t,
    onItemClick,
  } = props;

  return (
    <>
      {/* Data freshness badge for POE2Scout API tab */}
      {currenciesFetchedAt > 0 && (
        <DataFreshnessBadge
          fetchedAt={new Date(currenciesFetchedAt).toISOString()}
          dataAvailable={!!currenciesData}
          compact={denseMode}
        />
      )}
      {isLoading ? (
        <CurrencyGridSkeleton count={currenciesPerPage} />
      ) : activeError && !currenciesData ? (
        <ApiErrorFallback
          error={activeError}
          onRetry={() => refetchCurrencies()}
          title={t("failedToLoadData")}
        />
      ) : !currenciesData?.items?.length ? (
        <EmptyState
          kind="noResults"
          message={t("noCurrencies")}
          suggestion={search ? t("noResultsSuggestion") : undefined}
        />
      ) : (
        <>
          {useVirtualCurrencies ? (
            <VirtualCurrencyGrid
              items={currenciesData.items}
              onItemClick={onItemClick}
              realm={realm}
              league={league}
              referenceCurrency={referenceCurrency}
              exchangePairs={exchangeData ?? undefined}
            />
          ) : (
            <div
              className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2"
              role="list"
              aria-label={t("ariaCurrencyItems")}
            >
              {currenciesData.items.map((item) => (
                <CurrencyCard
                  key={item.id}
                  item={item}
                  onClick={onItemClick}
                  realm={realm}
                  league={league}
                  referenceCurrency={referenceCurrency}
                  highlighted={highlightedItemId === item.id}
                  exchangePairs={exchangeData ?? undefined}
                />
              ))}
            </div>
          )}
          <Pagination
            page={currenciesPage}
            totalPages={currenciesData.totalPages}
            totalItems={currenciesData.totalItems}
            perPage={currenciesPerPage}
            onPageChange={setCurrenciesPage}
            onPerPageChange={(v) => {
              setCurrenciesPerPage(v);
              setCurrenciesPage(1);
            }}
            perPageOptions={[25, 50, 100]}
          />
        </>
      )}
    </>
  );
}
