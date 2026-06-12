import { proxyToFlipper } from "@/lib/flipper-proxy";

export const dynamic = "force-dynamic";

/** GET /api/flipper/health → proxies to FastAPI GET /api/health
 *
 *  FIX: When the backend is offline, instead of returning 503 (which causes
 *  console errors and React Query retries), we return 200 with status "offline".
 *  The frontend dashboard-page.tsx checks `status === "ok" || status === "degraded"`
 *  to set `backendOnline = true`, so "offline" correctly sets it to false
 *  without generating any console errors.
 */
export async function GET() {
  const res = await proxyToFlipper("/api/v1/health");

  // If backend responded successfully, pass through
  if (res.ok) {
    return res;
  }

  // If backend is offline/unreachable, return structured offline response
  // instead of propagating the 503 error to the client
  if (res.status === 503) {
    return Response.json({
      status: "offline",
      provider: "unreachable",
      timestamp: new Date().toISOString(),
      league: null,
      baseCurrency: null,
      activeEvents: 0,
      cacheEntries: 0,
      snapshot: null,
      daily_stats_cache: null,
    });
  }

  // For other error statuses, pass through
  return res;
}
