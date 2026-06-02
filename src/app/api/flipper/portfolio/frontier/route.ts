import { proxyWithFallback } from "@/lib/flipper-proxy";

export const dynamic = "force-dynamic";

/** GET /api/flipper/portfolio/frontier → proxies to FastAPI GET /api/portfolio/frontier
 *
 *  FIX: When the backend is offline, return empty frontier data with
 *  dataAvailable: false instead of 503.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  return proxyWithFallback(
    "/api/portfolio/frontier",
    {
      offlineFallback: {
        frontier: { risks: [], returns: [] },
        individual_assets: [],
        current_portfolio: null,
        dataAvailable: false,
      },
      insufficientDataFallback: {
        frontier: { risks: [], returns: [] },
        individual_assets: [],
        current_portfolio: null,
        dataAvailable: false,
      },
    },
    url.searchParams,
  );
}
