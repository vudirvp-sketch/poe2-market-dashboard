import { NextRequest } from "next/server";
import { proxyWithFallback } from "@/lib/flipper-proxy";

export const dynamic = "force-dynamic";

/** GET /api/flipper/anomalies → proxies to FastAPI GET /api/anomalies
 *
 *  FIX: When the backend is offline, return empty anomalies with
 *  data_available: false instead of 503.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  return proxyWithFallback(
    "/api/anomalies",
    {
      offlineFallback: {
        anomalies: [],
        count: 0,
        currencies_checked: 0,
        min_alert_score: 0,
        data_available: false,
      },
      insufficientDataFallback: {
        anomalies: [],
        count: 0,
        currencies_checked: 0,
        min_alert_score: 0,
        data_available: false,
      },
    },
    searchParams,
  );
}
