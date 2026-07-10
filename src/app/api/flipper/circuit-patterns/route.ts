import { proxyWithFallback } from "@/lib/flipper-proxy";

export const dynamic = "force-dynamic";

/** GET /api/flipper/circuit-patterns → proxies to FastAPI
 *  GET /api/v1/circuit-patterns
 *
 *  F7 / P8 (iter 97). Returns per-currency trajectory classification
 *  (EXPONENTIAL_GROWTH / PEAK_THEN_DECLINE / VOLATILE / ...) plus a
 *  recommended action (HOLD_FOR_GROWTH / SELL_NOW / AVOID / WATCH /
 *  NEUTRAL). The dashboard's "Circuit Patterns" tab consumes this endpoint.
 *
 *  Query params (forwarded to backend):
 *    days        — lookback window in days (default 30, clamped to [1, 90]).
 *    limit       — max number of patterns to return (default 50, clamped to [1, 500]).
 *    trajectory  — "ALL" | "EXPONENTIAL_GROWTH" | "LINEAR_GROWTH" |
 *                  "PEAK_THEN_DECLINE" | "MEAN_REVERTING" | "VOLATILE" |
 *                  "DECLINING" | "STABLE". Default "ALL".
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
  // If they're absent, FastAPI uses its defaults
  // (days=30, limit=50, trajectory="ALL").

  const emptyFallback = {
    league: "",
    patterns: [],
    dataAvailable: false,
    fetchedAt: new Date().toISOString(),
    days: Number(searchParams.get("days") ?? 30),
  };

  return proxyWithFallback(
    "/api/v1/circuit-patterns",
    {
      offlineFallback: emptyFallback,
      insufficientDataFallback: emptyFallback,
    },
    searchParams,
  );
}
