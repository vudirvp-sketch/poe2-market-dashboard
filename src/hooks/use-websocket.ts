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

  // 3. SSR fallback
  return "ws://localhost:8000";
}

const FLIPPER_WS_URL = resolveWsBaseUrl();

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

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    if (!enabled || !mountedRef.current) return;

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

    const url = `${FLIPPER_WS_URL}${path}`;
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
        if (
          autoReconnect &&
          reconnectCount < maxReconnectAttempts &&
          !event.wasClean
        ) {
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
        // onclose will fire after onerror, so we handle reconnect there
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
    onForecastUpdate?: () => void;
    enabled?: boolean;
  },
  options: UseWebSocketOptions = {},
): UseWebSocketReturn<T> {
  // Callback-based API (Fix 10): subscribe to all channels and dispatch
  // callbacks based on message type
  if (typeof channelOrCallbacks === "object") {
    const { onFlipsUpdate, onAnomaly, onForecastUpdate, enabled = true } = channelOrCallbacks;
    // We connect to /ws/flips as the primary channel; messages from other
    // channels are dispatched based on message type field.
    // For simplicity, we connect to /ws/flips and /ws/anomalies in parallel.
    const flipsResult = useWebSocket<{ type?: string }>("/ws/flips", {
      ...options,
      enabled,
    });
    const anomaliesResult = useWebSocket<{ type?: string }>("/ws/anomalies", {
      ...options,
      enabled,
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
