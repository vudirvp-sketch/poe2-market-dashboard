import { NextRequest, NextResponse } from "next/server";
import {
  getExchangeSnapshot,
  getSnapshotPairs,
  getSnapshotHistory,
  getReferenceCurrencies,
} from "@/lib/poe2api";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const realm = searchParams.get("realm");
    const league = searchParams.get("league");
    const action = searchParams.get("action");

    if (!realm || !league) {
      return NextResponse.json({ error: "realm and league are required" }, { status: 400 });
    }

    switch (action) {
      case "snapshot": {
        const data = await getExchangeSnapshot(realm, league);
        return NextResponse.json(data);
      }
      case "pairs": {
        const data = await getSnapshotPairs(realm, league);
        return NextResponse.json(data);
      }
      case "history": {
        const limit = Number(searchParams.get("limit") || 24);
        const data = await getSnapshotHistory(realm, league, limit);
        return NextResponse.json(data);
      }
      case "reference": {
        const data = await getReferenceCurrencies(realm, league);
        return NextResponse.json(data);
      }
      default: {
        const data = await getExchangeSnapshot(realm, league);
        return NextResponse.json(data);
      }
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    const status = message.includes("timed out") ? 504 : 502;
    return NextResponse.json(
      { error: message, hint: message.includes("unreachable") ? "Try setting POE2_API_BASE_URL=https://api.poe2scout.com/api in .env.local" : undefined },
      { status }
    );
  }
}
