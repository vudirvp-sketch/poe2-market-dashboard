import { NextRequest } from "next/server";
import { proxyWithFallback } from "@/lib/flipper-proxy";

export const dynamic = "force-dynamic";

/** GET /api/flipper/forecast/[currency] → proxies to FastAPI GET /api/forecast/{currency}
 *
 *  FIX: When the backend is offline, return forecast with data_available: false
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
        low_confidence: true,
        is_event_active: false,
        data_points: 0,
        fetched_at: new Date().toISOString(),
        data_available: false,
      },
      insufficientDataFallback: {
        currency,
        horizon: 0,
        models: {},
        disagreement: false,
        low_confidence: true,
        is_event_active: false,
        data_points: 0,
        fetched_at: new Date().toISOString(),
        data_available: false,
      },
    },
    searchParams,
  );
}
