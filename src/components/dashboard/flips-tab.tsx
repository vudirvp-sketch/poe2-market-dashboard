// ============================================================================
// Flips Tab — Detailed flip opportunities analysis with scoring, filtering,
// sorting, and per-opportunity detail panel.
//
// This is the DETAILED version of the flip scoring view. The existing
// ArbitrageTab's flipper mode serves as a quick overview; this tab provides
// full detail panels, storage value integration, and cluster-based filtering.
// ============================================================================
"use client";

import { useState, useMemo, memo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Circle,
  Server,
  RefreshCw,
  Info,
  ArrowUpDown,
  Minus,
  ChevronRight,
  Search,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n, type TranslationKeys } from "@/lib/i18n";
import { fetchApi, fmt } from "@/lib/types";
import { Pagination } from "@/components/dashboard/pagination";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FlipOpportunity {
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

interface FlipEventStatus {
  any_active: boolean;
  affected_currencies: string[];
  summary: Record<string, unknown> | null;
}

interface FlipsResponse {
  league: string;
  total: number;
  opportunities: FlipOpportunity[];
  event_status: FlipEventStatus;
  fetched_at: string;
}

interface StorageValueResponse {
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

type SortField =
  | "score"
  | "spread_after_fees"
  | "gold_fee_actual"
  | "volume_24h"
  | "momentum"
  | "volatility";

type SortDirection = "asc" | "desc";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function scoreColor(score: number): string {
  if (score >= 0.7) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 0.4) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

function scoreBg(score: number): string {
  if (score >= 0.7) return "bg-emerald-500/10 border-emerald-500/50";
  if (score >= 0.4) return "bg-amber-500/10 border-amber-500/50";
  return "bg-red-500/10 border-red-500/50";
}

function clusterLabel(cluster: string, t: (key: TranslationKeys) => string): string {
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

function clusterBadgeClass(cluster: string): string {
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

function momentumIcon(momentum: number) {
  if (momentum > 0.001) return <TrendingUp className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />;
  if (momentum < -0.001) return <TrendingDown className="h-3.5 w-3.5 text-red-500" aria-hidden="true" />;
  return <Minus className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />;
}

function decisionBadgeClass(decision: string): string {
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
// Component Props
// ---------------------------------------------------------------------------

interface FlipsTabProps {
  /** Whether the flipper backend is online (checked at dashboard level) */
  backendOnline: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const FlipsTab = memo(function FlipsTab({ backendOnline }: FlipsTabProps) {
  const { t } = useI18n();

  // Filter state
  const [minScore, setMinScore] = useState(0);
  const [minVolume, setMinVolume] = useState(0);
  const [clusterFilter, setClusterFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Sort state
  const [sortField, setSortField] = useState<SortField>("score");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  // Pagination
  const [page, setPage] = useState(1);
  const perPage = 25;

  // Detail dialog
  const [selectedFlip, setSelectedFlip] = useState<FlipOpportunity | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // ---- Backend health check is done at dashboard level ----
  // backendOnline is passed as prop

  // ---- Fetch flip opportunities ----
  const {
    data: flipsData,
    isLoading: flipsLoading,
    isError: flipsError,
    refetch: refetchFlips,
  } = useQuery<FlipsResponse>({
    queryKey: ["flipper-flips-tab", minScore, minVolume],
    queryFn: () =>
      fetchApi<FlipsResponse>("/api/flipper/flips", {
        min_score: String(minScore),
        min_volume: String(minVolume),
      }),
    enabled: backendOnline,
    staleTime: 60_000,
    retry: 1,
  });

  // ---- Storage value for selected flip (detail dialog) ----
  const { data: storageData } = useQuery<StorageValueResponse>({
    queryKey: ["flipper-storage-value-flips", selectedFlip?.currency],
    queryFn: () => {
      // Extract first currency from pair like "divine/exalted"
      const firstCurrency = selectedFlip?.currency?.split("/")[0] ?? "";
      return fetchApi<StorageValueResponse>(
        `/api/flipper/storage-value/${firstCurrency}`,
      );
    },
    enabled: backendOnline && !!selectedFlip && detailOpen,
    staleTime: 60_000,
    retry: 1,
  });

  // ---- Filter and sort opportunities ----
  const filteredOpportunities = useMemo(() => {
    if (!flipsData?.opportunities) return [];

    let filtered = flipsData.opportunities;

    // Cluster filter
    if (clusterFilter !== "all") {
      filtered = filtered.filter((o) => o.cluster === clusterFilter);
    }

    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((o) =>
        o.currency.toLowerCase().includes(query),
      );
    }

    // Sort
    const sorted = [...filtered].sort((a, b) => {
      const aVal = a[sortField];
      const bVal = b[sortField];
      const multiplier = sortDirection === "desc" ? -1 : 1;
      return (aVal - bVal) * multiplier;
    });

    return sorted;
  }, [flipsData, clusterFilter, searchQuery, sortField, sortDirection]);

  // Paginated slice
  const totalPages = Math.max(1, Math.ceil(filteredOpportunities.length / perPage));
  const paginatedOpportunities = filteredOpportunities.slice(
    (page - 1) * perPage,
    page * perPage,
  );

  // Reset page when filters change
  const handleClusterFilterChange = (value: string) => {
    setClusterFilter(value);
    setPage(1);
  };

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    setPage(1);
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  };

  const openDetail = (opp: FlipOpportunity) => {
    setSelectedFlip(opp);
    setDetailOpen(true);
  };

  // ---- Summary stats ----
  const avgScore = useMemo(() => {
    if (!filteredOpportunities.length) return 0;
    return filteredOpportunities.reduce((sum, o) => sum + o.score, 0) / filteredOpportunities.length;
  }, [filteredOpportunities]);

  const bestFlip = filteredOpportunities[0] ?? null;

  // ---- Sort header helper ----
  const SortHeader = ({ field, label }: { field: SortField; label: string }) => (
    <button
      className="flex items-center gap-1 hover:text-foreground transition-colors"
      onClick={() => handleSort(field)}
      aria-label={`Sort by ${label}`}
    >
      <span>{label}</span>
      {sortField === field ? (
        <ArrowUpDown className="h-3 w-3" aria-hidden="true" />
      ) : null}
    </button>
  );

  // ---- Loading ----
  if (flipsLoading && backendOnline) {
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
      {/* ---- Backend status + Refresh ---- */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Circle
            className={`h-2.5 w-2.5 ${
              backendOnline
                ? "fill-emerald-500 text-emerald-500"
                : "fill-red-500 text-red-500"
            }`}
            aria-hidden="true"
          />
          <Server className="h-3 w-3" aria-hidden="true" />
          {backendOnline
            ? t("flipperBackendOnline")
            : t("flipperBackendOffline")}
        </div>

        {backendOnline && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2"
            onClick={() => refetchFlips()}
            aria-label={t("refreshData")}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        )}
      </div>

      {/* ---- Backend unavailable ---- */}
      {!backendOnline && (
        <Card className="border-red-500/30 bg-red-500/5">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertTriangle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="text-sm">
              <p className="font-medium text-red-600 dark:text-red-400">
                {t("flipperBackendOfflineTitle")}
              </p>
              <p className="text-muted-foreground mt-1">
                {t("flipperBackendOfflineDesc")}
              </p>
              <code className="text-xs mt-2 block bg-muted px-2 py-1 rounded">
                uvicorn backend.main:app --reload --port 8000
              </code>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ---- Event status banner ---- */}
      {flipsData?.event_status?.any_active && (
        <Card className="border-orange-500/30 bg-orange-500/5">
          <CardContent className="flex items-start gap-3 p-4">
            <Info className="h-5 w-5 text-orange-500 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="text-sm">
              <p className="font-medium text-orange-600 dark:text-orange-400">
                {t("flipperEventActive")}
              </p>
              {flipsData.event_status.affected_currencies.length > 0 && (
                <p className="text-muted-foreground mt-1">
                  {t("flipperAffectedCurrencies")}:{" "}
                  {flipsData.event_status.affected_currencies.join(", ")}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ---- Summary stats row ---- */}
      {backendOnline && flipsData && (
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                {t("flipsTotalOpportunities")}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-0">
              <p className="text-2xl font-bold">{filteredOpportunities.length}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                {t("flipsAvgScore")}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-0">
              <p className="text-2xl font-bold">{(avgScore * 100).toFixed(1)}%</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                {t("flipsBestPair")}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-0">
              <p className="text-2xl font-bold truncate">
                {bestFlip?.currency ?? "—"}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                {t("flipsBestScore")}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-0">
              <p className={`text-2xl font-bold ${bestFlip ? scoreColor(bestFlip.score) : ""}`}>
                {bestFlip ? (bestFlip.score * 100).toFixed(1) + "%" : "—"}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ---- Filters row ---- */}
      {backendOnline && (
        <div className="flex flex-wrap items-center gap-3">
          {/* Min Score */}
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="flips-min-score">
              {t("flipperMinScore")}
            </label>
            <Input
              id="flips-min-score"
              type="number"
              min={0}
              max={1}
              step={0.1}
              value={minScore}
              onChange={(e) => {
                setMinScore(Number(e.target.value) || 0);
                setPage(1);
              }}
              className="w-20 h-8 text-xs"
            />
          </div>

          {/* Min Volume */}
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="flips-min-vol">
              {t("flipperMinVolume")}
            </label>
            <Input
              id="flips-min-vol"
              type="number"
              min={0}
              step={10}
              value={minVolume}
              onChange={(e) => {
                setMinVolume(Number(e.target.value) || 0);
                setPage(1);
              }}
              className="w-20 h-8 text-xs"
            />
          </div>

          {/* Cluster filter */}
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="flips-cluster">
              {t("flipsClusterFilter")}
            </label>
            <Select value={clusterFilter} onValueChange={handleClusterFilterChange}>
              <SelectTrigger id="flips-cluster" className="w-[130px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("all")}</SelectItem>
                <SelectItem value="stable">{t("flipsClusterStable")}</SelectItem>
                <SelectItem value="moderate">{t("flipsClusterModerate")}</SelectItem>
                <SelectItem value="volatile_illiquid">{t("flipsClusterVolatile")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Search */}
          <div className="relative flex-1 min-w-[150px] max-w-xs">
            <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            <Input
              placeholder={t("flipsSearchCurrency")}
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="pl-7 h-8 text-xs"
            />
          </div>
        </div>
      )}

      {/* ---- Opportunities table ---- */}
      {backendOnline && (
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
              <TrendingUp className="h-4 w-4" aria-hidden="true" />
              {t("flipsDetailedOpportunities")}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0">
            {flipsError ? (
              <div className="text-center py-10">
                <AlertTriangle className="h-10 w-10 text-muted-foreground mx-auto mb-3" aria-hidden="true" />
                <p className="font-medium">{t("failedToLoadData")}</p>
              </div>
            ) : !filteredOpportunities.length ? (
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
                <div role="row" className="grid grid-cols-[1.5fr_60px_70px_70px_80px_70px_70px_80px_30px] gap-1.5 py-2 px-2 text-xs font-medium text-muted-foreground border-b border-border sticky top-0 bg-card z-10">
                  <span role="columnheader">{t("flipperCurrency")}</span>
                  <span role="columnheader" className="text-center"><SortHeader field="score" label={t("flipperScore")} /></span>
                  <span role="columnheader" className="text-right"><SortHeader field="spread_after_fees" label={t("flipperSpread")} /></span>
                  <span role="columnheader" className="text-right">{t("flipsGoldFeePct")}</span>
                  <span role="columnheader" className="text-right"><SortHeader field="gold_fee_actual" label={t("flipperGoldFee")} /></span>
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
                      className="grid grid-cols-[1.5fr_60px_70px_70px_80px_70px_70px_80px_30px] gap-1.5 py-2 px-2 text-sm border-b border-border/50 hover:bg-muted/20 transition-colors items-center cursor-pointer"
                      role="row"
                      onClick={() => openDetail(opp)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openDetail(opp);
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

                      {/* Gold fee % */}
                      <span className="text-right font-mono text-xs text-muted-foreground">
                        {(opp.gold_fee_fraction * 100).toFixed(2)}%
                      </span>

                      {/* Gold fee actual */}
                      <span className="text-right font-mono text-xs text-muted-foreground">
                        {fmt(opp.gold_fee_actual, 0)}
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
                {filteredOpportunities.length > perPage && (
                  <div className="mt-3">
                    <Pagination
                      page={page}
                      totalPages={totalPages}
                      totalItems={filteredOpportunities.length}
                      perPage={perPage}
                      onPageChange={setPage}
                      onPerPageChange={() => {}}
                      perPageOptions={[25]}
                    />
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ---- Detail Dialog ---- */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" aria-hidden="true" />
              {t("flipsDetailTitle", { "0": selectedFlip?.currency ?? "" })}
            </DialogTitle>
          </DialogHeader>

          {selectedFlip && (
            <div className="space-y-4">
              {/* Score & Spread */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">{t("flipperScore")}</p>
                  <p className={`text-lg font-bold ${scoreColor(selectedFlip.score)}`}>
                    {(selectedFlip.score * 100).toFixed(1)}%
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">{t("flipperSpread")}</p>
                  <p className="text-lg font-bold font-mono">
                    {(selectedFlip.spread_after_fees * 100).toFixed(2)}%
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">{t("flipsFeeFraction")}</p>
                  <p className="text-lg font-bold font-mono">
                    {(selectedFlip.gold_fee_fraction * 100).toFixed(2)}%
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">{t("flipperGoldFee")}</p>
                  <p className="text-lg font-bold font-mono">
                    {fmt(selectedFlip.gold_fee_actual, 0)}
                  </p>
                </div>
              </div>

              {/* Momentum, Volatility, Cluster */}
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground mb-1">{t("flipperMomentum")}</p>
                  <div className="flex items-center gap-1.5">
                    {momentumIcon(selectedFlip.momentum)}
                    <span className="font-mono text-sm font-medium">
                      {selectedFlip.momentum >= 0 ? "+" : ""}
                      {(selectedFlip.momentum * 100).toFixed(2)}%
                    </span>
                  </div>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground mb-1">{t("flipperVolatility")}</p>
                  <p className="font-mono text-sm font-medium">
                    {selectedFlip.volatility.toFixed(4)}
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground mb-1">{t("flipperCluster")}</p>
                  <Badge
                    variant="outline"
                    className={`text-xs px-2 py-0.5 font-semibold ${clusterBadgeClass(selectedFlip.cluster)}`}
                  >
                    {clusterLabel(selectedFlip.cluster, t)}
                  </Badge>
                </div>
              </div>

              {/* Prices: Bid / Ask / Mid */}
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">{t("flipsBid")}</p>
                  <p className="text-lg font-bold font-mono">{fmt(selectedFlip.bid)}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">{t("flipsAsk")}</p>
                  <p className="text-lg font-bold font-mono">{fmt(selectedFlip.ask)}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">{t("flipsMid")}</p>
                  <p className="text-lg font-bold font-mono">{fmt(selectedFlip.mid_price)}</p>
                </div>
              </div>

              {/* Volume */}
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">{t("flipperVolume")} (24h)</p>
                <p className="text-lg font-bold font-mono">{selectedFlip.volume_24h.toLocaleString()}</p>
              </div>

              {/* Storage Value Decision */}
              {storageData && (
                <div className="rounded-lg border p-3 space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    {t("forecastStorageValue", { "0": selectedFlip.currency.split("/")[0] })}
                  </p>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium">{t("forecastDecision")}:</span>
                    <Badge
                      variant="outline"
                      className={`text-sm px-3 py-1 font-semibold ${decisionBadgeClass(storageData.decision)}`}
                    >
                      {storageData.decision === "BUY" || storageData.decision === "HOLD" ? (
                        <TrendingUp className="h-4 w-4 mr-1 inline" aria-hidden="true" />
                      ) : storageData.decision === "SELL" || storageData.decision === "CONVERT" ? (
                        <TrendingDown className="h-4 w-4 mr-1 inline" aria-hidden="true" />
                      ) : null}
                      {storageData.decision}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <span className="text-muted-foreground">
                      {t("forecastRatio")}: <span className="font-mono font-medium">{storageData.ratio.toFixed(4)}</span>
                    </span>
                    <span className="text-muted-foreground">
                      {t("forecastNetAfterFees")}: <span className="font-mono font-medium">{storageData.net_value_after_fees.toFixed(4)}</span>
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
});
