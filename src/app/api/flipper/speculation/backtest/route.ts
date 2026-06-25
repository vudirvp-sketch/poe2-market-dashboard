import { proxyWithFallback } from "@/lib/flipper-proxy";

export const dynamic = "force-dynamic";

/** GET /api/flipper/speculation/backtest → proxies to FastAPI
 *  GET /api/v1/speculation/backtest
 *
 *  F5 follow-up (iter 80). Backtests the z-score BUY/SELL/HOLD strategy on
 *  historical price_logs and returns per-trade results + per-signal aggregates.
 *  The dashboard's Speculation tab consumes this endpoint via a Backtest panel
 *  mounted below the live signals list.
 *
 *  Query params (forwarded to backend):
 *    eval_days_ago  — when to evaluate the signal, in days before now
 *                     (default 14, clamped to [1, 365]).
 *    holding_days   — holding period after entry, in days
 *                     (default 7, clamped to [1, 90]).
 *    lookback_days  — z-score baseline window, in days before entry
 *                     (default 30, clamped to [1, 90]).
 *    limit          — max number of trades in the response list. Aggregates
 *                     are computed over ALL trades — this only caps the payload
 *                     (default 50, clamped to [1, 500]).
 *    signal         — "ALL" | "BUY" | "SELL" | "HOLD". Default "ALL".
 *                     HOLD signals never produce trades (no position taken)
 *                     but are counted in signal_breakdown.HOLD.
 *
 *  When the backend is offline or returns 503 (insufficient data / not
 *  yet loaded), we return an empty trades list with zeroed stats blocks and
 *  `dataAvailable: false` so the panel shows a graceful "no data yet" state
 *  instead of an error.
 */
export async function GET(request: Request) {
  // Forward query params to the backend
  const url = new URL(request.url);
  const searchParams = url.searchParams;
  // The backend validates and clamps these — no need to validate here.
  // If they're absent, FastAPI uses its defaults
  // (eval_days_ago=14, holding_days=7, lookback_days=30, limit=50, signal="ALL").

  const emptyFallback = {
    league: "",
    trades: [],
    signalBreakdown: { BUY: 0, SELL: 0, HOLD: 0 },
    evaluatedCount: 0,
    unevaluatedCount: 0,
    buyStats: {
      count: 0,
      winRate: 0.0,
      meanReturnPct: 0.0,
      medianReturnPct: 0.0,
      bestReturnPct: 0.0,
      worstReturnPct: 0.0,
    },
    sellStats: {
      count: 0,
      winRate: 0.0,
      meanReturnPct: 0.0,
      medianReturnPct: 0.0,
      bestReturnPct: 0.0,
      worstReturnPct: 0.0,
    },
    overallStats: {
      count: 0,
      winRate: 0.0,
      meanReturnPct: 0.0,
      medianReturnPct: 0.0,
      bestReturnPct: 0.0,
      worstReturnPct: 0.0,
    },
    dataAvailable: false,
    fetchedAt: new Date().toISOString(),
    evalDaysAgo: Number(searchParams.get("eval_days_ago") ?? 14),
    holdingDays: Number(searchParams.get("holding_days") ?? 7),
    lookbackDays: Number(searchParams.get("lookback_days") ?? 30),
  };

  return proxyWithFallback(
    "/api/v1/speculation/backtest",
    {
      offlineFallback: emptyFallback,
      insufficientDataFallback: emptyFallback,
    },
    searchParams,
  );
}
