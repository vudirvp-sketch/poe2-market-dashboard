import { NextRequest } from "next/server";
import { proxyWithFallback } from "@/lib/flipper-proxy";

export const dynamic = "force-dynamic";

/** POST /api/flipper/events/[eventId]/deactivate → proxies to FastAPI POST /api/events/{eventId}/deactivate
 *
 *  FIX: When the backend is offline, return error response instead of 503.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const { eventId } = await params;
  return proxyWithFallback(
    `/api/v1/events/${eventId}/deactivate`,
    {
      offlineFallback: {
        error: "Cannot deactivate event — backend is offline",
        error_type: "backend_offline",
      },
    },
    undefined,
    "POST",
  );
}
