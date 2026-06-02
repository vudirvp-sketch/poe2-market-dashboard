import { NextRequest } from "next/server";
import { proxyWithFallback } from "@/lib/flipper-proxy";

export const dynamic = "force-dynamic";

/** GET /api/flipper/storage-value/[currency] → proxies to FastAPI GET /api/storage-value/{currency}
 *
 *  FIX: When the backend is offline, return storage value with dataAvailable: false
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
        currentPrice: 0,
        projectedPrice: 0,
        riskDiscount: 0,
        adjustedPrice: 0,
        netValueAfterFees: 0,
        ratio: 0,
        decision: "HOLD",
        dataAvailable: false,
        inputs: {
          momentum: 0,
          volatility: 0,
          acceleration: 0,
          liquidityScore: 0,
          horizonHours: 24,
          significanceLevel: 0.95,
        },
      },
      insufficientDataFallback: {
        currency,
        currentPrice: 0,
        projectedPrice: 0,
        riskDiscount: 0,
        adjustedPrice: 0,
        netValueAfterFees: 0,
        ratio: 0,
        decision: "HOLD",
        dataAvailable: false,
        inputs: {
          momentum: 0,
          volatility: 0,
          acceleration: 0,
          liquidityScore: 0,
          horizonHours: 24,
          significanceLevel: 0.95,
        },
      },
    },
    searchParams,
  );
}
