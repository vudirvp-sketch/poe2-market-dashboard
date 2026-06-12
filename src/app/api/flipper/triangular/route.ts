import { NextRequest } from "next/server";
import { proxyWithFallback } from "@/lib/flipper-proxy";

export const dynamic = "force-dynamic";

/** GET /api/flipper/triangular → proxies to FastAPI GET /api/arbitrage/triangular
 *
 *  FIX: When the backend is offline, return empty triangular data with
 *  dataAvailable: false instead of 503.
 *
 *  TIMEOUT: Uses 45s timeout (instead of default 15s) because triangular
 *  arbitrage involves O(V²E) Bellman-Ford + O(E²) cross-rate validation
 *  with 600+ currencies. This can take 30-60s even with run_in_executor().
 *  The 15s default was causing proxy timeouts → circuit breaker cascade.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  return proxyWithFallback(
    "/api/v1/arbitrage/triangular",
    {
      offlineFallback: {
        league: "",
        total: 0,
        opportunities: [],
        fetchedAt: new Date().toISOString(),
        dataAvailable: false,
      },
      insufficientDataFallback: {
        league: "",
        total: 0,
        opportunities: [],
        fetchedAt: new Date().toISOString(),
        dataAvailable: false,
      },
    },
    searchParams,
    "GET",
    undefined,
    45_000, // 45s timeout for heavy computation
  );
}
