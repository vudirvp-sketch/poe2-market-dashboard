// ============================================================================
// usePriceStream — React hook for SSE live price updates
// ============================================================================
//
// Connects to the SSE endpoint /api/flipper/prices/stream and receives
// real-time price change notifications. When a price_update event arrives,
// the hook invalidates the relevant React Query cache entries so that
// components using useQuery hooks automatically refetch fresh data.
//
// Features:
//   - Auto-reconnect via browser EventSource (built-in)
//   - React Query cache invalidation on price changes
//   - Connection status tracking
//   - Graceful degradation: SSE is optional, polling still works
//   - Circuit breaker: stops reconnecting after repeated failures
//   - Respects backendOnline signal from health polling
//
// Architecture:
//   SSE is a complement to the existing polling-based data fetching,
//   NOT a replacement. The dashboard continues to poll via useQuery
//   with staleTime/refetchInterval. SSE adds real-time push for
//   significant price changes, reducing perceived latency between
//   a price change and the UI updating.
// ============================================================================

"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { QUERY_KEYS } from "@/components/providers";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SSEConnectionStatus = "connecting" | "connected" | "disconnected";

export interface PriceChange {
  api_id: string;
  previous_price: number;
  current_price: number;
  change_pct: number;
}

export interface PriceUpdateEvent {
  changed_pairs: PriceChange[];
  total_currencies: number;
  timestamp: string;
  snapshot_age_ms: number;
}

export interface UsePriceStreamOptions {
  /** Whether to enable the SSE connection (default: true) */
  enabled?: boolean;
  /** Minimum price change % to trigger cache invalidation (default: 1.0) */
  invalidationThresholdPct?: number;
  /**
   * External backend online signal (from health polling).
   * When false: SSE will disconnect and not attempt reconnect.
   * When true (after being false): SSE will reconnect.
   */
  backendOnline?: boolean;
  /** SSE stream URL (default: /api/flipper/prices/stream) */
  streamUrl?: string;
}

export interface UsePriceStreamReturn {
  /** Current connection status */
  status: SSEConnectionStatus;
  /** Last received price update event */
  lastUpdate: PriceUpdateEvent | null;
  /** Timestamp of last received update */
  lastUpdateAt: string | null;
  /** Number of reconnection attempts */
  reconnectCount: number;
  /** Manually reconnect */
  reconnect: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_STREAM_URL = "/api/flipper/prices/stream";
const CIRCUIT_BREAKER_THRESHOLD = 5;
const CIRCUIT_BREAKER_WINDOW_MS = 60_000;

// ---------------------------------------------------------------------------
// Query keys that should be invalidated on price changes
// ---------------------------------------------------------------------------

const PRICE_DEPENDENT_QUERY_KEYS = [
  QUERY_KEYS.flipperPrices,
  QUERY_KEYS.flipperFlips,
  QUERY_KEYS.flipperTriangular,
  QUERY_KEYS.flipperOptimalCurrency,
  QUERY_KEYS.flipperTiers,
  QUERY_KEYS.flipperAnomalies,
  QUERY_KEYS.crossRates,
  QUERY_KEYS.flipperBatch,
  QUERY_KEYS.heatmap,
];

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePriceStream({
  enabled = true,
  invalidationThresholdPct = 1.0,
  backendOnline,
  streamUrl = DEFAULT_STREAM_URL,
}: UsePriceStreamOptions = {}): UsePriceStreamReturn {
  const queryClient = useQueryClient();

  const [status, setStatus] = useState<SSEConnectionStatus>("disconnected");
  const [lastUpdate, setLastUpdate] = useState<PriceUpdateEvent | null>(null);
  const [lastUpdateAt, setLastUpdateAt] = useState<string | null>(null);
  const [reconnectCount, setReconnectCount] = useState(0);

  const eventSourceRef = useRef<EventSource | null>(null);
  const mountedRef = useRef(true);
  const failureTimestampsRef = useRef<number[]>([]);

  // Track previous backendOnline value for transitions
  const prevBackendOnlineRef = useRef<boolean | undefined>(backendOnline);
  const reconnectCountRef = useRef(0);

  // ---------------------------------------------------------------------------
  // Circuit breaker
  // ---------------------------------------------------------------------------

  const isCircuitBreakerOpen = useCallback((): boolean => {
    const now = Date.now();
    failureTimestampsRef.current = failureTimestampsRef.current.filter(
      (ts) => now - ts < CIRCUIT_BREAKER_WINDOW_MS
    );
    return failureTimestampsRef.current.length >= CIRCUIT_BREAKER_THRESHOLD;
  }, []);

  const resetCircuitBreaker = useCallback((): void => {
    failureTimestampsRef.current = [];
  }, []);

  // ---------------------------------------------------------------------------
  // Cache invalidation on price changes
  // ---------------------------------------------------------------------------

  const handlePriceUpdate = useCallback(
    (event: PriceUpdateEvent) => {
      // Only invalidate if there are significant changes
      const significantChanges = event.changed_pairs.filter(
        (c) => Math.abs(c.change_pct) >= invalidationThresholdPct
      );

      if (significantChanges.length === 0) return;

      // Invalidate price-dependent queries so they refetch fresh data
      for (const key of PRICE_DEPENDENT_QUERY_KEYS) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }

      // Also invalidate exchange pairs if many currencies changed
      if (significantChanges.length >= 5) {
        queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.exchangePairs] });
        queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.referenceCurrencies] });
      }
    },
    [queryClient, invalidationThresholdPct]
  );

  // ---------------------------------------------------------------------------
  // Connect / Disconnect
  // ---------------------------------------------------------------------------

  const connect = useCallback(() => {
    if (!enabled || !mountedRef.current) return;
    if (backendOnline === false) return;
    if (isCircuitBreakerOpen()) return;

    // Clean up existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.onopen = null;
      eventSourceRef.current.onmessage = null;
      eventSourceRef.current.onerror = null;
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    setStatus("connecting");

    try {
      const es = new EventSource(streamUrl);
      eventSourceRef.current = es;

      es.onopen = () => {
        if (!mountedRef.current) return;
        resetCircuitBreaker();
        setStatus("connected");
        setReconnectCount(0);
        reconnectCountRef.current = 0;
      };

      es.addEventListener("price_update", (event: MessageEvent) => {
        if (!mountedRef.current) return;
        try {
          const data: PriceUpdateEvent = JSON.parse(event.data);
          setLastUpdate(data);
          setLastUpdateAt(data.timestamp);
          handlePriceUpdate(data);
        } catch {
          // Ignore malformed events
        }
      });

      es.addEventListener("heartbeat", () => {
        // Heartbeat just keeps the connection alive — no action needed
      });

      es.onerror = () => {
        if (!mountedRef.current) return;
        setStatus("disconnected");

        // Record failure for circuit breaker
        failureTimestampsRef.current.push(Date.now());

        // EventSource auto-reconnects, but we track the failure count
        reconnectCountRef.current += 1;
        setReconnectCount(reconnectCountRef.current);

        // If circuit breaker is open, close the connection to stop auto-reconnect
        if (isCircuitBreakerOpen()) {
          es.close();
          eventSourceRef.current = null;
        }
      };
    } catch {
      setStatus("disconnected");
    }
  }, [
    enabled,
    streamUrl,
    backendOnline,
    isCircuitBreakerOpen,
    resetCircuitBreaker,
    handlePriceUpdate,
  ]);

  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.onopen = null;
      eventSourceRef.current.onmessage = null;
      eventSourceRef.current.onerror = null;
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setStatus("disconnected");
  }, []);

  // ---------------------------------------------------------------------------
  // React to backendOnline transitions
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const prevOnline = prevBackendOnlineRef.current;
    prevBackendOnlineRef.current = backendOnline;

    if (prevOnline === undefined) return;
    if (prevOnline === backendOnline) return;

    if (backendOnline === false) {
      disconnect();
    } else if (backendOnline === true) {
      resetCircuitBreaker();
      reconnectCountRef.current = 0;
      setReconnectCount(0);
      connect();
    }
  }, [backendOnline, connect, disconnect, resetCircuitBreaker]);

  // ---------------------------------------------------------------------------
  // Connect on mount / enabled change
  // ---------------------------------------------------------------------------

  useEffect(() => {
    mountedRef.current = true;

    if (enabled && backendOnline !== false && !isCircuitBreakerOpen()) {
      connect();
    }

    return () => {
      mountedRef.current = false;
      if (eventSourceRef.current) {
        eventSourceRef.current.onopen = null;
        eventSourceRef.current.onmessage = null;
        eventSourceRef.current.onerror = null;
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [enabled, backendOnline, connect, isCircuitBreakerOpen]);

  // ---------------------------------------------------------------------------
  // Manual reconnect
  // ---------------------------------------------------------------------------

  const reconnect = useCallback(() => {
    resetCircuitBreaker();
    reconnectCountRef.current = 0;
    setReconnectCount(0);
    disconnect();
    connect();
  }, [resetCircuitBreaker, disconnect, connect]);

  return {
    status,
    lastUpdate,
    lastUpdateAt,
    reconnectCount,
    reconnect,
  };
}
