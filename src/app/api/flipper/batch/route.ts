import { NextRequest } from "next/server";
import { proxyToFlipper } from "@/lib/flipper-proxy";

export const dynamic = "force-dynamic";

/** POST /api/flipper/batch → proxies to FastAPI POST /api/batch
 *
 *  Batch endpoint: combine multiple GET requests into a single HTTP call.
 *  The frontend sends a list of sub-requests (path + optional params),
 *  and receives a single response with all results keyed by request ID.
 *
 *  This reduces the number of HTTP round-trips on initial page load from
 *  5-6 separate requests to just 1 batch request, eliminating per-request
 *  overhead (TCP handshake, proxy middleware, circuit-breaker checks).
 *
 *  TIMEOUT: Uses 30s timeout because sub-requests may include heavy
 *  computations (flips, optimal-currency). The backend executes all
 *  sub-requests concurrently, so the total time ≈ max(sub-request times).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    return proxyToFlipper(
      "/api/v1/batch",
      undefined, // no searchParams for POST
      "POST",
      body,
      0, // no retries — batch is idempotent and caller handles errors
      30_000, // 30s timeout
    );
  } catch (e) {
    return new Response(
      JSON.stringify({
        error: "Invalid batch request body",
        results: {},
        errors: { _parse: { error: "invalid_body", detail: String(e) } },
        timing_ms: 0,
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }
}
