import { NextRequest } from "next/server";
import { proxyToFlipper } from "@/lib/flipper-proxy";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return proxyToFlipper("/api/optimizer/matrix");
}
