import { proxyWithFallback } from "@/lib/flipper-proxy";

export const dynamic = "force-dynamic";

/** GET /api/flipper/mirror-divine-arb → proxies to FastAPI
 *  GET /api/v1/mirror-divine-arb
 *
 *  P7 (iter 108). Detects Mirror:Divine arbitrage windows for chase-unique
 *  payment-method swaps. Returns a single-object response (Mirror:Divine is
 *  one market, not a per-currency list) with:
 *    - currentRate / meanRate / stdRate / minRate / maxRate
 *    - zScore (how many stds the current rate is from the mean)
 *    - deviationPct (signed % deviation from mean)
 *    - profitPotentialPerMirrorDiv (|current - mean| in Div per Mirror)
 *    - signal: SELL_MIRROR_BUY_DIVINE | SELL_DIVINE_BUY_MIRROR | NEUTRAL
 *    - isActionable: true when profitPotentialPerMirrorDiv >= 100
 *    - recommendedAction: EXECUTE_ARB | WATCH | HOLD
 *    - priceHistoryShort: up to 14 most-recent rate points (for sparkline)
 *
 *  Query params (forwarded to backend):
 *    days — lookback window in days (default 30, clamped to [1, 90]).
 *
 *  When the backend is offline or returns 503 (insufficient data / not
 *  yet loaded), we return an empty object with `dataAvailable: false`
 *  so the frontend can show a graceful "no data yet" state instead of
 *  an error.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const searchParams = url.searchParams;

  const emptyFallback = {
    league: "",
    mirrorCurrency: "mirror",
    divineCurrency: "divine",
    currentRate: null,
    meanRate: null,
    stdRate: null,
    minRate: null,
    maxRate: null,
    zScore: null,
    deviationPct: null,
    profitPotentialPerMirrorDiv: null,
    signal: "NEUTRAL",
    isActionable: false,
    recommendedAction: "HOLD",
    sampleSize: 0,
    priceHistoryShort: [],
    dataAvailable: false,
    fetchedAt: new Date().toISOString(),
    days: Number(searchParams.get("days") ?? 30),
  };

  return proxyWithFallback(
    "/api/v1/mirror-divine-arb",
    {
      offlineFallback: emptyFallback,
      insufficientDataFallback: emptyFallback,
    },
    searchParams,
  );
}
