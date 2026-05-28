import { NextRequest } from "next/server";
import { proxyToFlipper } from "@/lib/flipper-proxy";

export const dynamic = "force-dynamic";

/** POST /api/flipper/events/[eventId]/deactivate → proxies to FastAPI POST /api/events/{eventId}/deactivate */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const { eventId } = await params;
  return proxyToFlipper(`/api/events/${eventId}/deactivate`, undefined, "POST");
}
