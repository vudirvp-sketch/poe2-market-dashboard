// ============================================================================
// FlipperStickyBar — Compact bar showing key market metrics when the
// flipper backend is online. Displayed below the header per spec §2.3.
//
// Enhanced with:
//   - Market sentiment indicator (aggregated momentum across all pairs)
//   - Flip opportunity count badge
//   - Correlation shock alert
//   - WebSocket connection status badge
// ============================================================================
"use client";

import { memo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useFlipsQuery, FLIPS_QUERY_KEY } from "@/hooks/use-flips-query";
import { TrendingUp, TrendingDown, Minus, AlertTriangle, WifiHigh, Wifi, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n";
import { fetchApi } from "@/lib/types";
import {
  FlipperPhaseResponse,
  TriangularResponse,
} from "@/lib/types";
import { computeSentiment, scoreColor, classifySentiment } from "@/lib/flipper-helpers";
import type { WebSocketStatus } from "@/hooks/use-websocket";

// ---------------------------------------------------------------------------
// Types — imported from @/lib/types (Single Source of Truth)
// Previously FlipOpportunity / FlipsResponse / TriangularCycle /
// TriangularResponse / PortfolioData were duplicated locally as subsets.
// Now we use the canonical types.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface FlipperStickyBarProps {
  backendOnline: boolean;
  /** 4.2: Correlation warning flag from dashboard-level portfolio query.
   *  Previously this component made its own ["flipper-portfolio"] query,
   *  which was redundant with PortfolioTab's query. Now passed as a prop. */
  correlationWarning?: boolean;
  /** WebSocket connection status (from use-websocket.ts).
   *  Shows a small badge indicating live connection state. */
  wsStatus?: WebSocketStatus;
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
  correlationWarning = false,
  wsStatus,
}: FlipperStickyBarProps) {
  const { t } = useI18n();

  // ---- Best flip (shared cache key via useFlipsQuery) ----
  const { data: flipsData } = useFlipsQuery({
    enabled: backendOnline,
  });

  // ---- Best triangular arb (shared cache key with ArbitrageTab) ----
  // No refetchInterval — ArbitrageTab or Dashboard-level already polls this key
  // when visible. We only read from the shared cache here.
  const { data: triangularData } = useQuery<TriangularResponse>({
    queryKey: ["flipperTriangular"],
    queryFn: () => fetchApi<TriangularResponse>("/api/flipper/triangular"),
    enabled: backendOnline,
    staleTime: 60_000,
    // No refetchInterval — avoids duplicate network calls; other consumers poll this key
    retry: 1,
  });

  // ---- Phase info (shared cache key with Dashboard) ----
  // Note: Dashboard-level already refetches this with refetchInterval: 60_000.
  // We skip refetchInterval here to avoid duplicate network calls — React Query
  // will use the data from Dashboard's query via the shared cache key.
  const { data: phaseData } = useQuery<FlipperPhaseResponse>({
    queryKey: ["flipperPhase"],
    queryFn: () => fetchApi<FlipperPhaseResponse>("/api/flipper/phase"),
    enabled: backendOnline,
    staleTime: 60_000,
    // No refetchInterval — dashboard-page already polls this key
    retry: 1,
  });

  // 4.2: Portfolio query removed from FlipperStickyBar.
  // correlationWarning is now passed as a prop from dashboard-page.tsx,
  // which owns the ["flipper-portfolio"] query at the page level.
  // This eliminates a redundant network request when PortfolioTab is not mounted.

  // ---- Derived data ----
  const bestFlip = flipsData?.opportunities?.[0] ?? null;
  const bestCycle = triangularData?.opportunities?.[0] ?? null;
  const flipCount = flipsData?.total ?? 0;
  const momentum = bestFlip?.momentum ?? 0;
  const correlationShock = correlationWarning;

  // Market sentiment from all flip opportunities
  const sentiment = computeSentiment(flipsData?.opportunities ?? []);

  // Client-side phase validation (same logic as header.tsx)
  const effectivePhase = (() => {
    if (!phaseData?.phase) return { phase: "", isEstimated: false };
    const days = phaseData.daysSinceReference;
    const reported = phaseData.phase.toLowerCase();
    if (reported === "late" && days < 14) return { phase: "early", isEstimated: true };
    if (reported === "late" && days < 42) return { phase: "mid", isEstimated: true };
    if (reported === "mid" && days < 14) return { phase: "early", isEstimated: true };
    return { phase: reported, isEstimated: false };
  })();

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
                <span className={`font-bold ${scoreColor(bestFlip.score ?? 0)}`}>
                  {((bestFlip.score ?? 0) * 100).toFixed(0)}%
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
                  +{(bestCycle.netProfitPct ?? 0).toFixed(2)}%
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

          {/* WebSocket Status Badge */}
          {wsStatus && (
            <div className="flex items-center gap-1 shrink-0">
              <Badge
                variant="outline"
                title={
                  wsStatus === "connected"
                    ? t("wsStatusConnected")
                    : wsStatus === "connecting"
                      ? t("wsStatusConnecting")
                      : t("wsStatusDisconnected")
                }
                className={
                  wsStatus === "connected"
                    ? "border-emerald-500/50 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 text-[10px] px-1.5 py-0 font-semibold"
                    : wsStatus === "connecting"
                      ? "border-amber-500/50 text-amber-600 dark:text-amber-400 bg-amber-500/10 text-[10px] px-1.5 py-0 font-semibold"
                      : "border-muted-foreground/30 text-muted-foreground bg-muted/10 text-[10px] px-1.5 py-0 font-semibold"
                }
              >
                {wsStatus === "connected" ? (
                  <WifiHigh className="h-3 w-3 mr-0.5 inline" aria-hidden="true" />
                ) : wsStatus === "connecting" ? (
                  <Loader2 className="h-3 w-3 mr-0.5 inline animate-spin" aria-hidden="true" />
                ) : (
                  <Wifi className="h-3 w-3 mr-0.5 inline" aria-hidden="true" />
                )}
                {wsStatus === "connected"
                  ? t("stickyBarWsConnected")
                  : wsStatus === "connecting"
                    ? t("stickyBarWsConnecting")
                    : t("stickyBarWsDisconnected")}
              </Badge>
            </div>
          )}

          {/* Phase Badge — with client-side validation */}
          {effectivePhase.phase && (
            <div className="flex items-center gap-1.5 shrink-0 ml-auto">
              <Badge
                variant="outline"
                title={effectivePhase.isEstimated ? t("phaseEstimatedTooltip") : t("phaseBackendTooltip")}
                className={
                  effectivePhase.phase === "early"
                    ? "border-emerald-500/50 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 text-[10px] px-1.5 py-0 font-semibold"
                    : effectivePhase.phase === "mid"
                      ? "border-amber-500/50 text-amber-600 dark:text-amber-400 bg-amber-500/10 text-[10px] px-1.5 py-0 font-semibold"
                      : "border-red-500/50 text-red-600 dark:text-red-400 bg-red-500/10 text-[10px] px-1.5 py-0 font-semibold"
                }
              >
                {effectivePhase.phase === "early"
                  ? t("phaseEarly")
                  : effectivePhase.phase === "mid"
                    ? t("phaseMid")
                    : t("phaseLate")}
                {effectivePhase.isEstimated && (
                  <span className="ml-0.5 opacity-60 text-[8px]">~</span>
                )}
              </Badge>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
