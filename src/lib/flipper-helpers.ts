// ============================================================================
// Flipper Helper Functions — Pure functions extracted from flipper-sticky-bar
// for testability. These are shared utilities that compute
// scores, colors, sentiment, and profit indicators.
// ============================================================================

/**
 * Compute aggregated market sentiment from all flip opportunities.
 * Returns a value in [-1, 1] range representing bearish → bullish.
 * Uses score-weighted average momentum to emphasize high-quality flips.
 */
export function computeSentiment(
  opportunities: { score: number; momentum: number }[],
): number {
  if (opportunities.length === 0) return 0;
  let totalWeight = 0;
  let weightedSum = 0;
  for (const opp of opportunities) {
    const weight = Math.max(opp.score, 0.01);
    weightedSum += opp.momentum * weight;
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
