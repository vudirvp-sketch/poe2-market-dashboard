// ============================================================================
// Volume & Liquidity Indicators — P2-4
//
// Displays volume metrics and liquidity scores for exchange pairs.
// Uses utility functions from @/lib/utils (computeLiquidityScore, computeVolumeZScore).
// Fetches pair data from POE2Scout API and computes indicators client-side.
// ============================================================================
"use client";

import { useMemo, memo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  Droplets,
  Activity,
  AlertTriangle,
  ArrowUpDown,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { useI18n } from "@/lib/i18n";
import { fetchApi, fmt } from "@/lib/types";
import type { ExchangePair } from "@/lib/types";
import { computeLiquidityScore, computeVolumeZScore } from "@/lib/utils";
import { ApiErrorFallback } from "./api-error-fallback";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface VolumeLiquidityIndicatorsProps {
  realm?: string;
  league?: string;
  backendOnline?: boolean;
}

interface PairLiquidityData {
  id: string;
  name: string;
  volume: number;
  liquidityScore: number;
  volumeZScore: number | null;
  relativePrice: number | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const VolumeLiquidityIndicators = memo(function VolumeLiquidityIndicators({
  realm,
  league,
}: VolumeLiquidityIndicatorsProps) {
  const { t } = useI18n();
  const [sortField, setSortField] = useState<"volume" | "liquidity" | "zScore">("volume");
  const [sortDirection, setSortDirection] = useState<"desc" | "asc">("desc");

  // Fetch exchange pairs
  const {
    data: pairs,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<ExchangePair[]>({
    queryKey: ["exchangePairs", realm, league],
    queryFn: () =>
      fetchApi<ExchangePair[]>("/api/poe2/exchange", {
        realm: realm ?? "",
        league: league ?? "",
        action: "pairs",
      }),
    enabled: !!realm && !!league,
    staleTime: 60_000,
    retry: 1,
  });

  // Compute liquidity data for each pair
  const liquidityData = useMemo((): PairLiquidityData[] => {
    if (!pairs) return [];

    // Compute rolling volume statistics for z-score
    const volumes = pairs
      .map((p) => p.volume ?? 0)
      .filter((v) => v > 0);
    const meanVolume = volumes.length > 0
      ? volumes.reduce((a, b) => a + b, 0) / volumes.length
      : 0;
    const stdVolume = volumes.length > 1
      ? Math.sqrt(volumes.reduce((sum, v) => sum + (v - meanVolume) ** 2, 0) / (volumes.length - 1))
      : 0;

    return pairs
      .map((pair) => {
        const volume = pair.volume ?? 0;
        // We don't have HighestStock in the ExchangePair type, approximate liquidity
        // using volume alone (higher volume = more liquid)
        const liquidityScore = volume > 0 ? Math.min(1.0, Math.log1p(volume) / Math.log1p(10000)) : 0;
        const volumeZScore = meanVolume > 0 && stdVolume > 0
          ? computeVolumeZScore(volume, meanVolume, stdVolume)
          : null;

        return {
          id: pair.id,
          name: `${pair.currency1Name}/${pair.currency2Name}`,
          volume,
          liquidityScore,
          volumeZScore,
          relativePrice: pair.relativePrice,
        };
      })
      .filter((d) => d.volume > 0);
  }, [pairs]);

  // Sort data
  const sortedData = useMemo(() => {
    const sorted = [...liquidityData];
    sorted.sort((a, b) => {
      let aVal: number;
      let bVal: number;
      switch (sortField) {
        case "volume":
          aVal = a.volume;
          bVal = b.volume;
          break;
        case "liquidity":
          aVal = a.liquidityScore;
          bVal = b.liquidityScore;
          break;
        case "zScore":
          aVal = Math.abs(a.volumeZScore ?? 0);
          bVal = Math.abs(b.volumeZScore ?? 0);
          break;
        default:
          aVal = a.volume;
          bVal = b.volume;
      }
      return sortDirection === "desc" ? bVal - aVal : aVal - bVal;
    });
    return sorted.slice(0, 20); // Show top 20
  }, [liquidityData, sortField, sortDirection]);

  // Chart data (top 15 by selected sort)
  const chartData = useMemo(() => {
    return sortedData.slice(0, 15).map((d) => ({
      name: d.name.length > 15 ? d.name.slice(0, 13) + "…" : d.name,
      volume: d.volume,
      liquidity: Math.round(d.liquidityScore * 100),
      zScore: d.volumeZScore ? Number(d.volumeZScore.toFixed(2)) : 0,
    }));
  }, [sortedData]);

  // Aggregate stats
  const avgLiquidity = useMemo(() => {
    if (liquidityData.length === 0) return 0;
    return liquidityData.reduce((sum, d) => sum + d.liquidityScore, 0) / liquidityData.length;
  }, [liquidityData]);

  const highLiquidityCount = useMemo(
    () => liquidityData.filter((d) => d.liquidityScore >= 0.7).length,
    [liquidityData],
  );

  const volumeAnomalies = useMemo(
    () => liquidityData.filter((d) => Math.abs(d.volumeZScore ?? 0) > 2).length,
    [liquidityData],
  );

  // Loading
  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
            <Droplets className="h-4 w-4" aria-hidden="true" />
            Volume & Liquidity
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0">
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }

  // Error
  if (isError) {
    return (
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
            <Droplets className="h-4 w-4" aria-hidden="true" />
            Volume & Liquidity
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0">
          <ApiErrorFallback
            error={error instanceof Error ? error : String(error ?? "")}
            onRetry={() => refetch()}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* ---- Summary stats ---- */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <BarChart3 className="h-3.5 w-3.5" aria-hidden="true" />
              Total Pairs
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0">
            <p className="text-2xl font-bold">{liquidityData.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <Droplets className="h-3.5 w-3.5" aria-hidden="true" />
              Avg Liquidity
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0">
            <p className={`text-2xl font-bold ${(avgLiquidity * 100).toFixed(0) >= 50 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
              {(avgLiquidity * 100).toFixed(0)}%
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              High Liquidity Pairs
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0">
            <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
              {highLiquidityCount}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              score &ge; 70%
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <Activity className="h-3.5 w-3.5" aria-hidden="true" />
              Volume Anomalies
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0">
            <p className={`text-2xl font-bold ${volumeAnomalies > 0 ? "text-amber-600 dark:text-amber-400" : ""}`}>
              {volumeAnomalies}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              z-score &gt; 2
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ---- Volume & Liquidity Chart ---- */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
              <BarChart3 className="h-4 w-4" aria-hidden="true" />
              Volume & Liquidity — Top 15 Pairs
            </CardTitle>
            <div className="flex items-center gap-2">
              <button
                className={`text-xs px-2 py-1 rounded ${sortField === "volume" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => { setSortField("volume"); setSortDirection("desc"); }}
              >
                Volume
              </button>
              <button
                className={`text-xs px-2 py-1 rounded ${sortField === "liquidity" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => { setSortField("liquidity"); setSortDirection("desc"); }}
              >
                Liquidity
              </button>
              <button
                className={`text-xs px-2 py-1 rounded ${sortField === "zScore" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => { setSortField("zScore"); setSortDirection("desc"); }}
              >
                Anomaly
              </button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0">
          {chartData.length === 0 ? (
            <div className="text-center py-6">
              <AlertTriangle className="h-8 w-8 text-muted-foreground mx-auto mb-2" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">{t("noData")}</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 9 }}
                  interval={0}
                  angle={-35}
                  textAnchor="end"
                  height={60}
                />
                <YAxis yAxisId="volume" tick={{ fontSize: 10 }} width={60} />
                <YAxis yAxisId="liquidity" orientation="right" tick={{ fontSize: 10 }} width={50} domain={[0, 100]} />
                <Tooltip
                  contentStyle={{
                    fontSize: 11,
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                  }}
                />
                <Bar yAxisId="volume" dataKey="volume" fill="#6366f1" radius={[4, 4, 0, 0]} name="Volume" />
                <Bar yAxisId="liquidity" dataKey="liquidity" radius={[4, 4, 0, 0]} name="Liquidity %">
                  {chartData.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={
                        entry.liquidity >= 70
                          ? "#10b981"
                          : entry.liquidity >= 40
                          ? "#f59e0b"
                          : "#ef4444"
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* ---- Detailed table ---- */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm font-semibold">Detailed Liquidity Data</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0">
          <div className="max-h-64 overflow-y-auto" role="table" aria-label="Volume & Liquidity data">
            {/* Header */}
            <div
              className="grid grid-cols-[1.5fr_80px_80px_80px_80px] gap-2 py-2 px-2 text-xs font-medium text-muted-foreground border-b border-border sticky top-0 bg-card z-10"
              role="row"
            >
              <span role="columnheader">Pair</span>
              <span role="columnheader" className="text-right">Volume</span>
              <span role="columnheader" className="text-right">Liquidity</span>
              <span role="columnheader" className="text-right">Z-Score</span>
              <span role="columnheader" className="text-right">Status</span>
            </div>
            {/* Body */}
            {sortedData.map((d) => (
              <div
                key={d.id}
                className="grid grid-cols-[1.5fr_80px_80px_80px_80px] gap-2 py-1.5 px-2 text-xs border-b border-border/50 hover:bg-muted/20 transition-colors items-center"
                role="row"
              >
                <span className="truncate font-medium">{d.name}</span>
                <span className="text-right font-mono">{d.volume.toLocaleString()}</span>
                <span className="text-right font-mono">
                  <span className={
                    d.liquidityScore >= 0.7
                      ? "text-emerald-600 dark:text-emerald-400"
                      : d.liquidityScore >= 0.4
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-red-600 dark:text-red-400"
                  }>
                    {(d.liquidityScore * 100).toFixed(0)}%
                  </span>
                </span>
                <span className="text-right font-mono">
                  {d.volumeZScore !== null ? (
                    <span className={Math.abs(d.volumeZScore) > 2 ? "text-amber-600 dark:text-amber-400 font-bold" : ""}>
                      {d.volumeZScore.toFixed(2)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </span>
                <span className="text-right">
                  {d.liquidityScore >= 0.7 ? (
                    <Badge variant="outline" className="text-[9px] px-1 py-0 border-emerald-500/50 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10">
                      Liquid
                    </Badge>
                  ) : d.liquidityScore >= 0.4 ? (
                    <Badge variant="outline" className="text-[9px] px-1 py-0 border-amber-500/50 text-amber-600 dark:text-amber-400 bg-amber-500/10">
                      Moderate
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[9px] px-1 py-0 border-red-500/50 text-red-600 dark:text-red-400 bg-red-500/10">
                      Illiquid
                    </Badge>
                  )}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
});
