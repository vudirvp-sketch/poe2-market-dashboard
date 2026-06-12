import { NextRequest } from "next/server";
import { proxyWithFallback } from "@/lib/flipper-proxy";

export const dynamic = "force-dynamic";

/** GET /api/flipper/flips → proxies to FastAPI GET /api/arbitrage/flips
 *
 *  FIX: When the backend is offline, return empty flips with dataAvailable: false
 *  instead of 503. The frontend already handles this gracefully by showing
 *  "backend offline" / "insufficient data" UI states.
 *
 *  TIMEOUT: Uses 30s timeout (instead of default 15s) because flips computation
 *  involves ProcessPoolExecutor (GIL bypass) + clustering + scoring for 600+
 *  currencies. The first request after backend cold-start is especially slow
 *  (ProcessPoolExecutor spawn + sklearn import). Without the longer timeout,
 *  the proxy times out → circuit breaker opens → ALL endpoints blocked.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  return proxyWithFallback(
    "/api/v1/arbitrage/flips",
    {
      offlineFallback: {
        league: "",
        total: 0,
        opportunities: [],
        eventStatus: {
          anyActive: false,
          affectedCurrencies: [],
          summary: null,
        },
        fetchedAt: new Date().toISOString(),
        dataAvailable: false,
      },
      insufficientDataFallback: {
        league: "",
        total: 0,
        opportunities: [],
        eventStatus: {
          anyActive: false,
          affectedCurrencies: [],
          summary: null,
        },
        fetchedAt: new Date().toISOString(),
        dataAvailable: false,
      },
    },
    searchParams,
    "GET",
    undefined,
    30_000, // 30s timeout for ProcessPoolExecutor + clustering + scoring
  );
}
