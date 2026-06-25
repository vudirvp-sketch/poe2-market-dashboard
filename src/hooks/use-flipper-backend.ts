// ============================================================================
// useFlipperBackend — Shared hook for flipper backend dashboard-level queries
// ============================================================================
//
// Stage 1 of the useDashboardData hook extraction (iter 81, deferred from
// P2-1). See STATUS.md "Technical-debt backlog" for the staged plan.
//
// Single Source of Truth for the three dashboard-level flipper backend
// queries that used to live inline in dashboard-page.tsx:
//   1. /api/flipper/health      → flipperHealthData (status ok|degraded|down)
//   2. /api/flipper/phase        → flipperPhaseData (current league phase)
//   3. /api/flipper/events       → flipperEventsData (active events count)
//
// Derived flags (computed once, returned for consumers):
//   - flipperBackendOnline:  health is "ok" or "degraded" (cached data
//                            may still be served when "degraded").
//   - flipperUpstreamReachable: health.provider === "reachable" — used by
//                                sticky bar / liquid chain to show the
//                                "upstream degraded" notice.
//   - activeEventsCount:     flipperEventsData?.total ?? 0.
//
// All query keys go through QUERY_KEYS to prevent cache fragmentation.
// The phase and events queries are gated on `flipperBackendOnline` so they
// do NOT fire when the backend is offline (matches the prior inline
// behaviour exactly).
//
// Future stages (NOT in this hook):
//   - Stage 2: realms/leagues queries
//   - Stage 3: derived memos (exchangePairs filter, optimalPayment merge,
//              optimalPaymentByDisplayName, currencyCategories, …)
// ============================================================================

"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchApi } from "@/lib/types";
import type {
  FlipperHealthResponse,
  FlipperPhaseResponse,
  FlipperEventsSummary,
} from "@/lib/types";
import { QUERY_KEYS } from "@/components/providers";

export interface UseFlipperBackendResult {
  /** Raw health response (undefined while loading). */
  flipperHealthData?: FlipperHealthResponse;
  /** True while the initial health probe is in flight. */
  flipperHealthPending: boolean;
  /** True if the health probe errored (ECONNREFUSED, 5xx, etc.). */
  flipperHealthError: boolean;
  /** Backend is reachable AND in "ok" or "degraded" state. */
  flipperBackendOnline: boolean;
  /** Upstream poe2scout.com is reachable (health.provider === "reachable"). */
  flipperUpstreamReachable: boolean;
  /** Phase info for the header badge (undefined while loading or offline). */
  flipperPhaseData?: FlipperPhaseResponse;
  /** Active events summary (undefined while loading or offline). */
  flipperEventsData?: FlipperEventsSummary;
  /** Number of currently active events (0 when offline / loading). */
  activeEventsCount: number;
}

/**
 * Dashboard-level flipper backend status.
 *
 * Wraps three `useQuery` calls (health / phase / events) and derives the
 * online + upstream flags + active events count. Consumers should use this
 * hook instead of inlining the queries so the cache keys stay unified.
 */
export function useFlipperBackend(): UseFlipperBackendResult {
  // --- Health check (always runs — needed to detect "offline") ---
  const {
    data: flipperHealthData,
    isError: flipperHealthError,
    isPending: flipperHealthPending,
  } = useQuery<FlipperHealthResponse>({
    queryKey: [QUERY_KEYS.flipperHealth],
    queryFn: () => fetchApi<FlipperHealthResponse>("/api/flipper/health"),
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: 2, // P1-2: retry health checks (was retry: false)
    retryDelay: 3000, // P1-2: 3s between retries
  });

  // Backend is "online" when it responds with "ok" OR "degraded".
  // "degraded" means the backend is running but upstream API (poe2scout.com)
  // is unreachable — the backend can still serve cached/stale data.
  // Only truly "offline" when we can't reach the backend at all (ECONNREFUSED).
  const flipperBackendOnline =
    !flipperHealthError &&
    (flipperHealthData?.status === "ok" ||
      flipperHealthData?.status === "degraded");

  // Additional flag: is upstream API reachable? (for degraded status card)
  const flipperUpstreamReachable = flipperHealthData?.provider === "reachable";

  // --- Phase info (only when backend online — avoids 503 spam) ---
  const { data: flipperPhaseData } = useQuery<FlipperPhaseResponse>({
    queryKey: [QUERY_KEYS.flipperPhase],
    queryFn: () => fetchApi<FlipperPhaseResponse>("/api/flipper/phase"),
    enabled: flipperBackendOnline,
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: 1,
  });

  // --- Events count (only when backend online — header indicator) ---
  const { data: flipperEventsData } = useQuery<FlipperEventsSummary>({
    queryKey: [QUERY_KEYS.flipperEventsCount],
    queryFn: () =>
      fetchApi<FlipperEventsSummary>("/api/flipper/events", {
        active_only: "true",
      }),
    enabled: flipperBackendOnline,
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: 1,
  });

  const activeEventsCount = flipperEventsData?.total ?? 0;

  return {
    flipperHealthData,
    flipperHealthPending,
    flipperHealthError,
    flipperBackendOnline,
    flipperUpstreamReachable,
    flipperPhaseData,
    flipperEventsData,
    activeEventsCount,
  };
}
