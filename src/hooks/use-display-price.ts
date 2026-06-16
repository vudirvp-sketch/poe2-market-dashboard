// ============================================================================
// useDisplayPrice — Hook for client-side price conversion between reference
// currencies (P0-2 Step 2B fallback) + P0: Adaptive Value Display
//
// When the POE2Scout API does NOT recalculate prices based on the
// ReferenceCurrency parameter (or if this feature is removed in the future),
// this hook provides client-side conversion using exchange pair data.
//
// P0: "Adaptive" mode — auto-selects the most readable currency unit per row:
//   - Price ≥ 0.5 Divine  → show in Divine
//   - Price < 0.01 Exalted → show in Chaos
//   - Otherwise            → show in Exalted
//
// Usage:
//   const { displayPrice, currencyLabel } = useDisplayPrice({
//     priceInBase: item.relativePrice,
//     baseCurrencyApiId: "exalted",
//     targetCurrencyApiId: "divine",     // or "_adaptive" for auto-selection
//     exchangePairs: exchangeData,
//   });
//
// The hook computes: displayPrice = priceInBase * (baseRate / targetRate)
// where baseRate and targetRate come from the exchange pairs' RelativePrice.
// ============================================================================

import { useMemo } from "react";
import { useDashboardStore } from "@/lib/store";
import { convertBaseCurrency } from "@/lib/utils";
import type { ExchangePair } from "@/lib/types";

interface UseDisplayPriceOptions {
  /** Price expressed in the current base currency */
  priceInBase: number | null | undefined;
  /** The api_id of the currency the price is currently expressed in (default: league base) */
  baseCurrencyApiId?: string | null;
  /** The api_id of the target display currency. If null, returns the raw price.
   *  Use "_adaptive" for auto-selection of the most readable unit. */
  targetCurrencyApiId?: string | null;
  /** Exchange pair data used to look up relative prices */
  exchangePairs?: ExchangePair[];
}

interface DisplayPriceResult {
  /** The converted price in the target currency, or the raw price if no conversion needed */
  displayPrice: number | null;
  /** Short label for the target currency (e.g. "Div", "Exa") */
  currencyLabel: string;
  /** Whether a conversion was actually applied */
  wasConverted: boolean;
  /** The api_id of the currency that was chosen (useful when adaptive mode is active) */
  chosenCurrencyId: string;
}

// Currency short name map (same as utils.ts but standalone for hook)
const SHORT_NAMES: Record<string, string> = {
  exalted: "Exa",
  divine: "Div",
  chaos: "Chaos",
  regret: "Regret",
  chance: "Chance",
  alchemy: "Alch",
  scouring: "Scour",
  transmutation: "Trans",
  alteration: "Alt",
  augmentation: "Aug",
  jeweller: "Jew",
  fusing: "Fuse",
  chromatic: "Chrom",
  vaal: "Vaal",
  regal: "Regal",
  mirror: "Mirror",
};

// Adaptive display thresholds (prices in Exalted-equivalent)
const ADAPTIVE_DIVINE_THRESHOLD = 0.5;   // ≥0.5 Div → show in Divine
const ADAPTIVE_CHAOS_THRESHOLD = 0.01;   // <0.01 Exa → show in Chaos

/**
 * For adaptive mode: given a price in the base currency and exchange pairs,
 * determine which currency unit produces the most human-readable number.
 *
 * Priority:
 * 1. Divine: if priceInExa ≥ ADAPTIVE_DIVINE_THRESHOLD * divineRelativePrice
 * 2. Chaos:  if priceInExa < ADAPTIVE_CHAOS_THRESHOLD
 * 3. Exalted: default (most common)
 */
function resolveAdaptiveCurrency(
  priceInBase: number,
  baseCurrencyApiId: string,
  exchangePairs: ExchangePair[],
): { currencyId: string; label: string } {
  // Find relative prices for the major currencies
  let exaltedRate: number | null = null;
  let divineRate: number | null = null;
  let chaosRate: number | null = null;

  for (const pair of exchangePairs) {
    if (pair.currency1Id === "exalted" && pair.relativePrice != null) exaltedRate = pair.relativePrice;
    if (pair.currency1Id === "divine" && pair.relativePrice != null) divineRate = pair.relativePrice;
    if (pair.currency1Id === "chaos" && pair.relativePrice != null) chaosRate = pair.relativePrice;
  }

  // If base is not exalted, convert price to exalted-equivalent for comparison
  let priceInExa: number;
  if (baseCurrencyApiId === "exalted") {
    priceInExa = priceInBase;
  } else if (baseCurrencyApiId === "divine" && divineRate && exaltedRate) {
    // priceInDiv * (divineRate / exaltedRate) → but exaltedRate is usually 1.0
    // Actually: priceInDiv * divineRate / exaltedRate = priceInExa
    priceInExa = priceInBase * (divineRate / (exaltedRate || 1));
  } else if (baseCurrencyApiId === "chaos" && chaosRate && exaltedRate) {
    priceInExa = priceInBase * (chaosRate / (exaltedRate || 1));
  } else {
    // Can't determine exalted equivalent — fall back to base currency
    return { currencyId: baseCurrencyApiId, label: SHORT_NAMES[baseCurrencyApiId] ?? baseCurrencyApiId };
  }

  // Rule 1: Price ≥ 0.5 Divine → show in Divine
  if (divineRate && priceInExa >= ADAPTIVE_DIVINE_THRESHOLD * divineRate) {
    return { currencyId: "divine", label: "Div" };
  }

  // Rule 2: Price < 0.01 Exalted → show in Chaos
  if (chaosRate && priceInExa < ADAPTIVE_CHAOS_THRESHOLD) {
    return { currencyId: "chaos", label: "Chaos" };
  }

  // Rule 3: Default — show in Exalted
  return { currencyId: "exalted", label: "Exa" };
}

/**
 * Hook to convert a price from the base currency to the user's selected
 * reference currency on the client side. This is the P0-2 Step 2B fallback
 * for when the POE2Scout API does not support the ReferenceCurrency parameter.
 *
 * P0: When targetCurrencyApiId is "_adaptive", the hook automatically
 * selects the most readable currency unit for each price value.
 */
export function useDisplayPrice({
  priceInBase,
  baseCurrencyApiId,
  targetCurrencyApiId,
  exchangePairs,
}: UseDisplayPriceOptions): DisplayPriceResult {
  const uiState = useDashboardStore((s) => s.uiState);

  // Resolve effective base and target currencies
  const effectiveBase = baseCurrencyApiId ?? uiState.baseCurrencyApiId ?? "exalted";
  const effectiveTarget = targetCurrencyApiId ?? uiState.baseCurrencyApiId ?? "exalted";

  const result = useMemo(() => {
    // No price to convert
    if (priceInBase == null) {
      const label = effectiveTarget === "_adaptive"
        ? SHORT_NAMES[effectiveBase] ?? effectiveBase
        : SHORT_NAMES[effectiveTarget] ?? effectiveTarget;
      return { displayPrice: null, currencyLabel: label, wasConverted: false, chosenCurrencyId: effectiveBase };
    }

    // --- Adaptive mode ---
    if (effectiveTarget === "_adaptive") {
      if (!exchangePairs || exchangePairs.length === 0) {
        // No data for adaptive — fall back to base currency
        return {
          displayPrice: priceInBase,
          currencyLabel: SHORT_NAMES[effectiveBase] ?? effectiveBase,
          wasConverted: false,
          chosenCurrencyId: effectiveBase,
        };
      }

      const { currencyId, label } = resolveAdaptiveCurrency(priceInBase, effectiveBase, exchangePairs);

      // If the chosen currency is the same as base, no conversion needed
      if (currencyId === effectiveBase) {
        return { displayPrice: priceInBase, currencyLabel: label, wasConverted: false, chosenCurrencyId: currencyId };
      }

      // Convert to the chosen currency
      let baseRate = 1.0;
      let targetRate: number | null = null;

      for (const pair of exchangePairs) {
        if (pair.currency1Id === effectiveBase) {
          baseRate = pair.relativePrice ?? 1.0;
        }
        if (pair.currency1Id === currencyId) {
          targetRate = pair.relativePrice ?? null;
        }
      }

      if (targetRate == null || targetRate === 0) {
        return { displayPrice: priceInBase, currencyLabel: label, wasConverted: false, chosenCurrencyId: effectiveBase };
      }

      const converted = convertBaseCurrency(priceInBase, baseRate, targetRate);
      return { displayPrice: converted, currencyLabel: label, wasConverted: true, chosenCurrencyId: currencyId };
    }

    // --- Standard (non-adaptive) mode ---
    const currencyLabel = SHORT_NAMES[effectiveTarget] ?? effectiveTarget;

    // No conversion needed (same currency)
    if (effectiveBase === effectiveTarget) {
      return { displayPrice: priceInBase, currencyLabel, wasConverted: false, chosenCurrencyId: effectiveTarget };
    }

    // No exchange pair data available — can't convert
    if (!exchangePairs || exchangePairs.length === 0) {
      return { displayPrice: priceInBase, currencyLabel, wasConverted: false, chosenCurrencyId: effectiveBase };
    }

    // Find the relative prices of both currencies in the base pair data.
    let baseRate = 1.0; // Default: 1 unit of base currency
    let targetRate: number | null = null;

    for (const pair of exchangePairs) {
      if (pair.currency1Id === effectiveBase) {
        baseRate = pair.relativePrice ?? 1.0;
      }
      if (pair.currency1Id === effectiveTarget) {
        targetRate = pair.relativePrice ?? null;
      }
    }

    // If we couldn't find the target currency's rate, return unconverted
    if (targetRate == null || targetRate === 0) {
      return { displayPrice: priceInBase, currencyLabel, wasConverted: false, chosenCurrencyId: effectiveBase };
    }

    // Convert: priceInTarget = priceInBase * (baseRate / targetRate)
    const converted = convertBaseCurrency(priceInBase, baseRate, targetRate);

    return {
      displayPrice: converted,
      currencyLabel,
      wasConverted: true,
      chosenCurrencyId: effectiveTarget,
    };
  }, [priceInBase, effectiveBase, effectiveTarget, exchangePairs]);

  return result;
}
