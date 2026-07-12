// ============================================================================
// Gold Map ROI Tab (P10 Phase 1 MVP, iter 127)
//
// Top-level tab content for the Gold Map ROI feature. Wraps the existing
// /api/flipper/triangular endpoint and passes opportunities to the
// GoldMapRoiCalculator component.
//
// Tab placement: TAB_MAP index 13 (after `mirror-divine-arb`, click-only).
// Refs:
//   - docs/design/P10-gold-map-roi-design.md §5 (placement) + §7 (layout)
//   - docs/MARKET_PLAYBOOK.md §C.8 (Castaway map spec)
//
// Graceful degradation:
//   - backendOffline → offline card with start-backend hint
//   - data_available=false → "no cycles yet" notice (calculator still
//     renders, but with no profitable cycle shown)
//   - fetch error → error card with retry
//   - loading → calculator renders with loading hint
// ============================================================================

"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, MapPin, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { fetchApi, type TriangularResponse } from "@/lib/types";
import { GoldMapRoiCalculator } from "./gold-map-roi-calculator";
import { GoldMapRoiTrendChart } from "./gold-map-roi-trend-chart";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface GoldMapRoiTabProps {
  /** Whether the FastAPI analytics backend is reachable (dashboard-level check). */
  backendOnline: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GoldMapRoiTab({ backendOnline }: GoldMapRoiTabProps) {
  const { t } = useI18n();

  // ---- Query: triangular arbitrage cycles ----
  // 30s staleTime — cycles change every 5 min (snapshot refresh), no need
  // to refetch on every dashboard focus. 45s timeout matches the proxy
  // route's timeout for the heavy Bellman-Ford computation.
  const { data, isLoading, isError, refetch } = useQuery<TriangularResponse>({
    queryKey: ["gold-map-roi-triangular"],
    queryFn: () =>
      fetchApi<TriangularResponse>("/api/flipper/triangular"),
    enabled: backendOnline,
    staleTime: 30_000,
    retry: 1,
  });

  // ---- Render: backend offline ----
  if (!backendOnline) {
    return (
      <Card className="border-amber-500/30" data-testid="gold-map-roi-tab">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <MapPin className="h-5 w-5 text-amber-500" aria-hidden="true" />
            {t("goldMapTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground pt-0 space-y-2">
          <p>{t("goldMapOffline")}</p>
          <p className="text-xs text-muted-foreground/70">
            {t("goldMapOfflineHint")}
          </p>
        </CardContent>
      </Card>
    );
  }

  // ---- Render: error ----
  if (isError) {
    return (
      <Card className="border-red-500/30" data-testid="gold-map-roi-tab">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-5 w-5 text-red-500" aria-hidden="true" />
            {t("goldMapTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground pt-0">
          {t("goldMapError")}
          <Button
            variant="ghost"
            size="sm"
            className="ml-2 h-7"
            onClick={() => refetch()}
            aria-label={t("goldMapRefresh")}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="ml-1 text-xs">{t("goldMapRefresh")}</span>
          </Button>
        </CardContent>
      </Card>
    );
  }

  // ---- Main render: calculator + header ----
  const opportunities = data?.opportunities;
  const dataAvailable = data?.dataAvailable ?? false;

  return (
    <div className="space-y-4" data-testid="gold-map-roi-tab">
      {/* Header card */}
      <Card>
        <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
          <div className="flex flex-col gap-0.5">
            <CardTitle className="flex items-center gap-2 text-base">
              <MapPin className="h-5 w-5 text-violet-500" aria-hidden="true" />
              {t("goldMapTitle")}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {t("goldMapSubtitle")}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-8"
            onClick={() => refetch()}
            aria-label={t("goldMapRefresh")}
            data-testid="gold-map-roi-refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="ml-1 text-xs">{t("goldMapRefresh")}</span>
          </Button>
        </CardHeader>
      </Card>

      {/* "No cycles yet" notice (still render calculator below so user can
          see the inputs + manual gold→Div conversion result). */}
      {backendOnline && !isLoading && !dataAvailable && (
        <Card className="border-amber-500/30">
          <CardContent className="text-sm text-amber-700 dark:text-amber-300 pt-4">
            {t("goldMapNoCyclesYet")}
          </CardContent>
        </Card>
      )}

      {/* Calculator (inputs + result card). Even when no cycles are
          available, the calculator still shows the manual gold→Div step. */}
      <GoldMapRoiCalculator
        opportunities={opportunities}
        isLoading={isLoading}
        isError={isError}
        backendOnline={backendOnline}
      />

      {/* Trend chart (P10 Phase 2, iter 132) — historical best-cycle
          profitability from /api/flipper/triangular/history. Renders
          inside the same backendOnline gate as the calculator. */}
      <GoldMapRoiTrendChart backendOnline={backendOnline} />

      {/* Footer with fetched-at timestamp + cycle count */}
      {data?.fetchedAt && (
        <p className="text-[10px] text-muted-foreground/70">
          {t("goldMapFetchedAt", { 0: new Date(data.fetchedAt).toLocaleString() })}
          {" · "}
          {t("goldMapCycleCount", { 0: data.total ?? 0 })}
        </p>
      )}
    </div>
  );
}
