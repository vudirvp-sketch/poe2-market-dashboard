import { proxyWithFallback } from "@/lib/flipper-proxy";

export const dynamic = "force-dynamic";

/** GET /api/flipper/content-pulse → proxies to FastAPI
 *  GET /api/v1/content-pulse
 *
 *  F4 (iter 76). Returns per-category trade volume + 7d/30d rolling
 *  deltas + top rising/falling movers. The dashboard's main "Что фармить
 *  сегодня" widget consumes this endpoint.
 *
 *  When the backend is offline or returns 503 (insufficient data / not
 *  yet loaded), we return an empty categories list with
 *  `dataAvailable: false` so the widget shows a graceful "no data yet"
 *  state instead of an error.
 */
export async function GET() {
  const emptyFallback = {
    league: "",
    categories: [],
    dataAvailable: false,
    fetchedAt: new Date().toISOString(),
  };

  return proxyWithFallback(
    "/api/v1/content-pulse",
    {
      offlineFallback: emptyFallback,
      insufficientDataFallback: emptyFallback,
    },
  );
}
