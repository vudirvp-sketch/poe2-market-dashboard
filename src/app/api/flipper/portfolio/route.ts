import { proxyWithFallback } from "@/lib/flipper-proxy";

export const dynamic = "force-dynamic";

/** GET /api/flipper/portfolio → proxies to FastAPI GET /api/portfolio
 *
 *  FIX: When the backend is offline, return empty portfolio with
 *  dataAvailable: false instead of 503.
 */
export async function GET() {
  return proxyWithFallback("/api/portfolio", {
    offlineFallback: {
      method: "risk_parity",
      weights: {},
      expectedRisk: 0,
      correlationWarning: false,
      lastRebalance: null,
      dataAvailable: false,
    },
    insufficientDataFallback: {
      method: "risk_parity",
      weights: {},
      expectedRisk: 0,
      correlationWarning: false,
      lastRebalance: null,
      dataAvailable: false,
    },
  });
}
