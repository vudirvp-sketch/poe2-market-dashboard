// ============================================================================
// useCrossRates — Hook for cross-rate computation across currencies
// ============================================================================
//
// Provides a reactive cross-rate map derived from exchange pair data.
// Answers the question: "How much is currency X worth in Divine/Chaos/Exalted?"
//
// Design:
//   - Uses useExchangePairs() internally → unified query key, shared cache
//   - Delegates all computation to pure functions in currency-optimal.ts
//   - Returns: relativePriceMap, anchorId, crossRateFlips, crossRates map
//   - Consumers: MultiCurrencyPrice, FlipsTab, any component needing
//     cross-currency price comparisons
//
// Note: This hook does NOT make its own API call. It derives cross-rates
// from the exchange pairs already cached by useExchangePairs().
// ============================================================================

"use client";

import { useMemo, useCallback } from "react";
import { useExchangePairs } from "@/hooks/use-exchange-pairs";
import {
  buildRelativePriceMap,
  selectAnchor,
  detectCrossRateFlips,
  type CrossRateFlip,
  type AnchorCurrency,
} from "@/lib/currency-optimal";
import type { ExchangePair } from "@/lib/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of the useCrossRates hook */
export interface CrossRatesResult {
  /** Whether exchange pair data is currently loading */
  isLoading: boolean;
  /** Whether an error occurred fetching exchange pairs */
  isError: boolean;
  /** The raw exchange pair data (may be undefined while loading) */
  exchangePairs: ExchangePair[] | undefined;

  // --- Derived cross-rate data ---

  /** Map of currency apiId → relativePrice (in base currency, e.g. Exalted) */
  relativePriceMap: Map<string, number>;
  /** The selected anchor currency ID (e.g. "divine", "exalted") */
  anchorId: AnchorCurrency | string;
  /** Relative price of the anchor currency in the base currency */
  anchorRelPrice: number;
  /** Detected cross-rate flip opportunities (deviation >= thresholdPct) */
  crossRateFlips: CrossRateFlip[];

  // --- Utility methods ---

  /**
   * Convert a price from one currency to another.
   * Returns null if either currency is not in the relativePriceMap.
   */
  convertPrice: (
    priceInCurrency: number,
    fromCurrencyId: string,
    toCurrencyId: string,
  ) => number | null;

  /**
   * Get the relative price of a currency.
   * Returns undefined if the currency is not in the map.
   */
  getRelativePrice: (currencyId: string) => number | undefined;

  /**
   * Compute the cross-rate from currency A to currency B.
   * Returns how many units of B per 1 unit of A.
   * Returns null if either currency is unknown.
   */
  getCrossRate: (fromId: string, toId: string) => number | null;
}

// ---------------------------------------------------------------------------
// Hook options
// ---------------------------------------------------------------------------

export interface UseCrossRatesOptions {
  /** Only compute when this is true (default: true) */
  enabled?: boolean;
  /** Minimum deviation % to flag as cross-rate flip opportunity (default: 7, iter 92 KI-9 unified with backend) */
  flipThresholdPct?: number;
  /**
   * Override exchange pairs data (bypasses useExchangePairs if provided).
   * Use this when the parent component already has exchange pairs loaded
   * (e.g. dashboard-page.tsx with its own useExchangePairs call).
   */
  exchangePairsOverride?: ExchangePair[];
  /** Override realm (passed through to useExchangePairs) */
  realm?: string;
  /** Override league (passed through to useExchangePairs) */
  league?: string;
  /** Pass snapshot: true for fast initial load */
  snapshot?: boolean;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Hook that provides cross-rate computations from exchange pair data.
 *
 * Internally uses `useExchangePairs()` to fetch exchange pairs, then
 * derives:
 *   - relativePriceMap: currency → relative price in base currency
 *   - anchorId: best available anchor currency (Mirror > Divine > Exalted > Chaos)
 *   - crossRateFlips: detected arbitrage opportunities from rate deviations
 *   - convertPrice(): convert a price between any two known currencies
 *   - getCrossRate(): get the exchange rate between two currencies
 *
 * If `exchangePairsOverride` is provided, the hook uses that data
 * instead of fetching its own (useful when the parent already has
 * exchange pairs loaded via useExchangePairs).
 */
export function useCrossRates({
  enabled = true,
  flipThresholdPct = 7,
  exchangePairsOverride,
  realm,
  league,
  snapshot,
}: UseCrossRatesOptions = {}): CrossRatesResult {
  // Fetch exchange pairs unless override is provided
  const {
    data: fetchedPairs,
    isLoading,
    isError,
  } = useExchangePairs({
    enabled: enabled && !exchangePairsOverride,
    realm,
    league,
    snapshot,
  });

  const pairs = exchangePairsOverride ?? fetchedPairs;

  // Derive cross-rate data from exchange pairs
  const { relativePriceMap, anchorId, anchorRelPrice, crossRateFlips } = useMemo(() => {
    if (!pairs || pairs.length === 0) {
      return {
        relativePriceMap: new Map<string, number>(),
        anchorId: "exalted" as const,
        anchorRelPrice: 1,
        crossRateFlips: [] as CrossRateFlip[],
      };
    }

    const relativePriceMap = buildRelativePriceMap(pairs);
    const anchorId = selectAnchor(relativePriceMap);
    const anchorRelPrice = relativePriceMap.get(anchorId) ?? 1;
    const crossRateFlips = detectCrossRateFlips(pairs, flipThresholdPct);

    return { relativePriceMap, anchorId, anchorRelPrice, crossRateFlips };
  }, [pairs, flipThresholdPct]);

  // Utility: convert price between currencies
  const convertPrice = useCallback(
    (priceInCurrency: number, fromCurrencyId: string, toCurrencyId: string): number | null => {
      const fromRel = relativePriceMap.get(fromCurrencyId);
      const toRel = relativePriceMap.get(toCurrencyId);
      if (fromRel == null || toRel == null || toRel <= 0) return null;
      return priceInCurrency * (fromRel / toRel);
    },
    [relativePriceMap],
  );

  // Utility: get relative price of a currency
  const getRelativePrice = useCallback(
    (currencyId: string): number | undefined => relativePriceMap.get(currencyId),
    [relativePriceMap],
  );

  // Utility: get cross-rate between two currencies
  const getCrossRate = useCallback(
    (fromId: string, toId: string): number | null => {
      const fromRel = relativePriceMap.get(fromId);
      const toRel = relativePriceMap.get(toId);
      if (fromRel == null || toRel == null || toRel <= 0) return null;
      return fromRel / toRel;
    },
    [relativePriceMap],
  );

  return {
    isLoading: exchangePairsOverride ? false : isLoading,
    isError: exchangePairsOverride ? false : isError,
    exchangePairs: pairs,
    relativePriceMap,
    anchorId,
    anchorRelPrice,
    crossRateFlips,
    convertPrice,
    getRelativePrice,
    getCrossRate,
  };
}
