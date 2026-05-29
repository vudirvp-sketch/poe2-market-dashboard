// ============================================================================
// Flips Tab — Shared types and helper functions
// ============================================================================
import type { TranslationKeys } from "@/lib/i18n";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FlipOpportunity {
  currency: string;
  score: number;
  spread_after_fees: number;
  gold_fee_fraction: number;
  gold_fee_actual: number;
  volume_24h: number;
  momentum: number;
  volatility: number;
  cluster: string;
  bid: number;
  ask: number;
  mid_price: number;
}

export interface FlipEventStatus {
  any_active: boolean;
  affected_currencies: string[];
  summary: Record<string, unknown> | null;
}

export interface FlipsResponse {
  league: string;
  total: number;
  opportunities: FlipOpportunity[];
  event_status: FlipEventStatus;
  fetched_at: string;
}

export interface StorageValueResponse {
  currency: string;
  current_price: number;
  projected_price: number;
  risk_discount: number;
  adjusted_price: number;
  net_value_after_fees: number;
  ratio: number;
  decision: string;
  inputs: {
    momentum: number;
    volatility: number;
    acceleration: number;
    liquidity_score: number;
    gold_fee_fraction: number;
    horizon_hours: number;
    confidence_level: number;
  };
}

export type SortField =
  | "score"
  | "spread_after_fees"
  | "gold_fee_actual"
  | "volume_24h"
  | "momentum"
  | "volatility";

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
