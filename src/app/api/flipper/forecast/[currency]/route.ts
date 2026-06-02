import { NextRequest } from "next/server";
import { proxyWithFallback } from "@/lib/flipper-proxy";

export const dynamic = "force-dynamic";

/** GET /api/flipper/forecast/[currency] → proxies to FastAPI GET /api/forecast/{currency}
 *
 *  FIX: When the backend is offline, return forecast with dataAvailable: false
 *  instead of 503. The frontend already handles this state gracefully.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ currency: string }> },
) {
  const { currency } = await params;
  const { searchParams } = new URL(_req.url);
  return proxyWithFallback(
    `/api/forecast/${encodeURIComponent(currency)}`,
    {
      offlineFallback: {
        currency,
        horizon: 0,
        models: {},
        disagreement: false,
        lowConfidence: true,
        isEventActive: false,
        dataPoints: 0,
        fetchedAt: new Date().toISOString(),
        dataAvailable: false,
      },
      insufficientDataFallback: {
        currency,
        horizon: 0,
        models: {},
        disagreement: false,
        lowConfidence: true,
        isEventActive: false,
        dataPoints: 0,
        fetchedAt: new Date().toISOString(),
        dataAvailable: false,
      },
    },
    searchParams,
  );
}
