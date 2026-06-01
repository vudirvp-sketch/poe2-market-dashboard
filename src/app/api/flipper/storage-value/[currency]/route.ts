import { NextRequest } from "next/server";
import { proxyWithFallback } from "@/lib/flipper-proxy";

export const dynamic = "force-dynamic";

/** GET /api/flipper/storage-value/[currency] → proxies to FastAPI GET /api/storage-value/{currency}
 *
 *  FIX: When the backend is offline, return storage value with data_available: false
 *  instead of 503.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ currency: string }> },
) {
  const { currency } = await params;
  const { searchParams } = new URL(_req.url);
  return proxyWithFallback(
    `/api/storage-value/${encodeURIComponent(currency)}`,
    {
      offlineFallback: {
        currency,
        current_price: 0,
        projected_price: 0,
        risk_discount: 0,
        adjusted_price: 0,
        net_value_after_fees: 0,
        ratio: 0,
        decision: "HOLD",
        data_available: false,
        inputs: {
          momentum: 0,
          volatility: 0,
          acceleration: 0,
          liquidity_score: 0,
          horizon_hours: 24,
          confidence_level: 0.95,
        },
      },
      insufficientDataFallback: {
        currency,
        current_price: 0,
        projected_price: 0,
        risk_discount: 0,
        adjusted_price: 0,
        net_value_after_fees: 0,
        ratio: 0,
        decision: "HOLD",
        data_available: false,
        inputs: {
          momentum: 0,
          volatility: 0,
          acceleration: 0,
          liquidity_score: 0,
          horizon_hours: 24,
          confidence_level: 0.95,
        },
      },
    },
    searchParams,
  );
}
