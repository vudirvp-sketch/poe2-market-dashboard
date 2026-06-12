import { NextRequest } from "next/server";
import { proxyWithFallback } from "@/lib/flipper-proxy";

export const dynamic = "force-dynamic";

/** GET /api/flipper/anomalies → proxies to FastAPI GET /api/anomalies
 *
 *  FIX: When the backend is offline, return empty anomalies with
 *  dataAvailable: false instead of 503.
 *
 *  TIMEOUT: 45s — anomaly detection runs in ProcessPoolExecutor and can
 *  take 20-30s for 600+ currencies (STL decomposition is CPU-heavy).
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  return proxyWithFallback(
    "/api/v1/anomalies",
    {
      offlineFallback: {
        anomalies: [],
        count: 0,
        currenciesChecked: 0,
        minAlertScore: 0,
        dataAvailable: false,
      },
      insufficientDataFallback: {
        anomalies: [],
        count: 0,
        currenciesChecked: 0,
        minAlertScore: 0,
        dataAvailable: false,
      },
    },
    searchParams,
    "GET",
    undefined,
    45_000, // 45s timeout — anomaly detection is CPU-heavy
  );
}
