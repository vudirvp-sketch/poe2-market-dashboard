import { proxyToFlipper } from "@/lib/flipper-proxy";

export const dynamic = "force-dynamic";

/** GET /api/flipper/phase → proxies to FastAPI GET /api/phase */
export async function GET() {
  return proxyToFlipper("/api/phase");
}
