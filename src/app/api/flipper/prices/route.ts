import { NextRequest } from "next/server";
import { proxyWithFallback } from "@/lib/flipper-proxy";

export const dynamic = "force-dynamic";

/** GET /api/flipper/prices → proxies to FastAPI GET /api/prices
 *
 *  FIX: When the backend is offline, return empty array instead of 503.
 *
 *  TIMEOUT: Uses 30s timeout because /api/prices runs clustering via
 *  ProcessPoolExecutor on the first request. The spawn context on Windows
 *  requires importing sklearn in the child process, which is slow.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  return proxyWithFallback(
    "/api/prices",
    {
      offlineFallback: [],
    },
    searchParams,
    "GET",
    undefined,
    30_000, // 30s timeout for clustering in ProcessPoolExecutor
  );
}
