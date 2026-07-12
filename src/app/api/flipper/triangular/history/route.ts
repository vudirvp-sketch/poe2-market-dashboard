import { NextRequest } from "next/server";
import { proxyWithFallback } from "@/lib/flipper-proxy";

export const dynamic = "force-dynamic";

/** GET /api/flipper/triangular/history → proxies to FastAPI
 *  GET /api/v1/arbitrage/triangular/history
 *
 *  P10 Phase 2 (iter 132) — trend chart data source for the Gold Map ROI tab.
 *  Reads persisted triangular_cycles rows from SQLite (5-min-bucket snapshots
 *  written by `SnapshotManager._refresh` via `compute_triangular_cycles`).
 *
 *  DISTINCT from the live `/api/flipper/triangular` route:
 *    - live route: returns CURRENT detected cycles (heavy Bellman-Ford, 30-60s)
 *    - history route: reads SQLite, no computation, ~10ms
 *
 *  Query params (forwarded to backend):
 *    days     — lookback window in days (default 30, clamped to [1, 90]).
 *    cycleKey — optional cycle_key filter (e.g. "divine->exalted->mirror").
 *               When omitted, all cycles in the league are returned.
 *
 *  When the backend is offline or returns 503, we return an empty response
 *  with `dataAvailable: false` so the frontend trend chart can show a
 *  graceful "no history yet" state instead of an error.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const days = Number(searchParams.get("days") ?? 30);
  return proxyWithFallback(
    "/api/v1/arbitrage/triangular/history",
    {
      offlineFallback: {
        league: "",
        cycleKey: searchParams.get("cycleKey") ?? null,
        days,
        points: [],
        availableCycleKeys: [],
        dataAvailable: false,
        fetchedAt: new Date().toISOString(),
      },
      insufficientDataFallback: {
        league: "",
        cycleKey: searchParams.get("cycleKey") ?? null,
        days,
        points: [],
        availableCycleKeys: [],
        dataAvailable: false,
        fetchedAt: new Date().toISOString(),
      },
    },
    searchParams,
  );
}
