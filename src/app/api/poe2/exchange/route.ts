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
        // Fix 4.15: snapshot=true skips history enrichment for fast initial load
        const isSnapshot = searchParams.get("snapshot") === "true";
        const data = await getSnapshotPairs(realm, league, isSnapshot);
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
    return NextResponse.json(
      { error: message, error_type: "upstream_error" },
      { status: 502 }
    );
  }
}
