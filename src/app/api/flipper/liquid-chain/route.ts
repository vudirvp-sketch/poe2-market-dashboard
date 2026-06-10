import { NextRequest } from "next/server";
import { proxyWithFallback } from "@/lib/flipper-proxy";

export const dynamic = "force-dynamic";

/** GET /api/flipper/liquid-chain → proxies to FastAPI GET /api/liquid-chain/analysis
 *
 *  Returns full per-step and cumulative path analysis for all configured
 *  vendor reforge chains (currently delirium_liquids — 10 steps).
 *
 *  When the backend is offline, returns empty chains with dataAvailable: false
 *  so the UI can show the appropriate fallback state.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  return proxyWithFallback(
    "/api/liquid-chain/analysis",
    {
      offlineFallback: {
        chains: [],
        dataAvailable: false,
        fetchedAt: new Date().toISOString(),
      },
      insufficientDataFallback: {
        chains: [],
        dataAvailable: false,
        fetchedAt: new Date().toISOString(),
        message: "Snapshot is being collected. Try again in a few seconds.",
      },
    },
    searchParams,
    "GET",
    undefined,
    15_000, // 15s — computation is O(N) where N=10 steps, very fast
  );
}
