// ============================================================================
// useBatchQuery — Fetch multiple API endpoints in a single batch request
// ============================================================================
//
// On initial page load, the dashboard needs data from 5-6 different API
// endpoints (health, phase, events, currencies, optimal-currency, prices).
// Each request has HTTP overhead (TCP, proxy middleware, circuit breaker).
//
// This hook consolidates those requests into a single POST /api/flipper/batch
// call, reducing network overhead and improving initial load performance.
//
// Usage:
//   const { results, errors, isLoading } = useBatchQuery({
//     requests: [
//       { id: "health", path: "/api/v1/health" },
//       { id: "phase", path: "/api/v1/phase" },
//       { id: "events", path: "/api/v1/events", params: { active_only: "true" } },
//     ],
//     enabled: flipperBackendOnline,
//   });
//
// The hook populates React Query cache for each sub-request's query key,
// so components using individual useQuery hooks will find the data already
// cached and won't make duplicate requests.
// ============================================================================

"use client";

import { useEffect, useRef, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { QUERY_KEYS } from "@/components/providers";
import type {
  FlipperHealthResponse,
  FlipperPhaseResponse,
  FlipperEventsSummary,
  OptimalCurrencyResponse,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BatchSubRequest {
  /** Client-defined identifier for result lookup */
  id: string;
  /** Backend API path, e.g. "/api/v1/health" */
  path: string;
  /** Optional query parameters */
  params?: Record<string, string>;
}

export interface BatchResponse {
  /** Successful results keyed by sub-request ID */
  results: Record<string, unknown>;
  /** Failed results keyed by sub-request ID */
  errors: Record<string, unknown>;
  /** Total execution time in ms */
  timing_ms: number;
}

export interface UseBatchQueryOptions {
  /** List of sub-requests to batch */
  requests: BatchSubRequest[];
  /** Whether to enable the batch query */
  enabled?: boolean;
  /** Stale time for the batch query itself (default: 30s) */
  staleTime?: number;
  /** Refetch interval for the batch query (default: 30s) */
  refetchInterval?: number | false;
}

export interface UseBatchQueryResult {
  /** Raw batch response */
  data: BatchResponse | undefined;
  /** Whether the batch query is loading */
  isLoading: boolean;
  /** Whether the batch query has an error */
  isError: boolean;
  /** Individual results by sub-request ID */
  results: Record<string, unknown>;
  /** Individual errors by sub-request ID */
  errors: Record<string, unknown>;
  /** Refetch the batch query */
  refetch: () => void;
}

// ---------------------------------------------------------------------------
// Query key for batch requests
// ---------------------------------------------------------------------------

const BATCH_QUERY_KEY = "flipper-batch";

// ---------------------------------------------------------------------------
// Map batch sub-request IDs to React Query cache keys
// ---------------------------------------------------------------------------

/**
 * Maps a batch sub-request ID to the corresponding React Query cache key.
 * When the batch response arrives, we pre-populate the cache for each
 * sub-request so that components using individual useQuery hooks will
 * find the data already cached.
 */
const BATCH_ID_TO_QUERY_KEY: Record<string, string[]> = {
  health: [QUERY_KEYS.flipperHealth],
  phase: [QUERY_KEYS.flipperPhase],
  events: [QUERY_KEYS.flipperEventsCount],
  optimalCurrency: [QUERY_KEYS.flipperOptimalCurrency],
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useBatchQuery({
  requests,
  enabled = true,
  staleTime = 30_000,
  refetchInterval = 30_000,
}: UseBatchQueryOptions): UseBatchQueryResult {
  const queryClient = useQueryClient();
  const lastPopulatedRef = useRef<string>("");

  // Create a stable query key based on the request IDs
  const requestIdsKey = requests.map((r) => r.id).sort().join(",");

  const { data, isLoading, isError, refetch } = useQuery<BatchResponse>({
    queryKey: [BATCH_QUERY_KEY, requestIdsKey],
    queryFn: async () => {
      const response = await fetch("/api/flipper/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requests }),
      });

      if (!response.ok) {
        throw new Error(`Batch request failed: ${response.status}`);
      }

      return response.json();
    },
    enabled: enabled && requests.length > 0,
    staleTime,
    refetchInterval,
    retry: 1,
  });

  // Populate individual query caches from batch results
  // This allows components using individual useQuery hooks to find
  // data already cached, avoiding duplicate requests.
  useEffect(() => {
    if (!data || !data.results) return;

    // Avoid re-populating cache for the same response
    const resultKey = JSON.stringify(data.results);
    if (resultKey === lastPopulatedRef.current) return;
    lastPopulatedRef.current = resultKey;

    for (const [id, queryKey] of Object.entries(BATCH_ID_TO_QUERY_KEY)) {
      const result = data.results[id];
      if (result !== undefined) {
        // Only set cache if not already fresh (avoid overwriting newer data)
        const currentData = queryClient.getQueryData(queryKey);
        if (currentData === undefined) {
          queryClient.setQueryData(queryKey, result);
        }
      }
    }
  }, [data, queryClient]);

  return {
    data,
    isLoading,
    isError,
    results: data?.results ?? {},
    errors: data?.errors ?? {},
    refetch: () => refetch(),
  };
}

// ---------------------------------------------------------------------------
// Convenience hook: batch the most common initial-load queries
// ---------------------------------------------------------------------------

export interface UseInitialBatchOptions {
  /** Whether the batch query is enabled */
  enabled?: boolean;
}

/**
 * Batch the most common dashboard initial-load queries into a single request.
 *
 * This replaces 5 separate useQuery calls in dashboard-page.tsx:
 *   - flipperHealth → /api/v1/health
 *   - flipperPhase → /api/v1/phase
 *   - flipperEventsCount → /api/v1/events?active_only=true
 *   - flipperOptimalCurrency → /api/v1/arbitrage/optimal-currency
 *
 * Results are populated into the React Query cache so existing useQuery
 * hooks in dashboard-page.tsx consume them without changes.
 */
export function useInitialBatch({ enabled = true }: UseInitialBatchOptions): UseBatchQueryResult {
  return useBatchQuery({
    requests: [
      { id: "health", path: "/api/v1/health" },
      { id: "phase", path: "/api/v1/phase" },
      { id: "events", path: "/api/v1/events", params: { active_only: "true" } },
      { id: "optimalCurrency", path: "/api/v1/arbitrage/optimal-currency" },
    ],
    enabled,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
}
