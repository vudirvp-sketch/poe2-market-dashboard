import { proxyToFlipper } from '@/lib/flipper-proxy';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ currency: string }> }
) {
  const { currency } = await params;
  const url = new URL(request.url);
  const searchParams = new URLSearchParams();
  if (url.searchParams.get('days')) searchParams.set('days', url.searchParams.get('days')!);

  return proxyToFlipper(`/api/benchmarks/${currency}`, searchParams);
}
