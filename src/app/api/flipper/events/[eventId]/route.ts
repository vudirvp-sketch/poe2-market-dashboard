import { NextRequest } from "next/server";
import { proxyWithFallback } from "@/lib/flipper-proxy";

export const dynamic = "force-dynamic";

/** DELETE /api/flipper/events/[eventId] → proxies to FastAPI DELETE /api/events/{eventId}
 *
 *  FIX: When the backend is offline, return error response instead of 503.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const { eventId } = await params;
  return proxyWithFallback(
    `/api/v1/events/${eventId}`,
    {
      offlineFallback: {
        error: "Cannot delete event — backend is offline",
        error_type: "backend_offline",
      },
    },
    undefined,
    "DELETE",
  );
}
