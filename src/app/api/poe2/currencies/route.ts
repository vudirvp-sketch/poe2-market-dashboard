import { NextRequest, NextResponse } from "next/server";
import { getCurrenciesByCategory, getCurrency, getCurrencyPairHistory } from "@/lib/poe2api";

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
      default: {
        const data = await getCurrenciesByCategory(realm, league);
        return NextResponse.json(data);
      }
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    const status = message.includes("timed out") ? 504 : 502;
    return NextResponse.json(
      { error: message, hint: message.includes("unreachable") ? "Try using a VPN to access poe2scout.com" : undefined },
      { status }
    );
  }
}
