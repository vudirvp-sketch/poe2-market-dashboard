import { NextRequest, NextResponse } from "next/server";
import {
  getItems,
  getSnapshotPairs,
  getSnapshotHistory,
  getCurrenciesByCategory,
  getUniquesByCategory,
} from "@/lib/poe2api";
import type { PoeItem } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/poe2/overview?realm=poe2&league=Fate+of+the+Vaal
 *
 * Returns aggregated overview data:
 *   - topGainers: top 10 items by positive 24h changePercent
 *   - topLosers: top 10 items by negative 24h changePercent
 *   - topGainers7d: top 10 items by 7d change
 *   - topLosers7d: top 10 items by 7d change
 *   - stats: { totalVolume, trackedItems, exchangePairs }
 *   - snapshotHistory: volume/market cap trend data
 *
 * The /Items endpoint does NOT return PriceLogs, so we fetch
 * currencies and uniques by category (which DO include PriceLogs)
 * and merge them for the movers computation.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const realm = searchParams.get("realm");
    const league = searchParams.get("league");

    if (!realm || !league) {
      return NextResponse.json({ error: "realm and league are required" }, { status: 400 });
    }

    // Fetch all data in parallel
    const [allItems, pairs, snapshotHistory, currenciesData, uniquesData] = await Promise.all([
      getItems(realm, league).catch(() => [] as PoeItem[]),
      getSnapshotPairs(realm, league).catch(() => []),
      getSnapshotHistory(realm, league, 168).catch(() => []),
      // Fetch all currency categories (page 1 of each, merged)
      getCurrenciesByCategory(realm, league, "all", 1, 250).catch(() => ({ items: [] as PoeItem[], page: 1, perPage: 250, totalItems: 0, totalPages: 0 })),
      // Fetch all unique categories (page 1 of each, merged)
      getUniquesByCategory(realm, league, "all", 1, 250).catch(() => ({ items: [] as PoeItem[], page: 1, perPage: 250, totalItems: 0, totalPages: 0 })),
    ]);

    // Merge items with price change data (from currencies + uniques)
    // These have PriceLogs so changePercent is available
    const itemsWithChangeData = [
      ...(currenciesData.items ?? []),
      ...(uniquesData.items ?? []),
    ];

    // Compute top movers (24h)
    const validItems = itemsWithChangeData.filter(
      (i) => i.changePercent != null && i.volume != null && i.volume > 0
    );

    const sorted24h = [...validItems].sort(
      (a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0)
    );

    const topGainers = sorted24h.slice(0, 10);
    const topLosers = sorted24h.slice(-10).reverse();

    // Compute top movers (7d)
    const validItems7d = itemsWithChangeData.filter(
      (i) => i.sevenDayPriceChangePercent != null && i.volume != null && i.volume > 0
    );

    const sorted7d = [...validItems7d].sort(
      (a, b) => (b.sevenDayPriceChangePercent ?? 0) - (a.sevenDayPriceChangePercent ?? 0)
    );

    const topGainers7d = sorted7d.slice(0, 10);
    const topLosers7d = sorted7d.slice(-10).reverse();

    // Market stats
    const totalVolume = itemsWithChangeData.reduce(
      (sum, i) => sum + (i.volume ?? 0), 0
    );
    const trackedItems = allItems.length;
    const exchangePairs = pairs.length;

    return NextResponse.json({
      topGainers,
      topLosers,
      topGainers7d,
      topLosers7d,
      stats: {
        totalVolume,
        trackedItems,
        exchangePairs,
      },
      snapshotHistory,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    const status = message.includes("timed out") ? 504 : 502;
    return NextResponse.json(
      { error: message, hint: message.includes("unreachable") ? "Try setting POE2_API_BASE_URL=https://api.poe2scout.com/api in .env.local" : undefined },
      { status }
    );
  }
}
