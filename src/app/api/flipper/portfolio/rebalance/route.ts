import { NextRequest } from "next/server";
import { proxyWithFallback } from "@/lib/flipper-proxy";

export const dynamic = "force-dynamic";

/** POST /api/flipper/portfolio/rebalance → proxies to FastAPI POST /api/portfolio/rebalance?method=...
 *
 *  FIX: When the backend is offline, return a clear error response instead of 503.
 *  The frontend shows an error toast for failed rebalance.
 */
export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  // Forward the method parameter if provided (for switching between risk_parity / min_variance)
  const params = new URLSearchParams();
  const method = searchParams.get("method");
  if (method) {
    params.set("method", method);
  }
  return proxyWithFallback(
    "/api/portfolio/rebalance",
    {
      offlineFallback: {
        method: method ?? "risk_parity",
        weights: {},
        expected_risk: 0,
        correlation_warning: false,
        last_rebalance: null,
        data_available: false,
        error: "Cannot rebalance — backend is offline",
      },
    },
    params,
    "POST",
  );
}
