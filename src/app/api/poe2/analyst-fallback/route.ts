// ============================================================================
// Analyst Fallback — Lightweight league analysis using only POE2Scout API data
// (no FastAPI backend required)
//
// When the flipper backend is offline (backendOnline === false), this route
// provides a simplified analyst summary computed directly from SnapshotPairs
// and ByCategory currency data. This avoids the white-screen/empty-tab problem
// and gives users useful market information even without the backend.
//
// Computation:
//   1. Fetch SnapshotPairs → extract all unique currencies + their prices
//   2. Fetch ByCategory currencies → get PriceLogs for 24h change computation
//   3. Compute: total currencies, total pairs, trending up/down/stable, top movers
//   4. Detect simple anomalies (large 24h price swings)
//   5. Generate basic facts
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import {
  getSnapshotPairs,
  getCurrenciesByCategory,
} from "@/lib/poe2api";
import type { PoeItem } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Thresholds (matching backend/routes_analyst.py)
const TREND_UP_THRESHOLD = 2; // +2% = trending up
const TREND_DOWN_THRESHOLD = -2; // -2% = trending down
const ANOMALY_ZSCORE_THRESHOLD = 2.0;

interface FallbackTrend {
  apiId: string;
  currentPrice: number;
  change24hPct: number | null;
  direction: "up" | "down" | "stable" | "unknown";
}

interface FallbackAnomaly {
  apiId: string;
  zScore: number;
  direction: "spike_up" | "spike_down";
  currentPrice: number;
  changePct: number | null;
}

interface FallbackFact {
  type: "trend" | "anomaly" | "market";
  icon: string;
  text: string;
  severity: "info" | "warning";
}

/**
 * Extract trend data from a PoeItem using its history (PriceLogs).
 * Returns null if there's not enough data for a 24h change.
 */
function extractTrendFromItem(item: PoeItem): FallbackTrend | null {
  const historyPoints = item.history ?? [];
  const currentPrice = item.relativePrice ?? item.chaosEquivalentRate ?? 0;

  // Use changePercent already computed by mapCurrencyItem if available
  if (item.changePercent !== null) {
    let direction: FallbackTrend["direction"] = "unknown";
    if (item.changePercent > TREND_UP_THRESHOLD) direction = "up";
    else if (item.changePercent < TREND_DOWN_THRESHOLD) direction = "down";
    else direction = "stable";

    return { apiId: item.apiId, currentPrice, change24hPct: item.changePercent, direction };
  }

  // Fallback: compute from history points
  if (historyPoints.length >= 2) {
    const recent = historyPoints[historyPoints.length - 1].price;
    const older = historyPoints[0].price;
    let change24hPct: number | null = null;
    if (older > 0) {
      change24hPct = ((recent - older) / older) * 100;
    }

    let direction: FallbackTrend["direction"] = "unknown";
    if (change24hPct !== null) {
      if (change24hPct > TREND_UP_THRESHOLD) direction = "up";
      else if (change24hPct < TREND_DOWN_THRESHOLD) direction = "down";
      else direction = "stable";
    }

    return { apiId: item.apiId, currentPrice, change24hPct, direction };
  }

  return { apiId: item.apiId, currentPrice, change24hPct: null, direction: "unknown" };
}

/**
 * Extract price series from a PoeItem's history for anomaly detection.
 */
function extractPriceSeries(item: PoeItem): number[] | null {
  const historyPoints = item.history ?? [];
  if (historyPoints.length < 5) return null;
  return historyPoints.map((p) => p.price);
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const realm = searchParams.get("realm") || "poe2";
  const league = searchParams.get("league");

  if (!league) {
    return NextResponse.json(
      { error: "league parameter is required" },
      { status: 400 }
    );
  }

  try {
    // 1. Fetch SnapshotPairs for pair count and base currency info
    const pairs = await getSnapshotPairs(realm, league, true);
    const totalPairs = pairs.length;

    // Extract unique currencies from pairs
    const currencyIds = new Set<string>();
    for (const pair of pairs) {
      currencyIds.add(pair.currency1Id);
      currencyIds.add(pair.currency2Id);
    }

    // 2. Fetch currencies with PriceLogs for change data
    const trends: FallbackTrend[] = [];
    const allPriceChanges: { apiId: string; prices: number[] }[] = [];

    // Try common categories
    const categories = ["runes", "currency", "essences", "catalysts", "breach", "delirium"];
    const seenApiIds = new Set<string>();

    for (const cat of categories) {
      try {
        const page1 = await getCurrenciesByCategory(realm, league, cat, 1, 250);
        const items = page1.items || [];

        for (const item of items) {
          if (seenApiIds.has(item.apiId)) continue;
          seenApiIds.add(item.apiId);

          const trend = extractTrendFromItem(item);
          if (trend) trends.push(trend);

          const priceSeries = extractPriceSeries(item);
          if (priceSeries) {
            allPriceChanges.push({ apiId: item.apiId, prices: priceSeries });
          }
        }

        // Fetch remaining pages if there are more
        if (page1.totalPages > 1) {
          for (let p = 2; p <= Math.min(page1.totalPages, 3); p++) {
            try {
              const pageN = await getCurrenciesByCategory(realm, league, cat, p, 250);
              for (const item of pageN.items || []) {
                if (seenApiIds.has(item.apiId)) continue;
                seenApiIds.add(item.apiId);

                const trend = extractTrendFromItem(item);
                if (trend) trends.push(trend);

                const priceSeries = extractPriceSeries(item);
                if (priceSeries) {
                  allPriceChanges.push({ apiId: item.apiId, prices: priceSeries });
                }
              }
            } catch {
              // Skip failed pages
            }
          }
        }
      } catch {
        // Category may not exist in this league — skip
      }
    }

    // Sort trends by absolute change (most volatile first)
    trends.sort((a, b) => Math.abs(b.change24hPct ?? 0) - Math.abs(a.change24hPct ?? 0));

    // 3. Detect simple anomalies using z-score on price changes
    const anomalies: FallbackAnomaly[] = [];
    for (const { apiId, prices } of allPriceChanges) {
      if (prices.length < 5) continue;

      const changes: number[] = [];
      for (let i = 1; i < prices.length; i++) {
        if (prices[i - 1] > 0) {
          changes.push(prices[i] - prices[i - 1]);
        }
      }
      if (changes.length < 3) continue;

      const mean = changes.reduce((a, b) => a + b, 0) / changes.length;
      const std = Math.sqrt(changes.reduce((a, b) => a + (b - mean) ** 2, 0) / changes.length);

      if (std < 1e-10) continue;

      const latestChange = changes[changes.length - 1];
      const zScore = (latestChange - mean) / std;

      if (Math.abs(zScore) > ANOMALY_ZSCORE_THRESHOLD) {
        const prevPrice = prices.length >= 2 ? prices[prices.length - 2] : 0;
        anomalies.push({
          apiId,
          zScore: Math.round(zScore * 100) / 100,
          direction: zScore > 0 ? "spike_up" : "spike_down",
          currentPrice: prices[prices.length - 1],
          changePct: prevPrice > 0 ? Math.round((latestChange / prevPrice) * 10000) / 100 : null,
        });
      }
    }

    anomalies.sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore));
    const topAnomalies = anomalies.slice(0, 20);

    // 4. Compute summary
    const totalCurrencies = Math.max(seenApiIds.size, currencyIds.size);
    const upCount = trends.filter((t) => t.direction === "up").length;
    const downCount = trends.filter((t) => t.direction === "down").length;
    const stableCount = trends.filter((t) => t.direction === "stable").length;

    // 5. Generate facts
    const facts: FallbackFact[] = [];

    const bigMoversUp = trends.filter((t) => t.direction === "up").slice(0, 3);
    const bigMoversDown = trends.filter((t) => t.direction === "down").slice(0, 3);

    if (bigMoversUp.length > 0) {
      const top = bigMoversUp[0];
      facts.push({
        type: "trend",
        icon: "up",
        text: `${top.apiId} is the biggest gainer (+${(top.change24hPct ?? 0).toFixed(1)}% in 24h)`,
        severity: "info",
      });
    }

    if (bigMoversDown.length > 0) {
      const top = bigMoversDown[0];
      facts.push({
        type: "trend",
        icon: "down",
        text: `${top.apiId} is the biggest loser (${(top.change24hPct ?? 0).toFixed(1)}% in 24h)`,
        severity: "warning",
      });
    }

    if (topAnomalies.length > 0) {
      facts.push({
        type: "anomaly",
        icon: "alert",
        text: `${topAnomalies.length} currencies showing unusual price activity`,
        severity: topAnomalies.length > 5 ? "warning" : "info",
      });
    }

    if (totalCurrencies > 0) {
      facts.push({
        type: "market",
        icon: "chart",
        text: `Tracking ${totalCurrencies} currencies across ${totalPairs} trading pairs`,
        severity: "info",
      });
    }

    if (stableCount > 0) {
      facts.push({
        type: "market",
        icon: "shield",
        text: `${stableCount} currencies holding stable (less than 2% change)`,
        severity: "info",
      });
    }

    return NextResponse.json({
      league,
      summary: {
        totalCurrencies,
        totalPairs,
        trendingUp: upCount,
        trendingDown: downCount,
        stable: stableCount,
        anomalyCount: topAnomalies.length,
      },
      trends: trends.slice(0, 30),
      anomalies: topAnomalies,
      facts,
      dataAvailable: totalCurrencies > 0,
      fetchedAt: new Date().toISOString(),
      _fallback: true,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json(
      { error: message, error_type: "upstream_error" },
      { status: 502 }
    );
  }
}
