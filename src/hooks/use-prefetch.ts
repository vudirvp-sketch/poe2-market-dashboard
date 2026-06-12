// ============================================================================
// usePrefetch — Prefetch data on league/realm change
// ============================================================================
//
// When the user selects a new league or realm in the dashboard header,
// this hook pre-fetches the most important queries for the TARGET
// league/realm before the components even render with the new params.
//
// This eliminates the "flash of loading" that occurs when switching
// leagues because React Query starts fetching only AFTER the component
// re-renders with the new league value.
//
// Prefetched queries (chosen by impact × frequency):
//   1. exchangePairs — primary data for Exchange tab, needed by cross-rates
//   2. referenceCurrencies — needed for base-currency auto-select
//   3. allItems — needed for comparison, overview, alerts
//   4. itemCategories — needed for category filter chips
//
// NOT prefetched (tab-specific or paginated):
//   - currencies (depends on active category + page)
//   - uniques (depends on active category + page + search)
//   - flipper health/phase/events (backend-only, independent of league)
//   - item history (detail-dialog only)
//
// Usage:
//   import { usePrefetch } from "@/hooks/use-prefetch";
//   usePrefetch({ realm, league: effectiveLeague });
// ============================================================================

"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { fetchApi } from "@/lib/types";
import type {
  ExchangePair,
  ReferenceCurrency,
  PoeItem,
  ItemCategory,
} from "@/lib/types";
import { QUERY_KEYS } from "@/components/providers";

export interface UsePrefetchOptions {
  /** Current realm (e.g. "poe2") */
  realm: string;
  /** Current effective league name */
  league: string;
}

/**
 * Prefetches core queries when league or realm changes.
 *
 * Uses queryClient.prefetchQuery() which only fetches if there is no
 * fresh data in the cache for the given key. This means it's safe to
 * call on every render — it won't re-fetch data that's already cached
 * and not stale.
 *
 * The hook tracks the previous league/realm pair and only triggers
 * prefetch when either value changes.
 */
export function usePrefetch({ realm, league }: UsePrefetchOptions): void {
  const queryClient = useQueryClient();
  const prevRef = useRef({ realm, league });

  useEffect(() => {
    const prev = prevRef.current;
    // Only prefetch when league or realm actually changed AND we have a league
    if (
      league &&
      (prev.realm !== realm || prev.league !== league)
    ) {
      prevRef.current = { realm, league };

      // Prefetch exchange pairs — the most impactful query
      // (drives Exchange tab + cross-rates + optimal payment)
      queryClient.prefetchQuery({
        queryKey: [QUERY_KEYS.exchangePairs, realm, league],
        queryFn: () =>
          fetchApi<ExchangePair[]>("/api/poe2/exchange", {
            realm,
            league,
            action: "pairs",
          }),
      });

      // Prefetch reference currencies — needed for base-currency auto-select
      queryClient.prefetchQuery({
        queryKey: [QUERY_KEYS.referenceCurrencies, realm, league],
        queryFn: () =>
          fetchApi<ReferenceCurrency[]>("/api/poe2/exchange", {
            realm,
            league,
            action: "reference",
          }),
      });

      // Prefetch all items — needed for comparison resolution + overview + alerts
      queryClient.prefetchQuery({
        queryKey: [QUERY_KEYS.allItems, realm, league],
        queryFn: () =>
          fetchApi<PoeItem[]>("/api/poe2/items", { realm, league }),
      });

      // Prefetch item categories — needed for category filter chips
      queryClient.prefetchQuery({
        queryKey: [QUERY_KEYS.itemCategories, realm, league],
        queryFn: () =>
          fetchApi<ItemCategory[]>("/api/poe2/items", {
            realm,
            league,
            action: "categories",
          }),
      });
    }
  }, [realm, league, queryClient]);
}
