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
//
// P0-1 fix (iter 55): Backend now sends one event per changed currency
// with all fields populated.  Previously the backend sent a bulk
// {type, changes_count, changes: [{api_id, price}], timestamp} payload
// that never included change_pct, causing cache invalidation to never fire.
// ---------------------------------------------------------------------------

interface SSEPriceUpdate {
  /** Currency api_id that changed, e.g. "divine" or "exalted" */
  pair: string;
  /** Percentage change from previous price */
  change_pct: number;
  /** New price value */
  new_price: number;
  /** Old price value */
  old_price: number;
  /** Unix timestamp (seconds) of the update */
  timestamp: number;
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

  // Keep threshold ref in sync (iter 114 — KI-24 refs fix).
  // Was: `thresholdRef.current = invalidationThresholdPct;` written during
  // render. `react-hooks/refs` forbids ref writes during render because React
  // Compiler cannot optimize them and they may break concurrent rendering.
  // The ref is only read inside SSE event handlers (es.onmessage,
  // es.addEventListener("update")) and inside `connect()` — all of which fire
  // AFTER render — so deferring the sync to a passive effect is semantically
  // equivalent. Effect declaration order matters: this effect is declared
  // BEFORE the connect-on-mount effect below, so the ref is updated before
  // any consumer reads it.
  useEffect(() => {
    thresholdRef.current = invalidationThresholdPct;
  }, [invalidationThresholdPct]);

  // Track previous backendOnline to detect transitions
  const prevBackendOnlineRef = useRef<boolean | undefined>(backendOnline);

  // Stable ref for connect so effects can call without dep cycles
  const connectRef = useRef<() => void>(() => {});

  // ---------------------------------------------------------------------------
  // Cache invalidation on significant price changes (P2-7: targeted by pair)
  // ---------------------------------------------------------------------------
  //
  // P2-7 (iter 59): Backend now sends one SSE event per changed currency with
  // a `pair` field (P0-1, iter 55). We use it to do targeted invalidation:
  //
  //   1. Bulk queries that aggregate ALL currencies (`flipperPrices`,
  //      `flipperFlips`, `heatmap`, `flipperTriangular`, `flipperLiquidChain`)
  //      are still invalidated on every qualifying event — a single pair
  //      change affects their aggregate computation.
  //
  //   2. `crossRates` is NO LONGER invalidated. It derives from
  //      `useExchangePairs` (POE2 official API), NOT from flipper prices —
  //      invalidating it on a flipper SSE event was an over-invalidation bug.
  //
  //   3. Per-pair queries (`benchmark`) now use the `pair` field so only the
  //      changed currency's benchmark is invalidated. The currency-card for
  //      that pair (if mounted) refetches; other cards are untouched.
  //
  // This keeps real-time UI updates working for bulk views while avoiding
  // a refetch storm for unrelated per-pair cards on every SSE tick.

  const invalidateCaches = useCallback((pair: string) => {
    if (!pair) {
      // Defensive: skip if backend sent an empty pair field.
      // Bulk invalidation alone is still correct, just less targeted.
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.flipperPrices] });
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.flipperFlips] });
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.heatmap] });
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.flipperTriangular] });
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.flipperLiquidChain] });
      return;
    }

    // Bulk queries (depend on ALL prices — any pair change affects them).
    queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.flipperPrices] });
    queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.flipperFlips] });
    queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.heatmap] });
    queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.flipperTriangular] });
    queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.flipperLiquidChain] });

    // Per-pair queries (P2-7): invalidate just the changed currency.
    // `benchmark` is keyed by apiId which equals the SSE `pair` field.
    // Only the card currently mounted for that pair will refetch.
    queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.benchmark, pair] });

    // NOTE: `crossRates` deliberately omitted — derived from
    // useExchangePairs (POE2 official API), not from flipper prices.
    // NOTE: `itemHistory` / `itemDaily` / `itemOhlcv` deliberately omitted —
    // they are keyed by itemId (different from apiId/pair) and cannot be
    // safely targeted without an apiId→itemId lookup that we don't have.
    // Their own staleTime (2–5 min) provides adequate freshness.
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
        // P0-1 fix (iter 55): Backend now sends one message per changed currency
        // with {pair, change_pct, new_price, old_price, timestamp}.
        try {
          const data: SSEPriceUpdate = JSON.parse(event.data);
          // Only invalidate if the change exceeds the threshold
          if (
            data.change_pct != null &&
            Math.abs(data.change_pct) >= thresholdRef.current
          ) {
            // P2-7 (iter 59): pass pair for targeted per-pair invalidation.
            invalidateCaches(data.pair ?? "");
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
            // P2-7 (iter 59): pass pair for targeted per-pair invalidation.
            invalidateCaches(data.pair ?? "");
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

  // Keep connectRef in sync (iter 114 — KI-24 refs fix).
  // Was: `connectRef.current = connect;` written during render. Same
  // rationale as thresholdRef above: `react-hooks/refs` forbids ref writes
  // during render. `connectRef.current` is only read inside event handlers
  // (es.onerror) and inside the two useEffects below — all fire AFTER render.
  // This sync-effect is declared BEFORE the connect-on-mount effect, so when
  // `connect` identity changes (e.g. `enabled`/`backendOnline` flip), the ref
  // is updated before the connect-on-mount effect runs and calls
  // `connectRef.current()`. When only `connect` changes but
  // `enabled`/`backendOnline` do not, the ref is updated silently and the
  // existing connection stays open — preserving the latest-ref pattern's
  // core purpose (avoid reconnecting on callback identity churn).
  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

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
