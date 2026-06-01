import { NextRequest } from "next/server";
import { proxyWithFallback } from "@/lib/flipper-proxy";

export const dynamic = "force-dynamic";

/** GET /api/flipper/currencies → proxies to FastAPI GET /api/currencies
 *
 *  FIX: When the backend is offline, return empty array instead of 503.
 *  The forecast tab falls back to POPULAR_CURRENCIES when this returns [].
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  return proxyWithFallback(
    "/api/currencies",
    {
      offlineFallback: [],
    },
    searchParams,
  );
}
