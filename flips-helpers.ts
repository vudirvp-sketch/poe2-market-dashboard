// ============================================================================
// Flips Tab — Shared types and helper functions
//
// Includes client-side score computation based on
// PoE2_Flipper_Canonical_Formulas.md §7 (Opportunity Scoring).
// Used as a fallback when the backend returns score = 0 or missing data.
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

// ---------------------------------------------------------------------------
// Client-side score computation (Canonical Formulas §7)
// ---------------------------------------------------------------------------
//
// When the backend returns score = 0 (e.g., because the backend scoring
// module has a bug or data isn't fully computed yet), we recompute the
// score client-side from the available flip data using the exact formulas
// from PoE2_Flipper_Canonical_Formulas.md §7.
//
// The key formula chain:
//   spread_after_fees = (ask - bid) / mid_price - gold_fee_fraction
//   fill_probability  = log1p(volume_24h) / log1p(max_volume)
//   expected_profit   = spread_after_fees * fill_probability
//   momentum_penalty  = filter: 0.5 / 0.8 / 1.0 based on momentum
//   vol_penalty       = 1 / (1 + (volatility / vol_ref)^2)
//   score             = clamp(expected_profit * momentum_penalty * vol_penalty * phase_mult, 0, 1)
// ---------------------------------------------------------------------------

/** Default phase multiplier (§7.6) */
const PHASE_MULTIPLIERS: Record<string, number> = {
  early: 1.2,
  mid: 1.0,
  late: 0.9,
};

/** Default volatility reference (§7.4) */
const VOL_REFERENCE = 0.05;

/** Momentum penalty thresholds (§7.3) */
const MOMENTUM_NEG_THRESHOLD = -0.01;

/**
 * Compute the opportunity score for a single flip, following
 * PoE2_Flipper_Canonical_Formulas.md §7 exactly.
 *
 * @param opp  The flip opportunity with bid/ask/mid_price/volume/etc.
 * @param maxVolume  The maximum volume across all pairs (for fill probability)
 * @param phase  Current league phase: "early" | "mid" | "late"
 * @returns  A recomputed FlipOpportunity with corrected score, spread_after_fees, gold_fee_fraction
 */
export function recomputeFlipScore(
  opp: FlipOpportunity,
  maxVolume: number,
  phase: string = "mid",
): FlipOpportunity {
  const { bid, ask, mid_price, volume_24h, momentum, volatility, gold_fee_fraction } = opp;

  // §7.1: Recompute spread_after_fees from raw bid/ask/mid
  // This is the critical fix: the backend might compute this wrong
  let spreadAfterFees = 0;
  if (mid_price > 0) {
    const rawSpread = (ask - bid) / mid_price;
    spreadAfterFees = rawSpread - gold_fee_fraction;
  }

  // If no profit possible after fees, score = 0 (§7.1)
  if (spreadAfterFees <= 0) {
    return {
      ...opp,
      score: 0,
      spread_after_fees: spreadAfterFees,
    };
  }

  // §7.2: Fill probability
  let fillProbability = 0;
  if (maxVolume > 0) {
    fillProbability = Math.min(
      Math.log1p(volume_24h) / Math.log1p(maxVolume),
      1.0,
    );
  }

  // §7.5: Expected profit
  const expectedProfit = spreadAfterFees * fillProbability;

  // §7.3: Momentum penalty (filter, not additive)
  let momentumPenalty = 1.0;
  if (momentum < MOMENTUM_NEG_THRESHOLD) {
    momentumPenalty = 0.5;
  } else if (momentum < 0) {
    momentumPenalty = 0.8;
  }

  // §7.4: Volatility penalty
  const volPenalty = 1.0 / (1.0 + Math.pow(volatility / VOL_REFERENCE, 2));

  // §7.6: Phase multiplier
  const phaseMultiplier = PHASE_MULTIPLIERS[phase] ?? 1.0;

  // §7.5: Final score, clamped to [0, 1]
  const score = Math.min(Math.max(expectedProfit * momentumPenalty * volPenalty * phaseMultiplier, 0), 1);

  return {
    ...opp,
    score,
    spread_after_fees: spreadAfterFees,
  };
}

/**
 * Recompute scores for all flip opportunities.
 * Only recomputes when the backend score is 0 or clearly wrong.
 * Finds maxVolume from the dataset for fill probability calculation.
 */
export function recomputeAllFlipScores(
  opportunities: FlipOpportunity[],
  phase: string = "mid",
): FlipOpportunity[] {
  if (!opportunities || opportunities.length === 0) return opportunities;

  // Find max volume for fill probability normalization (§7.2)
  const maxVolume = Math.max(...opportunities.map((o) => o.volume_24h ?? 0), 1);

  return opportunities.map((opp) => {
    // Only recompute if the backend score is 0 or missing
    // This preserves valid backend scores when they exist
    if (opp.score > 0) return opp;

    return recomputeFlipScore(opp, maxVolume, phase);
  });
}
