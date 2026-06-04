import { proxyWithFallback } from "@/lib/flipper-proxy";

export const dynamic = "force-dynamic";

/** GET /api/flipper/phase → proxies to FastAPI GET /api/phase
 *
 *  FIX: When the backend is offline, return unknown phase with
 *  dataAvailable: false instead of 503.
 */
export async function GET() {
  return proxyWithFallback("/api/phase", {
    offlineFallback: {
      phase: "unknown",
      daysSinceReference: 0,
      league: "",
      dataAvailable: false,
    },
    insufficientDataFallback: {
      phase: "unknown",
      daysSinceReference: 0,
      league: "",
      dataAvailable: false,
    },
  });
}
