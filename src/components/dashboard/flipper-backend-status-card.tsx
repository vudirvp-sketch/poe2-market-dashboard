// ============================================================================
// FlipperBackendStatusCard — Shared backend status indicator + offline,
// degraded, upstream-unreachable, and insufficient-data cards.
// Extracted from flips-tab and currency-graph-tab to
// eliminate duplication.
//
// Four visual states:
//   1. Online + upstream reachable        → green "online"
//   2. Online + upstream DEGRADED         → yellow "upstream unreachable"
//      (backend works, but poe2scout.com is unreachable in user's region)
//   3. Online + insufficient data         → amber "insufficient data"
//      (backend running, but needs more historical data)
//   4. Offline                            → red "offline"
//      (backend process not running)
//
// WebSocket status badge (added):
//   When wsStatus is provided, a small badge next to the backend status
//   shows the current WebSocket connection state: connected (green),
//   connecting (yellow), or disconnected (gray). This gives the user
//   instant feedback on whether live updates are flowing.
//
// Data freshness badge (added):
//   When fetchedAt is provided, a DataFreshnessBadge shows the age of
//   the displayed data: Live (green), Stale data (yellow), Cached data (red).
//   This completes the graceful degradation chain:
//     flipper-proxy → proxyWithFallback() → cache-prepopulator → badge
// ============================================================================
"use client";

import { memo } from "react";
import { AlertTriangle, Circle, Server, RefreshCw, Database, WifiOff, Wifi, WifiHigh, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n";
import type { WebSocketStatus } from "@/hooks/use-websocket";
import { DataFreshnessBadge } from "./data-freshness-badge";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface FlipperBackendStatusCardProps {
  backendOnline: boolean;
  /** Backend is online but upstream API is unreachable (degraded mode) */
  upstreamDegraded?: boolean;
  insufficientData?: boolean;
  /** WebSocket connection status (from use-websocket.ts) */
  wsStatus?: WebSocketStatus;
  /** ISO timestamp when the data was last fetched from the backend */
  fetchedAt?: string | null;
  /** Whether the backend reports data as available */
  dataAvailable?: boolean | null;
  onRefresh?: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const FlipperBackendStatusCard = memo(function FlipperBackendStatusCard({
  backendOnline,
  upstreamDegraded,
  insufficientData,
  wsStatus,
  fetchedAt,
  dataAvailable,
  onRefresh,
}: FlipperBackendStatusCardProps) {
  const { t } = useI18n();

  // Determine the visual status indicator
  const statusColor = backendOnline
    ? upstreamDegraded
      ? "fill-amber-500 text-amber-500"
      : "fill-emerald-500 text-emerald-500"
    : "fill-red-500 text-red-500";

  const statusText = backendOnline
    ? upstreamDegraded
      ? t("flipperBackendDegraded")
      : t("flipperBackendOnline")
    : t("flipperBackendOffline");

  // WebSocket status badge
  const wsBadgeConfig = (() => {
    if (!wsStatus) return null;
    if (wsStatus === "connected") {
      return {
        label: t("wsStatusConnected"),
        badgeText: t("stickyBarWsConnected"),
        className: "border-emerald-500/50 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10",
        icon: <WifiHigh className="h-3 w-3" aria-hidden="true" />,
      };
    }
    if (wsStatus === "connecting") {
      return {
        label: t("wsStatusConnecting"),
        badgeText: t("stickyBarWsConnecting"),
        className: "border-amber-500/50 text-amber-600 dark:text-amber-400 bg-amber-500/10",
        icon: <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />,
      };
    }
    // disconnected
    return {
      label: t("wsStatusDisconnected"),
      badgeText: t("stickyBarWsDisconnected"),
      className: "border-muted-foreground/30 text-muted-foreground bg-muted/10",
      icon: <Wifi className="h-3 w-3" aria-hidden="true" />,
    };
  })();

  return (
    <>
      {/* ---- Backend status + Refresh + WS badge + Freshness badge ---- */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Circle
            className={`h-2.5 w-2.5 ${statusColor}`}
            aria-hidden="true"
          />
          <Server className="h-3 w-3" aria-hidden="true" />
          {statusText}

          {/* WebSocket status badge */}
          {wsBadgeConfig && (
            <Badge
              variant="outline"
              title={wsBadgeConfig.label}
              className={`ml-1.5 text-[10px] px-1.5 py-0 font-semibold ${wsBadgeConfig.className}`}
            >
              {wsBadgeConfig.icon}
              <span className="ml-0.5">{wsBadgeConfig.badgeText}</span>
            </Badge>
          )}

          {/* Data freshness badge — shows Live/Stale/Cached */}
          {backendOnline && fetchedAt && (
            <DataFreshnessBadge
              fetchedAt={fetchedAt}
              dataAvailable={dataAvailable}
              compact
            />
          )}
        </div>

        {backendOnline && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2"
            onClick={onRefresh}
            aria-label={t("refreshData")}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        )}
      </div>

      {/* ---- State 4: Backend OFFLINE (process not running) ---- */}
      {!backendOnline && (
        <Card className="border-red-500/30 bg-red-500/5">
          <CardContent className="flex items-start gap-3 p-4">
            <Server className="h-5 w-5 text-red-500 shrink-0 mt-0.5" aria-hidden="true" />
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

      {/* ---- State 2: Backend ONLINE but UPSTREAM UNREACHABLE ---- */}
      {backendOnline && upstreamDegraded && !insufficientData && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="flex items-start gap-3 p-4">
            <WifiOff className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="text-sm">
              <p className="font-medium text-amber-600 dark:text-amber-400">
                {t("flipperBackendDegradedTitle")}
              </p>
              <p className="text-muted-foreground mt-1">
                {t("flipperBackendDegradedDesc")}
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                {t("flipperBackendDegradedHint")}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ---- State 3: Backend online but INSUFFICIENT DATA ---- */}
      {backendOnline && insufficientData && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="flex items-start gap-3 p-4">
            <Database className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="text-sm">
              <p className="font-medium text-amber-600 dark:text-amber-400">
                {t("flipperBackendInsufficientDataTitle")}
              </p>
              <p className="text-muted-foreground mt-1">
                {t("flipperBackendInsufficientDataDesc")}
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
});
