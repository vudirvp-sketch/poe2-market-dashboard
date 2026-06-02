// ============================================================================
// Market Heatmap — P2-2: Visual heatmap of 24h price changes + Market Tops
//
// Fetches heatmap data from /api/flipper/heatmap (with POE2Scout fallback).
// Displays currency 24h changes as colored blocks, plus a "Market Tops" list
// showing the top gainers and losers.
// ============================================================================
"use client";

import { useMemo, memo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Grid3x3,
  Trophy,
  AlertTriangle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/lib/i18n";
import { fetchApi } from "@/lib/types";
import { ApiErrorFallback } from "./api-error-fallback";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HeatmapItem {
  currency: string;
  change24h: number;
}

interface MarketHeatmapProps {
  /** Current realm for POE2Scout fallback */
  realm?: string;
  /** Current league for POE2Scout fallback */
  league?: string;
  /** Whether the flipper backend is online */
  backendOnline?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map a 24h change percentage to an HSL color. Green for positive, red for negative. */
function changeToColor(change: number): string {
  if (Math.abs(change) < 0.5) return "hsl(0, 0%, 30%)"; // neutral gray

  // Clamp to [-30, +30] for color mapping
  const clamped = Math.max(-30, Math.min(30, change));
  const intensity = Math.abs(clamped) / 30;

  if (change > 0) {
    // Green hue: 140-160
    const lightness = 55 - intensity * 20; // brighter = more change
    const saturation = 50 + intensity * 40;
    return `hsl(150, ${saturation}%, ${lightness}%)`;
  } else {
    // Red hue: 0-10
    const lightness = 55 - intensity * 20;
    const saturation = 50 + intensity * 40;
    return `hsl(5, ${saturation}%, ${lightness}%)`;
  }
}

/** Map a 24h change to text color (for readability on colored backgrounds) */
function changeToTextColor(change: number): string {
  if (Math.abs(change) < 0.5) return "text-muted-foreground";
  return change > 0 ? "text-emerald-100" : "text-red-100";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const MarketHeatmap = memo(function MarketHeatmap({
  realm,
  league,
  backendOnline,
}: MarketHeatmapProps) {
  const { t } = useI18n();

  // Fetch heatmap data — works both with flipper backend and POE2Scout fallback
  const {
    data: heatmapData,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<HeatmapItem[]>({
    queryKey: ["heatmap", realm, league],
    queryFn: () =>
      fetchApi<HeatmapItem[]>(
        `/api/flipper/heatmap?realm=${realm ?? "poe2"}&league=${league}`,
      ),
    staleTime: 60_000,
    retry: 1,
  });

  // Compute top gainers and losers
  const { topGainers, topLosers } = useMemo(() => {
    if (!heatmapData || heatmapData.length === 0) {
      return { topGainers: [], topLosers: [] };
    }

    const sorted = [...heatmapData].sort((a, b) => b.change24h - a.change24h);
    const gainers = sorted.filter((item) => item.change24h > 0).slice(0, 5);
    const losers = sorted
      .filter((item) => item.change24h < 0)
      .reverse()
      .slice(0, 5);

    return { topGainers: gainers, topLosers: losers };
  }, [heatmapData]);

  // Loading state
  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
            <Grid3x3 className="h-4 w-4" aria-hidden="true" />
            {t("overviewHeatmap")}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0">
          <Skeleton className="h-48 w-full" />
        </CardContent>
      </Card>
    );
  }

  // Error state
  if (isError) {
    return (
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
            <Grid3x3 className="h-4 w-4" aria-hidden="true" />
            {t("overviewHeatmap")}
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

  // No data
  if (!heatmapData || heatmapData.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
            <Grid3x3 className="h-4 w-4" aria-hidden="true" />
            {t("overviewHeatmap")}
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
      {/* ---- Heatmap Grid ---- */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
            <Grid3x3 className="h-4 w-4" aria-hidden="true" />
            {t("overviewHeatmap")}
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            {t("heatmapCurrenciesCount", { "0": heatmapData.length })}
          </p>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0">
          <div className="flex flex-wrap gap-1.5" role="list" aria-label={t("overviewHeatmap")}>
            {heatmapData.map((item) => (
              <div
                key={item.currency}
                className="relative rounded-md px-2 py-1.5 text-center min-w-[70px] transition-transform hover:scale-105"
                style={{ backgroundColor: changeToColor(item.change24h) }}
                role="listitem"
                title={`${item.currency}: ${item.change24h >= 0 ? "+" : ""}${item.change24h.toFixed(1)}%`}
              >
                <div className={`text-[10px] font-medium truncate ${changeToTextColor(item.change24h)}`}>
                  {item.currency}
                </div>
                <div className={`text-xs font-bold ${changeToTextColor(item.change24h)}`}>
                  {item.change24h >= 0 ? "+" : ""}
                  {item.change24h.toFixed(1)}%
                </div>
              </div>
            ))}
          </div>

          {/* Color legend */}
          <div className="flex items-center gap-4 mt-3 text-[10px] text-muted-foreground">
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: "hsl(5, 90%, 35%)" }} />
              <span>-30%</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: "hsl(0, 0%, 30%)" }} />
              <span>0%</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: "hsl(150, 90%, 35%)" }} />
              <span>+30%</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ---- Market Tops ---- */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
            <Trophy className="h-4 w-4" aria-hidden="true" />
            {t("heatmapMarketTops")}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Top Gainers */}
            <div>
              <h4 className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                <TrendingUp className="h-3 w-3 text-emerald-500" aria-hidden="true" />
                {t("heatmapTopGainers")}
              </h4>
              {topGainers.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t("heatmapNoGainers")}</p>
              ) : (
                <div className="space-y-1">
                  {topGainers.map((item, idx) => (
                    <div
                      key={item.currency}
                      className="flex items-center justify-between py-1 px-2 rounded border border-emerald-500/20 bg-emerald-500/5"
                    >
                      <span className="text-xs font-medium">
                        <span className="text-muted-foreground mr-1">#{idx + 1}</span>
                        {item.currency}
                      </span>
                      <Badge
                        variant="outline"
                        className="text-[10px] px-1.5 py-0 border-emerald-500/50 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
                      >
                        +{item.change24h.toFixed(1)}%
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Top Losers */}
            <div>
              <h4 className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                <TrendingDown className="h-3 w-3 text-red-500" aria-hidden="true" />
                {t("heatmapTopLosers")}
              </h4>
              {topLosers.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t("heatmapNoLosers")}</p>
              ) : (
                <div className="space-y-1">
                  {topLosers.map((item, idx) => (
                    <div
                      key={item.currency}
                      className="flex items-center justify-between py-1 px-2 rounded border border-red-500/20 bg-red-500/5"
                    >
                      <span className="text-xs font-medium">
                        <span className="text-muted-foreground mr-1">#{idx + 1}</span>
                        {item.currency}
                      </span>
                      <Badge
                        variant="outline"
                        className="text-[10px] px-1.5 py-0 border-red-500/50 text-red-600 dark:text-red-400 bg-red-500/10"
                      >
                        {item.change24h.toFixed(1)}%
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
});
