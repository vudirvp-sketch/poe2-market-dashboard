import { NextRequest } from "next/server";
import { proxyWithFallback } from "@/lib/flipper-proxy";

export const dynamic = "force-dynamic";

/** GET /api/flipper/prices → proxies to FastAPI GET /api/prices
 *
 *  FIX: When the backend is offline, return empty array instead of 503.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  return proxyWithFallback(
    "/api/prices",
    {
      offlineFallback: [],
    },
    searchParams,
  );
}
