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

// ---------------------------------------------------------------------------
// Module-level overview cache (stale-while-revalidate)
//
// The overview route previously called getCurrenciesByCategory("all") and
// getUniquesByCategory("all") on EVERY request, which triggers 15+ ByCategory
// API calls each time (one per category). Since the overview data doesn't need
// to be real-time (5-minute staleness is acceptable), we cache the heavy
// ByCategory results and only revalidate in the background.
//
// Cache TTL: 5 minutes fresh, 10 minutes stale-while-revalidate
// ---------------------------------------------------------------------------

const OVERVIEW_CACHE_TTL = 5 * 60_000;       // 5 minutes
const OVERVIEW_STALE_TTL = 10 * 60_000;      // 10 minutes — serve stale up to this

interface OverviewCache {
  topGainers: PoeItem[];
  topLosers: PoeItem[];
  topGainers7d: PoeItem[];
  topLosers7d: PoeItem[];
  totalVolume: number;
  ts: number;
}

let _overviewCache: OverviewCache | null = null;
let _revalidationInProgress = false;

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
 *
 * OPTIMIZATION: Caches the heavy ByCategory results for 5 minutes
 * and revalidates in the background, reducing API calls from 30+
 * per page load to ~16 per 5-minute window.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const realm = searchParams.get("realm");
    const league = searchParams.get("league");

    if (!realm || !league) {
      return NextResponse.json({ error: "realm and league are required" }, { status: 400 });
    }

    const now = Date.now();

    // ---- Fetch lightweight data in parallel (always fresh) ----
    const [allItems, pairs, snapshotHistory] = await Promise.all([
      getItems(realm, league).catch(() => [] as PoeItem[]),
      getSnapshotPairs(realm, league).catch(() => []),
      getSnapshotHistory(realm, league, 168).catch(() => []),
    ]);

    // ---- Check overview cache for heavy ByCategory data ----
    const cached = _overviewCache;
    let moversData: {
      topGainers: PoeItem[];
      topLosers: PoeItem[];
      topGainers7d: PoeItem[];
      topLosers7d: PoeItem[];
      totalVolume: number;
    };

    if (cached && now - cached.ts < OVERVIEW_CACHE_TTL) {
      // Fresh cache hit — use cached movers data
      moversData = {
        topGainers: cached.topGainers,
        topLosers: cached.topLosers,
        topGainers7d: cached.topGainers7d,
        topLosers7d: cached.topLosers7d,
        totalVolume: cached.totalVolume,
      };
    } else if (cached && now - cached.ts < OVERVIEW_STALE_TTL) {
      // Stale-but-usable — return stale, revalidate in background
      moversData = {
        topGainers: cached.topGainers,
        topLosers: cached.topLosers,
        topGainers7d: cached.topGainers7d,
        topLosers7d: cached.topLosers7d,
        totalVolume: cached.totalVolume,
      };
      // Fire-and-forget revalidation
      if (!_revalidationInProgress) {
        _revalidationInProgress = true;
        _revalidateOverviewCache(realm, league).finally(() => {
          _revalidationInProgress = false;
        });
      }
    } else {
      // No cache or too stale — must fetch
      moversData = await _fetchMoversData(realm, league);
    }

    const trackedItems = allItems.length;
    const exchangePairs = pairs.length;

    return NextResponse.json({
      topGainers: moversData.topGainers,
      topLosers: moversData.topLosers,
      topGainers7d: moversData.topGainers7d,
      topLosers7d: moversData.topLosers7d,
      stats: {
        totalVolume: moversData.totalVolume,
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

/**
 * Fetch all ByCategory data and compute top movers.
 * This is the expensive operation (15+ API calls) that we cache.
 *
 * Fix 4.12: Paginated fetching — instead of only loading the first 250 items,
 * this now fetches all available pages (up to 10 pages = 2500 items per type).
 * This ensures items beyond position 250 are included in top movers.
 */
async function _fetchMoversData(
  realm: string,
  league: string,
): Promise<{
  topGainers: PoeItem[];
  topLosers: PoeItem[];
  topGainers7d: PoeItem[];
  topLosers7d: PoeItem[];
  totalVolume: number;
}> {
  // Fix 4.12: Fetch all pages of currencies and uniques instead of just page 1
  const [currenciesData, uniquesData] = await Promise.all([
    _fetchAllPages(realm, league, getCurrenciesByCategory),
    _fetchAllPages(realm, league, getUniquesByCategory),
  ]);

  // Merge items with price change data
  const itemsWithChangeData = [
    ...currenciesData,
    ...uniquesData,
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

  // Update cache
  _overviewCache = {
    topGainers,
    topLosers,
    topGainers7d,
    topLosers7d,
    totalVolume,
    ts: Date.now(),
  };

  return { topGainers, topLosers, topGainers7d, topLosers7d, totalVolume };
}

/**
 * Fix 4.12: Fetch all pages from a ByCategory endpoint.
 * Loads up to 10 pages (2500 items) to ensure we don't miss items
 * beyond the first 250.
 */
async function _fetchAllPages(
  realm: string,
  league: string,
  fetchFn: (realm: string, league: string, category: string, page: number, perPage: number) => Promise<{ items: PoeItem[]; page: number; perPage: number; totalItems: number; totalPages: number }>,
): Promise<PoeItem[]> {
  const allItems: PoeItem[] = [];
  const perPage = 250;
  let page = 1;
  const MAX_PAGES = 10; // Safety: max 10 pages = 2500 items

  try {
    do {
      const result = await fetchFn(realm, league, "all", page, perPage);
      allItems.push(...(result.items ?? []));
      page++;
      if (page > result.totalPages) break;
    } while (page <= MAX_PAGES);
  } catch {
    // Return whatever we got so far
  }

  return allItems;
}

/**
 * Background revalidation of the overview cache.
 */
async function _revalidateOverviewCache(realm: string, league: string): Promise<void> {
  try {
    await _fetchMoversData(realm, league);
  } catch {
    // Silently ignore — stale data still being served
  }
}
