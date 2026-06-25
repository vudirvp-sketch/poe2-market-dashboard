import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { fmt } from "@/lib/types"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ============================================================================
// iter 88: Locale-aware date formatting helper
// ============================================================================

/**
 * Map our 4-letter locale codes (en/ru/zh/ko) to BCP-47 tags accepted by Intl.
 * Used by all date formatting helpers — keeps the mapping in ONE place so
 * future locale additions only need to update this map.
 *
 * Pattern established in events-sidebar.tsx (iter 87) — now shared across
 * all chart components (iter 88, KI-2 hand-off).
 */
export function localeToBcp47(locale: string): string {
  switch (locale) {
    case "ru": return "ru-RU";
    case "zh": return "zh-CN";
    case "ko": return "ko-KR";
    default: return "en-US";
  }
}

/**
 * Format a date for compact axis labels (e.g. "13 Jun", "6月13日", "13 июня").
 *
 * @param value - ISO timestamp OR epoch milliseconds OR Date instance.
 * @param locale - Active locale ("en" | "ru" | "zh" | "ko").
 * @param opts - Optional Intl.DateTimeFormatOptions (default: month short + day numeric).
 * @returns Formatted date string, or the input verbatim if parsing fails.
 */
export function formatLocaleDate(
  value: string | number | Date,
  locale: string,
  opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" },
): string {
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString(localeToBcp47(locale), opts);
}

/**
 * Format a date+time for compact display (e.g. "13 Jun, 14:30").
 *
 * @param value - ISO timestamp OR epoch milliseconds OR Date instance.
 * @param locale - Active locale ("en" | "ru" | "zh" | "ko").
 * @returns Formatted string with short date + HH:MM time.
 */
export function formatLocaleDateTime(value: string | number | Date, locale: string): string {
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return String(value);
  const bcp47 = localeToBcp47(locale);
  const datePart = d.toLocaleDateString(bcp47, { month: "short", day: "numeric" });
  const timePart = d.toLocaleTimeString(bcp47, { hour: "2-digit", minute: "2-digit" });
  return `${datePart}, ${timePart}`;
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
