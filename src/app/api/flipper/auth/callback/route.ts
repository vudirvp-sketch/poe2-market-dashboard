/**
 * OAuth2 callback endpoint for GGG API authorization.
 *
 * This route handles the OAuth2 authorization code callback from GGG's
 * OAuth2 flow. It exchanges the authorization code for access and
 * refresh tokens by calling the FastAPI backend.
 *
 * To start the OAuth2 flow, redirect the user to:
 *   GET /api/flipper/auth/start
 */
import { NextRequest, NextResponse } from "next/server";
import { proxyToFlipper } from "@/lib/flipper-proxy";

export const dynamic = "force-dynamic";

/** GET /api/flipper/auth/callback — OAuth2 callback from GGG */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  if (error) {
    return NextResponse.json(
      { error: "oauth2_denied", detail: error },
      { status: 400 },
    );
  }

  if (!code || !state) {
    return NextResponse.json(
      { error: "missing_params", detail: "Missing code or state parameter" },
      { status: 400 },
    );
  }

  // Forward to FastAPI backend which handles the token exchange
  const params = new URLSearchParams({ code, state });
  return proxyToFlipper("/api/auth/callback", params);
}
