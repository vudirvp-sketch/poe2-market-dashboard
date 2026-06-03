// ============================================================================
// Arbitrage Flipper Flips — Flipper-mode scored flip opportunities table
// Extracted from arbitrage-tab.tsx (ШАГ 3 refactoring)
//
// FIX: Better UX for data unavailable states:
//   - When backend is online but data not yet collected → show
//     "collecting data" message with retry button
//   - When backend is offline → show backend_offline error
//   - When upstream is degraded → show upstream_unreachable error
// ============================================================================
"use client";

import { memo } from "react";
import { AlertTriangle, TrendingUp, RefreshCw, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import type { FlipsResponse } from "@/lib/types";
import { ApiErrorFallback } from "./api-error-fallback";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ArbitrageFlipperFlipsProps {
  flipsData: FlipsResponse | undefined;
  flipsError: boolean;
  flipsErrorObj: unknown;
  backendOnline: boolean;
  upstreamDegraded?: boolean;
  onRetry: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ArbitrageFlipperFlips = memo(function ArbitrageFlipperFlips({
  flipsData,
  flipsError,
  flipsErrorObj,
  backendOnline,
  upstreamDegraded,
  onRetry,
}: ArbitrageFlipperFlipsProps) {
  const { t } = useI18n();

  return (
    <Card>
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
          <TrendingUp className="h-4 w-4" aria-hidden="true" />
          {t("flipperFlipOpportunities")}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0">
        {!backendOnline ? (
          <ApiErrorFallback
            errorKind="backend_offline"
            onRetry={onRetry}
          />
        ) : upstreamDegraded ? (
          <ApiErrorFallback
            errorKind="upstream_unreachable"
            onRetry={onRetry}
          />
        ) : flipsData && flipsData.dataAvailable === false ? (
          <div className="text-center py-10">
            <Clock className="h-10 w-10 text-amber-500 mx-auto mb-3" aria-hidden="true" />
            <p className="font-medium text-amber-600 dark:text-amber-400">{t("flipperCollectingDataTitle")}</p>
            <p className="text-sm text-muted-foreground mt-1">
              {t("flipperCollectingDataDesc")}
            </p>
            {onRetry && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-3 h-8 text-xs gap-1.5"
                onClick={onRetry}
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                {t("tryAgain")}
              </Button>
            )}
          </div>
        ) : flipsError ? (
          <ApiErrorFallback
            error={flipsErrorObj instanceof Error ? flipsErrorObj : String(flipsErrorObj ?? "")}
            onRetry={onRetry}
          />
        ) : !flipsData?.opportunities?.length ? (
          <div className="text-center py-10">
            <AlertTriangle className="h-10 w-10 text-muted-foreground mx-auto mb-3" aria-hidden="true" />
            <p className="font-medium">{t("noArbitrage")}</p>
            <p className="text-sm text-muted-foreground mt-1">
              {t("noArbitrageDesc")}
            </p>
            {/* 4.3: CTA link to documentation */}
            <a
              href="https://github.com/vudirvp-sketch/poe2-market-dashboard#flipper-mode"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block mt-3 text-sm text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 underline underline-offset-2"
            >
              {t("learnMoreFlipsDocs")}
            </a>
          </div>
        ) : (
          <div className="space-y-0" role="table" aria-label={t("flipperFlipOpportunities")}>
            {/* Table header */}
            <div className="grid grid-cols-[1fr_60px_70px_70px_70px_80px_80px] gap-2 py-2 px-2 text-xs font-medium text-muted-foreground border-b border-border sticky top-0 bg-card z-10" role="row">
              <span role="columnheader">{t("flipperCurrency")}</span>
              <span className="text-center" role="columnheader">{t("flipperScore")}</span>
              <span className="text-right" role="columnheader">{t("flipperSpread")}</span>
              <span className="text-right" role="columnheader">{t("flipperMomentum")}</span>
              <span className="text-right" role="columnheader">{t("flipperVolatility")}</span>
              <span className="text-center" role="columnheader">{t("flipperCluster")}</span>
              <span className="text-right" role="columnheader">{t("flipperVolume")}</span>
            </div>

            {/* Table body */}
            <div className="max-h-96 overflow-y-auto" role="rowgroup">
              {flipsData.opportunities.map((opp, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-[1fr_60px_70px_70px_70px_80px_80px] gap-2 py-2 px-2 text-sm border-b border-border/50 hover:bg-muted/20 transition-colors items-center"
                  role="row"
                >
                  {/* Currency pair */}
                  <span className="text-xs font-medium truncate" role="cell">
                    {opp.currency}
                  </span>

                  {/* Score */}
                  <span className="flex justify-center" role="cell">
                    <Badge
                      variant="outline"
                      className={`text-[10px] px-1.5 py-0 font-semibold ${
                        opp.score >= 0.7
                          ? "border-emerald-500/50 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
                          : opp.score >= 0.4
                          ? "border-amber-500/50 text-amber-600 dark:text-amber-400 bg-amber-500/10"
                          : "border-red-500/50 text-red-600 dark:text-red-400 bg-red-500/10"
                      }`}
                    >
                      {(opp.score ?? 0).toFixed(2)}
                    </Badge>
                  </span>

                  {/* Spread after fees */}
                  <span className="text-right font-mono text-xs text-muted-foreground" role="cell">
                    {(((opp.spread ?? opp.spreadAfterFees) ?? 0) * 100).toFixed(2)}%
                  </span>

                  {/* Momentum */}
                  <span className={`text-right font-mono text-xs ${
                    (opp.momentum ?? 0) > 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : (opp.momentum ?? 0) < 0
                      ? "text-red-600 dark:text-red-400"
                      : "text-muted-foreground"
                  }`} role="cell">
                    {(opp.momentum ?? 0) > 0 ? "+" : ""}
                    {(opp.momentum ?? 0).toFixed(4)}
                  </span>

                  {/* Volatility */}
                  <span className="text-right font-mono text-xs text-muted-foreground" role="cell">
                    {(opp.volatility ?? 0).toFixed(4)}
                  </span>

                  {/* Cluster */}
                  <span className="flex justify-center" role="cell">
                    <Badge
                      variant="outline"
                      className={`text-[10px] px-1.5 py-0 font-semibold ${
                        opp.cluster === "SAFE"
                          ? "border-emerald-500/50 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
                          : opp.cluster === "RISKY"
                          ? "border-red-500/50 text-red-600 dark:text-red-400 bg-red-500/10"
                          : "border-amber-500/50 text-amber-600 dark:text-amber-400 bg-amber-500/10"
                      }`}
                    >
                      {opp.cluster}
                    </Badge>
                  </span>

                  {/* Volume */}
                  <span className="text-right font-mono text-xs text-muted-foreground" role="cell">
                    {(opp.volume24h ?? 0).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
});
