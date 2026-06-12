// ============================================================================
// useExchangePairs & useReferenceCurrencies — Shared hooks for exchange data
// ============================================================================
//
// Single Source of Truth for exchange pair and reference currency queries.
// All components MUST use these hooks instead of inline
//   useQuery + fetchApi("/api/poe2/exchange", { action: "pairs" })
//   useQuery + fetchApi("/api/poe2/exchange", { action: "reference" })
//
// Benefits:
//   1. Unified queryKey via QUERY_KEYS → no cache fragmentation
//   2. placeholderData: keepPreviousData → smooth league/realm transitions
//   3. Consistent staleTime, retry, and refetchInterval defaults
//   4. Per-consumer overrides for enabled, snapshot, refetchInterval, etc.
//   5. Accepts realm/league as params (fallback to store if not provided)
// ============================================================================

"use client";

import { useQuery } from "@tanstack/react-query";
import { keepPreviousData } from "@tanstack/react-query";
import { fetchApi } from "@/lib/types";
import type { ExchangePair, ReferenceCurrency } from "@/lib/types";
import { QUERY_KEYS } from "@/components/providers";
import { useDashboardStore } from "@/lib/store";

// ---------------------------------------------------------------------------
// useExchangePairs
// ---------------------------------------------------------------------------

export interface UseExchangePairsOptions {
  /** Only fetch when this is true (default: true) */
  enabled?: boolean;
  /** Pass snapshot: true for fast initial load (skip server-side history enrichment) */
  snapshot?: boolean;
  /** Override default refetchInterval (ms). false = no polling. */
  refetchInterval?: number | false;
  /** Override default staleTime (ms) */
  staleTime?: number;
  /** Override retry count */
  retry?: number;
  /** Override realm (defaults to store.uiState.realm or "poe2") */
  realm?: string;
  /** Override league (defaults to store.uiState.league or "") */
  league?: string;
}

/**
 * Hook to fetch exchange pairs with unified query key and caching.
 *
 * Uses QUERY_KEYS.exchangePairs from providers.tsx to prevent
 * cache fragmentation across components.
 *
 * Includes `placeholderData: keepPreviousData` so that switching
 * leagues/realms preserves the old data until new data loads.
 *
 * @param options.realm - Override realm (defaults to store.uiState.realm)
 * @param options.league - Override league (defaults to store.uiState.league)
 */
export function useExchangePairs({
  enabled = true,
  snapshot = false,
  refetchInterval = false,
  staleTime,
  retry = 3,
  realm: realmOverride,
  league: leagueOverride,
}: UseExchangePairsOptions = {}) {
  const uiState = useDashboardStore((s) => s.uiState);
  const realm = realmOverride ?? "poe2";
  const league = leagueOverride ?? uiState.league ?? "";

  return useQuery<ExchangePair[]>({
    queryKey: [QUERY_KEYS.exchangePairs, realm, league],
    queryFn: () =>
      fetchApi<ExchangePair[]>("/api/poe2/exchange", {
        realm,
        league,
        action: "pairs",
        ...(snapshot ? { snapshot: "true" } : {}),
      }),
    enabled: enabled && !!league,
    placeholderData: keepPreviousData,
    staleTime: staleTime ?? 5 * 60_000,
    refetchInterval,
    refetchIntervalInBackground: false,
    retry,
    retryDelay: (attemptIndex) => Math.min(500 * Math.pow(2, attemptIndex), 10_000),
  });
}

// ---------------------------------------------------------------------------
// useReferenceCurrencies
// ---------------------------------------------------------------------------

export interface UseReferenceCurrenciesOptions {
  /** Only fetch when this is true (default: true) */
  enabled?: boolean;
  /** Override realm (defaults to store.uiState.realm or "poe2") */
  realm?: string;
  /** Override league (defaults to store.uiState.league or "") */
  league?: string;
}

/**
 * Hook to fetch reference currencies with unified query key and caching.
 *
 * Uses QUERY_KEYS.referenceCurrencies from providers.tsx.
 * Includes `placeholderData: keepPreviousData` for smooth league transitions.
 *
 * @param options.realm - Override realm (defaults to store.uiState.realm)
 * @param options.league - Override league (defaults to store.uiState.league)
 */
export function useReferenceCurrencies({
  enabled = true,
  realm: realmOverride,
  league: leagueOverride,
}: UseReferenceCurrenciesOptions = {}) {
  const uiState = useDashboardStore((s) => s.uiState);
  const realm = realmOverride ?? "poe2";
  const league = leagueOverride ?? uiState.league ?? "";

  return useQuery<ReferenceCurrency[]>({
    queryKey: [QUERY_KEYS.referenceCurrencies, realm, league],
    queryFn: () =>
      fetchApi<ReferenceCurrency[]>("/api/poe2/exchange", {
        realm,
        league,
        action: "reference",
      }),
    enabled: enabled && !!league,
    placeholderData: keepPreviousData,
    staleTime: 10 * 60_000,
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(500 * Math.pow(2, attemptIndex), 10_000),
  });
}
