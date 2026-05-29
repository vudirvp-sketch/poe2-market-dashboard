/**
 * WebSocket connection info endpoint.
 *
 * Next.js API routes cannot proxy WebSocket connections. Instead, this
 * endpoint returns the backend WebSocket URL so the frontend can connect
 * directly. The `useWebSocket` hook uses this information.
 *
 * For production, configure a reverse proxy (nginx, Caddy, etc.) to
 * forward /ws/* to the FastAPI backend.
 */
import { NextResponse } from "next/server";

const FLIPPER_API_URL = process.env.FLIPPER_API_URL || "http://localhost:8000";

export const dynamic = "force-dynamic";

/** GET /api/flipper/ws/info → returns WebSocket connection details */
export async function GET() {
  // Derive WebSocket URL from the HTTP backend URL
  const wsBase = FLIPPER_API_URL.replace(/^http/, "ws");

  return NextResponse.json({
    ws_base_url: wsBase,
    endpoints: {
      storage_value: "/ws/storage-value/{currency}?horizon_hours=24",
      forecast: "/ws/forecast/{currency}?horizon=24",
    },
    note: "Connect directly to the WebSocket endpoints on the backend. " +
          "For production, use a reverse proxy to forward /ws/* to the backend.",
  });
}
