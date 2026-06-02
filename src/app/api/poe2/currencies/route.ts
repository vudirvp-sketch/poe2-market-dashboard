import { NextRequest, NextResponse } from "next/server";
import {
  getCurrenciesByCategory,
  getCurrency,
  getCurrencyPairHistory,
  getItemDailyStats,
  getMultiTimeframeOHLCV,
  getPairMultiTimeframeOHLCV,
  getPairDailyStats,
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
      case "byCategory": {
        const category = searchParams.get("category") || "all";
        const page = Number(searchParams.get("page") || 1);
        const perPage = Number(searchParams.get("perPage") || 50);
        const referenceCurrency = searchParams.get("referenceCurrency") || undefined;
        const data = await getCurrenciesByCategory(realm, league, category, page, perPage, referenceCurrency);
        return NextResponse.json(data);
      }
      case "detail": {
        const apiId = searchParams.get("apiId");
        if (!apiId) return NextResponse.json({ error: "apiId required" }, { status: 400 });
        const data = await getCurrency(realm, league, apiId);
        return NextResponse.json(data);
      }
      case "pairHistory": {
        const id1 = searchParams.get("id1");
        const id2 = searchParams.get("id2");
        if (!id1 || !id2) return NextResponse.json({ error: "id1 and id2 required" }, { status: 400 });
        const limit = Number(searchParams.get("limit") || 168);
        const data = await getCurrencyPairHistory(realm, league, id1, id2, limit);
        return NextResponse.json(data);
      }
      case "dailyStats": {
        const itemId = searchParams.get("itemId");
        if (!itemId) return NextResponse.json({ error: "itemId required" }, { status: 400 });
        const dayCount = Number(searchParams.get("limit") || 60);
        const referenceCurrency = searchParams.get("referenceCurrency") || undefined;
        const data = await getItemDailyStats(realm, league, itemId, dayCount, referenceCurrency);
        return NextResponse.json(data);
      }
      case "ohlcv": {
        const itemId = searchParams.get("itemId");
        if (!itemId) return NextResponse.json({ error: "itemId required" }, { status: 400 });
        const timeframe = (searchParams.get("timeframe") as "1H" | "4H" | "1W") || "4H";
        const referenceCurrency = searchParams.get("referenceCurrency") || undefined;
        const logCountParam = searchParams.get("logCount");
        const logCount = logCountParam ? Number(logCountParam) : undefined;
        const data = await getMultiTimeframeOHLCV(realm, league, itemId, timeframe, referenceCurrency, logCount);
        return NextResponse.json(data);
      }
      // New: Pair-level OHLCV using both ItemIds for true RelativePrice
      case "pairOhlcv": {
        const id1 = searchParams.get("id1");
        const id2 = searchParams.get("id2");
        if (!id1 || !id2) return NextResponse.json({ error: "id1 and id2 required" }, { status: 400 });
        const timeframe = (searchParams.get("timeframe") as "1H" | "4H" | "1W") || "4H";
        const logCountParam = searchParams.get("logCount");
        const logCount = logCountParam ? Number(logCountParam) : undefined;
        const data = await getPairMultiTimeframeOHLCV(realm, league, id1, id2, timeframe, logCount);
        return NextResponse.json(data);
      }
      // New: Pair-level daily stats using both ItemIds
      case "pairDailyStats": {
        const id1 = searchParams.get("id1");
        const id2 = searchParams.get("id2");
        if (!id1 || !id2) return NextResponse.json({ error: "id1 and id2 required" }, { status: 400 });
        const dayCount = Number(searchParams.get("limit") || 60);
        const data = await getPairDailyStats(realm, league, id1, id2, dayCount);
        return NextResponse.json(data);
      }
      default: {
        const data = await getCurrenciesByCategory(realm, league);
        return NextResponse.json(data);
      }
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json(
      { items: [], page: 1, perPage: 50, totalItems: 0, totalPages: 0, error: message, error_type: "upstream_error" },
      { status: 502 }
    );
  }
}
