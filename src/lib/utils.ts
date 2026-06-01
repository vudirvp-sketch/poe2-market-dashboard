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
