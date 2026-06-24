"use client";

/**
 * UniquesTabContent — extracted from dashboard-page.tsx (P2-1, iter 72).
 *
 * The Uniques tab shows a paginated table of unique items. It owns the
 * data-freshness badge, loading/empty/error states, the UniqueTable,
 * and pagination. All state lives in the parent (Dashboard) — this
 * component is a pure presentational wrapper.
 *
 * Pattern: same props-passing convention as ExchangeTabContent (iter 71)
 * and CurrenciesTabContent (iter 72). Keeps the parent lean.
 */

import { DataFreshnessBadge } from "@/components/dashboard/data-freshness-badge";
import { ApiErrorFallback } from "@/components/dashboard/api-error-fallback";
import { EmptyState } from "@/components/dashboard/empty-state";
import { UniqueTable } from "@/components/dashboard/unique-table";
import { Pagination } from "@/components/dashboard/pagination";
import { UniqueTableSkeleton } from "@/components/dashboard/skeletons";

import type { PoeItem, PaginatedResponse } from "@/lib/types";
import type { TranslationKeys } from "@/lib/i18n/locales/en";

export interface UniquesTabContentProps {
  // Data
  uniquesFetchedAt: number;
  uniquesData: PaginatedResponse<PoeItem> | undefined;
  refetchUniques: () => void;

  // Pagination
  uniquesPage: number;
  uniquesPerPage: number;
  setUniquesPage: (page: number) => void;
  setUniquesPerPage: (perPage: number) => void;

  // Loading / error state (computed by parent based on active tab)
  isLoading: boolean;
  activeError: Error | string | null;

  // Search (used only for the empty-state suggestion copy)
  search: string;

  // UI state (from store, passed in by parent)
  denseMode: boolean;

  // Highlight state (search-result pulse)
  highlightedItemId: string | null;

  // Context
  realm: string;
  league: string;
  referenceCurrency: string;

  // i18n
  t: (key: TranslationKeys, params?: Record<string, string | number>) => string;

  // Item click handler
  onItemClick: (item: PoeItem) => void;
}

export function UniquesTabContent(props: UniquesTabContentProps) {
  const {
    uniquesFetchedAt,
    uniquesData,
    refetchUniques,
    uniquesPage,
    uniquesPerPage,
    setUniquesPage,
    setUniquesPerPage,
    isLoading,
    activeError,
    search,
    denseMode,
    highlightedItemId,
    realm,
    league,
    referenceCurrency,
    t,
    onItemClick,
  } = props;

  return (
    <>
      {/* Data freshness badge for POE2Scout API tab */}
      {uniquesFetchedAt > 0 && (
        <DataFreshnessBadge
          fetchedAt={new Date(uniquesFetchedAt).toISOString()}
          dataAvailable={!!uniquesData}
          compact={denseMode}
        />
      )}
      {isLoading ? (
        <UniqueTableSkeleton rows={15} />
      ) : activeError && !uniquesData ? (
        <ApiErrorFallback
          error={activeError}
          onRetry={() => refetchUniques()}
          title={t("failedToLoadData")}
        />
      ) : !uniquesData?.items?.length ? (
        <EmptyState
          kind="noResults"
          message={t("noUniques")}
          suggestion={search ? t("noResultsSuggestion") : undefined}
        />
      ) : (
        <>
          <UniqueTable
            items={uniquesData.items}
            onItemClick={onItemClick}
            realm={realm}
            league={league}
            referenceCurrency={referenceCurrency}
            highlightedItemId={highlightedItemId}
          />
          <Pagination
            page={uniquesPage}
            totalPages={uniquesData.totalPages}
            totalItems={uniquesData.totalItems}
            perPage={uniquesPerPage}
            onPageChange={setUniquesPage}
            onPerPageChange={(v) => {
              setUniquesPerPage(v);
              setUniquesPage(1);
            }}
            perPageOptions={[25, 50, 100]}
          />
        </>
      )}
    </>
  );
}
