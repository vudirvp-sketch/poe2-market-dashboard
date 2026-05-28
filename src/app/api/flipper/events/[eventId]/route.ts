import { NextRequest } from "next/server";
import { proxyToFlipper } from "@/lib/flipper-proxy";

export const dynamic = "force-dynamic";

/** DELETE /api/flipper/events/[eventId] → proxies to FastAPI DELETE /api/events/{eventId} */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const { eventId } = await params;
  return proxyToFlipper(`/api/events/${eventId}`, undefined, "DELETE");
}

/** POST /api/flipper/events/[eventId]/deactivate → proxies to FastAPI POST /api/events/{eventId}/deactivate */
// Note: deactivate is handled as a sub-path, so we export a handler that
// checks the URL path. Since Next.js file-based routing maps
// /api/flipper/events/[eventId]/deactivate to a different route file,
// we'll add that separately. This file only handles /api/flipper/events/[eventId].
