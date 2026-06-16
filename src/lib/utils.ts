import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { fmt } from "@/lib/types"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ============================================================================
// Currency formatting utilities (Phase 0.2)
// ============================================================================

/**
 * Get a short display name for a currency.
 * "Exalted Orb" → "Exa", "Divine Orb" → "Div", "Chaos Orb" → "Chaos"
 */
export function getCurrencyShortName(
  text?: string | null,
  apiId?: string | null,
): string {
  // P0: Adaptive mode — fallback label since actual unit is per-row
  if (apiId === "_adaptive") return "Adaptive";
  if (apiId === "exalted") return "Exa";
  if (apiId === "divine") return "Div";
  if (apiId === "chaos") return "Chaos";
  if (apiId === "regret") return "Regret";
  if (apiId === "chance") return "Chance";
  if (text) {
    // Fallback: take first word or abbreviation
    const words = text.split(" ");
    // If it's "X Orb", use the first word abbreviated
    if (words.length >= 2 && words[words.length - 1] === "Orb") {
      return words[0].length > 4 ? words[0].slice(0, 3) : words[0];
    }
    return text.length > 8 ? text.slice(0, 3) : text;
  }
  return "";
}

/**
 * Format a price value with its currency unit.
 * @param value - The numeric price value
 * @param currencyText - The currency display name (e.g. "Exalted Orb")
 * @param currencyApiId - The currency API ID (e.g. "exalted")
 * @param options - Formatting options
 */
export function formatPrice(
  value: number | null | undefined,
  currencyText?: string | null,
  currencyApiId?: string | null,
  options?: { compact?: boolean; digits?: number },
): string {
  if (value == null) return "—";

  const digits = options?.digits ?? 2;
  const formatted = fmt(value, digits);

  if (!currencyText && !currencyApiId) return formatted;

  const shortName = getCurrencyShortName(currencyText, currencyApiId);
  if (!shortName) return formatted;

  return `${formatted} ${shortName}`;
}

// ============================================================================
// P1-4: Base currency conversion utility
// ============================================================================

/**
 * Convert a price from one base currency to another.
 *
 * priceInBase: price expressed in the current base currency
 * baseRelativePrice: RelativePrice of current base (e.g., Exalted = 1.0)
 * targetRelativePrice: RelativePrice of target base (e.g., Divine = 27.3)
 *
 * Formula: price_in_target = priceInBase * baseRelativePrice / targetRelativePrice
 *
 * Example: An item priced at 5.0 Exalted. Divine RelativePrice = 27.3.
 * Price in Divine = 5.0 * 1.0 / 27.3 = 0.183 Divine
 */
export function convertBaseCurrency(
  priceInBase: number,
  baseRelativePrice: number,
  targetRelativePrice: number,
): number {
  if (targetRelativePrice === 0) return 0;
  return priceInBase * baseRelativePrice / targetRelativePrice;
}

// ============================================================================
// P2-4: Volume & Liquidity utilities
// ============================================================================

/**
 * Liquidity score: 0 (illiquid) to 1 (highly liquid).
 * High volume with low stock = high liquidity (fast execution).
 */
export function computeLiquidityScore(volumeTraded: number, highestStock: number): number {
  return Math.min(1.0, Math.log1p(volumeTraded) / Math.log1p(highestStock + 1));
}

/**
 * Volume z-score: how many standard deviations current volume is above 7d mean.
 * > 2 = volume anomaly.
 */
export function computeVolumeZScore(
  currentVolume: number,
  rollingMean: number,
  rollingStd: number,
): number {
  if (rollingStd === 0) return 0;
  return (currentVolume - rollingMean) / rollingStd;
}
