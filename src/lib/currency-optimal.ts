// ============================================================================
// Cross-Currency Arbitrage & Optimal Payment Currency Helpers
//
// Implements §11 of PoE2_Flipper_Canonical_Formulas.md:
//   - Effective anchor price normalization
//   - Cross-currency premium detection
//   - Optimal payment currency recommendation
//   - Cross-rate flip opportunity detection
//
// These are PURE functions — no React, no hooks, no API calls.
// All data comes from ExchangePair.relativePrice fields.
// ============================================================================

import type { ExchangePair } from "@/lib/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of comparing an item's price across multiple payment currencies */
export interface OptimalPaymentResult {
  /** The currency with the lowest effective anchor price */
  bestCurrencyId: string;
  /** The currency with the highest effective anchor price */
  worstCurrencyId: string;
  /** Effective anchor price when paying with the best currency */
  bestAnchorPrice: number;
  /** Effective anchor price when paying with the worst currency */
  worstAnchorPrice: number;
  /** Savings in anchor units (worst − best) */
  savingsAnchor: number;
  /** Savings as a percentage of the worst price */
  savingsPct: number;
  /** All evaluated payment options, sorted by effective anchor price ascending */
  options: PaymentOption[];
}

/** A single payment option for an item in a specific currency */
export interface PaymentOption {
  /** Currency API ID used for payment */
  currencyId: string;
  /** Display name of the currency */
  currencyName: string;
  /** Price in the payment currency (e.g., 3.75 Divine) */
  priceInCurrency: number;
  /** Effective price normalized to the anchor currency */
  effectiveAnchorPrice: number;
  /** Cross-currency premium vs the cheapest option (0% for the cheapest) */
  premiumPct: number;
}

/** A detected cross-rate flip opportunity */
export interface CrossRateFlip {
  /** Currency being bought (undervalued) */
  buyCurrencyId: string;
  /** Currency being sold (overvalued) */
  sellCurrencyId: string;
  /** Fair cross-rate (via anchor): sell/buy */
  fairRate: number;
  /** Market cross-rate observed on exchange */
  marketRate: number;
  /** Deviation from fair rate, as percentage */
  deviationPct: number;
  /** Direction of the flip */
  direction: "buy_sell_with_buy" | "buy_buy_with_sell";
  /** Estimated profit percentage for a round-trip */
  estimatedProfitPct: number;
  /** 24h volume for this pair */
  volume: number;
}

// ---------------------------------------------------------------------------
// Anchor Currency Constants
// ---------------------------------------------------------------------------

/** Known anchor currencies, ordered by preference (highest first) */
export const ANCHOR_CURRENCIES = ["mirror", "divine", "exalted", "chaos"] as const;
export type AnchorCurrency = (typeof ANCHOR_CURRENCIES)[number];

// ---------------------------------------------------------------------------
// Item Category Constants
// ---------------------------------------------------------------------------

/**
 * POE2Scout CategoryApiId values for items that are priced on the exchange
 * but are NOT pure currencies. These are craft/consumable items like
 * Ritual Omens and Soul Cores that appear as CurrencyOne in exchange pairs.
 *
 * When a pair's currency1CategoryApiId is in this set, the optimal-payment
 * logic groups by currency1Id to find the cheapest payment currency.
 *
 * Must stay in sync with config.yaml → league.item_categories.
 */
export const ITEM_CATEGORIES = new Set([
  "ritual",       // Ritual Omens
  "ultimatum",    // Soul Cores
]);

/**
 * Check if a CategoryApiId represents a non-currency item priced on the exchange.
 */
export function isItemCategory(categoryApiId: string | null | undefined): boolean {
  if (!categoryApiId) return false;
  return ITEM_CATEGORIES.has(categoryApiId);
}

/**
 * Select the best available anchor currency from the current data.
 * Prefers Mirror of Kalandra > Divine Orb > Exalted Orb > Chaos Orb.
 * Returns the apiId of the anchor, or "exalted" as ultimate fallback.
 */
export function selectAnchor(
  relativePrices: Map<string, number>
): AnchorCurrency {
  for (const anchor of ANCHOR_CURRENCIES) {
    const price = relativePrices.get(anchor);
    if (price != null && price > 0) {
      return anchor as AnchorCurrency;
    }
  }
  return "exalted";
}

// ---------------------------------------------------------------------------
// Core Computation: Effective Anchor Price
// ---------------------------------------------------------------------------

/**
 * Compute the effective anchor price for an item priced in a given currency.
 *
 * §11.2: effective_anchor_price(C) = P_C * rate(C → anchor)
 * where rate(C → anchor) = relativePrice_C / relativePrice_anchor
 *
 * @param priceInCurrency  Price of the item in currency C (e.g., 3.75 Divine)
 * @param currencyRelPrice relativePrice of currency C in base currency (Exalted)
 * @param anchorRelPrice   relativePrice of the anchor currency in base currency
 * @returns Effective price in anchor currency units
 */
export function effectiveAnchorPrice(
  priceInCurrency: number,
  currencyRelPrice: number,
  anchorRelPrice: number
): number {
  if (anchorRelPrice <= 0 || currencyRelPrice <= 0) return Infinity;
  // rate(C → anchor) = relativePrice_C / relativePrice_anchor
  const rateToAnchor = currencyRelPrice / anchorRelPrice;
  return priceInCurrency * rateToAnchor;
}

// ---------------------------------------------------------------------------
// Optimal Payment Currency
// ---------------------------------------------------------------------------

/**
 * Given an item priced in multiple currencies, find the cheapest payment option.
 *
 * §11.4: best_currency = argmin(effective_anchor_price(C))
 *
 * @param pricingOptions  Array of { currencyId, currencyName, priceInCurrency, relativePrice }
 * @param anchorRelPrice  relativePrice of the anchor currency in base currency
 * @returns OptimalPaymentResult with all options sorted by effective price
 */
export function findOptimalPayment(
  pricingOptions: Array<{
    currencyId: string;
    currencyName: string;
    priceInCurrency: number;
    relativePrice: number;
  }>,
  anchorRelPrice: number
): OptimalPaymentResult | null {
  if (pricingOptions.length < 2) return null;

  const options: PaymentOption[] = pricingOptions
    .map((opt) => {
      const effPrice = effectiveAnchorPrice(
        opt.priceInCurrency,
        opt.relativePrice,
        anchorRelPrice
      );
      return {
        currencyId: opt.currencyId,
        currencyName: opt.currencyName,
        priceInCurrency: opt.priceInCurrency,
        effectiveAnchorPrice: effPrice,
        premiumPct: 0, // filled after sorting
      };
    })
    .filter((o) => isFinite(o.effectiveAnchorPrice) && o.effectiveAnchorPrice > 0)
    .sort((a, b) => a.effectiveAnchorPrice - b.effectiveAnchorPrice);

  if (options.length < 2) return null;

  const best = options[0];
  const worst = options[options.length - 1];

  // Compute premium for each option relative to the cheapest
  for (const opt of options) {
    opt.premiumPct =
      best.effectiveAnchorPrice > 0
        ? ((opt.effectiveAnchorPrice - best.effectiveAnchorPrice) /
            best.effectiveAnchorPrice) *
          100
        : 0;
  }

  const savingsAnchor = worst.effectiveAnchorPrice - best.effectiveAnchorPrice;
  const savingsPct =
    worst.effectiveAnchorPrice > 0
      ? (savingsAnchor / worst.effectiveAnchorPrice) * 100
      : 0;

  return {
    bestCurrencyId: best.currencyId,
    worstCurrencyId: worst.currencyId,
    bestAnchorPrice: best.effectiveAnchorPrice,
    worstAnchorPrice: worst.effectiveAnchorPrice,
    savingsAnchor,
    savingsPct,
    options,
  };
}

// ---------------------------------------------------------------------------
// Cross-Rate Flip Detection
// ---------------------------------------------------------------------------

/**
 * Detect cross-rate flip opportunities from exchange pairs.
 *
 * §11.5: Compare the market rate between two currencies with the "fair" rate
 * implied by their relative prices in the base currency.
 *
 * @param pairs  Exchange pairs with relativePrice data
 * @param thresholdPct  Minimum deviation % to flag as opportunity (default 5%)
 * @returns Array of CrossRateFlip opportunities
 */
export function detectCrossRateFlips(
  pairs: ExchangePair[],
  thresholdPct: number = 5
): CrossRateFlip[] {
  const results: CrossRateFlip[] = [];

  for (const pair of pairs) {
    const c1Rel = pair.relativePrice;
    const c2Rel = pair.currency2RelativePrice;
    if (c1Rel == null || c2Rel == null || c1Rel <= 0 || c2Rel <= 0) continue;
    if (pair.volume < 10) continue; // skip illiquid pairs

    // Fair cross-rate: how many c2 per 1 c1
    const fairRate = c1Rel / c2Rel;

    // Market rate (from the pair's price field — cross-rate already computed)
    const marketRate = pair.price;
    if (marketRate == null || marketRate <= 0) continue;

    // Deviation
    const deviationPct = ((marketRate - fairRate) / fairRate) * 100;

    if (Math.abs(deviationPct) >= thresholdPct) {
      const direction: CrossRateFlip["direction"] =
        deviationPct < 0 ? "buy_sell_with_buy" : "buy_buy_with_sell";

      // Estimated profit: if market < fair, buy c1 with c2 is cheap
      // If market > fair, buy c2 with c1 is cheap
      const estimatedProfitPct = Math.abs(deviationPct);

      results.push({
        buyCurrencyId:
          deviationPct < 0 ? pair.currency1Id : pair.currency2Id,
        sellCurrencyId:
          deviationPct < 0 ? pair.currency2Id : pair.currency1Id,
        fairRate,
        marketRate,
        deviationPct,
        direction,
        estimatedProfitPct,
        volume: pair.volume,
      });
    }
  }

  // Sort by estimated profit descending
  results.sort((a, b) => b.estimatedProfitPct - a.estimatedProfitPct);
  return results.slice(0, 50);
}

// ---------------------------------------------------------------------------
// Utility: Build relative price map from exchange pairs
// ---------------------------------------------------------------------------

/**
 * Build a Map of currency apiId → relativePrice from exchange pairs.
 * For each pair, both currency1 and currency2's relativePrices are recorded.
 */
export function buildRelativePriceMap(
  pairs: ExchangePair[]
): Map<string, number> {
  const map = new Map<string, number>();
  for (const pair of pairs) {
    if (pair.relativePrice != null && pair.relativePrice > 0) {
      map.set(pair.currency1Id, pair.relativePrice);
    }
    if (pair.currency2RelativePrice != null && pair.currency2RelativePrice > 0) {
      map.set(pair.currency2Id, pair.currency2RelativePrice);
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Utility: Compute cross-rate between two currencies via base
// ---------------------------------------------------------------------------

/**
 * Compute the cross-rate from currency A to currency B using their
 * relative prices in the base currency.
 *
 * crossRate(A→B) = relativePrice_A / relativePrice_B
 * This gives "how many units of B per 1 unit of A".
 */
export function crossRate(
  relPriceA: number | null,
  relPriceB: number | null
): number | null {
  if (relPriceA == null || relPriceB == null || relPriceB <= 0) return null;
  return relPriceA / relPriceB;
}
