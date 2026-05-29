/**
 * OAuth2 callback endpoint for GGG API authorization.
 *
 * This route handles the OAuth2 authorization code callback from GGG's
 * OAuth2 flow. It verifies the state parameter against the httpOnly cookie
 * set by /api/flipper/auth/start (CSRF protection), then forwards the
 * code and state to the FastAPI backend for token exchange.
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

  // ---- CSRF protection: verify state against the cookie ----
  const cookieState = req.cookies.get("ggg_oauth_state")?.value;

  if (!cookieState) {
    return NextResponse.json(
      { error: "csrf_state_missing", detail: "No OAuth2 state cookie found. The session may have expired. Try /api/flipper/auth/start again." },
      { status: 403 },
    );
  }

  if (state !== cookieState) {
    return NextResponse.json(
      { error: "csrf_state_mismatch", detail: "OAuth2 state parameter does not match the cookie. Possible CSRF attack." },
      { status: 403 },
    );
  }

  // Forward to FastAPI backend which handles the token exchange
  const params = new URLSearchParams({ code, state });
  const backendRes = await proxyToFlipper("/api/auth/callback", params);

  // Clear the state cookie after use (one-time token)
  if (backendRes.ok) {
    const response = new NextResponse(backendRes.body, {
      status: backendRes.status,
      statusText: backendRes.statusText,
      headers: backendRes.headers,
    });
    response.cookies.set("ggg_oauth_state", "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 0, // delete the cookie
      path: "/",
    });
    return response;
  }

  return backendRes;
}
