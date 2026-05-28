import { proxyToFlipper } from "@/lib/flipper-proxy";

export const dynamic = "force-dynamic";

/** POST /api/flipper/portfolio/rebalance → proxies to FastAPI POST /api/portfolio/rebalance */
export async function POST() {
  return proxyToFlipper("/api/portfolio/rebalance", undefined, "POST");
}
