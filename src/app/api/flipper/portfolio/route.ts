import { proxyToFlipper } from "@/lib/flipper-proxy";

export const dynamic = "force-dynamic";

/** GET /api/flipper/portfolio → proxies to FastAPI GET /api/portfolio */
export async function GET() {
  return proxyToFlipper("/api/portfolio");
}
