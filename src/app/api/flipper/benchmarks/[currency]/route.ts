import { proxyWithFallback } from '@/lib/flipper-proxy';
import { NextRequest } from 'next/server';

export const dynamic = "force-dynamic";

/** GET /api/flipper/benchmarks/[currency] → proxies to FastAPI GET /api/benchmarks/{currency}
 *
 *  FIX: When the backend is offline or returns 404 (no historical data for
 *  the given currency), return a fallback response with dataAvailable: false
 *  instead of propagating the error. This eliminates console 404/503 spam
 *  while keeping the UI clean — the frontend already checks dataAvailable.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ currency: string }> }
) {
  const { currency } = await params;
  const url = new URL(request.url);
  const searchParams = new URLSearchParams();
  if (url.searchParams.get('days')) searchParams.set('days', url.searchParams.get('days')!);

  const benchmarksFallback = {
    currency,
    dataAvailable: false,
    low30d: null,
    high30d: null,
    rangePosition: null,
    percentile30d: null,
    currentVsAvg: null,
  };

  const res = await proxyWithFallback(
    `/api/v1/benchmarks/${currency}`,
    {
      offlineFallback: benchmarksFallback,
      insufficientDataFallback: benchmarksFallback,
    },
    searchParams,
  );

  // If the backend returned 404 (no historical data for this currency),
  // catch it and return the fallback instead of propagating the error.
  if (res.status === 404) {
    return Response.json(benchmarksFallback);
  }

  return res;
}
