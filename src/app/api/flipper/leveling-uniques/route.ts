import { proxyWithFallback } from "@/lib/flipper-proxy";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

/** GET /api/flipper/leveling-uniques → proxies to FastAPI
 *  GET /api/v1/leveling-uniques?lang=<ru|en>
 *
 *  P3 (iter 100). Returns the static leveling-uniques table with per-item
 *  lifecycle stage (PRE_PEAK / AT_PEAK / POST_PEAK) + recommendation
 *  (BUY_OR_HOLD / SELL_NOW / AVOID_BUYING). The dashboard's
 *  LevelingUniquesWidget (mounted on the Overview tab below the PhaseHints
 *  widget) consumes this endpoint.
 *
 *  The unique table is hardcoded in backend/economy/leveling_uniques.py —
 *  this endpoint does NOT depend on the DataSnapshot. It uses PhaseDetector
 *  only (which uses league_start_datetime from config.yaml), so it's immune
 *  to KI-11 (upstream POE2Scout API 404 errors). It will always return
 *  data_available=true as long as the PhaseDetector can be constructed.
 *
 *  iter 100: Added `?lang=` query parameter. `lang=ru` returns the parallel
 *  Russian notes for each unique (only the `notes` field is translated —
 *  id/name/category/peak_day/peak_price_exalted/decay_pct/pattern/stage/
 *  recommendation/estimated_current_price_exalted/days_until_peak are
 *  identical across locales). Default is English.
 *
 *  When the backend is offline or returns 503, we return an empty uniques
 *  list with `data_available: false` so the widget shows a graceful
 *  "no data" state instead of an error.
 */
export async function GET(req: NextRequest) {
  // Read `lang` from the incoming request query string and forward it to
  // the FastAPI backend. Default is "en" (matches backend default).
  const lang = req.nextUrl.searchParams.get("lang") ?? "en";

  const emptyFallback = {
    league: "",
    phase: "unknown",
    daysSinceReference: 0,
    currentDay: 0,
    referenceCurrency: "",
    uniques: [],
    dataAvailable: false,
    fetchedAt: new Date().toISOString(),
  };

  return proxyWithFallback(
    `/api/v1/leveling-uniques?lang=${encodeURIComponent(lang)}`,
    {
      offlineFallback: emptyFallback,
      insufficientDataFallback: emptyFallback,
    },
  );
}
