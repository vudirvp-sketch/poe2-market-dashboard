import { NextRequest } from "next/server";
import { proxyWithFallback } from "@/lib/flipper-proxy";

export const dynamic = "force-dynamic";

/** GET /api/flipper/events → proxies to FastAPI GET /api/v1/events
 *
 *  FIX: When the backend is offline, return empty events list instead of 503.
 */

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  return proxyWithFallback(
    "/api/v1/events",
    {
      offlineFallback: {
        events: [],
        total: 0,
      },
    },
    searchParams,
  );
}

/** POST /api/flipper/events → proxies to FastAPI POST /api/v1/events
 *
 *  Transforms the frontend camelCase payload to the backend snake_case format:
 *    eventType        → event_type
 *    affectedCurrencies → affected_currencies
 *    expiryHours (number) → expires_at (ISO 8601 string, computed from now + hours)
 *
 *  The backend CreateEventRequest expects snake_case keys and ISO timestamps,
 *  but the frontend sends camelCase with expiryHours (number) for UX.
 *  This proxy route bridges the gap.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Transform frontend camelCase payload → backend snake_case payload
    const backendBody: Record<string, unknown> = {};

    if (body.eventType !== undefined) {
      backendBody.event_type = body.eventType;
    }
    if (body.description !== undefined) {
      backendBody.description = body.description;
    }
    if (body.affectedCurrencies !== undefined) {
      backendBody.affected_currencies = body.affectedCurrencies;
    }
    // Convert expiryHours (number) → expires_at (ISO 8601 string)
    if (typeof body.expiryHours === "number" && body.expiryHours > 0) {
      const expiresAt = new Date(Date.now() + body.expiryHours * 3600_000);
      backendBody.expires_at = expiresAt.toISOString();
    }

    return proxyWithFallback(
      "/api/v1/events",
      {
        offlineFallback: {
          error: "Flipper backend unavailable",
          error_type: "backend_offline",
          detail: "Cannot create event — backend is offline",
        },
      },
      undefined,
      "POST",
      backendBody,
    );
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON body" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }
}
