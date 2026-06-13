// ============================================================================
// usePriceStream — React hook for SSE price stream from the Flipper backend.
// ============================================================================
//
// Connects to /api/flipper/prices/stream (Next.js proxy → FastAPI SSE).
// When significant price changes are detected (above the configured threshold),
// the hook invalidates relevant React Query caches so the UI updates in
// real-time without manual polling.
//
// Features:
//   - EventSource-based SSE consumption with auto-reconnect
//   - Respects `enabled` and `backendOnline` flags
//   - Configurable invalidation threshold percentage
//   - Graceful degradation when backend is offline
//   - Cleanup on unmount
//   - Connection status tracking: "connecting" | "connected" | "disconnected" | "error"
// ============================================================================

"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { QUERY_KEYS } from "@/components/providers";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PriceStreamStatus = "connecting" | "connected" | "disconnected" | "error";

export interface UsePriceStreamOptions {
  /** Enable/disable the SSE connection (default: true) */
  enabled?: boolean;
  /**
   * External backend online signal (from health polling).
   * When false: SSE connection is closed and no reconnect is attempted.
   * When true (after being false): connection is re-established.
   */
  backendOnline?: boolean;
  /**
   * Minimum percentage change to trigger React Query invalidation.
   * Price updates below this threshold are ignored (default: 0.5).
   */
  invalidationThresholdPct?: number;
}

export interface UsePriceStreamReturn {
  /** Current SSE connection status */
  status: PriceStreamStatus;
  /** Last error message, if any */
  lastError: string | null;
  /** Number of reconnection attempts since last successful connection */
  reconnectCount: number;
}

// ---------------------------------------------------------------------------
// SSE event data shape (from backend routes_sse.py)
// ---------------------------------------------------------------------------

interface SSEPriceUpdate {
  /** Currency pair that changed, e.g. "divine/chaos" */
  pair?: string;
  /** Percentage change from previous price */
  change_pct?: number;
  /** New price value */
  new_price?: number;
  /** Old price value */
  old_price?: number;
  /** Timestamp of the update */
  timestamp?: string;
}

interface SSEErrorEvent {
  /** Error message */
  message: string;
  /** Whether the backend SSE endpoint is unavailable */
  unavailable?: boolean;
}

// ---------------------------------------------------------------------------
// Reconnect constants
// ---------------------------------------------------------------------------

const RECONNECT_BASE_DELAY_MS = 2_000;
const RECONNECT_MAX_DELAY_MS = 30_000;
const MAX_RECONNECT_ATTEMPTS = 10;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePriceStream({
  enabled = true,
  backendOnline,
  invalidationThresholdPct = 0.5,
}: UsePriceStreamOptions = {}): UsePriceStreamReturn {
  const [status, setStatus] = useState<PriceStreamStatus>("disconnected");
  const [lastError, setLastError] = useState<string | null>(null);
  const [reconnectCount, setReconnectCount] = useState(0);

  const queryClient = useQueryClient();

  // Refs to avoid stale closures in event handlers
  const esRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const reconnectCountRef = useRef(0);
  const everConnectedRef = useRef(false);
  const thresholdRef = useRef(invalidationThresholdPct);

  // Keep threshold ref in sync
  thresholdRef.current = invalidationThresholdPct;

  // Track previous backendOnline to detect transitions
  const prevBackendOnlineRef = useRef<boolean | undefined>(backendOnline);

  // Stable ref for connect so effects can call without dep cycles
  const connectRef = useRef<() => void>(() => {});

  // ---------------------------------------------------------------------------
  // Cache invalidation on significant price changes
  // ---------------------------------------------------------------------------

  const invalidateCaches = useCallback(() => {
    // Invalidate price-related queries so the UI shows fresh data
    queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.flipperPrices] });
    queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.flipperFlips] });
    queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.heatmap] });
    queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.flipperTriangular] });
    queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.crossRates] });
    queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.flipperLiquidChain] });
  }, [queryClient]);

  // ---------------------------------------------------------------------------
  // Cleanup helper
  // ---------------------------------------------------------------------------

  const cleanup = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (esRef.current) {
      esRef.current.onopen = null;
      esRef.current.onmessage = null;
      esRef.current.onerror = null;
      esRef.current.close();
      esRef.current = null;
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Connect function
  // ---------------------------------------------------------------------------

  const connect = useCallback(() => {
    if (!enabled || !mountedRef.current) return;

    // Don't connect if backend is known to be offline
    if (backendOnline === false) return;

    // Clean up any existing connection
    cleanup();

    // SSR guard — EventSource is browser-only
    if (typeof window === "undefined") return;

    const url = `/api/flipper/prices/stream?threshold_pct=${thresholdRef.current}`;
    setStatus("connecting");

    try {
      const es = new EventSource(url);
      esRef.current = es;

      es.onopen = () => {
        if (!mountedRef.current) return;
        everConnectedRef.current = true;
        setStatus("connected");
        setReconnectCount(0);
        reconnectCountRef.current = 0;
        setLastError(null);
      };

      es.onmessage = (event) => {
        if (!mountedRef.current) return;
        // SSE messages with no event type are default "message" events
        // The backend may send price updates as default events
        try {
          const data: SSEPriceUpdate = JSON.parse(event.data);
          // Only invalidate if the change exceeds the threshold
          if (
            data.change_pct != null &&
            Math.abs(data.change_pct) >= thresholdRef.current
          ) {
            invalidateCaches();
          }
        } catch {
          // Ignore non-JSON messages (e.g. keep-alive comments)
        }
      };

      // Listen for named "update" events (if backend sends them)
      es.addEventListener("update", (event) => {
        if (!mountedRef.current) return;
        try {
          const data: SSEPriceUpdate = JSON.parse((event as MessageEvent).data);
          if (
            data.change_pct != null &&
            Math.abs(data.change_pct) >= thresholdRef.current
          ) {
            invalidateCaches();
          }
        } catch {
          // Ignore malformed messages
        }
      });

      // Listen for "error" events from the backend SSE stream
      es.addEventListener("error", (event) => {
        if (!mountedRef.current) return;
        try {
          const data: SSEErrorEvent = JSON.parse((event as MessageEvent).data);
          if (data.unavailable) {
            // Backend SSE is not available — don't retry aggressively
            setStatus("error");
            setLastError(data.message);
            cleanup();
            return;
          }
          setLastError(data.message);
        } catch {
          // Ignore malformed error events
        }
      });

      es.onerror = () => {
        if (!mountedRef.current) return;

        // EventSource automatically tries to reconnect, but we manage it
        // manually for better control. Close and schedule a reconnect.
        const wasConnected = everConnectedRef.current;
        cleanup();

        if (!wasConnected) {
          // Never connected successfully — backend SSE is likely not running.
          // Don't spam reconnection attempts.
          setStatus("disconnected");
          return;
        }

        setStatus("disconnected");

        // Schedule reconnect with exponential backoff
        const currentCount = reconnectCountRef.current;
        if (currentCount < MAX_RECONNECT_ATTEMPTS) {
          const delay = Math.min(
            RECONNECT_BASE_DELAY_MS * Math.pow(2, currentCount),
            RECONNECT_MAX_DELAY_MS,
          );
          // Add jitter ±20%
          const jitter = delay * 0.2 * (Math.random() * 2 - 1);
          const finalDelay = Math.max(500, delay + jitter);

          reconnectTimerRef.current = setTimeout(() => {
            if (mountedRef.current) {
              reconnectCountRef.current += 1;
              setReconnectCount(reconnectCountRef.current);
              connectRef.current();
            }
          }, finalDelay);
        }
      };
    } catch {
      setStatus("error");
      setLastError("Failed to create EventSource");
    }
  }, [enabled, backendOnline, cleanup, invalidateCaches]);

  // Keep connectRef in sync
  connectRef.current = connect;

  // ---------------------------------------------------------------------------
  // Effect: Connect on mount / when enabled or backendOnline changes
  // ---------------------------------------------------------------------------

  useEffect(() => {
    mountedRef.current = true;

    if (enabled && backendOnline !== false) {
      connectRef.current();
    }

    return () => {
      mountedRef.current = false;
      cleanup();
    };
  }, [enabled, backendOnline, cleanup]);

  // ---------------------------------------------------------------------------
  // Effect: React to backendOnline transitions
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const prevOnline = prevBackendOnlineRef.current;
    prevBackendOnlineRef.current = backendOnline;

    // Only act on actual transitions (not the initial undefined)
    if (prevOnline === undefined) return;
    if (prevOnline === backendOnline) return;

    if (backendOnline === false) {
      // Backend went offline — close SSE and stop reconnecting
      cleanup();
      setStatus("disconnected");
      setLastError(null);
    } else if (backendOnline === true) {
      // Backend came back online — reset state and reconnect
      setReconnectCount(0);
      reconnectCountRef.current = 0;
      everConnectedRef.current = false;
      connectRef.current();
    }
  }, [backendOnline, cleanup]);

  return { status, lastError, reconnectCount };
}
