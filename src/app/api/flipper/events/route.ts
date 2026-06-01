import { NextRequest } from "next/server";
import { proxyWithFallback } from "@/lib/flipper-proxy";

export const dynamic = "force-dynamic";

/** GET /api/flipper/events → proxies to FastAPI GET /api/events
 *
 *  FIX: When the backend is offline, return empty events list instead of 503.
 */

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  return proxyWithFallback(
    "/api/events",
    {
      offlineFallback: {
        events: [],
        total: 0,
      },
    },
    searchParams,
  );
}

/** POST /api/flipper/events → proxies to FastAPI POST /api/events
 *
 *  POST requests cannot return fallback data — they are actions (create event).
 *  If the backend is offline, we return a clear error so the frontend
 *  can show "backend offline" in the form.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    return proxyWithFallback(
      "/api/events",
      {
        offlineFallback: {
          error: "Flipper backend unavailable",
          error_type: "backend_offline",
          detail: "Cannot create event — backend is offline",
        },
      },
      undefined,
      "POST",
      body,
    );
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON body" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }
}
