import { proxyToFlipper } from "@/lib/flipper-proxy";

export const dynamic = "force-dynamic";

/** GET /api/flipper/portfolio/frontier → proxies to FastAPI GET /api/portfolio/frontier */
export async function GET(request: Request) {
  const url = new URL(request.url);
  return proxyToFlipper("/api/portfolio/frontier", url.searchParams);
}
