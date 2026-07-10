import { NextResponse } from "next/server";
import { getHealth, isCircuitBreakerOpen } from "@/lib/poe2api";

export const dynamic = "force-dynamic";

/**
 * Health check endpoint — tests connectivity to the poe2scout API.
 * Useful for diagnosing 502 errors.
 * GET /api/poe2/health
 */
export async function GET() {
  try {
    const health = await getHealth();
    return NextResponse.json({
      status: health.status === "ok" ? "ok" : "degraded",
      apiBaseUrl: health.apiBaseUrl,
      corsProxyConfigured: !!process.env.POE2_CORS_PROXY_URL,
      corsProxyUrl: process.env.POE2_CORS_PROXY_URL || null,
      circuitBreakerOpen: isCircuitBreakerOpen(),
      timestamp: new Date().toISOString(),
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({
      status: "unreachable",
      error: message,
      error_type: "upstream_error",
      hint: `The poe2scout.com API is unreachable from your server. The dashboard will use fallback data. Try: 1) Set POE2_CORS_PROXY_URL=https://poe2scout-proxy.vudirvp.workers.dev/api in .env.local, 2) Use a VPN, 3) Check your internet connection`,
      apiBaseUrl: process.env.POE2_API_BASE_URL || "https://poe2scout.com/api",
      corsProxyConfigured: !!process.env.POE2_CORS_PROXY_URL,
      timestamp: new Date().toISOString(),
    }, { status: 502 });
  }
}
