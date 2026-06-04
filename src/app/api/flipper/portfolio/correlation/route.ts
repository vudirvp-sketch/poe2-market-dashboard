import { proxyToFlipper } from "@/lib/flipper-proxy";

export const dynamic = "force-dynamic";

/** GET /api/flipper/portfolio/correlation → proxies to FastAPI GET /api/portfolio/correlation
 *
 *  P3-3: Returns the correlation matrix for all eligible currencies.
 *  Used by the ComparativeChart component to render a correlation heatmap.
 *
 *  The backend portfolio/correlation endpoint is active (routes_portfolio.py).
 *  When the backend is offline or returns any error, we return empty data
 *  with dataAvailable: false instead of propagating the error.
 *  The ComparativeChart component has client-side correlation computation as fallback.
 */
const FALLBACK = {
  currencies: [],
  matrix: [],
  significant: [],
  dataAvailable: false,
};

export async function GET() {
  try {
    const res = await proxyToFlipper("/api/portfolio/correlation");

    // Backend returned a response — check if it's usable
    if (res.ok) {
      // The backend may return data_available: false with 200 status
      // when there's insufficient data (e.g., early league, no snapshot).
      // The proxy already transforms snake_case → camelCase, so
      // data_available → dataAvailable. Pass through as-is.
      return res;
    }

    // Any non-OK status (404, 500, 503, etc.) — return fallback.
    // The ComparativeChart will use client-side correlation instead.
    return Response.json(FALLBACK);
  } catch {
    // Network error, timeout, etc. — return fallback
    return Response.json(FALLBACK);
  }
}
