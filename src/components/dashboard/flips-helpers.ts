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
// iter 94 (Spread Capture view — Q5): Trend sparkline synthetic shape
// ---------------------------------------------------------------------------
// The /api/flipper/flips endpoint does NOT return per-pair price history
// (only momentum + volatility). We derive a 6-point shape that visualizes
// the price-action character: linear slope from momentum, amplitude from
// volatility. CLEARLY labeled in UI as "derived indicator, not historical".
// When backend adds priceHistoryShort (TD-9, future iter), the Sparkline
// column can switch to real data without UI changes.

export const FLIPS_TREND_SPARKLINE_POINTS = 6;

export function deriveTrendSparklineData(
  momentum: number | null | undefined,
  volatility: number | null | undefined,
): number[] {
  const m = momentum ?? 0;
  const v = volatility ?? 0;
  // Baseline = 0, slope = momentum (signed), amplitude = volatility.
  // Generate N points: trend line + alternating perturbations (deterministic,
  // no Math.random — same input always produces same shape).
  // Wave uses sin(i * PI/2): 0,1,0,-1,0,1,... — gives a clean oscillation.
  // Multiplied by (1-t) so amplitude decays toward the final point (lands on
  // the pure trend value at t=1).
  const points: number[] = [];
  for (let i = 0; i < FLIPS_TREND_SPARKLINE_POINTS; i++) {
    const t = i / (FLIPS_TREND_SPARKLINE_POINTS - 1); // 0..1
    const trend = m * t;
    const wave = v * Math.sin((i * Math.PI) / 2) * (1 - t) * 0.5;
    points.push(trend + wave);
  }
  return points;
}
