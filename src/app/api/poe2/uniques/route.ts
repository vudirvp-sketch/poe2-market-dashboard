import { NextRequest, NextResponse } from "next/server";
import { getUniquesByCategory } from "@/lib/poe2api";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const realm = searchParams.get("realm");
    const league = searchParams.get("league");
    const category = searchParams.get("category") || "all";
    const page = Number(searchParams.get("page") || 1);
    const perPage = Number(searchParams.get("perPage") || 50);
    const search = searchParams.get("search") || "";
    const referenceCurrency = searchParams.get("referenceCurrency") || undefined;

    if (!realm || !league) {
      return NextResponse.json({ error: "realm and league are required" }, { status: 400 });
    }

    const data = await getUniquesByCategory(realm, league, category, page, perPage, search, referenceCurrency);
    return NextResponse.json(data);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    const status = message.includes("timed out") ? 504 : 502;
    return NextResponse.json(
      { error: message, hint: message.includes("unreachable") ? "Try setting POE2_API_BASE_URL=https://api.poe2scout.com/api in .env.local" : undefined },
      { status }
    );
  }
}
