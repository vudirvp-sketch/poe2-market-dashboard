import { NextRequest } from "next/server";
import { proxyWithFallback } from "@/lib/flipper-proxy";

export const dynamic = "force-dynamic";

/** GET /api/flipper/recipes → proxies to FastAPI GET /api/recipes
 *
 *  FIX: When the backend is offline, return empty recipes instead of 503.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  return proxyWithFallback(
    "/api/recipes",
    {
      offlineFallback: {
        recipes: [],
        total: 0,
        dataAvailable: false,
      },
    },
    searchParams,
  );
}
