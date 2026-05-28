// ============================================================================
// FlipperBackendStatusCard — Shared backend status indicator + offline and
// insufficient-data cards. Extracted from flips-tab, portfolio-tab, and
// currency-graph-tab to eliminate duplication.
// ============================================================================
"use client";

import { memo } from "react";
import { AlertTriangle, Circle, Server, RefreshCw, Database } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface FlipperBackendStatusCardProps {
  backendOnline: boolean;
  insufficientData?: boolean;
  onRefresh?: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const FlipperBackendStatusCard = memo(function FlipperBackendStatusCard({
  backendOnline,
  insufficientData,
  onRefresh,
}: FlipperBackendStatusCardProps) {
  const { t } = useI18n();

  return (
    <>
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
            onClick={onRefresh}
            aria-label={t("refreshData")}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        )}
      </div>

      {/* ---- Backend unavailable (offline) ---- */}
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

      {/* ---- Backend online but insufficient data ---- */}
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
