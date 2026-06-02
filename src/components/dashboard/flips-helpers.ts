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

// StorageValueResponse is only used in flips-detail-dialog — keep it here
// (not in @/lib/types) because it's specific to the flips UI.
export interface StorageValueResponse {
  currency: string;
  /** Number of units held (query param, default 1.0) */
  quantity: number;
  // Per-unit values (same as before for backward compatibility)
  current_price: number;
  projected_price: number;
  risk_discount: number;
  adjusted_price: number;
  net_value_after_fees: number;
  ratio: number;
  decision: string;
  /** Whether the backend had sufficient data to compute */
  data_available: boolean;
  // Total values for the entire holdings (LOW-1)
  total_current_value: number;
  total_projected_value: number;
  total_net_value_after_fees: number;
  inputs: {
    momentum: number;
    volatility: number;
    acceleration: number;
    liquidity_score: number;
    horizon_hours: number;
    confidence_level: number;
  };
}

export type SortField =
  | "score"
  | "spread_after_fees"
  | "volume_24h"
  | "momentum"
  | "volatility"
  // P2-1: Quantized sort fields
  | "qSpread"       // optimalLotProfitPct from quantized analysis
  | "minLot"        // minProfitableLot from quantized analysis
  | "brickRisk"     // brickResistance from quantized analysis
  | "tierDistance";  // tier_distance between currencies

export type SortDirection = "asc" | "desc";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function scoreColor(score: number): string {
  if (score >= 0.7) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 0.4) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

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
