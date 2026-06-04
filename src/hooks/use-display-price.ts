// ============================================================================
// useDisplayPrice — Hook for client-side price conversion between reference
// currencies (P0-2 Step 2B fallback)
//
// When the POE2Scout API does NOT recalculate prices based on the
// ReferenceCurrency parameter (or if this feature is removed in the future),
// this hook provides client-side conversion using exchange pair data.
//
// Usage:
//   const { displayPrice, currencyLabel } = useDisplayPrice({
//     priceInBase: item.relativePrice,
//     baseCurrencyApiId: "exalted",
//     targetCurrencyApiId: "divine",
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
  /** The api_id of the target display currency. If null, returns the raw price */
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

/**
 * Hook to convert a price from the base currency to the user's selected
 * reference currency on the client side. This is the P0-2 Step 2B fallback
 * for when the POE2Scout API does not support the ReferenceCurrency parameter.
 *
 * Current behavior (Step 2A): The API recalculates prices server-side when
 * ReferenceCurrency is specified. This hook is a safety net that can be
 * activated if the API stops supporting this feature.
 *
 * To activate: pass `exchangePairs` to this hook in any component that
// displays prices. The hook will automatically convert if the target
// currency differs from the base.
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

  // Short label for the target currency
  const currencyLabel = SHORT_NAMES[effectiveTarget] ?? effectiveTarget;

  const result = useMemo(() => {
    // No price to convert
    if (priceInBase == null) {
      return { displayPrice: null, currencyLabel, wasConverted: false };
    }

    // No conversion needed (same currency)
    if (effectiveBase === effectiveTarget) {
      return { displayPrice: priceInBase, currencyLabel, wasConverted: false };
    }

    // No exchange pair data available — can't convert
    if (!exchangePairs || exchangePairs.length === 0) {
      return { displayPrice: priceInBase, currencyLabel, wasConverted: false };
    }

    // Find the relative prices of both currencies in the base pair data.
    // In SnapshotPairs, each pair has currency1Id and currency2Id.
    // RelativePrice is the price of currency1 in the league's base currency.
    // We need to find pairs where either currency matches our target.
    let baseRate = 1.0; // Default: 1 unit of base currency
    let targetRate: number | null = null;

    for (const pair of exchangePairs) {
      // If currency1 is the base currency, its RelativePrice IS its price
      if (pair.currency1Id === effectiveBase) {
        baseRate = pair.relativePrice ?? 1.0;
      }
      if (pair.currency1Id === effectiveTarget) {
        targetRate = pair.relativePrice ?? null;
      }
    }

    // If we couldn't find the target currency's rate, return unconverted
    if (targetRate == null || targetRate === 0) {
      return { displayPrice: priceInBase, currencyLabel, wasConverted: false };
    }

    // Convert: priceInTarget = priceInBase * (baseRate / targetRate)
    const converted = convertBaseCurrency(priceInBase, baseRate, targetRate);

    return {
      displayPrice: converted,
      currencyLabel,
      wasConverted: true,
    };
  }, [priceInBase, effectiveBase, effectiveTarget, exchangePairs, currencyLabel]);

  return result;
}
