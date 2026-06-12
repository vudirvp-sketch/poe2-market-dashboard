import { NextRequest } from "next/server";
import { proxyWithFallback } from "@/lib/flipper-proxy";

export const dynamic = "force-dynamic";

interface HeatmapItem {
  currency: string;
  change24h: number;
}

/** GET /api/flipper/heatmap → proxies to FastAPI GET /api/prices/heatmap
 *  CRITICAL-3 FIX: The backend returns { currencies: [...], fetched_at: "..." }
 *  but the frontend expects HeatmapItem[]. This proxy reshapes the response.
 *
 *  ENHANCEMENT: When the flipper backend is offline (returns empty fallback),
 *  generate heatmap data from the POE2Scout API directly. This allows the
 *  heatmap to work even when the FastAPI backend is not running.
 *
 *  Query parameters:
 *    realm  — POE2 realm (default: "poe2")
 *    league — League short name (default: "runes")
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const realm = searchParams.get("realm") || "poe2";
  const league = searchParams.get("league") || "runes";

  const res = await proxyWithFallback(
    "/api/v1/prices/heatmap",
    {
      offlineFallback: [],  // Empty heatmap — will try POE2Scout fallback below
    },
  );

  // If the fallback was returned (empty array), try POE2Scout API
  try {
    const data = await res.json();

    // If it's already an array (fallback or direct array response), check if empty
    if (Array.isArray(data)) {
      if (data.length > 0) {
        return Response.json(data);
      }
      // Empty array from fallback — try POE2Scout API
      const poe2scoutData = await generateHeatmapFromPoe2Scout(realm, league);
      if (poe2scoutData.length > 0) {
        return Response.json(poe2scoutData);
      }
      return Response.json([]);
    }

    // Handle wrapper object shape: { currencies: [...], fetched_at: "..." }
    // Extract the currencies array and reshape to HeatmapItem[]
    const heatmapItems: HeatmapItem[] = (data.currencies ?? []).map(
      (item: Record<string, unknown>) => ({
        currency: (item.text as string) ?? (item.api_id as string) ?? "unknown",
        change24h:
          Array.isArray(item.changes) && item.changes.length > 0
            ? (item.changes[item.changes.length - 1] as number) // last change value = most recent
            : 0,
      })
    );

    return Response.json(heatmapItems);
  } catch {
    // If JSON parsing fails, try POE2Scout fallback, then return empty array
    try {
      const poe2scoutData = await generateHeatmapFromPoe2Scout(realm, league);
      if (poe2scoutData.length > 0) {
        return Response.json(poe2scoutData);
      }
    } catch {
      // POE2Scout API also failed
    }
    return Response.json([]);
  }
}

/**
 * Generate heatmap data from the POE2Scout API when the flipper backend
 * is offline. Fetches currencies with PriceLogs and computes 24h change %.
 *
 * This function is called ONLY when the flipper backend returns no data.
 * It fetches the most liquid currency categories and computes 24h changes
 * from the PriceLogs that the POE2Scout API includes in its responses.
 */
async function generateHeatmapFromPoe2Scout(realm: string, league: string): Promise<HeatmapItem[]> {
  // Use dynamic import to avoid circular dependencies at module load time
  const { getCurrenciesByCategory } = await import("@/lib/poe2api");

  const heatmapItems: HeatmapItem[] = [];

  // Fetch the most liquid categories for heatmap data.
  // We only need page 1 with a small subset — the heatmap doesn't need all items,
  // just enough to show a representative overview.
  const categories = ["currency", "fragments", "runes", "essences"];

  for (const category of categories) {
    try {
      const result = await getCurrenciesByCategory(realm, league, category, 1, 50);

      for (const item of result.items) {
        // Only include items with valid 24h change data
        if (item.changePercent != null && isFinite(item.changePercent) && item.name) {
          heatmapItems.push({
            currency: item.name,
            change24h: item.changePercent,
          });
        }
      }
    } catch {
      // Skip categories that fail to load — partial data is better than no data
    }
  }

  // Sort by absolute change descending (most volatile first)
  heatmapItems.sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h));

  return heatmapItems;
}
