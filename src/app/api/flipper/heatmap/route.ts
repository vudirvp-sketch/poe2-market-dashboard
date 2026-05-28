import { proxyToFlipper } from "@/lib/flipper-proxy";

export const dynamic = "force-dynamic";

/** GET /api/flipper/heatmap → proxies to FastAPI GET /api/prices/heatmap */
export async function GET() {
  return proxyToFlipper("/api/prices/heatmap");
}
