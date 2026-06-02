// ============================================================================
// Arbitrage Flipper Triangular — Triangular arbitrage cycles table
// Extracted from arbitrage-tab.tsx (ШАГ 3 refactoring)
// ============================================================================
"use client";

import { memo } from "react";
import { AlertTriangle, ArrowRight, Layers } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n";
import type { TriangularResponse } from "@/lib/types";
import { ApiErrorFallback } from "./api-error-fallback";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ArbitrageFlipperTriangularProps {
  triData: TriangularResponse | undefined;
  triError: boolean;
  triErrorObj: unknown;
  backendOnline: boolean;
  upstreamDegraded?: boolean;
  onRetry: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ArbitrageFlipperTriangular = memo(function ArbitrageFlipperTriangular({
  triData,
  triError,
  triErrorObj,
  backendOnline,
  upstreamDegraded,
  onRetry,
}: ArbitrageFlipperTriangularProps) {
  const { t } = useI18n();

  return (
    <Card>
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
          <Layers className="h-4 w-4" aria-hidden="true" />
          {t("flipperTriangularTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0">
        {!backendOnline ? (
          <ApiErrorFallback errorKind="backend_offline" compact />
        ) : upstreamDegraded ? (
          <ApiErrorFallback errorKind="upstream_unreachable" compact />
        ) : triData && triData.dataAvailable === false ? (
          <div className="text-center py-6">
            <AlertTriangle className="h-8 w-8 text-amber-500 mx-auto mb-2" aria-hidden="true" />
            <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
              {t("dataUnavailableTitle")}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {t("dataUnavailableDesc")}
            </p>
          </div>
        ) : triError ? (
          <ApiErrorFallback
            error={triErrorObj instanceof Error ? triErrorObj : String(triErrorObj ?? "")}
            onRetry={onRetry}
            compact
          />
        ) : !triData?.opportunities?.length ? (
          <div className="text-center py-6">
            <AlertTriangle className="h-8 w-8 text-muted-foreground mx-auto mb-2" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">
              {t("flipperNoTriangular")}
            </p>
          </div>
        ) : (
          <div className="space-y-0" role="table" aria-label={t("flipperTriangularTitle")}>
            {/* Table header — P1-2: Added Min Start and Q-Profit columns */}
            <div className="grid grid-cols-[1fr_70px_70px_60px_60px_70px] gap-2 py-2 px-2 text-xs font-medium text-muted-foreground border-b border-border sticky top-0 bg-card z-10" role="row">
              <span role="columnheader">{t("flipperCycle")}</span>
              <span className="text-right" role="columnheader">{t("flipperNetProfitPct")}</span>
              <span className="text-right" role="columnheader" title={t("quantizedProfitTooltip")}>{t("quantizedProfit")}</span>
              <span className="text-right" role="columnheader" title={t("minStartTooltip")}>{t("minStart")}</span>
              <span className="text-center" role="columnheader">{t("confidence")}</span>
              <span className="text-right" role="columnheader">{t("flipperTotalVolume")}</span>
            </div>

            {/* Table body */}
            <div className="max-h-64 overflow-y-auto" role="rowgroup">
              {triData.opportunities.map((tri, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-[1fr_70px_70px_60px_60px_70px] gap-2 py-2 px-2 text-sm border-b border-border/50 hover:bg-muted/20 transition-colors items-center"
                  role="row"
                >
                  {/* Cycle */}
                  <div className="flex items-center gap-1 flex-wrap min-w-0" role="cell">
                    {tri.cycle.map((c, i) => (
                      <span key={i} className="flex items-center gap-1">
                        <span className="truncate text-xs font-medium">{c}</span>
                        {i < tri.cycle.length - 1 && (
                          <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" aria-hidden="true" />
                        )}
                      </span>
                    ))}
                    {/* P1-2: Integer simulation path */}
                    {tri.integerSimulation && tri.integerSimulation.length > 0 && (
                      <span className="text-[9px] text-muted-foreground ml-1" title={t("integerSimTooltip")}>
                        [{tri.integerSimulation.join("→")}]
                      </span>
                    )}
                  </div>

                  {/* Net profit % (continuous) */}
                  <span className="text-right font-mono text-xs font-semibold text-emerald-600 dark:text-emerald-400" role="cell">
                    +{tri.netProfitPct.toFixed(2)}%
                  </span>

                  {/* P1-2: Quantized profit % */}
                  <span className="text-right font-mono text-xs" role="cell" title={t("quantizedProfitTooltip")}>
                    {tri.quantizedProfitPct != null ? (
                      <span className={tri.quantizedProfitPct > 0 ? "text-emerald-600 dark:text-emerald-400 font-semibold" : "text-red-500"}>
                        {tri.quantizedProfitPct > 0 ? "+" : ""}{tri.quantizedProfitPct.toFixed(2)}%
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </span>

                  {/* P1-2: Min starting amount */}
                  <span className="text-right font-mono text-xs" role="cell" title={t("minStartTooltip")}>
                    {tri.minStartingAmount != null && tri.minStartingAmount > 0 ? (
                      <span className={tri.minStartingAmount > 100 ? "text-amber-600 dark:text-amber-400" : ""}>
                        {tri.minStartingAmount}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </span>

                  {/* Confidence */}
                  <span className="flex justify-center" role="cell">
                    <Badge
                      variant="outline"
                      className={`text-[10px] px-1.5 py-0 font-semibold ${
                        tri.confidence >= 0.7
                          ? "border-emerald-500/50 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
                          : tri.confidence >= 0.3
                          ? "border-amber-500/50 text-amber-600 dark:text-amber-400 bg-amber-500/10"
                          : "border-red-500/50 text-red-600 dark:text-red-400 bg-red-500/10"
                      }`}
                    >
                      {tri.confidence >= 0.7
                        ? t("confidenceHigh")
                        : tri.confidence >= 0.3
                        ? t("confidenceMedium")
                        : t("confidenceLow")}
                    </Badge>
                  </span>

                  {/* Total volume */}
                  <span className="text-right font-mono text-xs text-muted-foreground" role="cell">
                    {(tri.totalVolume ?? 0).toLocaleString()}
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
