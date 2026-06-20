import { NextResponse } from "next/server";
import { getAllEndpointCircuitBreakers } from "@/lib/flipper-proxy";

export const dynamic = "force-dynamic";

/**
 * GET /api/flipper/health/circuit-breakers
 *
 * P2-6 (iter 67): Exposes the per-endpoint circuit breaker state maintained
 * by `flipper-proxy.ts`. Returns a JSON snapshot suitable for ops dashboards
 * and debug panels. Read-only — does NOT mutate breaker state.
 *
 * Response shape:
 *   {
 *     "total": <number of tracked endpoints>,
 *     "open_count": <number of breakers currently open>,
 *     "circuit_breakers": {
 *       "/api/v1/prices": {
 *         "open": false,
 *         "openSince": 0,
 *         "cooldownMs": 15000,
 *         "consecutiveFailures": 0,
 *         "state": "closed"
 *       },
 *       ...
 *     },
 *     "timestamp": "<ISO 8601 UTC>"
 *   }
 *
 * Note: This is a frontend-only endpoint — it does not proxy to the backend.
 * The backend has no circuit breaker; the breaker lives in the Next.js layer
 * because it gates calls to the backend. (P2-6 originally mentioned a "double
 * circuit breaker" — that concept is obsolete since P1-10 in iter 66 unified
 * the frontend breaker to be per-endpoint.)
 */
export async function GET() {
  const snapshot = getAllEndpointCircuitBreakers();
  const entries = Array.from(snapshot.entries());

  const serialized: Record<string, unknown> = {};
  let openCount = 0;
  for (const [path, cb] of entries) {
    serialized[path] = cb;
    if (cb.open) {
      openCount += 1;
    }
  }

  return NextResponse.json({
    total: entries.length,
    open_count: openCount,
    circuit_breakers: serialized,
    timestamp: new Date().toISOString(),
  });
}
