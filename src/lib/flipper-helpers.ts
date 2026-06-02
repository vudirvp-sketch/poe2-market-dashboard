// ============================================================================
// Flipper Helper Functions — Pure functions extracted from flipper-sticky-bar
// for testability. These are shared utilities that compute
// scores, colors, sentiment, profit indicators, and data quality checks.
// ============================================================================

import type { FlipOpportunity } from "@/lib/types";

/**
 * Compute aggregated market sentiment from all flip opportunities.
 * Returns a value in [-1, 1] range representing bearish → bullish.
 * Uses score-weighted average momentum to emphasize high-quality flips.
 */
export function computeSentiment(
  opportunities: { score: number; momentum?: number }[],
): number {
  if (opportunities.length === 0) return 0;
  let totalWeight = 0;
  let weightedSum = 0;
  for (const opp of opportunities) {
    const weight = Math.max(opp.score, 0.01);
    weightedSum += (opp.momentum ?? 0) * weight;
    totalWeight += weight;
  }
  return totalWeight > 0 ? weightedSum / totalWeight : 0;
}

/**
 * Return a Tailwind color class based on the flip score.
 *   >= 0.7 → emerald (high)
 *   >= 0.4 → amber   (medium)
 *   < 0.4  → red     (low)
 */
export function scoreColor(score: number): string {
  if (score >= 0.7) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 0.4) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

/**
 * Return a Tailwind color class based on the profit amount.
 *   > 0 → emerald (profitable)
 *   < 0 → red     (loss)
 *   = 0 → muted   (neutral)
 */
export function profitColor(profit: number): string {
  if (profit > 0) return "text-emerald-600 dark:text-emerald-400";
  if (profit < 0) return "text-red-600 dark:text-red-400";
  return "text-muted-foreground";
}

/**
 * Return a Tailwind border/background class based on profitability.
 */
export function profitBg(isProfitable: boolean): string {
  return isProfitable
    ? "border-emerald-500/30 bg-emerald-500/5"
    : "border-red-500/30 bg-red-500/5";
}

/**
 * Classify sentiment into a category.
 *   > 0.005 → "bullish"
 *   < -0.005 → "bearish"
 *   otherwise → "neutral"
 */
export function classifySentiment(value: number): "bullish" | "bearish" | "neutral" {
  if (value > 0.005) return "bullish";
  if (value < -0.005) return "bearish";
  return "neutral";
}

/**
 * Phase 0.4: Check if flip data appears suspicious.
 * Detects patterns that indicate placeholder or incorrect data:
 * - All prices identical (buy = sell = mid)
 * - Spread contradicts the actual buy/sell prices
 * - Zero prices with non-zero volume
 */
export function isFlipDataSuspicious(flip: FlipOpportunity): boolean {
  // All prices identical → likely placeholder data
  if ((flip.bid ?? 0) > 0 && (flip.ask ?? 0) > 0 && (flip.midPrice ?? 0) > 0 &&
      flip.bid === flip.ask && flip.bid === flip.midPrice) {
    return true;
  }
  // Spread contradicts buy/sell prices
  if ((flip.bid ?? 0) > 0 && (flip.ask ?? 0) > 0) {
    const actualSpread = Math.abs((flip.ask ?? 0) - (flip.bid ?? 0)) /
                         (((flip.bid ?? 0) + (flip.ask ?? 0)) / 2);
    const reportedSpread = flip.spread ?? flip.spreadAfterFees ?? 0;
    if (reportedSpread > 0 && Math.abs(actualSpread - reportedSpread) > 0.01) {
      return true;
    }
  }
  // Zero prices with non-zero volume → data error
  if ((flip.bid === 0 || flip.bid == null) && (flip.volume24h ?? 0) > 0) return true;
  return false;
}

/**
 * Phase 0.4: Validate an entire flips response for suspicious patterns.
 * Returns true if the response looks like it contains bad data.
 */
export function isFlipsResponseSuspicious(
  opportunities: FlipOpportunity[],
): { suspicious: boolean; reason: string } {
  if (!opportunities || opportunities.length === 0) {
    return { suspicious: false, reason: "" };
  }

  // Check if all opportunities have identical prices
  const first = opportunities[0];
  const allSamePrice = first.bid != null && first.ask != null && first.midPrice != null &&
    opportunities.every(
      (f) => f.bid === first.bid &&
             f.ask === first.ask &&
             f.midPrice === first.midPrice,
    );
  if (allSamePrice && opportunities.length > 1) {
    return {
      suspicious: true,
      reason: "All flips have identical prices — likely placeholder data",
    };
  }

  // Check if a large proportion of flips are individually suspicious
  const suspiciousCount = opportunities.filter(isFlipDataSuspicious).length;
  if (suspiciousCount > opportunities.length * 0.5) {
    return {
      suspicious: true,
      reason: `${suspiciousCount} of ${opportunities.length} flips have suspicious data`,
    };
  }

  return { suspicious: false, reason: "" };
}
