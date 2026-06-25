import { proxyWithFallback } from "@/lib/flipper-proxy";

export const dynamic = "force-dynamic";

/** GET /api/flipper/phase-hints → proxies to FastAPI
 *  GET /api/v1/phase-hints
 *
 *  F6 (iter 78). Returns phase-aware advisory hints based on the current
 *  league phase detected by PhaseDetector. The dashboard's PhaseHintsWidget
 *  (mounted on the Overview tab below the Content Pulse widget) consumes
 *  this endpoint.
 *
 *  The hint table is hardcoded in backend/economy/phase_hints.py — this
 *  endpoint does NOT depend on the DataSnapshot. It will always return
 *  data_available=true as long as the PhaseDetector can be constructed.
 *
 *  When the backend is offline or returns 503, we return an empty hints
 *  list with `data_available: false` so the widget shows a graceful
 *  "no data" state instead of an error.
 */
export async function GET() {
  const emptyFallback = {
    league: "",
    phase: "unknown",
    phaseLabel: "Unknown Phase",
    daysSinceReference: 0,
    referenceCurrency: "",
    phaseSummary: "",
    hints: [],
    dataAvailable: false,
    fetchedAt: new Date().toISOString(),
  };

  return proxyWithFallback("/api/v1/phase-hints", {
    offlineFallback: emptyFallback,
    insufficientDataFallback: emptyFallback,
  });
}
