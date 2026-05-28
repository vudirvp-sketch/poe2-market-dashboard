import { NextRequest } from "next/server";
import { proxyToFlipper } from "@/lib/flipper-proxy";

export const dynamic = "force-dynamic";

/** POST /api/flipper/portfolio/rebalance → proxies to FastAPI POST /api/portfolio/rebalance?method=... */
export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  // Forward the method parameter if provided (for switching between risk_parity / min_variance)
  const params = new URLSearchParams();
  const method = searchParams.get("method");
  if (method) {
    params.set("method", method);
  }
  return proxyToFlipper("/api/portfolio/rebalance", params, "POST");
}
