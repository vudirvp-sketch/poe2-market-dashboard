// ============================================================================
// RecipesTab — Vendor recipe arbitrage tab.
// Shows profitable vendor orb recipes (e.g. shard → orb) compared against
// live market prices with gold fee calculations.
//
// Data: GET /api/flipper/recipes
// Backend: backend/api/routes_recipes.py
// ============================================================================
"use client";

import { useState, useMemo, memo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  FlaskConical,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Info,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/lib/i18n";
import { fetchApi, fmt, getFlipperErrorType } from "@/lib/types";
import { profitColor, profitBg } from "@/lib/flipper-helpers";
import { FlipperBackendStatusCard } from "./flipper-backend-status-card";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RecipeResult {
  name: string;
  input_cost_chaos?: number;
  output_value_chaos?: number;
  gold_fee_total?: number;
  gold_fee_chaos?: number;
  profit_chaos?: number;
  profit_pct?: number;
  is_profitable?: boolean;
  notes?: string;
  status?: string;
}

interface RecipesResponse {
  profitable_recipes: RecipeResult[];
  all_recipes: RecipeResult[];
  count: number;
  data_available?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers (profitColor and profitBg moved to @/lib/flipper-helpers.ts)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Component Props
// ---------------------------------------------------------------------------

interface RecipesTabProps {
  /** Whether the flipper backend is online */
  backendOnline: boolean;
  /** Backend is online but upstream API is unreachable (degraded mode) */
  upstreamDegraded?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const RecipesTab = memo(function RecipesTab({
  backendOnline,
  upstreamDegraded,
}: RecipesTabProps) {
  const { t } = useI18n();
  const [showUnprofitable, setShowUnprofitable] = useState(false);

  // ---- Fetch recipes data ----
  const {
    data: recipesData,
    isLoading: recipesLoading,
    isError: recipesError,
    refetch: refetchRecipes,
  } = useQuery<RecipesResponse>({
    queryKey: ["flipper-recipes"],
    queryFn: () => fetchApi<RecipesResponse>("/api/flipper/recipes"),
    enabled: backendOnline,
    staleTime: 60_000,
    retry: 1,
  });

  // ---- Determine error type ----
  const insufficientData =
    recipesError && getFlipperErrorType(recipesError) === "backend_insufficient_data";

  // ---- Derived data ----
  const profitable = recipesData?.profitable_recipes ?? [];
  const allRecipes = recipesData?.all_recipes ?? [];
  const unprofitable = useMemo(
    () => allRecipes.filter((r) => r.is_profitable === false),
    [allRecipes],
  );
  const missingData = useMemo(
    () => allRecipes.filter((r) => r.status === "missing_prices" || r.status === "missing_output_price"),
    [allRecipes],
  );

  const displayedRecipes = showUnprofitable ? allRecipes : profitable;

  // ---- Loading ----
  if (recipesLoading && backendOnline) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20 w-full" />
        <div className="grid grid-cols-3 gap-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <FlipperBackendStatusCard
        backendOnline={backendOnline}
        upstreamDegraded={upstreamDegraded}
        insufficientData={insufficientData}
        onRefresh={() => refetchRecipes()}
      />

      {backendOnline && (
        <>
          {/* ---- Key metrics row ---- */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-xs font-medium text-muted-foreground">
                  {t("recipesProfitableCount")}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 pt-0">
                <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                  {profitable.length}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-xs font-medium text-muted-foreground">
                  {t("recipesTotalChecked")}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 pt-0">
                <p className="text-2xl font-bold">
                  {allRecipes.length}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-xs font-medium text-muted-foreground">
                  {t("recipesBestProfit")}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 pt-0">
                {profitable.length > 0 ? (
                  <div className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5 text-emerald-500" aria-hidden="true" />
                    <span className="text-xl font-bold text-emerald-600 dark:text-emerald-400">
                      +{profitable[0].profit_pct?.toFixed(2) ?? "0.00"}%
                    </span>
                  </div>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </CardContent>
            </Card>
          </div>

          {/* ---- Info banner ---- */}
          <Card className="border-blue-500/30 bg-blue-500/5">
            <CardContent className="flex items-start gap-3 p-4">
              <Info className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" aria-hidden="true" />
              <div className="text-sm">
                <p className="text-muted-foreground">
                  {t("recipesDescription")}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* ---- Data unavailable (graceful) ---- */}
          {recipesData && recipesData.data_available === false && (
            <Card className="border-amber-500/30 bg-amber-500/5">
              <CardContent className="text-center py-10">
                <AlertTriangle className="h-10 w-10 text-amber-500 mx-auto mb-3" aria-hidden="true" />
                <p className="font-medium text-amber-600 dark:text-amber-400">{t("dataUnavailableTitle")}</p>
                <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
                  {t("dataUnavailableDesc")}
                </p>
              </CardContent>
            </Card>
          )}

          {/* ---- Error state (generic) ---- */}
          {recipesError && !insufficientData && (
            <Card className="border-red-500/30 bg-red-500/5">
              <CardContent className="text-center py-10">
                <AlertTriangle className="h-10 w-10 text-muted-foreground mx-auto mb-3" aria-hidden="true" />
                <p className="font-medium">{t("recipesNoData")}</p>
                <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
                  {t("recipesNoDataDesc")}
                </p>
              </CardContent>
            </Card>
          )}

          {/* ---- No profitable recipes ---- */}
          {!recipesError && profitable.length === 0 && allRecipes.length > 0 && (
            <Card className="border-amber-500/30 bg-amber-500/5">
              <CardContent className="text-center py-10">
                <TrendingDown className="h-10 w-10 text-muted-foreground mx-auto mb-3" aria-hidden="true" />
                <p className="font-medium">{t("recipesNoProfitable")}</p>
                <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
                  {t("recipesNoProfitableDesc")}
                </p>
              </CardContent>
            </Card>
          )}

          {/* ---- Profitable Recipes ---- */}
          {displayedRecipes.length > 0 && (
            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
                  <FlaskConical className="h-4 w-4" aria-hidden="true" />
                  {t("recipesTitle")}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 pt-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" role="table" aria-label={t("recipesTitle")}>
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-2 px-3 text-xs font-medium text-muted-foreground">
                          {t("recipesName")}
                        </th>
                        <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">
                          {t("recipesInputCost")}
                        </th>
                        <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">
                          {t("recipesOutputValue")}
                        </th>
                        <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">
                          {t("recipesGoldFee")}
                        </th>
                        <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">
                          {t("recipesProfit")}
                        </th>
                        <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">
                          {t("recipesProfitPct")}
                        </th>
                        <th className="text-center py-2 px-3 text-xs font-medium text-muted-foreground">
                          {t("recipesStatus")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayedRecipes.map((recipe) => {
                        const isProfitable = recipe.is_profitable ?? false;
                        const isMissing = recipe.status === "missing_prices" || recipe.status === "missing_output_price";

                        return (
                          <tr
                            key={recipe.name}
                            className={`border-b border-border/50 hover:bg-muted/20 transition-colors ${isProfitable ? "bg-emerald-500/5" : ""}`}
                          >
                            <td className="py-2 px-3 font-medium">
                              {recipe.name}
                              {recipe.notes && (
                                <span className="ml-2 text-xs text-muted-foreground">
                                  ({recipe.notes})
                                </span>
                              )}
                            </td>
                            <td className="py-2 px-3 text-right font-mono">
                              {recipe.input_cost_chaos != null
                                ? fmt(recipe.input_cost_chaos)
                                : "—"}
                            </td>
                            <td className="py-2 px-3 text-right font-mono">
                              {recipe.output_value_chaos != null
                                ? fmt(recipe.output_value_chaos)
                                : "—"}
                            </td>
                            <td className="py-2 px-3 text-right font-mono text-muted-foreground">
                              {recipe.gold_fee_chaos != null
                                ? fmt(recipe.gold_fee_chaos)
                                : "—"}
                            </td>
                            <td className={`py-2 px-3 text-right font-mono font-semibold ${profitColor(recipe.profit_chaos ?? 0)}`}>
                              {recipe.profit_chaos != null
                                ? `${recipe.profit_chaos > 0 ? "+" : ""}${fmt(recipe.profit_chaos)}`
                                : "—"}
                            </td>
                            <td className={`py-2 px-3 text-right font-mono font-semibold ${profitColor(recipe.profit_pct ?? 0)}`}>
                              {recipe.profit_pct != null
                                ? `${recipe.profit_pct > 0 ? "+" : ""}${recipe.profit_pct.toFixed(2)}%`
                                : "—"}
                            </td>
                            <td className="py-2 px-3 text-center">
                              {isMissing ? (
                                <Badge
                                  variant="outline"
                                  className="border-amber-500/50 text-amber-600 dark:text-amber-400 bg-amber-500/10 text-[10px] px-1.5 py-0"
                                >
                                  {t("recipesMissingPrices")}
                                </Badge>
                              ) : isProfitable ? (
                                <Badge
                                  variant="outline"
                                  className="border-emerald-500/50 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 text-[10px] px-1.5 py-0"
                                >
                                  {t("recipesProfitable")}
                                </Badge>
                              ) : (
                                <Badge
                                  variant="outline"
                                  className="border-red-500/50 text-red-600 dark:text-red-400 bg-red-500/10 text-[10px] px-1.5 py-0"
                                >
                                  {t("recipesUnprofitable")}
                                </Badge>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ---- Toggle unprofitable ---- */}
          {unprofitable.length > 0 && (
            <Card>
              <CardContent className="p-4">
                <button
                  className="flex items-center gap-2 text-sm font-semibold w-full text-left hover:text-foreground transition-colors"
                  onClick={() => setShowUnprofitable(!showUnprofitable)}
                  aria-expanded={showUnprofitable}
                >
                  <Info className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {showUnprofitable
                    ? t("recipesHideUnprofitable")
                    : t("recipesShowUnprofitable", { "0": unprofitable.length })}
                  {showUnprofitable ? (
                    <ChevronUp className="h-4 w-4 ml-auto" aria-hidden="true" />
                  ) : (
                    <ChevronDown className="h-4 w-4 ml-auto" aria-hidden="true" />
                  )}
                </button>
              </CardContent>
            </Card>
          )}

          {/* ---- Missing prices info ---- */}
          {missingData.length > 0 && (
            <Card className="border-amber-500/30 bg-amber-500/5">
              <CardContent className="flex items-start gap-3 p-4">
                <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" aria-hidden="true" />
                <div className="text-sm">
                  <p className="font-medium text-amber-600 dark:text-amber-400">
                    {t("recipesMissingTitle", { "0": missingData.length })}
                  </p>
                  <p className="text-muted-foreground mt-1">
                    {t("recipesMissingDesc")}
                  </p>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {missingData.map((r) => (
                      <Badge
                        key={r.name}
                        variant="outline"
                        className="text-[10px] border-amber-500/50 text-amber-600 dark:text-amber-400 bg-amber-500/10"
                      >
                        {r.name}
                      </Badge>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
});
