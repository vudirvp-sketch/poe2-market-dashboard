// ============================================================================
// Flips Tab — Detailed flip opportunities analysis with scoring, filtering,
// sorting, and per-opportunity detail panel.
//
// This is the DETAILED version of the flip scoring view. The existing
// ArbitrageTab's flipper mode serves as a quick overview; this tab provides
// full detail panels, storage value integration, and cluster-based filtering.
//
// Fix 5.6: Split from 771 lines into 4 files:
//   - flips-helpers.ts     — types + pure helpers
//   - flips-detail-dialog  — detail dialog sub-component
//   - flips-table.tsx      — opportunities table sub-component
//   - flips-tab.tsx        — this file: orchestrator (state, queries, layout)
// ============================================================================
"use client";

import { useState, useMemo, memo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useFlipsQuery, useInvalidateFlips, FLIPS_QUERY_KEY } from "@/hooks/use-flips-query";
import {
  TrendingUp,
  Info,
  Search,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useI18n } from "@/lib/i18n";
import { fetchApi, getFlipperErrorType } from "@/lib/types";
import { FlipperBackendStatusCard } from "./flipper-backend-status-card";
import { useFlipperWebSocket } from "@/hooks/use-websocket";
import { FlipsTable } from "./flips-table";
import { FlipsDetailDialog } from "./flips-detail-dialog";
import {
  type FlipOpportunity,
  type FlipsResponse,
  type StorageValueResponse,
  type SortField,
  type SortDirection,
  scoreColor,
} from "./flips-helpers";

// ---------------------------------------------------------------------------
// Component Props
// ---------------------------------------------------------------------------

interface FlipsTabProps {
  /** Whether the flipper backend is online (checked at dashboard level) */
  backendOnline: boolean;
  /** Backend is online but upstream API is unreachable (degraded mode) */
  upstreamDegraded?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const FlipsTab = memo(function FlipsTab({ backendOnline, upstreamDegraded }: FlipsTabProps) {
  const { t } = useI18n();
  const queryClient = useQueryClient();

  // Fix 10 (POE2-FIX-SPEC): Wire WebSocket for live updates
  const invalidateFlips = useInvalidateFlips();

  useFlipperWebSocket({
    onFlipsUpdate: () => {
      invalidateFlips();
    },
    onAnomaly: () => {
      queryClient.invalidateQueries({ queryKey: ["flipper-anomalies"] });
    },
    enabled: backendOnline,
    backendOnline,  // Graceful degradation: react to health-polling signal
  });

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

  // ---- Fetch flip opportunities (shared query via useFlipsQuery) ----
  const {
    data: flipsData,
    isLoading: flipsLoading,
    isError: flipsError,
    error: flipsErrorObj,
    refetch: refetchFlips,
  } = useFlipsQuery({
    minScore,
    minVolume,
    enabled: backendOnline,
  });

  // ---- Storage value for selected flip (detail dialog) ----
  const { data: storageData } = useQuery<StorageValueResponse>({
    queryKey: ["flipper-storage-value-flips", selectedFlip?.currency],
    queryFn: () => {
      const firstCurrency = selectedFlip?.currency?.split("/")[0] ?? "";
      return fetchApi<StorageValueResponse>(
        `/api/flipper/storage-value/${firstCurrency}`,
      );
    },
    enabled: backendOnline && !!selectedFlip && detailOpen,
    staleTime: 60_000,
    retry: 1,
  });

  // ---- Determine if error is due to insufficient data vs backend offline ----
  const insufficientData =
    flipsError && getFlipperErrorType(flipsErrorObj) === "backend_insufficient_data";

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

  // ---- Summary stats ----
  const avgScore = useMemo(() => {
    if (!filteredOpportunities.length) return 0;
    return filteredOpportunities.reduce((sum, o) => sum + o.score, 0) / filteredOpportunities.length;
  }, [filteredOpportunities]);

  const bestFlip = filteredOpportunities[0] ?? null;

  // ---- Sort handler ----
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
      <FlipperBackendStatusCard
        backendOnline={backendOnline}
        upstreamDegraded={upstreamDegraded}
        insufficientData={insufficientData}
        onRefresh={() => refetchFlips()}
      />

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
                {bestFlip?.currency ?? "\u2014"}
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
                {bestFlip ? (bestFlip.score * 100).toFixed(1) + "%" : "\u2014"}
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
            <Select value={clusterFilter} onValueChange={(v) => { setClusterFilter(v); setPage(1); }}>
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
              onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
              className="pl-7 h-8 text-xs"
            />
          </div>
        </div>
      )}

      {/* ---- Opportunities table ---- */}
      {backendOnline && (
        <FlipsTable
          opportunities={filteredOpportunities}
          isError={flipsError}
          errorObj={flipsErrorObj}
          insufficientData={insufficientData}
          onRetry={() => refetchFlips()}
          sortField={sortField}
          sortDirection={sortDirection}
          onSort={handleSort}
          onRowClick={openDetail}
          page={page}
          perPage={perPage}
          onPageChange={setPage}
        />
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
            <FlipsDetailDialog
              selectedFlip={selectedFlip}
              storageData={storageData}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
});
