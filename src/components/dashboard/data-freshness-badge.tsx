// ============================================================================
// DataFreshnessBadge — Per-tab data freshness indicator
//
// Shows a small badge next to the tab content indicating how fresh the
// displayed data is. This is part of the graceful degradation chain:
//
//   Level 1: LIVE   (green)  — data fetched <5 min ago, backend reachable
//   Level 2: STALE  (yellow) — data 5–30 min old, backend may be slow
//   Level 3: CACHED (red)    — data >30 min old or from cache-snapshot.json
//
// Usage:
//   <DataFreshnessBadge fetchedAt={data?.fetchedAt} dataAvailable={data?.dataAvailable} />
//
// The component does NOT fetch data itself — it receives the fetchedAt
// timestamp from the parent component's React Query response.
// ============================================================================
"use client";

import { memo, useMemo } from "react";
import { Clock, AlertTriangle, Database } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FreshnessLevel = "live" | "stale" | "cached";

interface DataFreshnessBadgeProps {
  /** ISO timestamp when the data was last fetched from the backend */
  fetchedAt?: string | null;
  /** Whether the backend reports data as available (false = no real data) */
  dataAvailable?: boolean | null;
  /** If true, the data came from the pre-populated cache snapshot */
  fromCache?: boolean;
  /** Compact mode — even smaller badge for tight spaces */
  compact?: boolean;
}

// ---------------------------------------------------------------------------
// Helper: compute freshness level from timestamp
// ---------------------------------------------------------------------------

const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
const CACHED_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

export function computeFreshness(
  fetchedAt: string | null | undefined,
  dataAvailable: boolean | null | undefined,
  fromCache?: boolean,
): FreshnessLevel {
  // If data is explicitly unavailable, it's cached level
  if (dataAvailable === false) return "cached";
  // If from cache snapshot, always cached
  if (fromCache) return "cached";
  // If no timestamp, can't determine — assume cached
  if (!fetchedAt) return "cached";

  const now = Date.now();
  const fetched = new Date(fetchedAt).getTime();
  if (isNaN(fetched)) return "cached";

  const age = now - fetched;
  if (age < STALE_THRESHOLD_MS) return "live";
  if (age < CACHED_THRESHOLD_MS) return "stale";
  return "cached";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const DataFreshnessBadge = memo(function DataFreshnessBadge({
  fetchedAt,
  dataAvailable,
  fromCache,
  compact,
}: DataFreshnessBadgeProps) {
  const { t } = useI18n();

  const level = useMemo(
    () => computeFreshness(fetchedAt, dataAvailable, fromCache),
    [fetchedAt, dataAvailable, fromCache],
  );

  // Config per level
  const config: Record<FreshnessLevel, {
    icon: React.ReactNode;
    label: string;
    className: string;
  }> = {
    live: {
      icon: <Clock className="h-3 w-3" aria-hidden="true" />,
      label: t("dataFreshnessLive"),
      className:
        "border-emerald-500/50 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10",
    },
    stale: {
      icon: <AlertTriangle className="h-3 w-3" aria-hidden="true" />,
      label: t("dataFreshnessStale"),
      className:
        "border-amber-500/50 text-amber-600 dark:text-amber-400 bg-amber-500/10",
    },
    cached: {
      icon: <Database className="h-3 w-3" aria-hidden="true" />,
      label: t("dataFreshnessCached"),
      className:
        "border-red-500/50 text-red-600 dark:text-red-400 bg-red-500/10",
    },
  };

  const { icon, label, className } = config[level];

  // Format the "fetched X min ago" text
  const ageText = useMemo(() => {
    if (!fetchedAt) return null;
    const fetched = new Date(fetchedAt).getTime();
    if (isNaN(fetched)) return null;
    const ageMin = Math.round((Date.now() - fetched) / 60_000);
    if (ageMin < 1) return t("dataFreshnessJustNow");
    return t("dataFreshnessAgeMinutes", { "0": String(ageMin) });
  }, [fetchedAt, t]);

  if (compact) {
    return (
      <Badge
        variant="outline"
        title={`${label}${ageText ? ` — ${ageText}` : ""}`}
        className={`text-[10px] px-1.5 py-0 font-semibold gap-0.5 ${className}`}
      >
        {icon}
        <span className="ml-0.5">{label}</span>
      </Badge>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Badge
        variant="outline"
        title={`${label}${ageText ? ` — ${ageText}` : ""}`}
        className={`text-[10px] px-1.5 py-0.5 font-semibold gap-0.5 ${className}`}
      >
        {icon}
        <span className="ml-0.5">{label}</span>
      </Badge>
      {ageText && (
        <span className="text-[10px] text-muted-foreground">
          {ageText}
        </span>
      )}
    </div>
  );
});
