import { proxyToFlipper } from "@/lib/flipper-proxy";

export const dynamic = "force-dynamic";

/** GET /api/flipper/health → proxies to FastAPI GET /api/health */
export async function GET() {
  return proxyToFlipper("/api/health");
}
