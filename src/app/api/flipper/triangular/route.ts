import { NextRequest } from "next/server";
import { proxyToFlipper } from "@/lib/flipper-proxy";

export const dynamic = "force-dynamic";

/** GET /api/flipper/triangular → proxies to FastAPI GET /api/arbitrage/triangular */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  return proxyToFlipper("/api/arbitrage/triangular", searchParams);
}
