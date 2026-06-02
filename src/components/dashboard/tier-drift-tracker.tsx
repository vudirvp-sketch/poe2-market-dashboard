// ============================================================================
// Tier Drift Tracker — P3-7
// Fetches /api/flipper/tiers. Shows tier distribution, drift alerts for
// currencies that recently changed tier, and a full currency table.
// ============================================================================
"use client";

import { useMemo, memo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Layers, ArrowUpDown, AlertTriangle, TrendingUp, TrendingDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/lib/i18n";
import { fetchApi, fmt } from "@/lib/types";
import { ApiErrorFallback } from "./api-error-fallback";

// Types (P3-7 specific)

interface CurrencyTier {
  currency: string;
  tier: string;
  price: number;
  change_24h: number;
  tier_history?: { timestamp: string; tier: string }[];
}

interface TiersResponse {
  tiers: CurrencyTier[];
  snapshot_time: string;
  data_available?: boolean;
}

interface TierDriftTrackerProps {
  backendOnline?: boolean;
}

// Helpers

function tierWeight(tier: string): number {
  const m = tier.match(/^T(\d+)/);
  return m ? parseInt(m[1], 10) : 99;
}

const tierColors: Record<string, { badge: string; text: string; dot: string }> = {
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
};

function tierStyle(tier: string) {
  return tierColors[tier] ?? tierColors.T3;
}

function detectDrift(item: CurrencyTier): { from: string; to: string } | null {
  const h = item.tier_history;
  if (!h || h.length < 2) return null;
  const last = h[h.length - 1];
  const prev = h[h.length - 2];
  return last.tier !== prev.tier ? { from: prev.tier, to: last.tier } : null;
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

  // Sort by tier weight, then by price descending
  const sortedTiers = useMemo(() => {
    if (!tiersData?.tiers) return [];
    return [...tiersData.tiers].sort((a, b) => {
      const tw = tierWeight(a.tier) - tierWeight(b.tier);
      return tw !== 0 ? tw : b.price - a.price;
    });
  }, [tiersData?.tiers]);

  // Tier distribution counts
  const distribution = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of sortedTiers) counts[item.tier] = (counts[item.tier] ?? 0) + 1;
    return Object.entries(counts).sort(([a], [b]) => tierWeight(a) - tierWeight(b));
  }, [sortedTiers]);

  // Currencies with recent tier drift
  const driftItems = useMemo(() => sortedTiers
    .map((item) => ({ item, drift: detectDrift(item) }))
    .filter((d) => d.drift !== null) as { item: CurrencyTier; drift: { from: string; to: string } }[],
  [sortedTiers]);

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
        {distribution.map(([tier, count]) => {
          const style = tierStyle(tier);
          return (
            <Card key={tier}>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <span className={`inline-block w-2 h-2 rounded-full ${style.dot}`} />
                  {tier} Currencies
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 pt-0">
                <p className={`text-2xl font-bold ${style.text}`}>{count}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Tier Drift Alerts */}
      {driftItems.length > 0 && (
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
              <ArrowUpDown className="h-4 w-4" aria-hidden="true" />
              Tier Drift — {driftItems.length} Recent Change{driftItems.length > 1 ? "s" : ""}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0">
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {driftItems.map(({ item, drift }) => {
                const upgraded = tierWeight(drift.to) < tierWeight(drift.from);
                const Icon = upgraded ? TrendingUp : TrendingDown;
                return (
                  <div
                    key={item.currency}
                    className={`flex items-center justify-between py-1.5 px-3 rounded border ${
                      upgraded ? "border-emerald-500/20 bg-emerald-500/5" : "border-red-500/20 bg-red-500/5"
                    }`}
                  >
                    <span className="text-xs font-medium flex items-center gap-1.5">
                      <Icon className={`h-3 w-3 ${upgraded ? "text-emerald-500" : "text-red-500"}`} aria-hidden="true" />
                      {item.currency}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Badge variant="outline" className={`text-[9px] px-1 py-0 ${tierStyle(drift.from).badge}`}>
                        {drift.from}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">&rarr;</span>
                      <Badge variant="outline" className={`text-[9px] px-1 py-0 ${tierStyle(drift.to).badge}`}>
                        {drift.to}
                      </Badge>
                    </span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Currency Tier Table */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
            <Layers className="h-4 w-4" aria-hidden="true" />
            All Currencies by Tier
          </CardTitle>
          {tiersData.snapshot_time && (
            <p className="text-[10px] text-muted-foreground mt-1">
              Snapshot: {new Date(tiersData.snapshot_time).toLocaleString()}
            </p>
          )}
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
              const style = tierStyle(item.tier);
              const drift = detectDrift(item);
              return (
                <div
                  key={item.currency}
                  className={`grid grid-cols-[1fr_60px_80px_80px] gap-2 py-1.5 px-2 text-xs border-b border-border/50 hover:bg-muted/20 transition-colors items-center ${
                    drift ? "bg-amber-500/5" : ""
                  }`}
                  role="row"
                >
                  <span className="truncate font-medium flex items-center gap-1">
                    {drift && <ArrowUpDown className="h-3 w-3 text-amber-500 shrink-0" aria-hidden="true" />}
                    {item.currency}
                  </span>
                  <span>
                    <Badge variant="outline" className={`text-[9px] px-1.5 py-0 ${style.badge}`}>
                      {item.tier}
                    </Badge>
                  </span>
                  <span className="text-right font-mono">{fmt(item.price)}</span>
                  <span className="text-right font-mono">
                    <span className={
                      item.change_24h > 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : item.change_24h < 0
                        ? "text-red-600 dark:text-red-400"
                        : "text-muted-foreground"
                    }>
                      {item.change_24h >= 0 ? "+" : ""}{fmt(item.change_24h)}
                    </span>
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
