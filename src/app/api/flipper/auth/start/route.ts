/**
 * OAuth2 start endpoint — initiates GGG OAuth2 authorization flow.
 *
 * Redirects the user to GGG's authorization page. After the user
 * authorizes, GGG redirects back to the callback endpoint.
 */
import { NextResponse } from "next/server";
import { proxyToFlipper } from "@/lib/flipper-proxy";

export const dynamic = "force-dynamic";

/** GET /api/flipper/auth/start — start OAuth2 flow */
export async function GET() {
  return proxyToFlipper("/api/auth/start");
}
