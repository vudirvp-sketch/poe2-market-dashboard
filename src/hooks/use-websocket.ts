// ============================================================================
// useWebSocket — React hook for WebSocket connections to the Flipper backend
// ============================================================================
//
// Connects directly to the FastAPI backend's WebSocket endpoints
// (/ws/storage-value/{currency}, /ws/forecast/{currency}).
//
// Features:
//   - Auto-reconnect with exponential backoff
//   - Connection status tracking (connecting | connected | disconnected)
//   - Typed message parsing
//   - Cleanup on unmount
//   - Configurable push interval awareness
// ============================================================================

"use client";

import { useEffect, useRef, useState, useCallback } from "react";

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
// Default backend URL — matches flipper-proxy.ts convention
// ---------------------------------------------------------------------------

const FLIPPER_WS_URL =
  process.env.NEXT_PUBLIC_FLIPPER_WS_URL ||
  (typeof window !== "undefined"
    ? `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${
        process.env.NEXT_PUBLIC_FLIPPER_API_URL?.replace(/^https?:\/\//, "") ||
        "localhost:8000"
      }`
    : "ws://localhost:8000");

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
