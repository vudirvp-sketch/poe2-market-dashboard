import { NextRequest } from "next/server";
import { proxyToFlipper } from "@/lib/flipper-proxy";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const params = new URLSearchParams();
  
  // Forward all filter parameters
  const keys = ["min_score", "max_score", "min_volume", "max_spread", "min_spread",
                 "cluster", "currency", "sort_by", "sort_dir", "limit", "include_stale"];
  for (const key of keys) {
    const val = sp.get(key);
    if (val) params.set(key, val);
  }
  
  return proxyToFlipper("/api/scanner/scan", params);
}
