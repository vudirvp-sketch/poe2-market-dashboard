import { proxyWithFallback } from "@/lib/flipper-proxy";

export const dynamic = "force-dynamic";

interface HeatmapItem {
  currency: string;
  change_24h: number;
}

/** GET /api/flipper/heatmap → proxies to FastAPI GET /api/prices/heatmap
 *  CRITICAL-3 FIX: The backend returns { currencies: [...], fetched_at: "..." }
 *  but the frontend expects HeatmapItem[]. This proxy reshapes the response.
 *
 *  FIX: When the backend is offline, return empty array instead of 503.
 *  The frontend already handles empty heatmap data gracefully.
 */
export async function GET() {
  const res = await proxyWithFallback(
    "/api/prices/heatmap",
    {
      offlineFallback: [],  // Empty heatmap — frontend shows "no data" state
    },
  );

  // If the fallback was returned (empty array), just return it
  try {
    const data = await res.json();

    // If it's already an array (fallback or direct array response), return as-is
    if (Array.isArray(data)) {
      return Response.json(data);
    }

    // Handle wrapper object shape: { currencies: [...], fetched_at: "..." }
    // Extract the currencies array and reshape to HeatmapItem[]
    const heatmapItems: HeatmapItem[] = (data.currencies ?? []).map(
      (item: Record<string, unknown>) => ({
        currency: (item.text as string) ?? (item.api_id as string) ?? "unknown",
        change_24h:
          Array.isArray(item.changes) && item.changes.length > 0
            ? (item.changes[item.changes.length - 1] as number) // last change value = most recent
            : 0,
      })
    );

    return Response.json(heatmapItems);
  } catch {
    // If JSON parsing fails, return empty array to prevent frontend crash
    return Response.json([]);
  }
}
