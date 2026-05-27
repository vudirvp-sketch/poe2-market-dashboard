import { NextRequest, NextResponse } from "next/server";
import { getLeagues } from "@/lib/poe2api";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const realm = searchParams.get("realm");
    if (!realm) {
      return NextResponse.json({ error: "realm is required" }, { status: 400 });
    }
    const leagues = await getLeagues(realm);
    return NextResponse.json(leagues);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
