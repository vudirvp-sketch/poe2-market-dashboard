import { proxyWithFallback } from "@/lib/flipper-proxy";

export const dynamic = "force-dynamic";

/** GET /api/flipper/intraday-patterns → proxies to FastAPI
 *  GET /api/v1/intraday-patterns
 *
 *  P4 (iter 98). Returns per-currency time-of-day (UTC hour) price
 *  patterns: 24-hourly mean/std/count, buy window (min mean), sell window
 *  (max mean), and a significance flag (range ≥ 10%). The dashboard's
 *  "Intraday Patterns" tab consumes this endpoint to render a heatmap
 *  (rows = currencies, columns = UTC hours 0..23).
 *
 *  Query params (forwarded to backend):
 *    days   — lookback window in days (default 14, clamped to [1, 90]).
 *    limit  — max number of patterns to return (default 50, clamped to [1, 500]).
 *
 *  When the backend is offline or returns 503 (insufficient data / not
 *  yet loaded), we return an empty patterns list with `dataAvailable: false`
 *  so the tab shows a graceful "no data yet" state instead of an error.
 */
export async function GET(request: Request) {
  // Forward query params to the backend
  const url = new URL(request.url);
  const searchParams = url.searchParams;
  // The backend validates and clamps these — no need to validate here.
  // If they're absent, FastAPI uses its defaults (days=14, limit=50).

  const emptyFallback = {
    league: "",
    patterns: [],
    dataAvailable: false,
    fetchedAt: new Date().toISOString(),
    days: Number(searchParams.get("days") ?? 14),
  };

  return proxyWithFallback(
    "/api/v1/intraday-patterns",
    {
      offlineFallback: emptyFallback,
      insufficientDataFallback: emptyFallback,
    },
    searchParams,
  );
}
