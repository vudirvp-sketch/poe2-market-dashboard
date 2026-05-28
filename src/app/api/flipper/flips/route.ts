import { NextRequest } from "next/server";
import { proxyToFlipper } from "@/lib/flipper-proxy";

export const dynamic = "force-dynamic";

/** GET /api/flipper/flips → proxies to FastAPI GET /api/arbitrage/flips */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  return proxyToFlipper("/api/arbitrage/flips", searchParams);
}
