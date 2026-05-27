import { NextRequest, NextResponse } from "next/server";
import {
  getItems,
  getItemCategories,
  getItem,
  getItemHistory,
  getItemDailyStats,
} from "@/lib/poe2api";

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
      case "categories": {
        const data = await getItemCategories(realm, league);
        return NextResponse.json(data);
      }
      case "detail": {
        const itemId = searchParams.get("itemId");
        if (!itemId) return NextResponse.json({ error: "itemId required" }, { status: 400 });
        const data = await getItem(realm, league, itemId);
        return NextResponse.json(data);
      }
      case "history": {
        const itemId = searchParams.get("itemId");
        if (!itemId) return NextResponse.json({ error: "itemId required" }, { status: 400 });
        const logCount = Number(searchParams.get("logCount") || 168);
        const data = await getItemHistory(realm, league, itemId, logCount);
        return NextResponse.json(data);
      }
      case "daily": {
        const itemId = searchParams.get("itemId");
        if (!itemId) return NextResponse.json({ error: "itemId required" }, { status: 400 });
        const dayCount = Number(searchParams.get("dayCount") || 30);
        const data = await getItemDailyStats(realm, league, itemId, dayCount);
        return NextResponse.json(data);
      }
      default: {
        const data = await getItems(realm, league);
        return NextResponse.json(data);
      }
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
