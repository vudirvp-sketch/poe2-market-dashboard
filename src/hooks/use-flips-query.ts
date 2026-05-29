// ============================================================================
// useFlipsQuery — Shared React Query hook for flip opportunities
// ============================================================================
//
// Single Source of Truth for the "flipper-flips" query key and fetcher.
// All components that need flip data MUST use this hook to ensure:
//   1. A single shared React Query cache key
//   2. Consistent staleTime, retry, and refetchInterval
//   3. Proper cache invalidation via FLIPS_QUERY_KEY
//
// Before this hook, three different keys existed:
//   - ["flipper-flips-tab", minScore, minVolume] in flips-tab.tsx
//   - ["flipper-flips", flipMinScore, flipMinVolume] in arbitrage-tab.tsx
//   - ["flipper-flips"] (no params) in flipper-sticky-bar.tsx
//
// This caused three separate HTTP requests for the same endpoint.
// ============================================================================

"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchApi, type FlipsResponse } from "@/lib/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Canonical query key prefix for flip opportunities. */
export const FLIPS_QUERY_KEY = "flipper-flips";

/** Cache TTL for flip opportunities (ms). */
const FLIPS_STALE_TIME = 60_000;

/** Polling interval when WebSocket is unavailable (ms). */
const FLIPS_REFETCH_INTERVAL = 60_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseFlipsQueryOptions {
  /** Minimum score filter (0–1, default 0) */
  minScore?: number;
  /** Minimum 24h volume filter (default 0) */
  minVolume?: number;
  /** Only fetch when this is true (e.g. backendOnline) */
  enabled?: boolean;
  /** Enable polling fallback (default: true — useful when no WS) */
  refetchInterval?: number | false;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useFlipsQuery({
  minScore = 0,
  minVolume = 0,
  enabled = true,
  refetchInterval = FLIPS_REFETCH_INTERVAL,
}: UseFlipsQueryOptions = {}) {
  return useQuery<FlipsResponse>({
    queryKey: [FLIPS_QUERY_KEY, minScore, minVolume],
    queryFn: () =>
      fetchApi<FlipsResponse>("/api/flipper/flips", {
        min_score: String(minScore),
        min_volume: String(minVolume),
      }),
    enabled,
    staleTime: FLIPS_STALE_TIME,
    refetchInterval,
    retry: 1,
  });
}

// ---------------------------------------------------------------------------
// Invalidation helper
// ---------------------------------------------------------------------------

/**
 * Invalidate all flip opportunity queries regardless of filter params.
 * Use this in WebSocket callbacks to trigger a full refresh.
 */
export function useInvalidateFlips() {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({ queryKey: [FLIPS_QUERY_KEY] });
}
