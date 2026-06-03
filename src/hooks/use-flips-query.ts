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
// Bug 28 fix: Removed minScore/minVolume from the hook interface.
// These were dead parameters that were accepted but never used — they
// didn't affect the queryKey, queryFn, or any filtering. All filtering
// is done by consumers via useMemo in their own components, which is
// the correct pattern (avoids cache fragmentation).
// ============================================================================

"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchApi, type FlipsResponse } from "@/lib/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Canonical query key for flip opportunities. */
export const FLIPS_QUERY_KEY = "flipper-flips";

/** Cache TTL for flip opportunities (ms). */
const FLIPS_STALE_TIME = 60_000;

/** Polling interval when WebSocket is unavailable (ms). */
const FLIPS_REFETCH_INTERVAL = 60_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseFlipsQueryOptions {
  /** Only fetch when this is true (e.g. backendOnline) */
  enabled?: boolean;
  /** Enable polling fallback (default: true — useful when no WS) */
  refetchInterval?: number | false;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useFlipsQuery({
  enabled = true,
  refetchInterval = FLIPS_REFETCH_INTERVAL,
}: UseFlipsQueryOptions = {}) {
  return useQuery<FlipsResponse>({
    queryKey: [FLIPS_QUERY_KEY],
    queryFn: () =>
      fetchApi<FlipsResponse>("/api/flipper/flips"),
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
