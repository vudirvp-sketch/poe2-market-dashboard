// ============================================================================
// useCurrencyItems — Shared hook for paginated currency item queries
// ============================================================================
//
// Single Source of Truth for currency item listing queries.
// All components MUST use this hook instead of inline
//   useQuery + fetchApi("/api/poe2/currencies", { action: "byCategory" })
//
// Benefits:
//   1. Unified queryKey via QUERY_KEYS → no cache fragmentation
//   2. placeholderData: keepPreviousData → smooth page/category transitions
//   3. Consistent staleTime, retry, and refetchInterval defaults
//   4. Per-consumer overrides for enabled, autoRefresh, etc.
//   5. Accepts realm/league as params (fallback to store if not provided)
// ============================================================================

"use client";

import { useQuery } from "@tanstack/react-query";
import { keepPreviousData } from "@tanstack/react-query";
import { fetchApi } from "@/lib/types";
import type { PoeItem, PaginatedResponse, ItemCategory } from "@/lib/types";
import { QUERY_KEYS } from "@/components/providers";
import { useDashboardStore } from "@/lib/store";

// ---------------------------------------------------------------------------
// useCurrencyItems
// ---------------------------------------------------------------------------

export interface UseCurrencyItemsOptions {
  /** Only fetch when this is true (default: true) */
  enabled?: boolean;
  /** Override category filter (default: "all") */
  category?: string;
  /** Override page number (default: 1) */
  page?: number;
  /** Override items per page (default: 50) */
  perPage?: number;
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
 * Hook to fetch paginated currency items with unified query key and caching.
 *
 * Uses QUERY_KEYS.currencies from providers.tsx to prevent
 * cache fragmentation across components.
 *
 * Includes `placeholderData: keepPreviousData` so that switching
 * pages or categories preserves the old data until new data loads.
 *
 * @param options.realm - Override realm (defaults to store.uiState.realm)
 * @param options.league - Override league (defaults to store.uiState.league)
 * @param options.category - Item category filter (default: "all")
 * @param options.page - Page number (default: 1)
 * @param options.perPage - Items per page (default: 50)
 */
export function useCurrencyItems({
  enabled = true,
  category = "all",
  page = 1,
  perPage = 50,
  referenceCurrency = "",
  refetchInterval = false,
  realm: realmOverride,
  league: leagueOverride,
}: UseCurrencyItemsOptions = {}) {
  const uiState = useDashboardStore((s) => s.uiState);
  const realm = realmOverride ?? "poe2";
  const league = leagueOverride ?? uiState.league ?? "";

  return useQuery<PaginatedResponse<PoeItem>>({
    queryKey: [
      QUERY_KEYS.currencies,
      realm,
      league,
      category,
      page,
      perPage,
      referenceCurrency,
    ],
    queryFn: () =>
      fetchApi<PaginatedResponse<PoeItem>>("/api/poe2/currencies", {
        realm,
        league,
        action: "byCategory",
        category,
        page: String(page),
        perPage: String(perPage),
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

// ---------------------------------------------------------------------------
// useAllItems
// ---------------------------------------------------------------------------

export interface UseAllItemsOptions {
  /** Only fetch when this is true (default: true) */
  enabled?: boolean;
  /** Override realm (defaults to store.uiState.realm or "poe2") */
  realm?: string;
  /** Override league (defaults to store.uiState.league or "") */
  league?: string;
}

/**
 * Hook to fetch all items (for comparison resolution + overview + alerts).
 *
 * Uses QUERY_KEYS.allItems from providers.tsx.
 */
export function useAllItems({
  enabled = true,
  realm: realmOverride,
  league: leagueOverride,
}: UseAllItemsOptions = {}) {
  const uiState = useDashboardStore((s) => s.uiState);
  const realm = realmOverride ?? "poe2";
  const league = leagueOverride ?? uiState.league ?? "";

  return useQuery<PoeItem[]>({
    queryKey: [QUERY_KEYS.allItems, realm, league],
    queryFn: () => fetchApi<PoeItem[]>("/api/poe2/items", { realm, league }),
    enabled: enabled && !!league,
    staleTime: 2 * 60_000,
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(500 * Math.pow(2, attemptIndex), 10_000),
  });
}

// ---------------------------------------------------------------------------
// useItemCategories
// ---------------------------------------------------------------------------

export interface UseItemCategoriesOptions {
  /** Only fetch when this is true (default: true) */
  enabled?: boolean;
  /** Override realm (defaults to store.uiState.realm or "poe2") */
  realm?: string;
  /** Override league (defaults to store.uiState.league or "") */
  league?: string;
}

/**
 * Hook to fetch item categories with unified query key.
 *
 * Uses QUERY_KEYS.itemCategories from providers.tsx.
 */
export function useItemCategories({
  enabled = true,
  realm: realmOverride,
  league: leagueOverride,
}: UseItemCategoriesOptions = {}) {
  const uiState = useDashboardStore((s) => s.uiState);
  const realm = realmOverride ?? "poe2";
  const league = leagueOverride ?? uiState.league ?? "";

  return useQuery<ItemCategory[]>({
    queryKey: [QUERY_KEYS.itemCategories, realm, league],
    queryFn: () =>
      fetchApi<ItemCategory[]>("/api/poe2/items", {
        realm,
        league,
        action: "categories",
      }),
    enabled: enabled && !!league,
    staleTime: 10 * 60_000,
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(500 * Math.pow(2, attemptIndex), 10_000),
  });
}
