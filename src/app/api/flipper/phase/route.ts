import { proxyWithFallback } from "@/lib/flipper-proxy";

export const dynamic = "force-dynamic";

/** GET /api/flipper/phase → proxies to FastAPI GET /api/phase
 *
 *  FIX: When the backend is offline, return unknown phase with
 *  data_available: false instead of 503.
 */
export async function GET() {
  return proxyWithFallback("/api/phase", {
    offlineFallback: {
      phase: "unknown",
      days_since_ref: 0,
      league: "",
      data_available: false,
    },
    insufficientDataFallback: {
      phase: "unknown",
      days_since_ref: 0,
      league: "",
      data_available: false,
    },
  });
}
