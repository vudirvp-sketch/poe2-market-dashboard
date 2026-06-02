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
// Bug 2.4 fix: minScore/minVolume are NO LONGER part of the queryKey.
// The hook always fetches the full unfiltered dataset from the backend.
// Filtering by minScore/minVolume is done client-side by consumers.
//
// Why: Including minScore/minVolume in the queryKey caused cache fragmentation
// — different filter values produced separate cache entries and separate HTTP
// requests for the same endpoint. By removing them from the queryKey, all
// consumers share a single cached response, and filtering is purely local.
// ============================================================================

"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchApi, type FlipsResponse } from "@/lib/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Canonical query key for flip opportunities.
 *  Bug 2.4: No longer includes minScore/minVolume — single shared cache. */
export const FLIPS_QUERY_KEY = "flipper-flips";

/** Cache TTL for flip opportunities (ms). */
const FLIPS_STALE_TIME = 60_000;

/** Polling interval when WebSocket is unavailable (ms). */
const FLIPS_REFETCH_INTERVAL = 60_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseFlipsQueryOptions {
  /** Minimum score filter (0–1, default 0).
   *  NOTE: This is applied client-side only, NOT sent to the API.
   *  Kept for backward compatibility but does NOT affect the queryKey.
   *  Consumers should prefer filtering the response data directly. */
  minScore?: number;
  /** Minimum 24h volume filter (default 0).
   *  NOTE: This is applied client-side only, NOT sent to the API.
   *  Kept for backward compatibility but does NOT affect the queryKey.
   *  Consumers should prefer filtering the response data directly. */
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
    // Bug 2.4: queryKey does NOT include minScore/minVolume.
    // This ensures a single shared cache for all consumers.
    queryKey: [FLIPS_QUERY_KEY],
    queryFn: () =>
      fetchApi<FlipsResponse>("/api/flipper/flips"),
    enabled,
    staleTime: FLIPS_STALE_TIME,
    refetchInterval,
    retry: 1,
    // Client-side filtering is done by consumers via useMemo.
    // minScore/minVolume are kept as params for API compatibility but
    // not included in the queryKey to avoid cache fragmentation.
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
