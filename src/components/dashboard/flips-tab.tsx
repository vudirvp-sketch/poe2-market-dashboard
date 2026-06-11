// ============================================================================
// Flips Tab — Unified flip opportunities + triangular arbitrage analysis
//
// Merged from arbitrage-tab.tsx + flips-tab.tsx (iteration 34).
// The old ArbitrageTab was a "quick overview" that duplicated the same
// API calls and warnings as FlipsTab. Now this single tab provides:
//   - Stats overview (scored flips, triangular cycles, phase, avg score)
//   - Disclaimer card
//   - Rich filter/sort/search for scored flips
//   - Detail dialog with storage value integration
//   - Triangular arbitrage cycles section
//   - WebSocket live updates
//   - Tier drift tracker (below flips section)
//
// Fix 5.6: Split from 771 lines into helper files:
//   - flips-helpers.ts      — types + pure helpers
//   - flips-detail-dialog   — detail dialog sub-component
//   - flips-table.tsx       — opportunities table sub-component
//   - flips-tab.tsx         — this file: orchestrator (state, queries, layout)
// ============================================================================
"use client";

import { useState, useMemo, memo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useFlipsQuery, useInvalidateFlips } from "@/hooks/use-flips-query";
import {
  TrendingUp,
  Info,
  Search,
  AlertTriangle,
  Clock,
  RefreshCw,
  Layers,
  Zap,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FlipsSkeleton } from "@/components/dashboard/skeletons";
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
import type { TriangularResponse, OptimalPaymentResult, FlipperPhaseResponse } from "@/lib/types";
import { FlipperBackendStatusCard } from "./flipper-backend-status-card";
import { useFlipperWebSocket } from "@/hooks/use-websocket";
import { FlipsTable } from "./flips-table";
import { FlipsDetailDialog } from "./flips-detail-dialog";
import { ArbitrageFlipperTriangular } from "./arbitrage-flipper-triangular";
import {
  type FlipOpportunity,
  type FlipsResponse,
  type StorageValueResponse,
  type SortField,
  type SortDirection,
  scoreColor,
} from "./flips-helpers";
import { isFlipDataSuspicious, isFlipsResponseSuspicious } from "@/lib/flipper-helpers";

// ---------------------------------------------------------------------------
// Component Props
// ---------------------------------------------------------------------------

interface FlipsTabProps {
  /** Whether the flipper backend is online (checked at dashboard level) */
  backendOnline: boolean;
  /** Backend is online but upstream API is unreachable (degraded mode) */
  upstreamDegraded?: boolean;
  /** Optimal payment results keyed by display name ("Name1/Name2") */
  optimalPaymentByDisplayName?: Map<string, OptimalPaymentResult>;
  /** Anchor currency ID for premium display */
  anchorId?: string;
  /** Current league name (for phase display) */
  league?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const FlipsTab = memo(function FlipsTab({ backendOnline, upstreamDegraded, optimalPaymentByDisplayName, anchorId, league }: FlipsTabProps) {
  const { t } = useI18n();
  const queryClient = useQueryClient();

  // Fix 10 (POE2-FIX-SPEC): Wire WebSocket for live updates
  const invalidateFlips = useInvalidateFlips();

  useFlipperWebSocket({
    onFlipsUpdate: () => {
      invalidateFlips();
      // Bug 13 fix: Also invalidate triangular data when flips update via WS,
      // since triangular arbitrage uses the same snapshot data.
      queryClient.invalidateQueries({ queryKey: ["flipperTriangular"] });
    },
    onAnomaly: () => {
      queryClient.invalidateQueries({ queryKey: ["flipperAnomalies"] });
    },
    enabled: backendOnline,
    backendOnline,  // Graceful degradation: react to health-polling signal
  });

  // Filter state
  const [minScore, setMinScore] = useState(0);
  const [minVolume, setMinVolume] = useState(0);
  const [minSpread, setMinSpread] = useState(0);
  const [clusterFilter, setClusterFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(false);

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
    enabled: backendOnline,
  });

  // ---- Storage value for selected flip (detail dialog) ----
  const { data: storageData } = useQuery<StorageValueResponse>({
    queryKey: ["flipperStorageValue-flips", selectedFlip?.currency],
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

  // ---- Triangular data (for cross-rate warning + triangular section) ----
  // Bug 13 fix: Added refetchInterval so triangular data auto-refreshes.
  const {
    data: triData,
    isError: triError,
    error: triErrorObj,
    refetch: refetchTri,
  } = useQuery<TriangularResponse>({
    queryKey: ["flipperTriangular"],
    queryFn: () => fetchApi<TriangularResponse>("/api/flipper/triangular"),
    enabled: backendOnline,
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: 1,
  });

  // ---- Flipper phase info (for stats row) ----
  const { data: phaseData } = useQuery<FlipperPhaseResponse>({
    queryKey: ["flipperPhase"],
    queryFn: () => fetchApi<FlipperPhaseResponse>("/api/flipper/phase"),
    enabled: backendOnline,
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

    // Bug 2.4 fix: minScore/minVolume are now filtered client-side
    // (no longer sent to the API to avoid cache fragmentation)
    if (minScore > 0) {
      filtered = filtered.filter((o) => (o.score ?? 0) >= minScore);
    }
    if (minVolume > 0) {
      filtered = filtered.filter((o) => (o.volume24h ?? 0) >= minVolume);
    }

    // Min Spread filter
    if (minSpread > 0) {
      filtered = filtered.filter((o) => (o.spread ?? 0) >= minSpread);
    }

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

    // Sort — P2-1: Support nested quantized fields
    const sorted = [...filtered].sort((a, b) => {
      let aVal: number;
      let bVal: number;

      // Handle quantized sort fields that require nested property access
      switch (sortField) {
        case "qSpread":
          aVal = a.quantizedAnalysis?.optimalLotProfitPct ?? 0;
          bVal = b.quantizedAnalysis?.optimalLotProfitPct ?? 0;
          break;
        case "minLot":
          aVal = a.quantizedAnalysis?.minProfitableLot ?? 0;
          bVal = b.quantizedAnalysis?.minProfitableLot ?? 0;
          break;
        case "brickRisk":
          aVal = a.quantizedAnalysis?.brickResistance ?? 0;
          bVal = b.quantizedAnalysis?.brickResistance ?? 0;
          break;
        case "tierDistance":
          aVal = a.tierDistance ?? 0;
          bVal = b.tierDistance ?? 0;
          break;
        case "premium":
          aVal = optimalPaymentByDisplayName?.get(a.currency)?.savingsPct ?? 0;
          bVal = optimalPaymentByDisplayName?.get(b.currency)?.savingsPct ?? 0;
          break;
        default:
          aVal = (a[sortField] as number) ?? 0;
          bVal = (b[sortField] as number) ?? 0;
      }

      const multiplier = sortDirection === "desc" ? -1 : 1;
      return (aVal - bVal) * multiplier;
    });

    return sorted;
  }, [flipsData, clusterFilter, searchQuery, sortField, sortDirection, minScore, minVolume, minSpread, optimalPaymentByDisplayName]);

  // ---- Summary stats ----
  const avgScore = useMemo(() => {
    if (!filteredOpportunities.length) return 0;
    return filteredOpportunities.reduce((sum, o) => sum + (o.score ?? 0), 0) / filteredOpportunities.length;
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

  // §1.5: Data quality check — detect suspicious flip data
  const dataQuality = useMemo(() => {
    if (!flipsData?.opportunities || flipsData.opportunities.length === 0) {
      return { suspicious: false, reason: "" };
    }
    return isFlipsResponseSuspicious(flipsData.opportunities);
  }, [flipsData?.opportunities]);

  // Auto-refresh every 30 seconds when enabled
  useEffect(() => {
    if (!autoRefresh || !backendOnline) return;
    const interval = setInterval(() => {
      invalidateFlips();
    }, 30_000);
    return () => clearInterval(interval);
  }, [autoRefresh, backendOnline, invalidateFlips]);

  // §0.4: Stale data detection — check if fetched_at is older than 10 minutes
  const [isStale, setIsStale] = useState(false);
  useEffect(() => {
    if (!flipsData?.fetchedAt || !backendOnline) {
      setIsStale(false);
      return;
    }
    const checkStaleness = () => {
      const fetchedTime = new Date(flipsData.fetchedAt).getTime();
      const ageMs = Date.now() - fetchedTime;
      setIsStale(ageMs > 10 * 60 * 1000); // 10 minutes
    };
    checkStaleness();
    const interval = setInterval(checkStaleness, 30_000); // re-check every 30s
    return () => clearInterval(interval);
  }, [flipsData?.fetchedAt, backendOnline]);

  // ---- Loading ----
  if (flipsLoading && backendOnline) {
    return <FlipsSkeleton />;
  }

  return (
    <div className="space-y-4">
      <FlipperBackendStatusCard
        backendOnline={backendOnline}
        upstreamDegraded={upstreamDegraded}
        insufficientData={insufficientData}
        fetchedAt={flipsData?.fetchedAt}
        dataAvailable={flipsData?.dataAvailable}
        onRefresh={() => { refetchFlips(); refetchTri(); }}
      />

      {/* ---- Disclaimer (from old ArbitrageTab) ---- */}
      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardContent className="flex items-start gap-3 p-4">
          <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="text-sm">
            <p className="font-medium text-amber-600 dark:text-amber-400">
              {t("arbitrageTheoretical")}
            </p>
            <p className="text-muted-foreground mt-1">
              {t("arbitrageTheoreticalDesc")}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ---- Cross-rate inconsistency warning ---- */}
      {triData?.crossRateWarning && triData.crossRateWarning.suspiciousTriplesCount > 0 && (
        <Card className="border-red-500/30 bg-red-500/5" role="alert" aria-live="polite">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertTriangle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="text-sm">
              <p className="font-medium text-red-600 dark:text-red-400">
                {t("crossRateWarningTitle")}
              </p>
              <p className="text-muted-foreground mt-1">
                {t("crossRateWarningDesc")}
              </p>
              {triData.crossRateWarning.affectedCurrencies.length > 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  {t("flipperAffectedCurrencies")}: {triData.crossRateWarning.affectedCurrencies.join(", ")}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* §0.4: Data quality warning banner — when flip data looks suspicious */}
      {dataQuality.suspicious && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="text-sm">
              <p className="font-medium text-amber-600 dark:text-amber-400">
                {t("flipsDataQualityWarning")}
              </p>
              <p className="text-muted-foreground mt-1">
                {dataQuality.reason}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* §0.4: Stale data warning — when fetched_at is older than 10 minutes */}
      {isStale && (
        <Card className="border-blue-500/30 bg-blue-500/5" role="alert" aria-live="polite">
          <CardContent className="flex items-start gap-3 p-4">
            <Clock className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="text-sm">
              <p className="font-medium text-blue-600 dark:text-blue-400">
                {t("flipsStaleDataWarning")}
              </p>
              <p className="text-muted-foreground mt-1">
                {flipsData?.fetchedAt
                  ? t("lastUpdatedAt", { "0": new Date(flipsData.fetchedAt).toLocaleTimeString() })
                  : undefined}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ---- Event status banner ---- */}
      {flipsData?.eventStatus?.anyActive && (
        <Card className="border-orange-500/30 bg-orange-500/5">
          <CardContent className="flex items-start gap-3 p-4">
            <Info className="h-5 w-5 text-orange-500 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="text-sm">
              <p className="font-medium text-orange-600 dark:text-orange-400">
                {t("flipperEventActive")}
              </p>
              {flipsData.eventStatus.affectedCurrencies.length > 0 && (
                <p className="text-muted-foreground mt-1">
                  {t("flipperAffectedCurrencies")}:{" "}
                  {flipsData.eventStatus.affectedCurrencies.join(", ")}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ---- Summary stats row (expanded: from old ArbitrageTab + FlipsTab) ---- */}
      {backendOnline && flipsData && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4">
          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />
                {t("flipperScoredFlips")}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-0">
              <p className="text-2xl font-bold">{flipsData.total ?? filteredOpportunities.length}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{t("flipperScoredFlipsDesc")}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5" aria-hidden="true" />
                {t("flipperTriangularCycles")}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-0">
              <p className="text-2xl font-bold">{triData?.total ?? "—"}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{t("flipperTriangularCyclesDesc")}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <Zap className="h-3.5 w-3.5" aria-hidden="true" />
                {t("flipperPhase")}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-0">
              <p className="text-2xl font-bold capitalize">
                {phaseData?.phase ?? league ?? "—"}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">{t("flipperPhaseDesc")}</p>
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

          {/* Min Spread */}
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="flips-min-spread">
              {t("flipperMinSpread") || "Min Spread"}
            </label>
            <Input
              id="flips-min-spread"
              type="number"
              min={0}
              max={1}
              step={0.01}
              value={minSpread}
              onChange={(e) => { setMinSpread(Number(e.target.value) || 0); setPage(1); }}
              className="w-20 h-8 text-xs"
            />
          </div>

          {/* Auto-refresh toggle */}
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="flips-auto-refresh">
              {t("autoRefresh") || "Auto"}
            </label>
            <Button
              id="flips-auto-refresh"
              variant={autoRefresh ? "default" : "outline"}
              size="sm"
              className="h-8 text-xs"
              onClick={() => setAutoRefresh(!autoRefresh)}
            >
              <RefreshCw className={`h-3 w-3 ${autoRefresh ? "animate-spin" : ""}`} />
            </Button>
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

      {/* ---- Scored Flip Opportunities table ---- */}
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
          optimalPaymentByDisplayName={optimalPaymentByDisplayName}
          anchorId={anchorId}
        />
      )}

      {/* ---- Triangular Arbitrage section (from old ArbitrageTab) ---- */}
      {backendOnline && (
        <ArbitrageFlipperTriangular
          triData={triData}
          triError={!!triError}
          triErrorObj={triErrorObj}
          backendOnline={backendOnline}
          upstreamDegraded={upstreamDegraded}
          onRetry={() => refetchTri()}
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
