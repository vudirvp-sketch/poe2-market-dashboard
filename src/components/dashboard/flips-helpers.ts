// ============================================================================
// Flips Tab — Shared helper functions
//
// Types (FlipOpportunity, FlipEventStatus, FlipsResponse) are defined once in
// @/lib/types (Single Source of Truth). This file re-exports them for
// backward-compatible imports from flips-tab / flips-table / flips-detail-dialog.
// ============================================================================
import type { TranslationKeys } from "@/lib/i18n";

// Re-export canonical types from @/lib/types
export type { FlipOpportunity, FlipEventStatus, FlipsResponse } from "@/lib/types";

// StorageValueResponse & StorageValueInputs — imported from canonical @/lib/types
import { type StorageValueResponse, type StorageValueInputs } from "@/lib/types";
export type { StorageValueResponse };

export type SortField =
  | "score"
  | "spreadAfterFees"
  | "volume24h"
  | "momentum"
  | "volatility"
  // P2-1: Quantized sort fields
  | "qSpread"       // optimalLotProfitPct from quantized analysis
  | "minLot"        // minProfitableLot from quantized analysis
  | "brickRisk"     // brickResistance from quantized analysis
  | "tierDistance"   // tier_distance between currencies
  | "premium"       // savingsPct from optimal payment result
  // iter 92 (TD-1): New sort fields for previously hidden backend columns
  | "bid"           // best buy price
  | "ask"           // best sell price
  | "deviationPct"  // deviation of market rate from fair rate
  | "fairRate";     // fair cross-rate between currencies

export type SortDirection = "asc" | "desc";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export { scoreColor } from "@/lib/flipper-helpers";

export function scoreBg(score: number): string {
  if (score >= 0.7) return "bg-emerald-500/10 border-emerald-500/50";
  if (score >= 0.4) return "bg-amber-500/10 border-amber-500/50";
  return "bg-red-500/10 border-red-500/50";
}

export function clusterLabel(cluster: string, t: (key: TranslationKeys) => string): string {
  switch (cluster) {
    case "stable":
      return t("flipsClusterStable");
    case "moderate":
      return t("flipsClusterModerate");
    case "volatile_illiquid":
      return t("flipsClusterVolatile");
    default:
      return cluster;
  }
}

export function clusterBadgeClass(cluster: string): string {
  switch (cluster) {
    case "stable":
      return "border-emerald-500/50 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10";
    case "moderate":
      return "border-amber-500/50 text-amber-600 dark:text-amber-400 bg-amber-500/10";
    case "volatile_illiquid":
      return "border-red-500/50 text-red-600 dark:text-red-400 bg-red-500/10";
    default:
      return "border-muted-foreground/30 text-muted-foreground";
  }
}

export function decisionBadgeClass(decision: string): string {
  switch (decision) {
    case "BUY":
    case "HOLD":
      return "border-emerald-500/50 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10";
    case "SELL":
    case "CONVERT":
      return "border-red-500/50 text-red-600 dark:text-red-400 bg-red-500/10";
    default:
      return "border-amber-500/50 text-amber-600 dark:text-amber-400 bg-amber-500/10";
  }
}

// ---------------------------------------------------------------------------
// iter 94 (Spread Capture view — Q4): Spread tier classification
// ---------------------------------------------------------------------------
// Used by: (1) FlipsTable Spread cell color, (2) FlipsTab "Spread tier" filter.
// Thresholds chosen for PoE2 currency market: 5%+ is a wide spread worth
// capturing; 2-5% is marginal (fees may eat most of it); <2% is tight (skip).
// Returns the tier id ("wide" | "medium" | "tight") — caller maps to label.

export type SpreadTier = "wide" | "medium" | "tight";

export const SPREAD_TIER_WIDE_THRESHOLD = 0.05;   // ≥5%
export const SPREAD_TIER_MEDIUM_THRESHOLD = 0.02; // ≥2%

export function classifySpreadTier(spread: number | null | undefined): SpreadTier {
  if (spread == null) return "tight";
  if (spread >= SPREAD_TIER_WIDE_THRESHOLD) return "wide";
  if (spread >= SPREAD_TIER_MEDIUM_THRESHOLD) return "medium";
  return "tight";
}

export function spreadTierColor(tier: SpreadTier): string {
  switch (tier) {
    case "wide":
      return "text-emerald-600 dark:text-emerald-400 font-semibold";
    case "medium":
      return "text-amber-600 dark:text-amber-400";
    case "tight":
      return "text-muted-foreground";
  }
}

// ---------------------------------------------------------------------------
// TD-9 (iter 127 + iter 135 fallback removal): real price history only
// ---------------------------------------------------------------------------
// When `priceHistoryShort` has ≥ 2 points, render the REAL price-history
// sparkline (array of price numbers, oldest-first). Otherwise, return an
// empty array — the `Sparkline` component renders an em-dash placeholder
// (`—`) when `data.length < 2` (see `sparkline.tsx:115-116`).
//
// iter 135 removed the synthetic `deriveTrendSparklineData(momentum,
// volatility)` fallback that previously filled the cell with a "derived
// indicator, not historical" shape. Reason: 2 iterations (iter 128-134)
// have shipped since TD-9 Phase 1 (iter 127) wired real `price_history_short`
// into the `/flips` response, and no production logs indicated the fallback
// path was being hit. The fallback was misleading users by visualizing
// momentum × volatility as if it were a price chart.
//
// Ref: docs/design/TD-3-4-5-9-persistence-gaps-design.md §5.3 + §10 Q5
// (fallback-removal timing).

export interface TrendSparklineInput {
  /** Real price history from backend (TD-9). Optional + may be empty. */
  priceHistoryShort?: { date: string; price: number }[] | null;
}

/** Minimum number of real-history points required to render a sparkline. */
export const FLIPS_TREND_REAL_HISTORY_MIN_POINTS = 2;

export function getTrendSparklineData(input: TrendSparklineInput): number[] {
  const real = input.priceHistoryShort;
  if (real && real.length >= FLIPS_TREND_REAL_HISTORY_MIN_POINTS) {
    return real.map((p) => p.price);
  }
  return [];
}

/** Returns true when the sparkline will render REAL price history (≥ 2 points).
 *  UI uses this to choose between the "real history" tooltip and the
 *  "no history yet" tooltip. */
export function isTrendSparklineRealData(input: TrendSparklineInput): boolean {
  return !!(
    input.priceHistoryShort &&
    input.priceHistoryShort.length >= FLIPS_TREND_REAL_HISTORY_MIN_POINTS
  );
}
