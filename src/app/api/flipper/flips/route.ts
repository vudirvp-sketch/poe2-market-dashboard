import { NextRequest } from "next/server";
import { proxyWithFallback } from "@/lib/flipper-proxy";

export const dynamic = "force-dynamic";

/** GET /api/flipper/flips → proxies to FastAPI GET /api/arbitrage/flips
 *
 *  FIX: When the backend is offline, return empty flips with dataAvailable: false
 *  instead of 503. The frontend already handles this gracefully by showing
 *  "backend offline" / "insufficient data" UI states.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  return proxyWithFallback(
    "/api/arbitrage/flips",
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
  );
}
