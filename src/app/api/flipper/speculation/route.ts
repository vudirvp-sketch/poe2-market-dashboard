import { proxyWithFallback } from "@/lib/flipper-proxy";

export const dynamic = "force-dynamic";

/** GET /api/flipper/speculation → proxies to FastAPI
 *  GET /api/v1/speculation
 *
 *  F5 (iter 77). Returns per-item z-score + BUY/SELL/HOLD signals for the
 *  Speculation tab. The dashboard's Speculation tab consumes this endpoint.
 *
 *  Query params (forwarded to backend):
 *    days   — lookback window in days (default 30, clamped to [1, 90]).
 *    limit  — max number of signals to return (default 50, clamped to [1, 500]).
 *    signal — "ALL" | "BUY" | "SELL" | "HOLD". Default "ALL".
 *
 *  When the backend is offline or returns 503 (insufficient data / not
 *  yet loaded), we return an empty signals list with `dataAvailable: false`
 *  so the tab shows a graceful "no data yet" state instead of an error.
 */
export async function GET(request: Request) {
  // Forward query params to the backend
  const url = new URL(request.url);
  const searchParams = url.searchParams;
  // The backend validates and clamps these — no need to validate here.
  // If they're absent, FastAPI uses its defaults (days=30, limit=50, signal="ALL").

  const emptyFallback = {
    league: "",
    signals: [],
    dataAvailable: false,
    fetchedAt: new Date().toISOString(),
    days: Number(searchParams.get("days") ?? 30),
  };

  return proxyWithFallback(
    "/api/v1/speculation",
    {
      offlineFallback: emptyFallback,
      insufficientDataFallback: emptyFallback,
    },
    searchParams,
  );
}
