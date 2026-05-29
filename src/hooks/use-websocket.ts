// ============================================================================
// useWebSocket — React hook for WebSocket connections to the Flipper backend
// ============================================================================
//
// Connects directly to the FastAPI backend's WebSocket endpoints
// (/ws/storage-value/{currency}, /ws/forecast/{currency},
//  /ws/anomalies, /ws/flips, /ws/events).
//
// Features:
//   - Auto-reconnect with exponential backoff
//   - Connection status tracking (connecting | connected | disconnected)
//   - Typed message parsing
//   - Cleanup on unmount
//   - Configurable push interval awareness
//   - Generic useFlipperWebSocket for anomalies/flips/events channels
//   - Graceful degradation: respects backendOnline from health polling
//   - Circuit breaker: pauses reconnects after rapid failures
// ============================================================================

"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WebSocketStatus = "connecting" | "connected" | "disconnected";

export interface WSMessage<T = Record<string, unknown>> {
  type: "update" | "error" | "heartbeat";
  data?: T;
  message?: string;
  timestamp?: string;
}

export interface UseWebSocketOptions {
  /** Auto-reconnect on disconnect (default: true) */
  autoReconnect?: boolean;
  /** Maximum reconnect attempts before giving up (default: 10) */
  maxReconnectAttempts?: number;
  /** Base delay in ms for exponential backoff (default: 1000) */
  reconnectBaseDelay?: number;
  /** Maximum delay cap in ms (default: 30000) */
  reconnectMaxDelay?: number;
  /** Enable/disable the hook (default: true) */
  enabled?: boolean;
  /**
   * External backend online signal (from health polling).
   * When false: WS will disconnect and NOT attempt reconnect.
   * When true (after being false): WS will reset reconnect counter
   * and attempt to reconnect.
   */
  backendOnline?: boolean;
}

export interface UseWebSocketReturn<T = Record<string, unknown>> {
  /** Last received data payload (from "update" messages) */
  data: T | null;
  /** Current connection status */
  status: WebSocketStatus;
  /** Last error message (from "error" messages) */
  lastError: string | null;
  /** Number of reconnect attempts since last successful connection */
  reconnectCount: number;
  /** Manually reconnect */
  reconnect: () => void;
  /** Timestamp of the last received update */
  lastUpdateAt: string | null;
}

// ---------------------------------------------------------------------------
// Circuit breaker constants
// ---------------------------------------------------------------------------

/** Number of rapid failures that trigger the circuit breaker */
const CIRCUIT_BREAKER_THRESHOLD = 3;

/** Time window (ms) within which N failures trigger the breaker */
const CIRCUIT_BREAKER_WINDOW_MS = 30_000;

// ---------------------------------------------------------------------------
// Default backend URL — production-aware WebSocket connection
// ---------------------------------------------------------------------------
//
// Connection strategy:
//   1. NEXT_PUBLIC_FLIPPER_WS_URL env var (explicit override)
//   2. If behind a reverse proxy (same-origin), use relative path:
//      ws(s)://current-host/ws/... — this works when nginx/Caddy
//      proxies /ws/* to the backend.
//   3. In dev/without proxy, connect directly to the backend on port 8000.
//
// Production deployment (nginx/Caddy example):
//   location /ws/ {
//       proxy_pass http://127.0.0.1:8000/ws/;
//       proxy_http_version 1.1;
//       proxy_set_header Upgrade $http_upgrade;
//       proxy_set_header Connection "upgrade";
//       proxy_set_header Host $host;
//       proxy_read_timeout 86400;
//   }
//
// Then set in .env.local:
//   NEXT_PUBLIC_FLIPPER_WS_URL=   (empty = auto-detect same-origin)
// Or explicitly:
//   NEXT_PUBLIC_FLIPPER_WS_URL=wss://your-domain.com
// ---------------------------------------------------------------------------

function resolveWsBaseUrl(): string {
  // Fix 4.9: SSR-safe — return empty string during server-side rendering
  if (typeof window === "undefined") {
    return ''; // SSR: no WebSocket connection possible
  }

  // 1. Explicit override from env
  const envUrl = process.env.NEXT_PUBLIC_FLIPPER_WS_URL;
  if (envUrl) return envUrl;

  // 2. Browser-only detection
  if (typeof window !== "undefined") {
    const flipperApiUrl = process.env.NEXT_PUBLIC_FLIPPER_API_URL;

    // If no explicit FLIPPER_API_URL, assume same-origin (reverse proxy)
    if (!flipperApiUrl || flipperApiUrl.includes(window.location.host)) {
      // Same-origin: use current host with ws:/wss: protocol
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      return `${proto}//${window.location.host}`;
    }

    // Dev mode: direct connection to backend on different host/port
    const wsProto = flipperApiUrl.startsWith("https") ? "wss:" : "ws:";
    return `${wsProto}//${flipperApiUrl.replace(/^https?:\/\//, "")}`;
  }

  // 3. Should not reach here due to SSR guard above, but just in case
  return '';
}

// Fix 4.9: Compute WS URL lazily inside the hook instead of at module level.
// This prevents SSR from computing ws://localhost:8000 which persists after hydration.
// const FLIPPER_WS_URL = resolveWsBaseUrl();  // REMOVED

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useWebSocket<T = Record<string, unknown>>(
  path: string,
  options: UseWebSocketOptions = {},
): UseWebSocketReturn<T> {
  const {
    autoReconnect = true,
    maxReconnectAttempts = 10,
    reconnectBaseDelay = 1000,
    reconnectMaxDelay = 30000,
    enabled = true,
    backendOnline,
  } = options;

  const [data, setData] = useState<T | null>(null);
  const [status, setStatus] = useState<WebSocketStatus>("disconnected");
  const [lastError, setLastError] = useState<string | null>(null);
  const [reconnectCount, setReconnectCount] = useState(0);
  const [lastUpdateAt, setLastUpdateAt] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  // Track whether this WebSocket has ever successfully connected.
  // If the very first connection attempt fails with ECONNREFUSED-style
  // errors (code 1006, !wasClean), we know the backend is not running
  // and should NOT retry — retries just produce console spam.
  const everConnectedRef = useRef(false);

  // Circuit breaker: tracks timestamps of recent failures.
  // If N failures happen within the window, we stop reconnecting
  // until backendOnline signals a healthy backend.
  const failureTimestampsRef = useRef<number[]>([]);

  // Track previous backendOnline value to detect transitions
  const prevBackendOnlineRef = useRef<boolean | undefined>(backendOnline);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  // Fix 4.9: Compute WS URL lazily to avoid SSR stale value
  const wsBaseUrl = useMemo(() => resolveWsBaseUrl(), []);

  // ---------------------------------------------------------------------------
  // Circuit breaker check
  // ---------------------------------------------------------------------------

  const isCircuitBreakerOpen = useCallback((): boolean => {
    const now = Date.now();
    // Prune old timestamps outside the window
    failureTimestampsRef.current = failureTimestampsRef.current.filter(
      (ts) => now - ts < CIRCUIT_BREAKER_WINDOW_MS,
    );
    return failureTimestampsRef.current.length >= CIRCUIT_BREAKER_THRESHOLD;
  }, []);

  const recordFailure = useCallback((): void => {
    failureTimestampsRef.current.push(Date.now());
  }, []);

  const resetCircuitBreaker = useCallback((): void => {
    failureTimestampsRef.current = [];
  }, []);

  // ---------------------------------------------------------------------------
  // Graceful degradation: react to backendOnline changes
  // ---------------------------------------------------------------------------
  // When backendOnline transitions:
  //   true → false: close WS, don't try reconnect (backend is down)
  //   false → true: reset reconnect counter, reset circuit breaker,
  //                 and attempt to connect (backend came back up)

  useEffect(() => {
    const prevOnline = prevBackendOnlineRef.current;
    prevBackendOnlineRef.current = backendOnline;

    // Only act on actual transitions (not the initial undefined)
    if (prevOnline === undefined) return;
    if (prevOnline === backendOnline) return;

    if (backendOnline === false) {
      // Backend went offline — close WS and stop reconnecting
      clearReconnectTimer();
      if (wsRef.current) {
        wsRef.current.onopen = null;
        wsRef.current.onclose = null;
        wsRef.current.onerror = null;
        wsRef.current.onmessage = null;
        if (
          wsRef.current.readyState === WebSocket.OPEN ||
          wsRef.current.readyState === WebSocket.CONNECTING
        ) {
          wsRef.current.close(1000, "backend offline");
        }
        wsRef.current = null;
      }
      setStatus("disconnected");
      setLastError(null);
    } else if (backendOnline === true) {
      // Backend came back online — reset state and reconnect
      setReconnectCount(0);
      resetCircuitBreaker();
      everConnectedRef.current = false; // Allow fresh connection attempt
    }
  }, [backendOnline, clearReconnectTimer, resetCircuitBreaker]);

  // ---------------------------------------------------------------------------
  // Connect function
  // ---------------------------------------------------------------------------

  const connect = useCallback(() => {
    if (!enabled || !mountedRef.current) return;

    // If backendOnline is explicitly false, don't connect
    if (backendOnline === false) return;

    // If circuit breaker is open, don't attempt connection
    if (isCircuitBreakerOpen()) return;

    // Clean up existing connection
    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      if (
        wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING
      ) {
        wsRef.current.close();
      }
      wsRef.current = null;
    }

    // Fix 4.9: Guard against empty wsBaseUrl (SSR)
    if (!wsBaseUrl) return;

    const url = `${wsBaseUrl}${path}`;
    setStatus("connecting");

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) return;
        everConnectedRef.current = true;
        resetCircuitBreaker(); // Connection succeeded, reset breaker
        setStatus("connected");
        setReconnectCount(0);
        setLastError(null);
      };

      ws.onmessage = (event) => {
        if (!mountedRef.current) return;

        try {
          const msg: WSMessage<T> = JSON.parse(event.data);

          if (msg.type === "update" && msg.data) {
            setData(msg.data);
            setLastUpdateAt(msg.timestamp || new Date().toISOString());
          } else if (msg.type === "error") {
            setLastError(msg.message || "Unknown error");
          }
          // "heartbeat" — no action needed, just keeps connection alive
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = (event) => {
        if (!mountedRef.current) return;
        setStatus("disconnected");
        wsRef.current = null;

        // Record this failure for circuit breaker tracking
        recordFailure();

        // FIX: Don't retry if the connection was never established.
        // If we've never successfully connected (everConnectedRef is false)
        // and the close was abnormal (code 1006, !wasClean), the backend
        // WebSocket server is not running. Retrying is useless and only
        // produces console spam ("WebSocket connection to 'ws://...' failed").
        const wasRefused = !everConnectedRef.current && event.code === 1006 && !event.wasClean;

        // Also stop if this is a clean close — the server intentionally
        // closed the connection (e.g. restart, shutdown).
        // Auto-reconnect only makes sense for unexpected disconnections
        // AFTER a previously working connection.
        const shouldReconnect =
          autoReconnect &&
          reconnectCount < maxReconnectAttempts &&
          !event.wasClean &&
          !wasRefused &&
          everConnectedRef.current &&  // Only retry if we had a connection before
          backendOnline !== false &&   // Don't reconnect if backend is known offline
          !isCircuitBreakerOpen();     // Don't reconnect if breaker is open

        if (shouldReconnect) {
          const delay = Math.min(
            reconnectBaseDelay * Math.pow(2, reconnectCount),
            reconnectMaxDelay,
          );
          // Add jitter ±20%
          const jitter = delay * 0.2 * (Math.random() * 2 - 1);
          const finalDelay = Math.max(100, delay + jitter);

          reconnectTimerRef.current = setTimeout(() => {
            if (mountedRef.current) {
              setReconnectCount((prev) => prev + 1);
              connect();
            }
          }, finalDelay);
        }
      };

      ws.onerror = () => {
        // onclose will fire after onerror, so we handle reconnect there.
        // NOTE: We intentionally do NOT log WebSocket errors to console.
        // When the flipper backend is offline (no reverse proxy), the browser
        // itself already logs "WebSocket connection to 'ws://...' failed".
        // Adding our own console.error here would double the noise.
        // The `status` / `lastError` state is the proper way for UI code
        // to detect and display connection problems.
      };
    } catch {
      setStatus("disconnected");
    }
  }, [
    path,
    enabled,
    autoReconnect,
    maxReconnectAttempts,
    reconnectBaseDelay,
    reconnectMaxDelay,
    reconnectCount,
    wsBaseUrl,
    backendOnline,
    isCircuitBreakerOpen,
    recordFailure,
    resetCircuitBreaker,
  ]);

  // Connect on mount / when path changes.
  // FIX: Only attempt connection when we have a non-empty wsBaseUrl
  // AND the backend is not known to be offline.
  useEffect(() => {
    mountedRef.current = true;
    if (enabled && wsBaseUrl && backendOnline !== false) {
      connect();
    }

    return () => {
      mountedRef.current = false;
      clearReconnectTimer();
      if (wsRef.current) {
        wsRef.current.onopen = null;
        wsRef.current.onclose = null;
        wsRef.current.onerror = null;
        wsRef.current.onmessage = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, enabled, wsBaseUrl]);

  // Reconnect when backendOnline transitions from false → true
  // (The useEffect above handles initial mount; this one handles recovery)
  useEffect(() => {
    if (backendOnline === true && enabled && wsBaseUrl && prevBackendOnlineRef.current === false) {
      connect();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendOnline]);

  // Manual reconnect function
  const reconnect = useCallback(() => {
    clearReconnectTimer();
    setReconnectCount(0);
    resetCircuitBreaker();
    everConnectedRef.current = false;
    connect();
  }, [clearReconnectTimer, connect, resetCircuitBreaker]);

  return {
    data,
    status,
    lastError,
    reconnectCount,
    reconnect,
    lastUpdateAt,
  };
}

// ---------------------------------------------------------------------------
// useFlipperWebSocket — Generic hook for anomalies, flips, and events channels
//
// Fix 10 (POE2-FIX-SPEC): Extended with callback-based invalidation API
// so tab components can subscribe to WS events and invalidate their
// React Query cache accordingly.
//
// Graceful degradation: now accepts backendOnline from the dashboard
// level health check, enabling proper WS lifecycle management.
// ---------------------------------------------------------------------------

export type FlipperChannel = "/ws/anomalies" | "/ws/flips" | "/ws/events";

export function useFlipperWebSocket<T = Record<string, unknown>>(
  channelOrCallbacks: FlipperChannel | {
    onFlipsUpdate?: () => void;
    onAnomaly?: () => void;
    // Fix 4.10/4.11: Removed onForecastUpdate — no /ws/forecast connection exists
    enabled?: boolean;
    /** External backend online signal (from health polling).
     *  When false: WS connections close and stop reconnecting.
     *  When true (after false): WS reconnects with reset counters. */
    backendOnline?: boolean;
  },
  options: UseWebSocketOptions = {},
): UseWebSocketReturn<T> {
  // Callback-based API (Fix 10): subscribe to all channels and dispatch
  // callbacks based on message type
  if (typeof channelOrCallbacks === "object") {
    const {
      onFlipsUpdate,
      onAnomaly,
      enabled = true,
      backendOnline,
    } = channelOrCallbacks;
    // We connect to /ws/flips as the primary channel; messages from other
    // channels are dispatched based on message type field.
    // For simplicity, we connect to /ws/flips and /ws/anomalies in parallel.
    // FIX: Reduced maxReconnectAttempts from default 10 to 3.
    // Without a reverse proxy (nginx/caddy) the WS connections go to
    // ws://localhost:8000 which may not be reachable from the browser.
    // Limiting retries prevents console spam from repeated failures.
    const flipsResult = useWebSocket<{ type?: string }>("/ws/flips", {
      ...options,
      enabled,
      backendOnline,
      maxReconnectAttempts: 3,
    });
    const anomaliesResult = useWebSocket<{ type?: string }>("/ws/anomalies", {
      ...options,
      enabled,
      backendOnline,
      maxReconnectAttempts: 3,
    });

    // Trigger callbacks when data changes
    // We use the data + lastUpdateAt to detect new messages
    // This is a simplified approach — in production, you'd parse
    // the message type from the WS data payload
    const prevFlipsUpdate = useRef<string | null>(null);
    const prevAnomalyUpdate = useRef<string | null>(null);

    useEffect(() => {
      if (flipsResult.lastUpdateAt && flipsResult.lastUpdateAt !== prevFlipsUpdate.current) {
        prevFlipsUpdate.current = flipsResult.lastUpdateAt;
        onFlipsUpdate?.();
      }
    }, [flipsResult.lastUpdateAt, onFlipsUpdate]);

    useEffect(() => {
      if (anomaliesResult.lastUpdateAt && anomaliesResult.lastUpdateAt !== prevAnomalyUpdate.current) {
        prevAnomalyUpdate.current = anomaliesResult.lastUpdateAt;
        onAnomaly?.();
      }
    }, [anomaliesResult.lastUpdateAt, onAnomaly]);

    // Return the flips result as primary (for backwards compat)
    return flipsResult as UseWebSocketReturn<T>;
  }

  // Legacy channel-based API
  return useWebSocket<T>(channelOrCallbacks, options);
}
