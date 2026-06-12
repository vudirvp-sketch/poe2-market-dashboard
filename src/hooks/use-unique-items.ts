// ============================================================================
// useUniqueItems — Shared hook for paginated unique item queries
// ============================================================================
//
// Single Source of Truth for unique item listing queries.
// All components MUST use this hook instead of inline
//   useQuery + fetchApi("/api/poe2/uniques", { ... })
//
// Benefits:
//   1. Unified queryKey via QUERY_KEYS → no cache fragmentation
//   2. placeholderData: keepPreviousData → smooth page/category transitions
//   3. Consistent staleTime, retry, and refetchInterval defaults
//   4. Per-consumer overrides for enabled, autoRefresh, search, etc.
//   5. Accepts realm/league as params (fallback to store if not provided)
// ============================================================================

"use client";

import { useQuery } from "@tanstack/react-query";
import { keepPreviousData } from "@tanstack/react-query";
import { fetchApi } from "@/lib/types";
import type { PoeItem, PaginatedResponse } from "@/lib/types";
import { QUERY_KEYS } from "@/components/providers";
import { useDashboardStore } from "@/lib/store";

// ---------------------------------------------------------------------------
// useUniqueItems
// ---------------------------------------------------------------------------

export interface UseUniqueItemsOptions {
  /** Only fetch when this is true (default: true) */
  enabled?: boolean;
  /** Override category filter (default: "all") */
  category?: string;
  /** Override page number (default: 1) */
  page?: number;
  /** Override items per page (default: 50) */
  perPage?: number;
  /** Search string for filtering uniques */
  search?: string;
  /** Override reference currency for price conversion */
  referenceCurrency?: string;
  /** Override default refetchInterval (ms). false = no polling. */
  refetchInterval?: number | false;
  /** Override realm (defaults to store.uiState.realm or "poe2") */
  realm?: string;
  /** Override league (defaults to store.uiState.league or "") */
  league?: string;
}

/**
 * Hook to fetch paginated unique items with unified query key and caching.
 *
 * Uses QUERY_KEYS.uniques from providers.tsx to prevent
 * cache fragmentation across components.
 *
 * Includes `placeholderData: keepPreviousData` so that switching
 * pages, categories, or search terms preserves old data until new loads.
 *
 * @param options.realm - Override realm (defaults to store.uiState.realm)
 * @param options.league - Override league (defaults to store.uiState.league)
 * @param options.category - Item category filter (default: "all")
 * @param options.page - Page number (default: 1)
 * @param options.perPage - Items per page (default: 50)
 * @param options.search - Search string for filtering uniques
 */
export function useUniqueItems({
  enabled = true,
  category = "all",
  page = 1,
  perPage = 50,
  search = "",
  referenceCurrency = "",
  refetchInterval = false,
  realm: realmOverride,
  league: leagueOverride,
}: UseUniqueItemsOptions = {}) {
  const uiState = useDashboardStore((s) => s.uiState);
  const realm = realmOverride ?? "poe2";
  const league = leagueOverride ?? uiState.league ?? "";

  return useQuery<PaginatedResponse<PoeItem>>({
    queryKey: [
      QUERY_KEYS.uniques,
      realm,
      league,
      category,
      page,
      perPage,
      search,
      referenceCurrency,
    ],
    queryFn: () =>
      fetchApi<PaginatedResponse<PoeItem>>("/api/poe2/uniques", {
        realm,
        league,
        category,
        page: String(page),
        perPage: String(perPage),
        search,
        referenceCurrency: referenceCurrency || "",
      }),
    enabled: enabled && !!league,
    placeholderData: keepPreviousData,
    staleTime: 2 * 60_000,
    refetchInterval,
    refetchIntervalInBackground: false,
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(500 * Math.pow(2, attemptIndex), 10_000),
  });
}
