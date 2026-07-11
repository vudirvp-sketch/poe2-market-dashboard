// ============================================================================
// Gold Map ROI Calculator (P10 Phase 1 MVP, iter 127)
//
// Pure presentational + state-holding component for the Gold Map ROI inputs
// and result card. Renders three numeric inputs (gold per run, map cost in
// Div, gold per Div rate) + a result panel with expected ROI, ROI %, a
// recommendation flag, and a breakdown.
//
// Reuses the existing /api/flipper/triangular endpoint — NO new backend
// route is required for the MVP (see docs/design/P10-gold-map-roi-design.md
// §8 for the rationale). The "best 3-way chain ending in Div" is a
// client-side filter+sort on the opportunities array.
//
// ROI formula (reconciled with §C.8 + §13 — see design doc §4.3):
//   gold_in_div = gold_amount / gold_per_divine
//   best_cycle  = pick_best_cycle_ending_in_div(opportunities)
//   multiplier  = best_cycle ? 1 + best_cycle.netProfitPct / 100 : 1
//   final_div   = gold_in_div * multiplier
//   expected_div = final_div - map_cost
//   roi_pct     = map_cost > 0 ? (expected_div / map_cost) * 100 : Infinity
//
// localStorage persistence:
//   Key: poe2-gold-map-roi-inputs
//   Value: { goldAmount, mapCost, goldPerDiv, timestamp }
//   Loaded on mount; saved on every input change. Timestamp is used to
//   surface a staleness warning when the stored rate is older than 7 days
//   (per §3.4 of the design doc).
//
// Refs:
//   - docs/design/P10-gold-map-roi-design.md (full design — §4.3 formula,
//     §6 input contract, §7 UI layout, §11 risks)
//   - docs/MARKET_PLAYBOOK.md §C.8 (Castaway map spec)
//   - PoE2_Flipper_Canonical_Formulas.md §13 (gold_to_chaos_rate bounds)
// ============================================================================

"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  MapPin,
  TrendingUp,
  TrendingDown,
  Minus,
  Zap,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import type { TranslationKeys } from "@/lib/i18n/locales/en";
import type { TriangularCycle } from "@/lib/types";

// ---------------------------------------------------------------------------
// Constants — input bounds + recommendation thresholds
// ---------------------------------------------------------------------------

export const DEFAULT_GOLD_AMOUNT = 500_000;
export const DEFAULT_MAP_COST = 2.0;
export const DEFAULT_GOLD_PER_DIV = 100_000;

export const GOLD_AMOUNT_MIN = 1;
export const GOLD_AMOUNT_MAX = 10_000_000;
export const MAP_COST_MIN = 0;
export const MAP_COST_MAX = 100;
export const GOLD_PER_DIV_MIN = 1_000;
export const GOLD_PER_DIV_MAX = 10_000_000;

/** Soft warning when the stored gold rate is older than this (in days). */
export const GOLD_RATE_STALENESS_DAYS = 7;

/** Recommendation thresholds (per design doc §7.2). Tunable constants. */
export const ROI_THRESHOLD_MARGINAL = 50; // %  — below = MARGINAL
export const ROI_THRESHOLD_STRONG = 150;  // %  — at/above = STRONG_FARM

const LOCALSTORAGE_KEY = "poe2-gold-map-roi-inputs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GoldMapRoiInputs {
  goldAmount: number;
  mapCost: number;
  goldPerDiv: number;
  /** Unix epoch ms when the gold_per_div value was last set. */
  goldPerDivTimestamp: number;
}

export type Recommendation = "AVOID" | "MARGINAL" | "FARM" | "STRONG_FARM";

export interface RoiComputation {
  /** Div-equivalent of the gold amount (manual conversion). */
  goldInDiv: number;
  /** Best 3-way cycle ending in Div, or null when none available. */
  bestCycle: TriangularCycle | null;
  /** Multiplier applied (1 + netProfitPct/100). 1.0 when no cycle. */
  multiplier: number;
  /** Final Div after the 3-way chain (gold_in_div * multiplier). */
  finalDiv: number;
  /** Net expected Div (finalDiv - mapCost). */
  expectedDiv: number;
  /** ROI as percentage of map cost. Infinity when mapCost = 0. */
  roiPct: number;
  /** Recommendation flag based on roiPct. */
  recommendation: Recommendation;
  /** Whether the user's gold amount is below the cycle's min start. */
  belowMinStart: boolean;
}

// ---------------------------------------------------------------------------
// Persistence helpers — exported for unit tests
// ---------------------------------------------------------------------------

export function loadInputsFromLocalStorage(): GoldMapRoiInputs | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LOCALSTORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GoldMapRoiInputs>;
    if (
      typeof parsed.goldAmount !== "number" ||
      typeof parsed.mapCost !== "number" ||
      typeof parsed.goldPerDiv !== "number" ||
      typeof parsed.goldPerDivTimestamp !== "number"
    ) {
      return null;
    }
    return {
      goldAmount: parsed.goldAmount,
      mapCost: parsed.mapCost,
      goldPerDiv: parsed.goldPerDiv,
      goldPerDivTimestamp: parsed.goldPerDivTimestamp,
    };
  } catch {
    return null;
  }
}

export function saveInputsToLocalStorage(inputs: GoldMapRoiInputs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOCALSTORAGE_KEY, JSON.stringify(inputs));
  } catch {
    // localStorage quota exceeded / disabled — silently ignore.
  }
}

export function defaultInputs(now: number = Date.now()): GoldMapRoiInputs {
  return {
    goldAmount: DEFAULT_GOLD_AMOUNT,
    mapCost: DEFAULT_MAP_COST,
    goldPerDiv: DEFAULT_GOLD_PER_DIV,
    goldPerDivTimestamp: now,
  };
}

/** Days since the stored gold_per_div value was last set. */
export function goldRateAgeDays(timestamp: number, now: number = Date.now()): number {
  return Math.max(0, Math.floor((now - timestamp) / (24 * 60 * 60 * 1000)));
}

// ---------------------------------------------------------------------------
// Pure computation — exported for unit tests
// ---------------------------------------------------------------------------

/**
 * Pick the best (highest netProfitPct) triangular cycle that starts AND
 * ends in "divine" — i.e. cycle[0] === "divine". Returns null when no
 * such cycle exists in the response.
 */
export function pickBestCycleEndingInDiv(
  opportunities: TriangularCycle[] | undefined | null,
): TriangularCycle | null {
  if (!opportunities || opportunities.length === 0) return null;
  const divCycles = opportunities.filter(
    (o) => o.cycle && o.cycle.length > 0 && o.cycle[0] === "divine",
  );
  if (divCycles.length === 0) return null;
  // Sort by netProfitPct desc (defensive: falls back to 0 when undefined).
  divCycles.sort((a, b) => (b.netProfitPct ?? 0) - (a.netProfitPct ?? 0));
  return divCycles[0];
}

export function computeRoi(
  inputs: GoldMapRoiInputs,
  opportunities: TriangularCycle[] | undefined | null,
): RoiComputation {
  const goldInDiv = inputs.goldPerDiv > 0 ? inputs.goldAmount / inputs.goldPerDiv : 0;
  const bestCycle = pickBestCycleEndingInDiv(opportunities);
  const multiplier = bestCycle
    ? 1 + (bestCycle.netProfitPct ?? 0) / 100
    : 1;
  const finalDiv = goldInDiv * multiplier;
  const expectedDiv = finalDiv - inputs.mapCost;
  const roiPct = inputs.mapCost > 0 ? (expectedDiv / inputs.mapCost) * 100 : Infinity;

  let recommendation: Recommendation;
  if (!Number.isFinite(roiPct) && roiPct > 0) {
    // map_cost = 0 → infinite ROI → STRONG_FARM.
    recommendation = expectedDiv > 0 ? "STRONG_FARM" : "MARGINAL";
  } else if (expectedDiv <= 0) {
    recommendation = "AVOID";
  } else if (roiPct < ROI_THRESHOLD_MARGINAL) {
    recommendation = "MARGINAL";
  } else if (roiPct < ROI_THRESHOLD_STRONG) {
    recommendation = "FARM";
  } else {
    recommendation = "STRONG_FARM";
  }

  const belowMinStart =
    !!bestCycle &&
    typeof bestCycle.minStartingAmount === "number" &&
    bestCycle.minStartingAmount > 0 &&
    goldInDiv < bestCycle.minStartingAmount;

  return {
    goldInDiv,
    bestCycle,
    multiplier,
    finalDiv,
    expectedDiv,
    roiPct,
    recommendation,
    belowMinStart,
  };
}

// ---------------------------------------------------------------------------
// Recommendation UI helpers — exported for unit tests
// ---------------------------------------------------------------------------

export function recommendationBadgeClass(r: Recommendation): string {
  switch (r) {
    case "STRONG_FARM":
      return "border-emerald-500/50 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10";
    case "FARM":
      return "border-emerald-500/50 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10";
    case "MARGINAL":
      return "border-amber-500/50 text-amber-600 dark:text-amber-400 bg-amber-500/10";
    case "AVOID":
    default:
      return "border-red-500/50 text-red-600 dark:text-red-400 bg-red-500/10";
  }
}

export function recommendationLabelKey(r: Recommendation): TranslationKeys {
  switch (r) {
    case "STRONG_FARM":
      return "goldMapRecommendationStrongFarm";
    case "FARM":
      return "goldMapRecommendationFarm";
    case "MARGINAL":
      return "goldMapRecommendationMarginal";
    case "AVOID":
    default:
      return "goldMapRecommendationAvoid";
  }
}

export function recommendationIcon(r: Recommendation) {
  switch (r) {
    case "STRONG_FARM":
      return <Zap className="h-3.5 w-3.5" aria-hidden="true" />;
    case "FARM":
      return <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />;
    case "MARGINAL":
      return <Minus className="h-3.5 w-3.5" aria-hidden="true" />;
    case "AVOID":
    default:
      return <TrendingDown className="h-3.5 w-3.5" aria-hidden="true" />;
  }
}

// ---------------------------------------------------------------------------
// Number formatting — local helper (avoids pulling fmt for special cases)
// ---------------------------------------------------------------------------

function fmtNum(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return n > 0 ? "∞" : "—";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function fmtInt(n: number): string {
  if (!Number.isFinite(n)) return n > 0 ? "∞" : "—";
  return Math.round(n).toLocaleString();
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface GoldMapRoiCalculatorProps {
  /** Triangular arbitrage opportunities from /api/flipper/triangular. */
  opportunities: TriangularCycle[] | undefined;
  /** True when the triangular query is loading. */
  isLoading: boolean;
  /** True when the triangular query errored. */
  isError: boolean;
  /** Whether the backend is online (parent gate). */
  backendOnline: boolean;
}

export function GoldMapRoiCalculator({
  opportunities,
  isLoading,
  isError,
  backendOnline,
}: GoldMapRoiCalculatorProps) {
  const { t } = useI18n();

  // ---- Inputs (with localStorage persistence) ----
  const [inputs, setInputs] = useState<GoldMapRoiInputs>(() => {
    const loaded = loadInputsFromLocalStorage();
    return loaded ?? defaultInputs();
  });

  // Persist on every change.
  useEffect(() => {
    saveInputsToLocalStorage(inputs);
  }, [inputs]);

  // Track whether the user has touched the gold_per_div field since mount —
  // used to hide the "default estimate" hint once they've set their own rate.
  const [userTouchedGoldPerDiv, setUserTouchedGoldPerDiv] = useState(false);

  // ---- Derived state ----
  const computation = useMemo(
    () => computeRoi(inputs, opportunities),
    [inputs, opportunities],
  );

  const goldRateAge = goldRateAgeDays(inputs.goldPerDivTimestamp);
  const isGoldRateStale = goldRateAge >= GOLD_RATE_STALENESS_DAYS;
  const isGoldPerDivValid =
    inputs.goldPerDiv >= GOLD_PER_DIV_MIN &&
    inputs.goldPerDiv <= GOLD_PER_DIV_MAX;
  const isGoldAmountValid =
    inputs.goldAmount >= GOLD_AMOUNT_MIN && inputs.goldAmount <= GOLD_AMOUNT_MAX;
  const canCompute = backendOnline && !isError && isGoldPerDivValid && isGoldAmountValid;

  // ---- Input handlers ----
  function updateField<K extends keyof GoldMapRoiInputs>(
    field: K,
    value: GoldMapRoiInputs[K],
  ) {
    setInputs((prev) => ({ ...prev, [field]: value }));
  }

  function handleGoldPerDivChange(v: number) {
    setUserTouchedGoldPerDiv(true);
    setInputs((prev) => ({
      ...prev,
      goldPerDiv: v,
      // Refresh the staleness clock whenever the user manually updates the rate.
      goldPerDivTimestamp: Date.now(),
    }));
  }

  // ---- Render ----
  return (
    <div className="space-y-4" data-testid="gold-map-roi-calculator">
      {/* Inputs panel */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <MapPin className="h-5 w-5 text-violet-500" aria-hidden="true" />
            {t("goldMapInputsTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Gold per run */}
            <div className="space-y-1.5">
              <label htmlFor="gold-map-gold-amount" className="text-xs font-medium text-muted-foreground">
                {t("goldMapGoldPerRun")}
              </label>
              <Input
                id="gold-map-gold-amount"
                type="number"
                inputMode="numeric"
                min={GOLD_AMOUNT_MIN}
                max={GOLD_AMOUNT_MAX}
                step={50_000}
                value={Number.isFinite(inputs.goldAmount) ? inputs.goldAmount : 0}
                onChange={(e) => updateField("goldAmount", Number(e.target.value))}
                disabled={!backendOnline}
                aria-label={t("goldMapGoldPerRun")}
                data-testid="gold-map-gold-amount-input"
              />
            </div>

            {/* Map cost (Div) */}
            <div className="space-y-1.5">
              <label htmlFor="gold-map-map-cost" className="text-xs font-medium text-muted-foreground">
                {t("goldMapMapCost")}
              </label>
              <Input
                id="gold-map-map-cost"
                type="number"
                inputMode="decimal"
                min={MAP_COST_MIN}
                max={MAP_COST_MAX}
                step={0.5}
                value={Number.isFinite(inputs.mapCost) ? inputs.mapCost : 0}
                onChange={(e) => updateField("mapCost", Number(e.target.value))}
                disabled={!backendOnline}
                aria-label={t("goldMapMapCost")}
                data-testid="gold-map-map-cost-input"
              />
            </div>

            {/* Gold per Div */}
            <div className="space-y-1.5">
              <label htmlFor="gold-map-gold-per-div" className="text-xs font-medium text-muted-foreground">
                {t("goldMapGoldPerDiv")}
                {isGoldRateStale && (
                  <span
                    className="ml-2 text-amber-600 dark:text-amber-400 inline-flex items-center gap-1"
                    data-testid="gold-map-rate-stale-warning"
                  >
                    <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                    {t("goldMapRateStaleWarning", { 0: goldRateAge })}
                  </span>
                )}
              </label>
              <Input
                id="gold-map-gold-per-div"
                type="number"
                inputMode="numeric"
                min={GOLD_PER_DIV_MIN}
                max={GOLD_PER_DIV_MAX}
                step={10_000}
                value={Number.isFinite(inputs.goldPerDiv) ? inputs.goldPerDiv : 0}
                onChange={(e) => handleGoldPerDivChange(Number(e.target.value))}
                disabled={!backendOnline}
                aria-label={t("goldMapGoldPerDiv")}
                data-testid="gold-map-gold-per-div-input"
              />
              {!userTouchedGoldPerDiv && (
                <p className="text-[10px] text-muted-foreground/70">
                  {t("goldMapDefaultRateHint")}
                </p>
              )}
              {!isGoldPerDivValid && (
                <p
                  className="text-[10px] text-red-600 dark:text-red-400"
                  data-testid="gold-map-invalid-rate-error"
                >
                  {t("goldMapInvalidGoldPerDiv")}
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Result card */}
      <Card data-testid="gold-map-roi-result-card">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-5 w-5 text-violet-500" aria-hidden="true" />
            {t("goldMapResultTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-4">
          {/* Hero: expected ROI + ROI % + recommendation flag */}
          <div
            className="rounded-md border border-border/60 p-4 grid grid-cols-1 sm:grid-cols-3 gap-3"
            data-testid="gold-map-roi-hero"
          >
            <div className="space-y-0.5">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
                {t("goldMapResultExpectedDiv")}
              </div>
              <div
                className={`text-2xl font-mono font-semibold ${
                  computation.expectedDiv > 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-red-600 dark:text-red-400"
                }`}
                data-testid="gold-map-expected-div"
              >
                {canCompute ? `${fmtNum(computation.expectedDiv)} Div` : "—"}
              </div>
            </div>
            <div className="space-y-0.5">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
                {t("goldMapResultRoiPct")}
              </div>
              <div
                className={`text-2xl font-mono font-semibold ${
                  Number.isFinite(computation.roiPct)
                    ? computation.roiPct > 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-red-600 dark:text-red-400"
                    : "text-emerald-600 dark:text-emerald-400"
                }`}
                data-testid="gold-map-roi-pct"
              >
                {canCompute
                  ? Number.isFinite(computation.roiPct)
                    ? `${fmtNum(computation.roiPct, 1)}%`
                    : "∞"
                  : "—"}
              </div>
            </div>
            <div className="space-y-0.5">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
                {t("goldMapRecommendationLabel")}
              </div>
              {canCompute ? (
                <Badge
                  variant="outline"
                  className={`text-xs ${recommendationBadgeClass(computation.recommendation)}`}
                  data-testid="gold-map-recommendation-badge"
                >
                  {recommendationIcon(computation.recommendation)}
                  <span className="ml-1">
                    {t(recommendationLabelKey(computation.recommendation))}
                  </span>
                </Badge>
              ) : (
                <span className="text-muted-foreground text-xs">—</span>
              )}
            </div>
          </div>

          {/* Breakdown */}
          <div
            className="rounded-md border border-border/60 p-3 space-y-1.5 text-sm font-mono"
            data-testid="gold-map-roi-breakdown"
          >
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground/80 font-sans mb-1">
              {t("goldMapBreakdownTitle")}
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                {t("goldMapBreakdownManualConversion")}
              </span>
              <span>
                {fmtInt(inputs.goldAmount)} gold ÷ {fmtInt(inputs.goldPerDiv)} = {fmtNum(computation.goldInDiv)} Div
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                {t("goldMapBreakdownBestCycle")}
              </span>
              <span data-testid="gold-map-breakdown-best-cycle">
                {computation.bestCycle ? (
                  <>
                    {computation.bestCycle.cycle.join(" → ")}{" "}
                    <span className="text-emerald-600 dark:text-emerald-400">
                      (+{fmtNum(computation.bestCycle.netProfitPct ?? 0, 2)}%)
                    </span>
                  </>
                ) : (
                  <span className="text-muted-foreground text-xs">
                    {t("goldMapNoCycleAvailable")}
                  </span>
                )}
              </span>
            </div>
            {!computation.bestCycle && canCompute && (
              <div className="text-[10px] text-muted-foreground/70">
                {t("goldMapNoCycleFallback")}
              </div>
            )}
            {computation.belowMinStart && computation.bestCycle && (
              <div
                className="text-[10px] text-amber-600 dark:text-amber-400"
                data-testid="gold-map-below-min-start-warning"
              >
                {t("goldMapMinStartWarning", {
                  0: fmtNum(computation.goldInDiv),
                  1: fmtInt(computation.bestCycle.minStartingAmount ?? 0),
                })}
              </div>
            )}
            <div className="flex justify-between border-t border-border/40 pt-1.5 mt-1.5">
              <span className="text-muted-foreground">
                {t("goldMapBreakdownMapCost")}
              </span>
              <span className="text-red-600 dark:text-red-400">
                −{fmtNum(inputs.mapCost)} Div
              </span>
            </div>
            <div className="flex justify-between font-semibold">
              <span>{t("goldMapBreakdownExpectedNet")}</span>
              <span
                className={
                  computation.expectedDiv > 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-red-600 dark:text-red-400"
                }
                data-testid="gold-map-breakdown-expected-net"
              >
                {fmtNum(computation.expectedDiv)} Div
              </span>
            </div>
          </div>

          {/* Disabled-when-offline notice */}
          {!backendOnline && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              {t("goldMapOffline")}
            </p>
          )}
          {backendOnline && isLoading && (
            <p className="text-xs text-muted-foreground" data-testid="gold-map-loading">
              {t("goldMapLoading")}
            </p>
          )}
          {backendOnline && isError && (
            <p className="text-xs text-red-600 dark:text-red-400">
              {t("goldMapError")}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
