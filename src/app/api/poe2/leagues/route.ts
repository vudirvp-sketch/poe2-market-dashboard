import { NextRequest, NextResponse } from "next/server";
import { getLeagues } from "@/lib/poe2api";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const realm = searchParams.get("realm");
    // Fix 5.4: Pass defaultLeagueValue if provided by the client,
    // avoiding a redundant /Realms request inside getLeagues()
    const defaultLeagueValue = searchParams.get("defaultLeagueValue") || undefined;
    if (!realm)
      return NextResponse.json({ error: "realm is required" }, { status: 400 });
    const leagues = await getLeagues(realm, defaultLeagueValue);
    return NextResponse.json(leagues);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    // getLeagues() returns fallback data on its own errors, so this catch
    // is only for truly unexpected errors.
    return NextResponse.json(
      {
        error: message,
        error_type: "upstream_error",
        hint: `The poe2scout.com API is unreachable. The dashboard will use fallback data for realms and leagues. Try: 1) Set POE2_API_BASE_URL=${process.env.POE2_API_BASE_URL || "https://poe2scout.com/api"} in .env.local, 2) Use a VPN`,
      },
      { status: 502 }
    );
  }
}
