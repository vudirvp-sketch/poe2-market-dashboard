import { NextRequest } from "next/server";
import { proxyToFlipper } from "@/lib/flipper-proxy";

export const dynamic = "force-dynamic";

/** GET /api/flipper/prices → proxies to FastAPI GET /api/prices */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  return proxyToFlipper("/api/prices", searchParams);
}
