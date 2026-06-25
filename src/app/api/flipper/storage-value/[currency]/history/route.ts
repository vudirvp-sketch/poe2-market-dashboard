import { NextRequest } from "next/server";
import { proxyWithFallback } from "@/lib/flipper-proxy";

export const dynamic = "force-dynamic";

/** GET /api/flipper/storage-value/[currency]/history → proxies to FastAPI
 *  GET /api/v1/storage-value/{currency}/history
 *
 *  F2 follow-up (iter 75). Returns a time-series of
 *  `price(currency) / price(mirror)` and `price(currency) / price(hinekora)`
 *  ratios for the historical chart in the Storage Value tab.
 *
 *  When the backend is offline or returns 503 (insufficient data), we
 *  return an empty points array with `dataAvailable: false` so the chart
 *  shows a graceful "no history yet" state instead of an error.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ currency: string }> },
) {
  const { currency } = await params;
  const { searchParams } = new URL(_req.url);

  const emptyFallback = {
    currency,
    mirrorCurrency: "mirror",
    hinekoraCurrency: "hinekoras-lock",
    points: [],
    dataAvailable: false,
    fetchedAt: new Date().toISOString(),
  };

  return proxyWithFallback(
    `/api/v1/storage-value/${encodeURIComponent(currency)}/history`,
    {
      offlineFallback: emptyFallback,
      insufficientDataFallback: emptyFallback,
    },
    searchParams,
  );
}
