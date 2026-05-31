import { proxyToFlipper } from "@/lib/flipper-proxy";

export const dynamic = "force-dynamic";

interface HeatmapItem {
  currency: string;
  change_24h: number;
}

/** GET /api/flipper/heatmap → proxies to FastAPI GET /api/prices/heatmap
 *  CRITICAL-3 FIX: The backend returns { currencies: [...], fetched_at: "..." }
 *  but the frontend expects HeatmapItem[]. This proxy reshapes the response.
 */
export async function GET() {
  const backendResponse = await proxyToFlipper("/api/prices/heatmap");

  // If the backend returned an error (503, etc.), pass it through as-is
  if (!backendResponse.ok) {
    return backendResponse;
  }

  try {
    const backendData = await backendResponse.json();

    // Handle wrapper object shape: { currencies: [...], fetched_at: "..." }
    // If it's already an array, pass through
    if (Array.isArray(backendData)) {
      return Response.json(backendData);
    }

    // Extract the currencies array and reshape to HeatmapItem[]
    const heatmapItems: HeatmapItem[] = (backendData.currencies ?? []).map(
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
