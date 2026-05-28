// ============================================================================
// FlipperStickyBar — Compact bar showing key market metrics when the
// flipper backend is online. Displayed below the header per spec §2.3.
//
// Enhanced with:
//   - Market sentiment indicator (aggregated momentum across all pairs)
//   - Flip opportunity count badge
//   - Correlation shock alert
// ============================================================================
"use client";

import { memo } from "react";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp, TrendingDown, Minus, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n";
import { fetchApi } from "@/lib/types";
import type { FlipperPhaseResponse } from "@/lib/types";
import { computeSentiment, scoreColor, classifySentiment } from "@/lib/flipper-helpers";

// ---------------------------------------------------------------------------
// Inline types for API responses (subset of fields we use)
// ---------------------------------------------------------------------------

interface FlipOpportunity {
  currency: string;
  score: number;
  momentum: number;
}

interface FlipsResponse {
  league: string;
  total: number;
  opportunities: FlipOpportunity[];
  fetched_at: string;
}

interface TriangularCycle {
  cycle: string[];
  net_profit_pct: number;
}

interface TriangularResponse {
  cycles: TriangularCycle[];
  total: number;
}

interface PortfolioData {
  method: "risk_parity" | "min_variance";
  weights: Record<string, number>;
  expected_risk: number;
  correlation_warning: boolean;
  last_rebalance: string | null;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface FlipperStickyBarProps {
  backendOnline: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// scoreColor and computeSentiment moved to @/lib/flipper-helpers.ts for testability

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const FlipperStickyBar = memo(function FlipperStickyBar({
  backendOnline,
}: FlipperStickyBarProps) {
  const { t } = useI18n();

  // ---- Best flip ----
  const { data: flipsData } = useQuery<FlipsResponse>({
    queryKey: ["flipper-sticky-flips"],
    queryFn: () => fetchApi<FlipsResponse>("/api/flipper/flips"),
    enabled: backendOnline,
    staleTime: 60_000,
    retry: 1,
  });

  // ---- Best triangular arb ----
  const { data: triangularData } = useQuery<TriangularResponse>({
    queryKey: ["flipper-sticky-triangular"],
    queryFn: () => fetchApi<TriangularResponse>("/api/flipper/triangular"),
    enabled: backendOnline,
    staleTime: 60_000,
    retry: 1,
  });

  // ---- Phase info ----
  const { data: phaseData } = useQuery<FlipperPhaseResponse>({
    queryKey: ["flipper-sticky-phase"],
    queryFn: () => fetchApi<FlipperPhaseResponse>("/api/flipper/phase"),
    enabled: backendOnline,
    staleTime: 60_000,
    retry: 1,
  });

  // ---- Portfolio data (for correlation shock) ----
  const { data: portfolioData } = useQuery<PortfolioData>({
    queryKey: ["flipper-sticky-portfolio"],
    queryFn: () => fetchApi<PortfolioData>("/api/flipper/portfolio"),
    enabled: backendOnline,
    staleTime: 60_000,
    retry: 1,
  });

  // ---- Derived data ----
  const bestFlip = flipsData?.opportunities?.[0] ?? null;
  const bestCycle = triangularData?.cycles?.[0] ?? null;
  const flipCount = flipsData?.total ?? 0;
  const momentum = bestFlip?.momentum ?? 0;
  const correlationShock = portfolioData?.correlation_warning ?? false;

  // Market sentiment from all flip opportunities
  const sentiment = computeSentiment(flipsData?.opportunities ?? []);

  // Don't render if backend is offline
  if (!backendOnline) return null;

  return (
    <div className="bg-card/80 backdrop-blur-sm border-b border-border">
      <div className="max-w-[1600px] mx-auto px-4 py-1.5">
        <div className="flex items-center gap-4 text-xs overflow-x-auto">
          {/* Best Flip */}
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-muted-foreground font-medium">
              {t("stickyBarBestFlip")}:
            </span>
            {bestFlip ? (
              <>
                <span className="font-semibold truncate max-w-[120px]">
                  {bestFlip.currency}
                </span>
                <span className={`font-bold ${scoreColor(bestFlip.score)}`}>
                  {(bestFlip.score * 100).toFixed(0)}%
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">{t("stickyBarNoFlips")}</span>
            )}
          </div>

          {/* Flip Count Badge */}
          {flipCount > 0 && (
            <div className="flex items-center gap-1 shrink-0">
              <Badge
                variant="outline"
                className="border-blue-500/50 text-blue-600 dark:text-blue-400 bg-blue-500/10 text-[10px] px-1.5 py-0 font-semibold"
              >
                {t("stickyBarFlipCount", { "0": flipCount })}
              </Badge>
            </div>
          )}

          {/* 24h Trend */}
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-muted-foreground font-medium">
              {t("stickyBarTrend24h")}:
            </span>
            {bestFlip ? (
              <div className="flex items-center gap-0.5">
                {momentum > 0.001 ? (
                  <TrendingUp className="h-3 w-3 text-emerald-500" aria-hidden="true" />
                ) : momentum < -0.001 ? (
                  <TrendingDown className="h-3 w-3 text-red-500" aria-hidden="true" />
                ) : (
                  <Minus className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
                )}
                <span
                  className={
                    momentum > 0.001
                      ? "text-emerald-600 dark:text-emerald-400"
                      : momentum < -0.001
                        ? "text-red-600 dark:text-red-400"
                        : "text-muted-foreground"
                  }
                >
                  {momentum >= 0 ? "+" : ""}
                  {(momentum * 100).toFixed(2)}%
                </span>
              </div>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </div>

          {/* Market Sentiment */}
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-muted-foreground font-medium">
              {t("stickyBarSentiment")}:
            </span>
            <div className="flex items-center gap-0.5">
              {classifySentiment(sentiment) === "bullish" ? (
                <TrendingUp className="h-3 w-3 text-emerald-500" aria-hidden="true" />
              ) : classifySentiment(sentiment) === "bearish" ? (
                <TrendingDown className="h-3 w-3 text-red-500" aria-hidden="true" />
              ) : (
                <Minus className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
              )}
              <Badge
                variant="outline"
                className={
                  classifySentiment(sentiment) === "bullish"
                    ? "border-emerald-500/50 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 text-[10px] px-1.5 py-0 font-semibold"
                    : classifySentiment(sentiment) === "bearish"
                      ? "border-red-500/50 text-red-600 dark:text-red-400 bg-red-500/10 text-[10px] px-1.5 py-0 font-semibold"
                      : "border-muted-foreground/30 text-muted-foreground bg-muted/10 text-[10px] px-1.5 py-0 font-semibold"
                }
              >
                {classifySentiment(sentiment) === "bullish"
                  ? t("stickyBarBullish")
                  : classifySentiment(sentiment) === "bearish"
                    ? t("stickyBarBearish")
                    : t("stickyBarNeutral")}
              </Badge>
            </div>
          </div>

          {/* Best Arb */}
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-muted-foreground font-medium">
              {t("stickyBarBestArb")}:
            </span>
            {bestCycle ? (
              <>
                <span className="font-mono truncate max-w-[160px]">
                  {bestCycle.cycle.join("→")}
                </span>
                <Badge
                  variant="outline"
                  className="border-emerald-500/50 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 text-[10px] px-1.5 py-0 font-semibold"
                >
                  +{bestCycle.net_profit_pct.toFixed(2)}%
                </Badge>
              </>
            ) : (
              <span className="text-muted-foreground">{t("stickyBarNoCycles")}</span>
            )}
          </div>

          {/* Correlation Shock Alert */}
          {correlationShock && (
            <div className="flex items-center gap-1 shrink-0">
              <Badge
                variant="outline"
                className="border-red-500/50 text-red-600 dark:text-red-400 bg-red-500/10 text-[10px] px-1.5 py-0 font-semibold animate-pulse"
              >
                <AlertTriangle className="h-3 w-3 mr-0.5 inline" aria-hidden="true" />
                {t("stickyBarCorrelationShock")}
              </Badge>
            </div>
          )}

          {/* Phase Badge */}
          {phaseData?.phase && (
            <div className="flex items-center gap-1.5 shrink-0 ml-auto">
              <Badge
                variant="outline"
                className={
                  phaseData.phase === "early"
                    ? "border-emerald-500/50 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 text-[10px] px-1.5 py-0 font-semibold"
                    : phaseData.phase === "mid"
                      ? "border-amber-500/50 text-amber-600 dark:text-amber-400 bg-amber-500/10 text-[10px] px-1.5 py-0 font-semibold"
                      : "border-red-500/50 text-red-600 dark:text-red-400 bg-red-500/10 text-[10px] px-1.5 py-0 font-semibold"
                }
              >
                {phaseData.phase === "early"
                  ? t("phaseEarly")
                  : phaseData.phase === "mid"
                    ? t("phaseMid")
                    : t("phaseLate")}
              </Badge>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
