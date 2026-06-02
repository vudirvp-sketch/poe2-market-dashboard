// ============================================================================
// Tier Drift Tracker — P3-7
// Fetches /api/flipper/tiers. Shows tier distribution, tier boundary
// thresholds, and a full currency table.
//
// CRITICAL-1: Now uses canonical CurrencyTier / TiersResponse from @/lib/types.
//   - currency → apiId
//   - tier (was string "T1") → tier (number 0-5) for sorting, tierLabel for display
//   - price → relativePrice
//   - change_24h → removed (not in backend); shown as "—"
//   - tier_history → removed (not in backend)
//   - snapshot_time → removed (not in TiersResponse)
//   - data_available → dataAvailable
//   - boundaries from TiersResponse now displayed
// ============================================================================
"use client";

import { useMemo, memo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Layers, ArrowUpDown, AlertTriangle, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/lib/i18n";
import { fetchApi, fmt, type CurrencyTier, type TiersResponse } from "@/lib/types";
import { ApiErrorFallback } from "./api-error-fallback";

interface TierDriftTrackerProps {
  backendOnline?: boolean;
}

// Helpers

const tierColors: Record<string, { badge: string; text: string; dot: string }> = {
  T0: {
    badge: "border-blue-500/50 text-blue-600 dark:text-blue-400 bg-blue-500/10",
    text: "text-blue-600 dark:text-blue-400",
    dot: "bg-blue-500",
  },
  T1: {
    badge: "border-emerald-500/50 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10",
    text: "text-emerald-600 dark:text-emerald-400",
    dot: "bg-emerald-500",
  },
  T2: {
    badge: "border-amber-500/50 text-amber-600 dark:text-amber-400 bg-amber-500/10",
    text: "text-amber-600 dark:text-amber-400",
    dot: "bg-amber-500",
  },
  T3: {
    badge: "border-red-500/50 text-red-600 dark:text-red-400 bg-red-500/10",
    text: "text-red-600 dark:text-red-400",
    dot: "bg-red-500",
  },
  T4: {
    badge: "border-purple-500/50 text-purple-600 dark:text-purple-400 bg-purple-500/10",
    text: "text-purple-600 dark:text-purple-400",
    dot: "bg-purple-500",
  },
  T5: {
    badge: "border-gray-500/50 text-gray-600 dark:text-gray-400 bg-gray-500/10",
    text: "text-gray-600 dark:text-gray-400",
    dot: "bg-gray-500",
  },
};

function tierStyle(tierLabel: string) {
  return tierColors[tierLabel] ?? tierColors.T3;
}

// Component

export const TierDriftTracker = memo(function TierDriftTracker({
  backendOnline,
}: TierDriftTrackerProps) {
  const { t } = useI18n();

  const { data: tiersData, isLoading, isError, error, refetch } = useQuery<TiersResponse>({
    queryKey: ["flipperTiers"],
    queryFn: () => fetchApi<TiersResponse>("/api/flipper/tiers"),
    enabled: backendOnline !== false,
    staleTime: 60_000,
    retry: 1,
  });

  // Sort by tier number, then by relativePrice descending
  const sortedTiers = useMemo(() => {
    if (!tiersData?.tiers) return [];
    return [...tiersData.tiers].sort((a, b) => {
      const tw = a.tier - b.tier;
      return tw !== 0 ? tw : b.relativePrice - a.relativePrice;
    });
  }, [tiersData?.tiers]);

  // Tier distribution counts (group by tierLabel)
  const distribution = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of sortedTiers) counts[item.tierLabel] = (counts[item.tierLabel] ?? 0) + 1;
    // Sort by tierLabel: T0, T1, T2, ...
    return Object.entries(counts).sort(([a], [b]) => {
      const numA = parseInt(a.replace("T", ""), 10);
      const numB = parseInt(b.replace("T", ""), 10);
      return numA - numB;
    });
  }, [sortedTiers]);

  // ── Loading ─────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
            <Layers className="h-4 w-4" aria-hidden="true" />
            Tier Drift Tracker
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0">
          <Skeleton className="h-48 w-full" />
        </CardContent>
      </Card>
    );
  }

  // ── Error ───────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
            <Layers className="h-4 w-4" aria-hidden="true" />
            Tier Drift Tracker
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

  // ── No data ─────────────────────────────────────────────────────────────
  if (!tiersData?.tiers || tiersData.tiers.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
            <Layers className="h-4 w-4" aria-hidden="true" />
            Tier Drift Tracker
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0">
          <div className="text-center py-6">
            <AlertTriangle className="h-8 w-8 text-muted-foreground mx-auto mb-2" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">{t("noData")}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Tier Distribution Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {distribution.map(([tierLabel, count]) => {
          const style = tierStyle(tierLabel);
          return (
            <Card key={tierLabel}>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <span className={`inline-block w-2 h-2 rounded-full ${style.dot}`} />
                  {tierLabel} Currencies
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 pt-0">
                <p className={`text-2xl font-bold ${style.text}`}>{count}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Tier Boundaries */}
      {tiersData.boundaries && (
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
              <Layers className="h-4 w-4" aria-hidden="true" />
              Tier Boundary Thresholds
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {Object.entries(tiersData.boundaries).map(([key, value]) => {
                const tierNum = key.replace("t", "").replace("Min", "");
                const label = `T${tierNum}+`;
                const style = tierStyle(`T${tierNum}`);
                return (
                  <div key={key} className="rounded-lg border p-3 text-center">
                    <p className="text-xs text-muted-foreground mb-1">{label} min</p>
                    <p className={`text-lg font-bold font-mono ${style.text}`}>
                      {fmt(value)}
                    </p>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Historical drift note */}
      <Card className="border-blue-500/30 bg-blue-500/5">
        <CardContent className="flex items-start gap-3 p-4">
          <Info className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="text-sm">
            <p className="text-muted-foreground">
              Historical tier drift requires backend time-series data (not yet available).
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Currency Tier Table */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
            <Layers className="h-4 w-4" aria-hidden="true" />
            All Currencies by Tier
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0">
          <div className="max-h-96 overflow-y-auto" role="table" aria-label="Currency tiers">
            <div
              className="grid grid-cols-[1fr_60px_80px_80px] gap-2 py-2 px-2 text-xs font-medium text-muted-foreground border-b border-border sticky top-0 bg-card z-10"
              role="row"
            >
              <span role="columnheader">Currency</span>
              <span role="columnheader">Tier</span>
              <span role="columnheader" className="text-right">Price</span>
              <span role="columnheader" className="text-right">24h Change</span>
            </div>
            {sortedTiers.map((item) => {
              const style = tierStyle(item.tierLabel);
              return (
                <div
                  key={item.apiId}
                  className="grid grid-cols-[1fr_60px_80px_80px] gap-2 py-1.5 px-2 text-xs border-b border-border/50 hover:bg-muted/20 transition-colors items-center"
                  role="row"
                >
                  <span className="truncate font-medium">
                    {item.apiId}
                  </span>
                  <span>
                    <Badge variant="outline" className={`text-[9px] px-1.5 py-0 ${style.badge}`}>
                      {item.tierLabel}
                    </Badge>
                  </span>
                  <span className="text-right font-mono">{fmt(item.relativePrice)}</span>
                  <span className="text-right font-mono text-muted-foreground">
                    —
                  </span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
});
