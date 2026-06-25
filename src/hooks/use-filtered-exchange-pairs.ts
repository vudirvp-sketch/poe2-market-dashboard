// ============================================================================
// useFilteredExchangePairs — Exchange tab filter/sort/search derivation
// ============================================================================
//
// Stage 3a of the useDashboardData hook extraction (iter 83, deferred from
// P2-1). See STATUS.md "Technical-debt backlog" for the staged plan.
//
// This hook owns the client-side filtering of the raw `/api/poe2/exchange`
// response into the `exchangePairs` array consumed by the Exchange tab. The
// filter pipeline (search → quick-filter chip → extended numeric filters) is
// pure — same logic as the inline useMemo it replaces, just centralized so
// dashboard-page.tsx can stop holding 40 lines of filter rules.
//
// The hook does NOT own any state. It receives `exchangeData`, `search`, and
// the `exchangeUiState` slice as inputs and returns a derived array. Inputs
// are owned by the parent (Dashboard component) — same as before. This keeps
// the dependency surface minimal: the hook has no side effects, no query
// subscriptions, and no store reads.
//
// Behaviour parity (verified by jest baseline 422/422 in iter 83):
//   - Search is case-insensitive, matches either currency name in the pair.
//   - `topVolume` chip → top 20 pairs by `volume` (descending). The slice is
//     applied AFTER search + extended filters so they compose correctly.
//   - `favorites` chip → pairs whose `id` appears in `exchangeUiState.favorites`.
//   - Extended filters: `minVolume` / `maxVolume` are inclusive; `minChange`
//     and `maxChange` are ignored when 0 (treated as "not set" — matches the
//     original inline behaviour). `changePercent` is treated as -∞ / +∞ when
//     null so null-change pairs are excluded by min/max bounds.
//
// Future stages (NOT in this hook):
//   - Stage 3b: optimalPayment cluster (clientOptimalResult + merge +
//               optimalPaymentByDisplayName) — highest interdependency risk.
// ============================================================================

"use client";

import { useMemo } from "react";
import type { ExchangePair } from "@/lib/types";
import type { PersistedUIState } from "@/lib/store";

/** Inputs for useFilteredExchangePairs. */
export interface UseFilteredExchangePairsInput {
  /** Raw exchange pair data from useExchangePairs (undefined while loading). */
  exchangeData: ExchangePair[] | undefined;
  /** Current search string from the toolbar (case-insensitive substring). */
  search: string;
  /** The `uiState.exchange` slice from the Zustand store. */
  exchangeUiState: PersistedUIState["exchange"];
}

/**
 * Apply the Exchange tab filter pipeline (search → quick chip → extended
 * numeric filters) to the raw exchange pair data. Returns a new array —
 * the input is never mutated.
 */
export function useFilteredExchangePairs({
  exchangeData,
  search,
  exchangeUiState,
}: UseFilteredExchangePairsInput): ExchangePair[] {
  return useMemo(() => {
    let pairs = exchangeData || [];

    // --- Search filter (case-insensitive, either currency name) ---
    if (search) {
      const q = search.toLowerCase();
      pairs = pairs.filter(
        (p) =>
          p.currency1Name.toLowerCase().includes(q) ||
          p.currency2Name.toLowerCase().includes(q)
      );
    }

    // --- Quick filter chips (§1.2) ---
    const activeFilter = exchangeUiState.activeFilter;
    if (activeFilter === "topVolume") {
      // Top 20 pairs by volume (descending). Applied after search so the
      // chip respects the user's current search context.
      const sorted = [...pairs].sort((a, b) => b.volume - a.volume);
      pairs = sorted.slice(0, 20);
    } else if (activeFilter === "favorites") {
      // Only favorited pairs
      pairs = pairs.filter((p) => exchangeUiState.favorites.includes(p.id));
    }

    // --- §2.3: Extended numeric filters ---
    const extFilters = exchangeUiState.extendedFilters;
    if (extFilters.minVolume != null) {
      pairs = pairs.filter((p) => p.volume >= (extFilters.minVolume ?? 0));
    }
    if (extFilters.maxVolume != null) {
      pairs = pairs.filter((p) => p.volume <= (extFilters.maxVolume ?? Infinity));
    }
    if (extFilters.minChange != null && extFilters.minChange !== 0) {
      pairs = pairs.filter(
        (p) => (p.changePercent ?? -Infinity) >= (extFilters.minChange ?? -Infinity)
      );
    }
    if (extFilters.maxChange != null && extFilters.maxChange !== 0) {
      pairs = pairs.filter(
        (p) => (p.changePercent ?? Infinity) <= (extFilters.maxChange ?? Infinity)
      );
    }

    return pairs;
  }, [
    exchangeData,
    search,
    exchangeUiState.activeFilter,
    exchangeUiState.favorites,
    exchangeUiState.extendedFilters,
  ]);
}
