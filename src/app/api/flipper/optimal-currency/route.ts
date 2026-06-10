import { NextRequest } from "next/server";
import { proxyWithFallback } from "@/lib/flipper-proxy";

export const dynamic = "force-dynamic";

/** GET /api/flipper/optimal-currency → proxies to FastAPI GET /api/arbitrage/optimal-currency
 *
 *  §11: Cross-currency optimal payment analysis and cross-rate flip detection.
 *  Returns (after transformKeys):
 *  - optimalPaymentByPair: For each currency with 2+ payment options,
 *    which currency is cheapest and how much you save.
 *  - crossRateFlips: Pairs where market rate deviates from fair rate
 *    (implied by prices_in_base) by more than threshold_pct.
 *  - anchorId: The selected anchor currency for price normalization.
 *
 *  When the backend is offline, returns empty results with dataAvailable: false.
 *
 *  NOTE: Fallback data uses camelCase because proxyWithFallback returns it
 *  directly without going through transformKeys(). The backend now uses
 *  snake_case consistently, which transformKeys() converts to camelCase.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  return proxyWithFallback(
    "/api/arbitrage/optimal-currency",
    {
      offlineFallback: {
        league: "",
        anchorId: "exalted",
        optimalPaymentByPair: {},
        crossRateFlips: [],
        dataAvailable: false,
        fetchedAt: new Date().toISOString(),
      },
      insufficientDataFallback: {
        league: "",
        anchorId: "exalted",
        optimalPaymentByPair: {},
        crossRateFlips: [],
        dataAvailable: false,
        fetchedAt: new Date().toISOString(),
      },
    },
    searchParams,
  );
}
