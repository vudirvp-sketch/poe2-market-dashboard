"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useState, useEffect, type ReactNode } from "react";
import { I18nProvider } from "@/lib/i18n";
import { useDashboardStore } from "@/lib/store";

/**
 * Query key prefixes used across the application.
 * Centralized here to ensure consistency and prevent cache fragmentation.
 *
 * Rule: All queryKeys for the same data MUST use the same prefix + parameters.
 * Example: exchange pairs → ["exchangePairs", realm, league] everywhere.
 */
export const QUERY_KEYS = {
  /** Exchange pairs from POE2Scout API */
  exchangePairs: "exchangePairs",
  /** Heatmap data from flipper backend */
  heatmap: "heatmap",
  /** Item price history */
  itemHistory: "itemHistory",
  /** Item daily stats */
  itemDaily: "itemDaily",
  /** Item OHLCV candles */
  itemOhlcv: "itemOhlcv",
  /** Benchmark data for a currency */
  benchmark: "benchmark",
  /** Flipper health check */
  flipperHealth: "flipper-health",
  /** Flipper phase */
  flipperPhase: "flipper-phase",
  /** Flipper scored flips */
  flipperFlips: "flipper-flips",
  /** Flipper triangular arbitrage */
  flipperTriangular: "flipper-triangular",
  /** Flipper events */
  flipperEvents: "flipper-events",
  /** Flipper liquid chain */
  flipperLiquidChain: "flipper-liquid-chain",
  /** Flipper tiers */
  flipperTiers: "flipperTiers",
  /** Flipper anomalies */
  flipperAnomalies: "flipper-anomalies",
  /** Flipper optimal currency */
  flipperOptimalCurrency: "flipper-optimal-currency",
  /** Flipper optimizer path */
  flipperOptimizerPath: "flipper-optimizer-path",
  /** Flipper optimizer matrix */
  flipperOptimizerMatrix: "flipper-optimizer-matrix",
  /** Flipper analyst summary */
  flipperAnalystSummary: "flipper-analyst-summary",
  /** Flipper storage value */
  flipperStorageValue: "flipper-storage-value",
  /** Flipper prices */
  flipperPrices: "flipper-prices",
  /** Flipper currencies */
  flipperCurrencies: "flipper-currencies",
  /** Flipper events count */
  flipperEventsCount: "flipper-events-count",
  /** POE2 overview */
  overview: "overview",
  /** POE2 realms */
  realms: "realms",
  /** POE2 leagues */
  leagues: "leagues",
  /** POE2 reference currencies */
  referenceCurrencies: "referenceCurrencies",
  /** POE2 all items */
  allItems: "allItems",
  /** POE2 item categories */
  itemCategories: "itemCategories",
  /** POE2 currencies (items with category) */
  currencies: "currencies",
  /** POE2 uniques */
  uniques: "uniques",
  /** Analyst fallback (no backend) */
  analystFallback: "analyst-fallback",
  /** Portfolio correlation */
  portfolioCorrelation: "portfolio-correlation",
  /** Pair hover history */
  pairHoverHistory: "pairHoverHistory",
} as const;

/**
 * Stale time defaults by query key prefix (in milliseconds).
 * Queries whose key starts with a listed prefix get the specified staleTime.
 * Unlisted queries use the global default (60s).
 */
const STALE_TIME_DEFAULTS: Record<string, number> = {
  /** Exchange pairs: 5 minutes — data changes slowly */
  [QUERY_KEYS.exchangePairs]: 5 * 60_000,
  /** Heatmap: 5 minutes — aggregates change slowly */
  [QUERY_KEYS.heatmap]: 5 * 60_000,
  /** Item history: 2 minutes — price history is updated periodically */
  [QUERY_KEYS.itemHistory]: 2 * 60_000,
  /** Item daily stats: 5 minutes */
  [QUERY_KEYS.itemDaily]: 5 * 60_000,
  /** Item OHLCV: 2 minutes */
  [QUERY_KEYS.itemOhlcv]: 2 * 60_000,
  /** Benchmark: 5 minutes */
  [QUERY_KEYS.benchmark]: 5 * 60_000,
  /** Overview: 2 minutes */
  [QUERY_KEYS.overview]: 2 * 60_000,
  /** Realms: 30 minutes — changes very rarely */
  [QUERY_KEYS.realms]: 30 * 60_000,
  /** Leagues: 30 minutes */
  [QUERY_KEYS.leagues]: 30 * 60_000,
  /** Reference currencies: 10 minutes */
  [QUERY_KEYS.referenceCurrencies]: 10 * 60_000,
  /** All items: 2 minutes */
  [QUERY_KEYS.allItems]: 2 * 60_000,
  /** Item categories: 10 minutes */
  [QUERY_KEYS.itemCategories]: 10 * 60_000,
  /** Flipper flips: 60 seconds — core data for flips tab */
  [QUERY_KEYS.flipperFlips]: 60_000,
  /** Flipper triangular: 60 seconds */
  [QUERY_KEYS.flipperTriangular]: 60_000,
  /** Flipper phase: 60 seconds */
  [QUERY_KEYS.flipperPhase]: 60_000,
  /** Flipper health: 30 seconds */
  [QUERY_KEYS.flipperHealth]: 30_000,
  /** Flipper tiers: 5 minutes */
  [QUERY_KEYS.flipperTiers]: 5 * 60_000,
  /** Flipper liquid chain: 60 seconds */
  [QUERY_KEYS.flipperLiquidChain]: 60_000,
  /** Flipper analyst summary: 2 minutes */
  [QUERY_KEYS.flipperAnalystSummary]: 2 * 60_000,
  /** Analyst fallback: 5 minutes */
  [QUERY_KEYS.analystFallback]: 5 * 60_000,
  /** Portfolio correlation: 5 minutes */
  [QUERY_KEYS.portfolioCorrelation]: 5 * 60_000,
};

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () => {
      const client = new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000, // 60 seconds global default
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      });

      // Set per-query-key defaults for staleTime.
      // This ensures consistent caching across all components that use
      // the same query key prefix, without each component needing to
      // specify staleTime individually.
      for (const [keyPrefix, staleTime] of Object.entries(STALE_TIME_DEFAULTS)) {
        client.setQueryDefaults([keyPrefix], { staleTime });
      }

      return client;
    }
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        attribute="class"
        defaultTheme="dark"
        enableSystem
        disableTransitionOnChange
      >
        <I18nProvider>
          <StoreRehydrator>{children}</StoreRehydrator>
        </I18nProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

/**
 * Triggers Zustand store rehydration from localStorage AFTER mount.
 * This avoids hydration mismatches because SSR always renders with
 * empty state, and the real data is loaded client-side only.
 */
function StoreRehydrator({ children }: { children: ReactNode }) {
  const rehydrate = useDashboardStore((s) => s.rehydrate);

  useEffect(() => {
    rehydrate();
  }, [rehydrate]);

  return <>{children}</>;
}
