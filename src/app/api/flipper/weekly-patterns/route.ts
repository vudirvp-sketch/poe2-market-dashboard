import { proxyWithFallback } from "@/lib/flipper-proxy";

export const dynamic = "force-dynamic";

/** GET /api/flipper/weekly-patterns → proxies to FastAPI
 *  GET /api/v1/weekly-patterns
 *
 *  P5 (iter 99). Returns per-currency weekday (Mon-Sun) price
 *  patterns: per-weekday mean/std/count, buy day (min mean), sell day
 *  (max mean), weekday_delta_pct (weekend vs weekday), and a significance
 *  flag (range ≥ 10%). The dashboard's "Weekly Patterns" tab consumes
 *  this endpoint to render a heatmap (rows = currencies, columns = 7
 *  weekdays Mon..Sun).
 *
 *  Query params (forwarded to backend):
 *    weeks  — lookback window in weeks (default 4, clamped to [1, 26]).
 *             Each week = 7 days, so weeks=4 → 28-day window.
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
  // If they're absent, FastAPI uses its defaults (weeks=4, limit=50).

  const emptyFallback = {
    league: "",
    patterns: [],
    dataAvailable: false,
    fetchedAt: new Date().toISOString(),
    weeks: Number(searchParams.get("weeks") ?? 4),
  };

  return proxyWithFallback(
    "/api/v1/weekly-patterns",
    {
      offlineFallback: emptyFallback,
      insufficientDataFallback: emptyFallback,
    },
    searchParams,
  );
}
