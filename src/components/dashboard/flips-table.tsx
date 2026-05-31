// ============================================================================
// Flips Opportunities Table — Sortable, filterable table of flip opportunities
// with sort headers, cluster badges, momentum icons, and pagination.
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
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useI18n, type TranslationKeys } from "@/lib/i18n";
import { fmt } from "@/lib/types";
import { Pagination } from "@/components/dashboard/pagination";
import { ApiErrorFallback } from "./api-error-fallback";
import {
  type FlipOpportunity,
  type SortField,
  type SortDirection,
  scoreColor,
  clusterBadgeClass,
  clusterLabel,
} from "./flips-helpers";

// ---------------------------------------------------------------------------
// Local helpers (JSX-dependent)
// ---------------------------------------------------------------------------

function momentumIcon(momentum: number) {
  if (momentum > 0.001) return <TrendingUp className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />;
  if (momentum < -0.001) return <TrendingDown className="h-3.5 w-3.5 text-red-500" aria-hidden="true" />;
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
}: FlipsTableProps) {
  const { t } = useI18n();

  // Sort header helper
  const SortHeader = ({ field, label }: { field: SortField; label: string }) => (
    <button
      className="flex items-center gap-1 hover:text-foreground transition-colors"
      onClick={() => onSort(field)}
      aria-label={`Sort by ${label}`}
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
            {/* Table header */}
            <div role="row" className="grid grid-cols-[1.5fr_60px_80px_70px_70px_80px_30px] gap-1.5 py-2 px-2 text-xs font-medium text-muted-foreground border-b border-border sticky top-0 bg-card z-10">
              <span role="columnheader">{t("flipperCurrency")}</span>
              <span role="columnheader" className="text-center"><SortHeader field="score" label={t("flipperScore")} /></span>
              <span role="columnheader" className="text-right"><SortHeader field="spread_after_fees" label={t("flipperSpread")} /></span>
              <span role="columnheader" className="text-right"><SortHeader field="momentum" label={t("flipperMomentum")} /></span>
              <span role="columnheader" className="text-right"><SortHeader field="volatility" label={t("flipperVolatility")} /></span>
              <span role="columnheader" className="text-center">{t("flipperCluster")}</span>
              <span role="columnheader" />
            </div>

            {/* Table body */}
            <div className="max-h-[500px] overflow-y-auto" role="rowgroup" aria-label="Flip opportunities">
              {paginatedOpportunities.map((opp) => (
                <div
                  key={opp.currency}
                  className="grid grid-cols-[1.5fr_60px_80px_70px_70px_80px_30px] gap-1.5 py-2 px-2 text-sm border-b border-border/50 hover:bg-muted/20 transition-colors items-center cursor-pointer"
                  role="row"
                  onClick={() => onRowClick(opp)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onRowClick(opp);
                    }
                  }}
                  tabIndex={0}
                  aria-label={`${opp.currency} score ${(opp.score * 100).toFixed(0)}%`}
                >
                  {/* Currency pair */}
                  <span className="text-xs font-medium truncate">{opp.currency}</span>

                  {/* Score */}
                  <span className={`text-center text-xs font-bold ${scoreColor(opp.score)}`}>
                    {(opp.score * 100).toFixed(0)}%
                  </span>

                  {/* Spread after fees */}
                  <span className="text-right font-mono text-xs">
                    {(opp.spread_after_fees * 100).toFixed(2)}%
                  </span>

                  {/* Momentum */}
                  <span className="flex items-center justify-end gap-0.5">
                    {momentumIcon(opp.momentum)}
                    <span className="font-mono text-xs">
                      {opp.momentum >= 0 ? "+" : ""}
                      {(opp.momentum * 100).toFixed(2)}%
                    </span>
                  </span>

                  {/* Volatility */}
                  <span className="text-right font-mono text-xs">
                    {opp.volatility.toFixed(4)}
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
                  onPerPageChange={() => {}}
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
