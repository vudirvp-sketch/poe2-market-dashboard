// ============================================================================
// useOptimalPayment — Optimal payment currency cluster (Stage 3b of
// useDashboardData extraction, iter 84)
// ============================================================================
//
// Single Source of Truth for the §11 "Cross-currency optimal payment"
// pipeline. Wraps four previously-inline blocks from dashboard-page.tsx:
//
//   1. `optimalCurrencyData` useQuery — backend-side computation
//      (GET /api/flipper/optimal-currency). Gated on `flipperBackendOnline`
//      so it does NOT fire when the backend is unreachable (matches the
//      pre-iter-84 inline behaviour). 60s staleTime + refetchInterval,
//      retry: 1. Query key: `QUERY_KEYS.flipperOptimalCurrency` (unchanged).
//
//   2. `clientOptimalResult` memo — client-side fallback. Computes the same
//      `{ optimalPaymentByPair, crossRateFlips, anchorId }` shape using the
//      pure functions `findOptimalPayment` + `isItemCategory` from
//      `@/lib/currency-optimal`, plus the `crossRates` hook's
//      `relativePriceMap` / `anchorId` / `anchorRelPrice` / `crossRateFlips`.
//      Runs in two passes: (a) group pairs by `currency1Id` for currency-vs-
//      currency pricing; (b) group pairs by `currency1CategoryApiId` for
//      item-aware optimal payment (Omens, Soul Cores, etc.). Both passes
//      require ≥2 pricing options per group — `findOptimalPayment` returns
//      null for groups with <2 options.
//
//   3. Merge memo — backend data takes priority when available and has data
//      (`optimalCurrencyData.dataAvailable && optimalPaymentByPair`); falls
//      back to `clientOptimalResult` otherwise. When the backend path is
//      used, the response's `"currencyFrom_currencyTo"` keys are remapped
//      to frontend `pair.id` so downstream components can look up results
//      by pair ID. Returns the three values consumed by ExchangeTabContent
//      and FlipsTab: `{ optimalPaymentByPair, crossRateFlips,
//      anchorId: selectedAnchorId }`.
//
//   4. `optimalPaymentByDisplayName` memo — derived from the merge memo's
//      `optimalPaymentByPair`. Builds a parallel `Map<string,
//      OptimalPaymentResult>` keyed by `"currency1Name/currency2Name"` for
//      FlipsTab (which uses display-name keys, not pair IDs).
//
// The hook receives three pure inputs from the parent:
//   - `exchangeData` — from `useExchangePairs()` in the parent
//   - `crossRates` — from `useCrossRates()` in the parent (the parent also
//     passes `crossRates` straight to FlipsTab, so the hook cannot own it)
//   - `flipperBackendOnline` — from `useFlipperBackend()` in the parent
//
// All dependency arrays match the prior inline memos exactly — verified by
// jest baseline 422/422 in iter 84. Zero behaviour change.
//
// Stage 3b was the highest interdependency risk in the entire extraction
// plan because the merge memo consumes both the useQuery result AND the
// clientOptimalResult memo, and the byDisplayName memo consumes the merge
// memo's output. The pipeline is internally linear, so a single hook (vs
// the 3b-i / 3b-ii split suggested in iter 83's hand-off) is sufficient
// and keeps the parent's call site to a single line.
//
// With Stage 3b shipped, the `useDashboardData` extraction is COMPLETE.
// dashboard-page.tsx is now legitimate parent wiring — no more inline
// useQuery / heavy memo clusters left to extract.
// ============================================================================

"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchApi } from "@/lib/types";
import type {
  ExchangePair,
  OptimalPaymentResult,
  OptimalCurrencyResponse,
  CrossRateFlip,
} from "@/lib/types";
import {
  findOptimalPayment,
  isItemCategory,
} from "@/lib/currency-optimal";
import type { CrossRatesResult } from "@/hooks/use-cross-rates";
import { QUERY_KEYS } from "@/components/providers";

/** Inputs for useOptimalPayment. */
export interface UseOptimalPaymentInput {
  /** Raw exchange pair data from useExchangePairs (undefined while loading). */
  exchangeData: ExchangePair[] | undefined;
  /** Cross-rate computation from useCrossRates (relativePriceMap + anchor + flips). */
  crossRates: CrossRatesResult;
  /** Whether the flipper backend is reachable (gates the useQuery). */
  flipperBackendOnline: boolean;
}

/** Result of useOptimalPayment — what dashboard-page.tsx consumes downstream. */
export interface UseOptimalPaymentResult {
  /** Map of pair.id → OptimalPaymentResult (backend-merged with client fallback). */
  optimalPaymentByPair: Map<string, OptimalPaymentResult>;
  /** Cross-rate flip opportunities (from backend when available, else client). */
  crossRateFlips: CrossRateFlip[];
  /** Selected anchor currency ID ("exalted" by default). */
  selectedAnchorId: string;
  /** Display-name-keyed map ("Name1/Name2") for FlipsTab consumption. */
  optimalPaymentByDisplayName: Map<string, OptimalPaymentResult>;
}

/**
 * Compute the optimal-payment cluster for the dashboard.
 *
 * See file header for the full pipeline description. The hook is pure given
 * its three inputs — no store reads, no useState. The only side effect is
 * the conditional `useQuery` (which is itself idempotent under React Query's
 * cache key contract).
 */
export function useOptimalPayment({
  exchangeData,
  crossRates,
  flipperBackendOnline,
}: UseOptimalPaymentInput): UseOptimalPaymentResult {
  // ==========================================================================
  // 1. Backend-side optimal-currency query (gated on flipperBackendOnline).
  // ==========================================================================
  // When the backend is online, this returns server-side-computed
  // `{ optimalPaymentByPair, crossRateFlips, anchorId }`. When the backend
  // is offline, the query is disabled and we fall through to the
  // client-side computation below.
  const { data: optimalCurrencyData } = useQuery<OptimalCurrencyResponse>({
    queryKey: [QUERY_KEYS.flipperOptimalCurrency],
    queryFn: () => fetchApi<OptimalCurrencyResponse>("/api/flipper/optimal-currency"),
    enabled: flipperBackendOnline,
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: 1,
  });

  // ==========================================================================
  // 2. Client-side fallback: compute optimal payment from exchangeData when
  //    the backend is offline (or before the backend query resolves).
  // ==========================================================================
  // Uses crossRates hook for relativePriceMap, anchorId, and crossRateFlips
  // (Phase 2.3). The same logic from currency-optimal.ts is reused — no
  // recomputation of the relativePriceMap here.
  const clientOptimalResult = useMemo(() => {
    const allPairs = exchangeData ?? [];
    if (allPairs.length === 0) {
      return {
        optimalPaymentByPair: new Map<string, OptimalPaymentResult>(),
        crossRateFlips: [] as CrossRateFlip[],
        anchorId: "exalted" as string,
      };
    }

    // Use crossRates hook results instead of recomputing buildRelativePriceMap/selectAnchor
    const relPriceMap = crossRates.relativePriceMap;
    const anchor = crossRates.anchorId;
    const anchorRelPrice = crossRates.anchorRelPrice;

    // Group pairs by currency1Id — each group represents one "item" priced in multiple currencies
    const groups = new Map<string, ExchangePair[]>();
    for (const pair of allPairs) {
      const existing = groups.get(pair.currency1Id);
      if (existing) {
        existing.push(pair);
      } else {
        groups.set(pair.currency1Id, [pair]);
      }
    }

    // For each group with 2+ pricing options, compute optimal payment
    const optimalPaymentByPair = new Map<string, OptimalPaymentResult>();
    for (const [, groupPairs] of groups) {
      if (groupPairs.length < 2) continue;

      // Build pricing options from each pair in the group
      const pricingOptions = groupPairs
        .filter((p) => p.currency2RelativePrice != null && p.currency2RelativePrice > 0)
        .map((p) => ({
          currencyId: p.currency2Id,
          currencyName: p.currency2Name,
          // Cross-rate: how many currency2 per 1 currency1
          priceInCurrency:
            p.relativePrice != null &&
            p.currency2RelativePrice != null &&
            p.currency2RelativePrice > 0
              ? p.relativePrice / p.currency2RelativePrice
              : 0,
          relativePrice: p.currency2RelativePrice ?? 0,
        }))
        .filter((opt) => opt.priceInCurrency > 0 && opt.relativePrice > 0);

      const result = findOptimalPayment(pricingOptions, anchorRelPrice);
      if (result) {
        // Map result back to each pair in the group
        for (const p of groupPairs) {
          optimalPaymentByPair.set(p.id, result);
        }
      }
    }

    // §11 extension: Item-aware optimal payment.
    // For craft items (Omens, Soul Cores), currency1Id is the item itself.
    // These items appear as CurrencyOne in exchange pairs, where CurrencyTwo
    // is the payment currency. Group all pairs where currency1CategoryApiId
    // is an item category, then for each item find the cheapest payment currency.
    const itemGroups = new Map<string, ExchangePair[]>();
    for (const pair of allPairs) {
      if (isItemCategory(pair.currency1CategoryApiId)) {
        const existing = itemGroups.get(pair.currency1Id);
        if (existing) {
          existing.push(pair);
        } else {
          itemGroups.set(pair.currency1Id, [pair]);
        }
      }
    }

    for (const [, itemPairs] of itemGroups) {
      if (itemPairs.length < 2) continue;

      // Each pair represents: "item X can be bought with currency Y"
      // priceInCurrency = price of 1 unit of item X in currency Y
      const pricingOptions = itemPairs
        .filter(
          (p) =>
            p.currency2RelativePrice != null &&
            p.currency2RelativePrice > 0 &&
            p.relativePrice != null &&
            p.relativePrice > 0,
        )
        .map((p) => ({
          currencyId: p.currency2Id,
          currencyName: p.currency2Name,
          priceInCurrency: p.relativePrice! / p.currency2RelativePrice!,
          relativePrice: p.currency2RelativePrice!,
        }))
        .filter((opt) => opt.priceInCurrency > 0 && opt.relativePrice > 0);

      const result = findOptimalPayment(pricingOptions, anchorRelPrice);
      if (result) {
        for (const p of itemPairs) {
          optimalPaymentByPair.set(p.id, result);
        }
      }
    }

    // Use crossRates for cross-rate flips (computed by useCrossRates hook)
    return {
      optimalPaymentByPair,
      crossRateFlips: crossRates.crossRateFlips,
      anchorId: anchor,
    };
  }, [
    exchangeData,
    crossRates.relativePriceMap,
    crossRates.anchorId,
    crossRates.anchorRelPrice,
    crossRates.crossRateFlips,
  ]);

  // ==========================================================================
  // 3. Merge: backend data takes priority when available and has data;
  //    client fallback otherwise.
  // ==========================================================================
  const { optimalPaymentByPair, crossRateFlips, anchorId: selectedAnchorId } =
    useMemo(() => {
      // Backend data available?
      if (
        optimalCurrencyData?.dataAvailable &&
        optimalCurrencyData.optimalPaymentByPair
      ) {
        // Remap backend keys ("currencyFrom_currencyTo") to frontend pair.id
        // Backend groups by currency_from; each key covers a currency_from → currency_to pair.
        // We need to map these back to the exchange pair IDs for component lookups.
        const allPairs = exchangeData ?? [];
        const pairMap = new Map<string, OptimalPaymentResult>();

        for (const pair of allPairs) {
          // Try the exact backend key format: currency1Id_currency2Id
          const backendKey = `${pair.currency1Id}_${pair.currency2Id}`;
          const result = optimalCurrencyData.optimalPaymentByPair[backendKey];
          if (result) {
            pairMap.set(pair.id, result);
          }
        }

        return {
          optimalPaymentByPair: pairMap,
          crossRateFlips: optimalCurrencyData.crossRateFlips ?? [],
          anchorId: optimalCurrencyData.anchorId || "exalted",
        };
      }

      // Fallback: use client-side computation
      return clientOptimalResult;
    }, [optimalCurrencyData, exchangeData, clientOptimalResult]);

  // ==========================================================================
  // 4. Display-name-keyed map for FlipsTab (flip currency uses "Name1/Name2"
  //    format).
  // ==========================================================================
  const optimalPaymentByDisplayName = useMemo(() => {
    const map = new Map<string, OptimalPaymentResult>();
    if (!exchangeData || !optimalPaymentByPair || optimalPaymentByPair.size === 0)
      return map;
    for (const pair of exchangeData) {
      const result = optimalPaymentByPair.get(pair.id);
      if (result) {
        const key = `${pair.currency1Name}/${pair.currency2Name}`;
        map.set(key, result);
      }
    }
    return map;
  }, [exchangeData, optimalPaymentByPair]);

  return {
    optimalPaymentByPair,
    crossRateFlips,
    selectedAnchorId,
    optimalPaymentByDisplayName,
  };
}
