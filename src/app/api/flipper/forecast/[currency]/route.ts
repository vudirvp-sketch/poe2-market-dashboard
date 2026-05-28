import { NextRequest } from "next/server";
import { proxyToFlipper } from "@/lib/flipper-proxy";

export const dynamic = "force-dynamic";

/** GET /api/flipper/forecast/[currency] → proxies to FastAPI GET /api/forecast/{currency} */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ currency: string }> },
) {
  const { currency } = await params;
  const { searchParams } = new URL(_req.url);
  return proxyToFlipper(`/api/forecast/${encodeURIComponent(currency)}`, searchParams);
}
