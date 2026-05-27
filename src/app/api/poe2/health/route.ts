import { NextResponse } from "next/server";
import { getHealth } from "@/lib/poe2api";

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
      timestamp: new Date().toISOString(),
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({
      status: "error",
      error: message,
      timestamp: new Date().toISOString(),
    }, { status: 502 });
  }
}
