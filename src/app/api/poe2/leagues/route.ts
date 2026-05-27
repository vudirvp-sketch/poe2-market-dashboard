import { NextRequest, NextResponse } from "next/server";
import { getLeagues } from "@/lib/poe2api";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const realm = searchParams.get("realm");
    if (!realm)
      return NextResponse.json({ error: "realm is required" }, { status: 400 });
    const leagues = await getLeagues(realm);
    return NextResponse.json(leagues);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    const status = message.includes("timed out") ? 504 : 502;
    return NextResponse.json(
      {
        error: message,
        hint: message.includes("unreachable") || message.includes("Cannot reach")
          ? "The poe2scout.com API is unreachable. Try: 1) Set POE2_API_BASE_URL=https://api.poe2scout.com/api in .env.local, 2) Use a VPN"
          : undefined,
      },
      { status }
    );
  }
}
