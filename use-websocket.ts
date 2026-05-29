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

    // If FLIPPER_API_URL is set and points to a different host, use it for WS
    if (flipperApiUrl && !flipperApiUrl.includes(window.location.host)) {
      const wsProto = flipperApiUrl.startsWith("https") ? "wss:" : "ws:";
      return `${wsProto}//${flipperApiUrl.replace(/^https?:\/\//, "")}`;
    }

    // Fix WebSocket error: When no explicit WS URL is configured and the
    // flipper backend runs on a different port (8000), do NOT default to
    // the current page host (which is Next.js on port 3000). The Next.js
    // server does NOT have WebSocket endpoints. Instead, default to the
    // standard flipper backend port. This eliminates the console errors:
    //   "WebSocket connection to 'ws://localhost:3000/ws/flips' failed"
    //
    // If behind a reverse proxy that handles /ws/* routes, set
    // NEXT_PUBLIC_FLIPPER_WS_URL to empty string in .env.local
    // to use same-origin detection.
    if (!flipperApiUrl) {
      // No env var at all — assume dev setup with backend on port 8000
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const hostname = window.location.hostname;
      // Use port 8000 for the flipper backend WebSocket, not the Next.js port
      return `${proto}//${hostname}:8000`;
    }

    // Same-origin: use current host with ws:/wss: protocol
    // (only reached if flipperApiUrl includes window.location.host,
    //  meaning a reverse proxy is serving both)
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}`;
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
  } = options;

  const [data, setData] = useState<T | null>(null);
  const [status, setStatus] = useState<WebSocketStatus>("disconnected");
  const [lastError, setLastError] = useState<string | null>(null);
  const [reconnectCount, setReconnectCount] = useState(0);
  const [lastUpdateAt, setLastUpdateAt] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  // Fix React #310: Use a ref for reconnectCount inside the connect callback
  // to avoid reconnectCount being a dependency of connect's useCallback.
  // Previously, reconnectCount was in the dep array, which caused:
  //   WS close → setReconnectCount → connect recreated → re-render cascade
  const reconnectCountRef = useRef(0);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  // Fix 4.9: Compute WS URL lazily to avoid SSR stale value
  const wsBaseUrl = useMemo(() => resolveWsBaseUrl(), []);

  const connect = useCallback(() => {
    if (!enabled || !mountedRef.current) return;
    // Fix React #310: Use ref instead of state for reconnect count check
    // to prevent connect from being a dependency of reconnectCount state
    if (reconnectCountRef.current >= maxReconnectAttempts) return;

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

        // Auto-reconnect with exponential backoff
        // Fix React #310: Use reconnectCountRef instead of reconnectCount state
        // to avoid creating a new connect() callback on every reconnect
        const currentCount = reconnectCountRef.current;
        if (
          autoReconnect &&
          currentCount < maxReconnectAttempts &&
          !event.wasClean
        ) {
          const delay = Math.min(
            reconnectBaseDelay * Math.pow(2, currentCount),
            reconnectMaxDelay,
          );
          // Add jitter ±20%
          const jitter = delay * 0.2 * (Math.random() * 2 - 1);
          const finalDelay = Math.max(100, delay + jitter);

          reconnectTimerRef.current = setTimeout(() => {
            if (mountedRef.current) {
              reconnectCountRef.current += 1;
              setReconnectCount(reconnectCountRef.current);
              connect();
            }
          }, finalDelay);
        }
      };

      ws.onerror = () => {
        // onclose will fire after onerror, so we handle reconnect there
      };
    } catch {
      setStatus("disconnected");
    }
  // Fix React #310: Removed reconnectCount from dependency array.
  // Using reconnectCountRef inside connect() instead of the state variable
  // prevents the infinite re-render cascade:
  //   WS close → setReconnectCount → connect recreated → consumer re-renders → loop
  }, [
    path,
    enabled,
    autoReconnect,
    maxReconnectAttempts,
    reconnectBaseDelay,
    reconnectMaxDelay,
    wsBaseUrl, // Fix 4.9: added dependency
  ]);

  // Connect on mount / when path changes
  useEffect(() => {
    mountedRef.current = true;
    if (enabled) {
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
  }, [path, enabled]);

  // Manual reconnect function
  const reconnect = useCallback(() => {
    clearReconnectTimer();
    reconnectCountRef.current = 0;
    setReconnectCount(0);
    connect();
  }, [clearReconnectTimer, connect]);

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
// ---------------------------------------------------------------------------

export type FlipperChannel = "/ws/anomalies" | "/ws/flips" | "/ws/events";

export function useFlipperWebSocket<T = Record<string, unknown>>(
  channelOrCallbacks: FlipperChannel | {
    onFlipsUpdate?: () => void;
    onAnomaly?: () => void;
    // Fix 4.10/4.11: Removed onForecastUpdate — no /ws/forecast connection exists
    enabled?: boolean;
  },
  options: UseWebSocketOptions = {},
): UseWebSocketReturn<T> {
  // Fix Rules of Hooks violation: Previously, useWebSocket was called
  // conditionally based on typeof channelOrCallbacks, which violates
  // React's Rules of Hooks. Now we ALWAYS call the same hooks, but
  // use the `enabled` flag and callback refs to control behavior.

  // Determine if this is the callback-based API or legacy channel API
  const isCallbackMode = typeof channelOrCallbacks === "object";
  const callbacks = isCallbackMode ? channelOrCallbacks : null;
  const channel = isCallbackMode ? null : channelOrCallbacks;

  const enabled = callbacks?.enabled ?? options.enabled ?? true;
  const onFlipsUpdate = callbacks?.onFlipsUpdate;
  const onAnomaly = callbacks?.onAnomaly;

  // Always create both WS connections (fixes Rules of Hooks violation).
  // When not in callback mode or when disabled, the connections are
  // effectively no-ops (enabled=false prevents actual connections).
  const flipsResult = useWebSocket<{ type?: string }>(
    isCallbackMode ? "/ws/flips" : (channel as string),
    {
      ...options,
      enabled: isCallbackMode ? enabled : (options.enabled ?? true),
    },
  );
  const anomaliesResult = useWebSocket<{ type?: string }>(
    "/ws/anomalies",
    {
      ...options,
      // Only connect anomalies in callback mode; otherwise disabled
      enabled: isCallbackMode ? enabled : false,
    },
  );

  // Stable refs for callbacks — prevents useEffect from re-running
  // on every render when parent passes inline arrow functions
  const onFlipsUpdateRef = useRef(onFlipsUpdate);
  onFlipsUpdateRef.current = onFlipsUpdate;
  const onAnomalyRef = useRef(onAnomaly);
  onAnomalyRef.current = onAnomaly;

  // Trigger callbacks when data changes
  const prevFlipsUpdate = useRef<string | null>(null);
  const prevAnomalyUpdate = useRef<string | null>(null);

  useEffect(() => {
    if (flipsResult.lastUpdateAt && flipsResult.lastUpdateAt !== prevFlipsUpdate.current) {
      prevFlipsUpdate.current = flipsResult.lastUpdateAt;
      // Use ref to avoid dependency on the callback itself
      onFlipsUpdateRef.current?.();
    }
  }, [flipsResult.lastUpdateAt]);

  useEffect(() => {
    if (anomaliesResult.lastUpdateAt && anomaliesResult.lastUpdateAt !== prevAnomalyUpdate.current) {
      prevAnomalyUpdate.current = anomaliesResult.lastUpdateAt;
      onAnomalyRef.current?.();
    }
  }, [anomaliesResult.lastUpdateAt]);

  return flipsResult as UseWebSocketReturn<T>;
}
