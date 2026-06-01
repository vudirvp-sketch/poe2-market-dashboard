import { NextRequest } from "next/server";
import { proxyWithFallback } from "@/lib/flipper-proxy";

export const dynamic = "force-dynamic";

/** GET /api/flipper/triangular → proxies to FastAPI GET /api/arbitrage/triangular
 *
 *  FIX: When the backend is offline, return empty triangular data with
 *  data_available: false instead of 503.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  return proxyWithFallback(
    "/api/arbitrage/triangular",
    {
      offlineFallback: {
        league: "",
        total: 0,
        opportunities: [],
        fetched_at: new Date().toISOString(),
        data_available: false,
      },
      insufficientDataFallback: {
        league: "",
        total: 0,
        opportunities: [],
        fetched_at: new Date().toISOString(),
        data_available: false,
      },
    },
    searchParams,
  );
}
