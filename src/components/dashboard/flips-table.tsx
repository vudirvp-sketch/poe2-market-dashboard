// ============================================================================
// Flips Opportunities Table — Sortable, filterable table of flip opportunities
// with sort headers, cluster badges, momentum icons, pagination, and Premium
// column showing cross-currency optimal payment.
//
// P1-1/P1-3: Added quantized columns (Q-Spread, Min Lot, Brick Risk, Tier)
// Iteration 12: Added Premium column with BestPaymentBadge + tooltip
// Iteration 13: i18n-ified Premium tooltip strings
// ============================================================================
"use client";

import { memo } from "react";
import {
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  ArrowUpDown,
  Minus,
  ChevronRight,
  Shield,
  Boxes,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useI18n, type TranslationKeys } from "@/lib/i18n";
import { fmt, type OptimalPaymentResult } from "@/lib/types";
import { Pagination } from "@/components/dashboard/pagination";
import { ApiErrorFallback } from "./api-error-fallback";
import { BestPaymentBadge } from "./best-payment-badge";
import {
  type FlipOpportunity,
  type SortField,
  type SortDirection,
  scoreColor,
  clusterBadgeClass,
  clusterLabel,
} from "./flips-helpers";
import { isFlipDataSuspicious } from "@/lib/flipper-helpers";

// ---------------------------------------------------------------------------
// Local helpers (JSX-dependent)
// ---------------------------------------------------------------------------

function momentumIcon(momentum: number | undefined) {
  const m = momentum ?? 0;
  if (m > 0.001) return <TrendingUp className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />;
  if (m < -0.001) return <TrendingDown className="h-3.5 w-3.5 text-red-500" aria-hidden="true" />;
  return <Minus className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />;
}

// ---------------------------------------------------------------------------
// Component Props
// ---------------------------------------------------------------------------

interface FlipsTableProps {
  opportunities: FlipOpportunity[];
  isError: boolean;
  errorObj: unknown;
  insufficientData: boolean;
  onRetry: () => void;
  sortField: SortField;
  sortDirection: SortDirection;
  onSort: (field: SortField) => void;
  onRowClick: (opp: FlipOpportunity) => void;
  page: number;
  perPage: number;
  onPageChange: (page: number) => void;
  /** Optimal payment results keyed by display name ("Name1/Name2") */
  optimalPaymentByDisplayName?: Map<string, OptimalPaymentResult>;
  /** Anchor currency ID for premium display */
  anchorId?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const FlipsTable = memo(function FlipsTable({
  opportunities,
  isError,
  errorObj,
  insufficientData,
  onRetry,
  sortField,
  sortDirection,
  onSort,
  onRowClick,
  page,
  perPage,
  onPageChange,
  optimalPaymentByDisplayName,
  anchorId,
}: FlipsTableProps) {
  const { t } = useI18n();

  // Sort header helper
  const SortHeader = ({ field, label }: { field: SortField; label: string }) => (
    <button
      className="flex items-center gap-1 hover:text-foreground transition-colors"
      onClick={() => onSort(field)}
      aria-label={t("sortBy", { "0": label })}
    >
      <span>{label}</span>
      {sortField === field ? (
        <ArrowUpDown className="h-3 w-3" aria-hidden="true" />
      ) : null}
    </button>
  );

  const totalPages = Math.max(1, Math.ceil(opportunities.length / perPage));
  const paginatedOpportunities = opportunities.slice(
    (page - 1) * perPage,
    page * perPage,
  );

  return (
    <Card>
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
          <TrendingUp className="h-4 w-4" aria-hidden="true" />
          {t("flipsDetailedOpportunities")}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0">
        {isError ? (
          <ApiErrorFallback
            error={errorObj instanceof Error ? errorObj : String(errorObj ?? "")}
            onRetry={onRetry}
            errorKind={insufficientData ? "insufficient_data" : undefined}
          />
        ) : !opportunities.length ? (
          <div className="text-center py-10">
            <AlertTriangle className="h-10 w-10 text-muted-foreground mx-auto mb-3" aria-hidden="true" />
            <p className="font-medium">{t("flipsNoOpportunities")}</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
              {t("flipsNoOpportunitiesDesc")}
            </p>
          </div>
        ) : (
          <div role="table" aria-label={t("flipsDetailedOpportunities")}>
            {/* Table header — P1-1/P1-3: Added Q-Spread, Min Lot, Brick Risk, Tier; Premium column */}
            <div role="row" className="grid grid-cols-[1.5fr_50px_70px_50px_70px_60px_60px_55px_55px_60px_30px] gap-1 py-2 px-2 text-xs font-medium text-muted-foreground border-b border-border sticky top-0 bg-card z-10">
              <span role="columnheader">{t("flipperCurrency")}</span>
              <span role="columnheader" className="text-center"><SortHeader field="score" label={t("flipperScore")} /></span>
              <span role="columnheader" className="text-right"><SortHeader field="spreadAfterFees" label={t("flipperSpread")} /></span>
              <span role="columnheader" className="text-right hidden sm:table-cell" title={t("qSpreadTooltip")}><SortHeader field="qSpread" label={t("qSpread")} /></span>
              <span role="columnheader" className="text-right">{t("flipperMomentum")}</span>
              <span role="columnheader" className="text-right hidden sm:table-cell" title={t("minLotTooltip")}><SortHeader field="minLot" label={t("minLot")} /></span>
              <span role="columnheader" className="text-center hidden sm:table-cell" title={t("brickRiskTooltip")}><SortHeader field="brickRisk" label={t("brickRisk")} /></span>
              <span role="columnheader" className="text-center">{t("flipperCluster")}</span>
              <span role="columnheader" className="text-center hidden md:table-cell" title={t("tierDistanceTooltip")}><SortHeader field="tierDistance" label={t("tierDist")} /></span>
              <span role="columnheader" className="text-center hidden md:table-cell"><SortHeader field="premium" label={t("crossCurrencyPremium")} /></span>
              <span role="columnheader" />
            </div>

            {/* Table body */}
            <div className="max-h-[500px] overflow-y-auto" role="rowgroup" aria-label={t("ariaFlipOpportunities")}>
              {paginatedOpportunities.map((opp) => (
                <div
                  key={opp.currency}
                  className="grid grid-cols-[1.5fr_50px_70px_50px_70px_60px_60px_55px_55px_60px_30px] gap-1 py-2 px-2 text-sm border-b border-border/50 hover:bg-muted/20 transition-colors items-center cursor-pointer"
                  role="row"
                  onClick={() => onRowClick(opp)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onRowClick(opp);
                    }
                  }}
                  tabIndex={0}
                  aria-label={t("ariaFlipRowScore", { "0": opp.currency, "1": ((opp.score ?? 0) * 100).toFixed(0) })}
                >
                  {/* Currency pair + suspicious data indicator */}
                  <span className="flex items-center gap-1 text-xs font-medium truncate">
                    {isFlipDataSuspicious(opp) && (
                      <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" aria-hidden="true" />
                    )}
                    {opp.currency}
                  </span>

                  {/* Score */}
                  <span className={`text-center text-xs font-bold ${scoreColor(opp.score ?? 0)}`}>
                    {((opp.score ?? 0) * 100).toFixed(1)}%
                  </span>

                  {/* Spread (theoretical) */}
                  <span className="text-right font-mono text-xs">
                    {(((opp.spread ?? opp.spreadAfterFees) ?? 0) * 100).toFixed(2)}%
                  </span>

                  {/* P1-1: Q-Spread — quantized spread at min profitable lot */}
                  <span className="text-right font-mono text-xs hidden sm:table-cell" title={t("qSpreadTooltip")}>
                    {opp.quantizedAnalysis ? (
                      <span className={(opp.quantizedAnalysis.optimalLotProfitPct ?? 0) > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}>
                        {(opp.quantizedAnalysis.optimalLotProfitPct ?? 0).toFixed(1)}%
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </span>

                  {/* Momentum */}
                  <span className="flex items-center justify-end gap-0.5">
                    {momentumIcon(opp.momentum)}
                    <span className="font-mono text-xs">
                      {(opp.momentum ?? 0) >= 0 ? "+" : ""}
                      {((opp.momentum ?? 0) * 100).toFixed(2)}%
                    </span>
                  </span>

                  {/* P1-1: Min Lot — minimum profitable lot size */}
                  <span className="text-right font-mono text-xs flex items-center justify-end gap-0.5 hidden sm:table-cell" title={t("minLotTooltip")}>
                    <Boxes className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
                    {opp.quantizedAnalysis ? (
                      <span className={opp.quantizedAnalysis.minProfitableLot > 10 ? "text-amber-600 dark:text-amber-400" : ""}>
                        {opp.quantizedAnalysis.minProfitableLot > 0 ? `×${opp.quantizedAnalysis.minProfitableLot}` : "✗"}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </span>

                  {/* P1-1: Brick Risk — lower = more fragile */}
                  <span className="flex justify-center hidden sm:table-cell" title={t("brickRiskTooltip")}>
                    {opp.quantizedAnalysis ? (
                      <span className="flex items-center gap-0.5">
                        <Shield
                          className={`h-3 w-3 ${
                            (opp.quantizedAnalysis.brickResistance ?? 0) >= 0.5
                              ? "text-emerald-500"
                              : (opp.quantizedAnalysis.brickResistance ?? 0) >= 0.2
                              ? "text-amber-500"
                              : "text-red-500"
                          }`}
                          aria-hidden="true"
                        />
                        <span className="text-[10px] font-mono">{((opp.quantizedAnalysis.brickResistance ?? 0) * 100).toFixed(0)}</span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-[10px]">—</span>
                    )}
                  </span>

                  {/* Cluster */}
                  <span className="flex justify-center">
                    <Badge
                      variant="outline"
                      className={`text-[10px] px-1.5 py-0 font-semibold ${clusterBadgeClass(opp.cluster)}`}
                    >
                      {clusterLabel(opp.cluster, t)}
                    </Badge>
                  </span>

                  {/* P1-3: Tier Distance */}
                  <span className="text-center text-xs hidden md:table-cell" title={t("tierDistanceTooltip")}>
                    {opp.tierDistance != null && opp.tierDistance > 0 ? (
                      <Badge
                        variant="outline"
                        className={`text-[10px] px-1 py-0 font-semibold ${
                          opp.tierDistance >= 3
                            ? "border-red-500/50 text-red-600 dark:text-red-400 bg-red-500/10"
                            : opp.tierDistance >= 2
                            ? "border-amber-500/50 text-amber-600 dark:text-amber-400 bg-amber-500/10"
                            : "border-muted-foreground/30 text-muted-foreground"
                        }`}
                      >
                        Δ{opp.tierDistance}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground text-[10px]">—</span>
                    )}
                  </span>

                  {/* Premium — BestPaymentBadge showing cheapest payment currency */}
                  <span className="flex justify-center hidden md:table-cell">
                    {(() => {
                      const result = optimalPaymentByDisplayName?.get(opp.currency);
                      if (!result || result.savingsPct < 1) {
                        return <span className="text-muted-foreground text-[10px]">—</span>;
                      }
                      const cell = <BestPaymentBadge result={result} anchorName={anchorId ?? "exalted"} compact />;
                      if (result.options.length >= 2) {
                        return (
                          <TooltipProvider delayDuration={200}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="cursor-help">{cell}</div>
                              </TooltipTrigger>
                              <TooltipContent side="left" className="max-w-[260px] p-2.5" sideOffset={6}>
                                <div className="space-y-1.5">
                                  <div className="text-xs font-medium text-foreground mb-1.5">
                                    {t("premiumPayIn")} <span className="text-emerald-400">{result.options[0]?.currencyName}</span> → {t("premiumSave")} {fmt(result.savingsAnchor)} {anchorId ?? "Exa"}
                                  </div>
                                  <div className="border-t border-border/50 pt-1.5 space-y-0.5">
                                    {result.options.map((opt, idx) => (
                                      <div key={opt.currencyId} className={`flex items-center justify-between gap-3 text-[11px] ${idx === 0 ? "font-semibold text-emerald-400" : "text-muted-foreground"}`}>
                                        <span className="truncate max-w-[100px]">{opt.currencyName}</span>
                                        <span className="font-mono whitespace-nowrap">
                                          {fmt(opt.effectiveAnchorPrice)} {anchorId ?? "Exa"}
                                          {opt.premiumPct > 0 && (
                                            <span className="text-amber-400 ml-1">+{opt.premiumPct.toFixed(1)}%</span>
                                          )}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        );
                      }
                      return cell;
                    })()}
                  </span>

                  {/* Detail arrow */}
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                </div>
              ))}
            </div>

            {/* Pagination */}
            {opportunities.length > perPage && (
              <div className="mt-3">
                <Pagination
                  page={page}
                  totalPages={totalPages}
                  totalItems={opportunities.length}
                  perPage={perPage}
                  onPageChange={onPageChange}
                  onPerPageChange={() => {}}  // Intentional no-op: perPage is fixed at 25
                  perPageOptions={[25]}
                />
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
});
