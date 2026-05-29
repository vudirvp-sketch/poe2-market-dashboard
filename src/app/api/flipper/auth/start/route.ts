/**
 * OAuth2 start endpoint — initiates GGG OAuth2 authorization flow.
 *
 * Calls the FastAPI backend to get the authorization URL and state,
 * then sets the state in an httpOnly cookie for CSRF verification
 * before redirecting the user to GGG's authorization page.
 */
import { NextResponse } from "next/server";
import { proxyToFlipper } from "@/lib/flipper-proxy";

export const dynamic = "force-dynamic";

/** GET /api/flipper/auth/start — start OAuth2 flow with CSRF protection */
export async function GET() {
  // Call the FastAPI backend to get auth_url and state
  const res = await proxyToFlipper("/api/auth/start");

  if (!res.ok) {
    return res;
  }

  try {
    const data = await res.json();

    if (!data.auth_url || !data.state) {
      return NextResponse.json(
        { error: "invalid_auth_response", detail: "Backend did not return auth_url or state" },
        { status: 502 },
      );
    }

    // Set the state in an httpOnly, SameSite=Lax cookie for CSRF verification.
    // The cookie will be checked in the callback route.
    const response = NextResponse.redirect(data.auth_url);
    response.cookies.set("ggg_oauth_state", data.state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 600, // 10 minutes — plenty for the OAuth2 flow
      path: "/",
    });

    return response;
  } catch {
    return NextResponse.json(
      { error: "auth_start_failed", detail: "Failed to parse backend response" },
      { status: 502 },
    );
  }
}
