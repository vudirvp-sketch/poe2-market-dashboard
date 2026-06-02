import { proxyWithFallback } from "@/lib/flipper-proxy";

export const dynamic = "force-dynamic";

/** GET /api/flipper/portfolio/correlation → proxies to FastAPI GET /api/portfolio/correlation
 *
 *  P3-3: Returns the correlation matrix for all eligible currencies.
 *  Used by the ComparativeChart component to render a correlation heatmap.
 *
 *  When the backend is offline, returns empty data with data_available: false.
 */
export async function GET() {
  return proxyWithFallback("/api/portfolio/correlation", {
    offlineFallback: {
      currencies: [],
      matrix: [],
      data_available: false,
    },
    insufficientDataFallback: {
      currencies: [],
      matrix: [],
      data_available: false,
    },
  });
}
