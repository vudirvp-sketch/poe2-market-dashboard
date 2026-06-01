import { proxyWithFallback } from "@/lib/flipper-proxy";

export const dynamic = "force-dynamic";

/** GET /api/flipper/portfolio → proxies to FastAPI GET /api/portfolio
 *
 *  FIX: When the backend is offline, return empty portfolio with
 *  data_available: false instead of 503.
 */
export async function GET() {
  return proxyWithFallback("/api/portfolio", {
    offlineFallback: {
      method: "risk_parity",
      weights: {},
      expected_risk: 0,
      correlation_warning: false,
      last_rebalance: null,
      data_available: false,
    },
    insufficientDataFallback: {
      method: "risk_parity",
      weights: {},
      expected_risk: 0,
      correlation_warning: false,
      last_rebalance: null,
      data_available: false,
    },
  });
}
