"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Coins,
  Shield,
  ArrowLeftRight,
  Star,
  BarChart3,
  AlertTriangle,
  GitCompare,
  Bell,
  TrendingUp,
  Route,
  Network,
  Keyboard,
  LineChart,
  Droplets,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { Header } from "@/components/dashboard/header";
// P2-1 (iter 71): ExchangeTabContent extracted from this file.
import { ExchangeTabContent } from "@/components/dashboard/exchange-tab-content";
// P2-1 (iter 72): CurrenciesTabContent / UniquesTabContent / OverviewTabContent extracted.
import { CurrenciesTabContent } from "@/components/dashboard/currencies-tab-content";
import { UniquesTabContent } from "@/components/dashboard/uniques-tab-content";
import { OverviewTabContent } from "@/components/dashboard/overview-tab-content";
import { DetailDialog } from "@/components/dashboard/detail-dialog";
import { PairDetailDialog } from "@/components/dashboard/pair-detail-dialog";
// WatchlistTab — lazy-loaded (Phase 4.1)
import { ComparisonDialog } from "@/components/dashboard/comparison-dialog";
import { PairComparisonDialog } from "@/components/dashboard/pair-comparison-dialog";
import { PriceAlertDialog } from "@/components/dashboard/price-alert-dialog";
// ArbitrageTab, ArbitrageFlipperFlips, ArbitrageHelpers — deleted (iter 37)
// FlipsTab, OptimizerTab, AnalystTab — lazy-loaded (Phase 4.1)
import { ShortcutsDialog } from "@/components/dashboard/shortcuts-dialog";
// MarketHeatmap — deleted (iter 37)
import { TierDriftTracker } from "@/components/dashboard/tier-drift-tracker";
// LiquidChainTab — lazy-loaded (Phase 4.1)

// Phase 4.1: Lazy-loaded tab components via next/dynamic.
// Heavy tabs (Flips, Optimizer, Analyst, LiquidChain, CurrencyGraph, Watchlist)
// are only loaded when the user actually navigates to them, reducing the
// initial JavaScript bundle size significantly.
//
// Lightweight tabs (Overview, Currencies, Uniques, Exchange) are still
// eagerly imported because they're the most commonly viewed tabs.
import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

/** Generic tab skeleton loader — shown while lazy tab chunk loads */
const TabSkeleton = () => (
  <div className="space-y-4 p-4">
    <Skeleton className="h-8 w-48" />
    <Skeleton className="h-4 w-full max-w-md" />
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <Skeleton className="h-24" />
      <Skeleton className="h-24" />
      <Skeleton className="h-24" />
      <Skeleton className="h-24" />
    </div>
    <Skeleton className="h-[400px] w-full" />
  </div>
);

const FlipsTab = dynamic(
  () => import("@/components/dashboard/flips-tab").then((m) => ({ default: m.FlipsTab })),
  { loading: TabSkeleton },
);

const OptimizerTab = dynamic(
  () => import("@/components/dashboard/optimizer-tab").then((m) => ({ default: m.OptimizerTab })),
  { loading: TabSkeleton },
);

const AnalystTab = dynamic(
  () => import("@/components/dashboard/analyst-tab").then((m) => ({ default: m.AnalystTab })),
  { loading: TabSkeleton },
);

const LiquidChainTab = dynamic(
  () => import("@/components/dashboard/liquid-chain-tab").then((m) => ({ default: m.LiquidChainTab })),
  { loading: TabSkeleton },
);

const CurrencyGraphTab = dynamic(
  () => import("@/components/dashboard/currency-graph-tab").then((m) => ({ default: m.CurrencyGraphTab })),
  { loading: TabSkeleton },
);

const WatchlistTab = dynamic(
  () => import("@/components/dashboard/watchlist-tab").then((m) => ({ default: m.WatchlistTab })),
  { loading: TabSkeleton },
);

import { EventsSidebar } from "@/components/dashboard/events-sidebar";
import { OfflineBanner } from "@/components/dashboard/offline-banner";
import { FlipperStickyBar } from "@/components/dashboard/flipper-sticky-bar";
import { ErrorBoundary } from "@/components/dashboard/error-boundary";

import {
  fetchApi,
  exportToCsv,
  exportToJson,
} from "@/lib/types";
import { useExchangePairs, useReferenceCurrencies } from "@/hooks/use-exchange-pairs";
import { useCrossRates } from "@/hooks/use-cross-rates";
import { useCurrencyItems, useAllItems, useItemCategories } from "@/hooks/use-currency-items";
import { useUniqueItems } from "@/hooks/use-unique-items";
import { usePrefetch } from "@/hooks/use-prefetch";
import { useInitialBatch } from "@/hooks/use-batch-query";
import { usePriceStream } from "@/hooks/use-price-stream";
import { QUERY_KEYS } from "@/components/providers";
import type {
  Realm,
  League,
  PoeItem,
  ExchangePair,
  ReferenceCurrency,
  FlipperHealthResponse,
  FlipperPhaseResponse,
  FlipperEventsSummary,
  OptimalPaymentResult,
  OptimalCurrencyResponse,
  CrossRateFlip,
} from "@/lib/types";
import {
  findOptimalPayment,
  isItemCategory,
} from "@/lib/currency-optimal";
import { useDashboardStore } from "@/lib/store";
import { usePriceAlerts } from "@/hooks/use-price-alerts";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import type { KeyboardShortcutActions } from "@/hooks/use-keyboard-shortcuts";
import { useI18n } from "@/lib/i18n";

// Virtualization threshold: use virtual grid when more than this many currencies
const CURRENCY_VIRTUAL_THRESHOLD = 30;



// ============================================================================
// Main Dashboard
// ============================================================================
export function Dashboard() {
  // --- Selection state ---
  // Default realm is "poe2" to match API URL path segment
  const [realm, setRealm] = useState("poe2");
  const [league, setLeagueLocal] = useState("");
  const [tab, setTabLocal] = useState("overview");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");

  // --- Pagination state ---
  const [uniquesPage, setUniquesPage] = useState(1);
  const [uniquesPerPage, setUniquesPerPage] = useState(50);
  const [currenciesPage, setCurrenciesPage] = useState(1);
  const [currenciesPerPage, setCurrenciesPerPage] = useState(50);

  // --- Detail dialog ---
  const [detailItem, setDetailItem] = useState<PoeItem | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // --- Pair detail dialog ---
  const [detailPair, setDetailPair] = useState<ExchangePair | null>(null);
  const [pairDetailOpen, setPairDetailOpen] = useState(false);

  // --- Comparison dialog ---
  const [comparisonOpen, setComparisonOpen] = useState(false);

  // --- Pair comparison dialog ---
  const [pairComparisonOpen, setPairComparisonOpen] = useState(false);

  // --- Price alert dialog ---
  const [alertOpen, setAlertOpen] = useState(false);

  // --- Auto-refresh ---
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // --- Base currency ---
  const [referenceCurrency, setReferenceCurrency] = useState("");

  // --- Events sidebar ---
  const [eventsSidebarOpen, setEventsSidebarOpen] = useState(false);

  // --- §2.3: Extended filters panel ---
  const [extendedFiltersOpen, setExtendedFiltersOpen] = useState(false);

  // --- §3.2: Keyboard shortcuts state ---
  const [highlightedRowIndex, setHighlightedRowIndex] = useState<number | null>(null);
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false);

  // --- §3.5: Search result highlight (scroll + pulse) ---
  const [highlightedItemId, setHighlightedItemId] = useState<string | null>(null);

  // --- Comparison store ---
  const {
    comparisonIds,
    pairComparisonIds,
    alerts,
    uiState,
    setActiveTab,
    setLeague: persistLeague,
    setExchangeViewMode,
    setExchangeFilter,
    setExchangeExtendedFilters,
    clearExchangeExtendedFilters,
    setDenseMode,
    setBaseCurrency,
    _hydrated: storeHydrated,
  } = useDashboardStore();

  // SSR/hydration safety: baseCurrencyApiId may differ between server and client.
  // With ssr: false this is already mitigated, but we add an explicit guard:
  // don't use baseCurrency values from the store until hydration completes.
  const safeBaseCurrencyApiId = storeHydrated ? uiState.baseCurrencyApiId : null;
  const safeBaseCurrencyText = storeHydrated ? uiState.baseCurrencyText : null;

  // §3.5: Toggle .dense-mode class on <html> when global dense mode changes
  useEffect(() => {
    if (uiState.denseMode) {
      document.documentElement.classList.add('dense-mode');
    } else {
      document.documentElement.classList.remove('dense-mode');
    }
  }, [uiState.denseMode]);

  // §2.3: Count of active extended filters
  const activeExtFilterCount = useMemo(() => {
    const f = uiState.exchange.extendedFilters;
    let count = 0;
    if (f.minVolume != null) count++;
    if (f.maxVolume != null) count++;
    if (f.minChange != null) count++;
    if (f.maxChange != null) count++;
    return count;
  }, [uiState.exchange.extendedFilters]);

  // --- i18n ---
  const { t, tp } = useI18n();

  // ============================================================================
  // Flipper backend health check (dashboard-level, shared across components)
  // ============================================================================
  const { data: flipperHealthData, isError: flipperHealthError, isPending: flipperHealthPending } = useQuery<FlipperHealthResponse>({
    queryKey: [QUERY_KEYS.flipperHealth],
    queryFn: () => fetchApi<FlipperHealthResponse>("/api/flipper/health"),
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: 2, // P1-2: retry health checks (was retry: false)
    retryDelay: 3000, // P1-2: 3s between retries
  });

  // Backend is "online" when it responds with "ok" OR "degraded".
  // "degraded" means the backend is running but upstream API (poe2scout.com)
  // is unreachable — the backend can still serve cached/stale data.
  // Only truly "offline" when we can't reach the backend at all (ECONNREFUSED).
  const flipperBackendOnline =
    !flipperHealthError &&
    (flipperHealthData?.status === "ok" || flipperHealthData?.status === "degraded");

  // Additional flag: is upstream API reachable? (for degraded status card)
  const flipperUpstreamReachable = flipperHealthData?.provider === "reachable";

  // ============================================================================
  // Flipper phase info (for header phase badge)
  // ============================================================================
  const { data: flipperPhaseData } = useQuery<FlipperPhaseResponse>({
    queryKey: [QUERY_KEYS.flipperPhase],
    queryFn: () => fetchApi<FlipperPhaseResponse>("/api/flipper/phase"),
    enabled: flipperBackendOnline,
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: 1,
  });

  // Portfolio data query removed — the Portfolio tab used a mock correlation matrix.
  // FlipperStickyBar now defaults to correlationWarning=false.

  // ============================================================================
  // Flipper events count (for header events button indicator)
  // ============================================================================
  const { data: flipperEventsData } = useQuery<FlipperEventsSummary>({
    queryKey: [QUERY_KEYS.flipperEventsCount],
    queryFn: () => fetchApi<FlipperEventsSummary>("/api/flipper/events", { active_only: "true" }),
    enabled: flipperBackendOnline,
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: 1,
  });

  const activeEventsCount = flipperEventsData?.total ?? 0;

  // ============================================================================
  // Phase 3.2: SSE price stream — real-time price change notifications
  // Connects to /api/flipper/prices/stream and invalidates React Query
  // caches when significant price changes are detected.
  // This is a complement to polling (not a replacement): SSE provides
  // push-based invalidation, reducing perceived latency for price updates.
  // ============================================================================
  const { status: sseStatus } = usePriceStream({
    enabled: flipperBackendOnline,
    backendOnline: flipperBackendOnline,
    invalidationThresholdPct: 1.0, // Invalidate caches on ≥1% price changes
  });

  // --- Data queries ---
  const { data: realms, isLoading: realmsLoading } = useQuery({
    queryKey: [QUERY_KEYS.realms],
    queryFn: () => fetchApi<Realm[]>("/api/poe2/realms"),
  });

  const { data: leagues, isLoading: leaguesLoading } = useQuery({
    queryKey: [QUERY_KEYS.leagues, realm],
    queryFn: () => {
      // Fix 5.4: Pass defaultLeagueValue from realms data to avoid
      // a redundant /Realms request inside getLeagues()
      const defaultLeague = realms?.find(
        (r) => r.name === realm || (realm === "poe2" && r.name === "poe2")
      )?.defaultLeague;
      return fetchApi<League[]>("/api/poe2/leagues", {
        realm,
        ...(defaultLeague ? { defaultLeagueValue: defaultLeague } : {}),
      });
    },
    enabled: !!realm,
  });

  // Compute the effective league: user selection > active league > first league
  const effectiveLeague = useMemo(() => {
    if (league && leagues?.some((l) => l.name === league)) return league;
    const active = leagues?.find((l) => l.active);
    return active?.name || leagues?.[0]?.name || "";
  }, [league, leagues]);

  // Sync tab with persisted state on mount (or when store hydrates)
  // FIX: Added `tab` to deps — without it the closure captured the initial
  // "overview" value, causing a stale-check that could overwrite a user's
  // manual tab switch if uiState.activeTab changed later.
  useEffect(() => {
    if (uiState.activeTab && tab === "overview") {
      setTabLocal(uiState.activeTab);
    }
  }, [uiState.activeTab, tab]);

  // Wrapper for tab changes that also persists
  const setTab = (newTab: string) => {
    setTabLocal(newTab);
    setActiveTab(newTab);
  };

  // Wrapper for league changes that also persists
  const setLeague = (newLeague: string) => {
    setLeagueLocal(newLeague);
    persistLeague(newLeague);
  };

  // FIX: Auto-select the first league when leagues load and no league is
  // explicitly selected.  Without this the Radix Select stays empty because
  // `value=""` is invalid, and the "Select a realm and league" placeholder
  // never goes away even though effectiveLeague resolves to a name.
  useEffect(() => {
    if (!league && leagues && leagues.length > 0) {
      const autoLeague =
        leagues.find((l) => l.active)?.name || leagues[0].name;
      if (autoLeague) {
        setLeague(autoLeague);
      }
    }
  }, [league, leagues]);

  // Phase 1.3: Prefetch core queries on league/realm change — eliminates
  // the "flash of loading" when switching leagues because React Query
  // starts fetching the new data before the components re-render.
  usePrefetch({ realm, league: effectiveLeague });

  // Phase 3.1: Batch initial dashboard queries into a single HTTP request.
  // Pre-populates React Query cache for health, phase, events, optimalCurrency
  // so the individual useQuery hooks below find data already cached.
  useInitialBatch({ enabled: !!effectiveLeague });

  // Reference currencies — uses shared hook (Phase 2.1)
  const { data: referenceCurrencies } = useReferenceCurrencies({
    enabled: !!effectiveLeague,
    realm,
    league: effectiveLeague,
  });

  // Phase 0.2 + P0-2: Update base currency in store when league changes.
  // Only update if the store doesn't already have a user-selected base currency,
  // OR if the currently selected currency doesn't exist in the new league.
  useEffect(() => {
    if (leagues && effectiveLeague) {
      const currentLeague = leagues.find((l) => l.name === effectiveLeague);
      if (currentLeague?.baseCurrencyApiId || currentLeague?.baseCurrencyText) {
        // P0-2: Check if the user's selected reference currency still exists
        // in the new league's reference currencies. If it does, keep it.
        // If not, reset to the league default.
        // SSR guard: only check user selection after store hydration completes.
        const userBaseApiId = safeBaseCurrencyApiId;
        if (userBaseApiId && referenceCurrencies) {
          const existsInNewLeague = referenceCurrencies.some(
            (c) => c.apiId === userBaseApiId
          );
          if (existsInNewLeague) {
            // User's selected currency exists in new league — keep it
            return;
          }
        }
        // Either no user selection or currency doesn't exist in new league
        // → Reset to league default
        setBaseCurrency(
          currentLeague.baseCurrencyApiId ?? null,
          currentLeague.baseCurrencyText ?? null,
        );
        // Also reset the local referenceCurrency state
        setReferenceCurrency("");
      }
    }
  }, [leagues, effectiveLeague, setBaseCurrency, referenceCurrencies, safeBaseCurrencyApiId]);

  // All items (for comparison resolution + overview + alerts) — shared hook (Phase 2.2)
  const { data: allItems } = useAllItems({ realm, league: effectiveLeague });

  // --- Price alerts hook (auto-checks in background) ---
  usePriceAlerts({ realm, league: effectiveLeague });

  // Currencies — shared hook (Phase 2.2)
  const {
    data: currenciesData,
    isLoading: currenciesLoading,
    refetch: refetchCurrencies,
    error: currenciesError,
    dataUpdatedAt: currenciesFetchedAt,
  } = useCurrencyItems({
    enabled: tab === "currencies",
    category: categoryFilter,
    page: currenciesPage,
    perPage: currenciesPerPage,
    referenceCurrency: referenceCurrency || "",
    refetchInterval: autoRefresh ? 60_000 : false,
    realm,
    league: effectiveLeague,
  });

  // Item categories — shared hook (Phase 2.2)
  const { data: uniqueCategories } = useItemCategories({ realm, league: effectiveLeague });

  // Uniques — shared hook (Phase 2.2)
  const {
    data: uniquesData,
    isLoading: uniquesLoading,
    refetch: refetchUniques,
    error: uniquesError,
    dataUpdatedAt: uniquesFetchedAt,
  } = useUniqueItems({
    enabled: tab === "uniques",
    category: categoryFilter,
    page: uniquesPage,
    perPage: uniquesPerPage,
    search,
    referenceCurrency: referenceCurrency || "",
    refetchInterval: autoRefresh ? 60_000 : false,
    realm,
    league: effectiveLeague,
  });

  // Exchange — uses shared hook (Phase 2.1) with snapshot=true for fast initial load
  const {
    data: exchangeData,
    isLoading: exchangeLoading,
    refetch: refetchExchange,
    error: exchangeError,
    dataUpdatedAt: exchangeFetchedAt,
  } = useExchangePairs({
    enabled: tab === "exchange" && !!effectiveLeague,
    snapshot: true,
    refetchInterval: autoRefresh ? 60_000 : false,
    realm,
    league: effectiveLeague,
  });

  // --- Derived data ---
  const exchangePairs = useMemo(() => {
    let pairs = exchangeData || [];

    // Apply search filter
    if (search) {
      pairs = pairs.filter(
        (p) =>
          p.currency1Name.toLowerCase().includes(search.toLowerCase()) ||
          p.currency2Name.toLowerCase().includes(search.toLowerCase())
      );
    }

    // Apply quick filter chips (§1.2)
    const activeFilter = uiState.exchange.activeFilter;
    if (activeFilter === "topVolume") {
      // Top 20 pairs by volume
      const sorted = [...pairs].sort((a, b) => b.volume - a.volume);
      pairs = sorted.slice(0, 20);
    } else if (activeFilter === "favorites") {
      // Only favorited pairs
      pairs = pairs.filter((p) => uiState.exchange.favorites.includes(p.id));
    }

    // §2.3: Apply extended filters
    const extFilters = uiState.exchange.extendedFilters;
    if (extFilters.minVolume != null) {
      pairs = pairs.filter((p) => p.volume >= (extFilters.minVolume ?? 0));
    }
    if (extFilters.maxVolume != null) {
      pairs = pairs.filter((p) => p.volume <= (extFilters.maxVolume ?? Infinity));
    }
    if (extFilters.minChange != null && extFilters.minChange !== 0) {
      pairs = pairs.filter((p) => (p.changePercent ?? -Infinity) >= (extFilters.minChange ?? -Infinity));
    }
    if (extFilters.maxChange != null && extFilters.maxChange !== 0) {
      pairs = pairs.filter((p) => (p.changePercent ?? Infinity) <= (extFilters.maxChange ?? Infinity));
    }

    return pairs;
  }, [exchangeData, search, uiState.exchange.activeFilter, uiState.exchange.favorites, uiState.exchange.extendedFilters]);

  // ==========================================================================
  // Phase 2.3: Cross-rates hook — derives relativePriceMap, anchor, flips
  // ==========================================================================
  // Uses exchangePairsOverride since exchangeData is already loaded above.
  // This replaces the inline buildRelativePriceMap/selectAnchor/detectCrossRateFlips
  // calls that were previously duplicated in clientOptimalResult.
  const crossRates = useCrossRates({
    enabled: !!exchangeData && exchangeData.length > 0,
    exchangePairsOverride: exchangeData,
  });

  // ==========================================================================
  // §11: Cross-currency optimal payment — backend-first with client fallback
  // ==========================================================================
  // When the backend is online, fetch optimal-currency data from
  // GET /api/flipper/optimal-currency (server-side computation).
  // When the backend is offline, fall back to client-side computation
  // using the same logic from currency-optimal.ts.

  const { data: optimalCurrencyData } = useQuery<OptimalCurrencyResponse>({
    queryKey: [QUERY_KEYS.flipperOptimalCurrency],
    queryFn: () => fetchApi<OptimalCurrencyResponse>("/api/flipper/optimal-currency"),
    enabled: flipperBackendOnline,
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: 1,
  });

  // Client-side fallback: compute optimal payment from exchangeData when backend is offline
  // Uses crossRates hook for relativePriceMap, anchorId, and crossRateFlips (Phase 2.3)
  const clientOptimalResult = useMemo(() => {
    const allPairs = exchangeData ?? [];
    if (allPairs.length === 0) {
      return { optimalPaymentByPair: new Map<string, OptimalPaymentResult>(), crossRateFlips: [] as CrossRateFlip[], anchorId: "exalted" as string };
    }

    // Use crossRates hook results instead of recomputing buildRelativePriceMap/selectAnchor
    const relPriceMap = crossRates.relativePriceMap;
    const anchor = crossRates.anchorId;
    const anchorRelPrice = crossRates.anchorRelPrice;

    // Group pairs by currency1Id — each group represents one "item" priced in multiple currencies
    const groups = new Map<string, ExchangePair[]>();
    for (const pair of allPairs) {
      const existing = groups.get(pair.currency1Id);
      if (existing) {
        existing.push(pair);
      } else {
        groups.set(pair.currency1Id, [pair]);
      }
    }

    // For each group with 2+ pricing options, compute optimal payment
    const optimalPaymentByPair = new Map<string, OptimalPaymentResult>();
    for (const [, groupPairs] of groups) {
      if (groupPairs.length < 2) continue;

      // Build pricing options from each pair in the group
      const pricingOptions = groupPairs
        .filter((p) => p.currency2RelativePrice != null && p.currency2RelativePrice > 0)
        .map((p) => ({
          currencyId: p.currency2Id,
          currencyName: p.currency2Name,
          // Cross-rate: how many currency2 per 1 currency1
          priceInCurrency: p.relativePrice != null && p.currency2RelativePrice != null && p.currency2RelativePrice > 0
            ? p.relativePrice / p.currency2RelativePrice
            : 0,
          relativePrice: p.currency2RelativePrice ?? 0,
        }))
        .filter((opt) => opt.priceInCurrency > 0 && opt.relativePrice > 0);

      const result = findOptimalPayment(pricingOptions, anchorRelPrice);
      if (result) {
        // Map result back to each pair in the group
        for (const p of groupPairs) {
          optimalPaymentByPair.set(p.id, result);
        }
      }
    }

    // §11 extension: Item-aware optimal payment.
    // For craft items (Omens, Soul Cores), currency1Id is the item itself.
    // These items appear as CurrencyOne in exchange pairs, where CurrencyTwo
    // is the payment currency. Group all pairs where currency1CategoryApiId
    // is an item category, then for each item find the cheapest payment currency.
    const itemGroups = new Map<string, ExchangePair[]>();
    for (const pair of allPairs) {
      if (isItemCategory(pair.currency1CategoryApiId)) {
        const existing = itemGroups.get(pair.currency1Id);
        if (existing) {
          existing.push(pair);
        } else {
          itemGroups.set(pair.currency1Id, [pair]);
        }
      }
    }

    for (const [, itemPairs] of itemGroups) {
      if (itemPairs.length < 2) continue;

      // Each pair represents: "item X can be bought with currency Y"
      // priceInCurrency = price of 1 unit of item X in currency Y
      const pricingOptions = itemPairs
        .filter((p) => p.currency2RelativePrice != null && p.currency2RelativePrice > 0 && p.relativePrice != null && p.relativePrice > 0)
        .map((p) => ({
          currencyId: p.currency2Id,
          currencyName: p.currency2Name,
          priceInCurrency: p.relativePrice! / p.currency2RelativePrice!,
          relativePrice: p.currency2RelativePrice!,
        }))
        .filter((opt) => opt.priceInCurrency > 0 && opt.relativePrice > 0);

      const result = findOptimalPayment(pricingOptions, anchorRelPrice);
      if (result) {
        for (const p of itemPairs) {
          optimalPaymentByPair.set(p.id, result);
        }
      }
    }

    // Use crossRates for cross-rate flips (computed by useCrossRates hook)
    return { optimalPaymentByPair, crossRateFlips: crossRates.crossRateFlips, anchorId: anchor };
  }, [exchangeData, crossRates.relativePriceMap, crossRates.anchorId, crossRates.anchorRelPrice, crossRates.crossRateFlips]);

  // Merge: backend data takes priority when available and has data; client fallback otherwise
  const { optimalPaymentByPair, crossRateFlips, anchorId: selectedAnchorId } = useMemo(() => {
    // Backend data available?
    if (optimalCurrencyData?.dataAvailable && optimalCurrencyData.optimalPaymentByPair) {
      // Remap backend keys ("currencyFrom_currencyTo") to frontend pair.id
      // Backend groups by currency_from; each key covers a currency_from → currency_to pair.
      // We need to map these back to the exchange pair IDs for component lookups.
      const allPairs = exchangeData ?? [];
      const pairMap = new Map<string, OptimalPaymentResult>();

      for (const pair of allPairs) {
        // Try the exact backend key format: currency1Id_currency2Id
        const backendKey = `${pair.currency1Id}_${pair.currency2Id}`;
        const result = optimalCurrencyData.optimalPaymentByPair[backendKey];
        if (result) {
          pairMap.set(pair.id, result);
        }
      }

      return {
        optimalPaymentByPair: pairMap,
        crossRateFlips: optimalCurrencyData.crossRateFlips ?? [],
        anchorId: optimalCurrencyData.anchorId || "exalted",
      };
    }

    // Fallback: use client-side computation
    return clientOptimalResult;
  }, [optimalCurrencyData, exchangeData, clientOptimalResult]);

  // Build display-name-keyed map for FlipsTab (flip currency uses "Name1/Name2" format)
  const optimalPaymentByDisplayName = useMemo(() => {
    const map = new Map<string, OptimalPaymentResult>();
    if (!exchangeData || !optimalPaymentByPair || optimalPaymentByPair.size === 0) return map;
    for (const pair of exchangeData) {
      const result = optimalPaymentByPair.get(pair.id);
      if (result) {
        const key = `${pair.currency1Name}/${pair.currency2Name}`;
        map.set(key, result);
      }
    }
    return map;
  }, [exchangeData, optimalPaymentByPair]);

  // Categories
  const currencyCategories = useMemo(() => {
    const cats = uniqueCategories?.filter((c) => c.name !== "Unique") || [];
    if (cats.length === 0) cats.push({ name: "all", displayName: t("all"), count: 0 });
    return cats;
  }, [uniqueCategories, t]);

  const uniqueCategoriesList = useMemo(() => {
    const cats =
      uniqueCategories?.filter(
        (c) =>
          c.name === "Unique" ||
          c.name.includes("Unique") ||
          c.name.includes("Armour") ||
          c.name.includes("Weapon") ||
          c.name.includes("Accessory") ||
          c.name.includes("Flask") ||
          c.name.includes("Jewel") ||
          c.name.includes("Gem")
      ) || [];
    if (cats.length === 0) cats.push({ name: "all", displayName: t("all"), count: 0 });
    return cats;
  }, [uniqueCategories, t]);

  const currentCategories =
    tab === "currencies" ? currencyCategories : uniqueCategoriesList;

  // Should we virtualize currencies?
  const useVirtualCurrencies = (currenciesData?.items?.length ?? 0) > CURRENCY_VIRTUAL_THRESHOLD;

  // --- Handlers ---
  const openDetail = useCallback((item: PoeItem) => {
    setDetailItem(item);
    setDetailOpen(true);
  }, []);

  const openPairDetail = useCallback((pair: ExchangePair) => {
    setDetailPair(pair);
    setPairDetailOpen(true);
  }, []);

  const handleRefresh = useCallback(() => {
    setLastUpdated(new Date());
    if (tab === "currencies") refetchCurrencies();
    else if (tab === "uniques") refetchUniques();
    else if (tab === "exchange") refetchExchange();
  }, [tab, refetchCurrencies, refetchUniques, refetchExchange]);

  // Update lastUpdated when data arrives
  useEffect(() => {
    if (currenciesData || uniquesData || exchangeData) {
      setLastUpdated(new Date());
    }
  }, [currenciesData, uniquesData, exchangeData]);

  // Keyboard navigation for pages
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (tab === "uniques" && uniquesData) {
        if (e.key === "ArrowLeft" && e.altKey) {
          setUniquesPage((p) => Math.max(1, p - 1));
        } else if (e.key === "ArrowRight" && e.altKey) {
          setUniquesPage((p) => Math.min(uniquesData.totalPages, p + 1));
        }
      }
      if (tab === "currencies" && currenciesData) {
        if (e.key === "ArrowLeft" && e.altKey) {
          setCurrenciesPage((p) => Math.max(1, p - 1));
        } else if (e.key === "ArrowRight" && e.altKey) {
          setCurrenciesPage((p) => Math.min(currenciesData.totalPages, p + 1));
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [tab, uniquesData, currenciesData]);

  // ============================================================================
  // §3.2: Keyboard Shortcuts
  // ============================================================================
  // Tab index mapping for shortcuts 1–9 (matching visible tab order)
  // "forecast" and "portfolio" removed from TAB_MAP
  const TAB_MAP = ["overview", "currencies", "uniques", "exchange", "arbitrage", "flips", "optimizer", "analyst", "liquid-chain", "graph", "watchlist"];

  // Get the current list for row navigation (depends on active tab)
  // §3.5: Extended to uniques and currencies tabs
  const navigableList = useMemo(() => {
    if (tab === "exchange") return exchangePairs;
    if (tab === "uniques" && uniquesData?.items) return uniquesData.items;
    if (tab === "currencies" && currenciesData?.items) return currenciesData.items;
    return [];
  }, [tab, exchangePairs, uniquesData, currenciesData]);

  const keyboardActions: KeyboardShortcutActions = useMemo(
    () => ({
      onToggleView: () => {
        if (tab === "exchange" || tab === "uniques") {
          setExchangeViewMode(uiState.exchange.viewMode === "table" ? "cards" : "table");
        }
      },
      onFocusSearch: () => {
        const searchInput = document.querySelector(
          'input[role="combobox"]'
        ) as HTMLInputElement | null;
        searchInput?.focus();
      },
      onNavigateUp: () => {
        setHighlightedRowIndex((prev) => {
          if (navigableList.length === 0) return null;
          if (prev === null) return navigableList.length - 1;
          return prev > 0 ? prev - 1 : navigableList.length - 1;
        });
      },
      onNavigateDown: () => {
        setHighlightedRowIndex((prev) => {
          if (navigableList.length === 0) return null;
          if (prev === null) return 0;
          return prev < navigableList.length - 1 ? prev + 1 : 0;
        });
      },
      onEnter: () => {
        if (highlightedRowIndex != null && navigableList[highlightedRowIndex]) {
          const item = navigableList[highlightedRowIndex];
          // §3.5: Handle different tab types
          if (tab === "exchange") {
            openPairDetail(item as ExchangePair);
          } else {
            // Uniques or Currencies — open item detail
            openDetail(item as PoeItem);
          }
        }
      },
      onEscape: () => {
        // Close any open dialogs, deselect row, unfocus
        setHighlightedRowIndex(null);
        setDetailOpen(false);
        setPairDetailOpen(false);
        setComparisonOpen(false);
        setPairComparisonOpen(false);
        setAlertOpen(false);
        setShortcutsHelpOpen(false);
        setEventsSidebarOpen(false);
        setExtendedFiltersOpen(false);
        // Unfocus search
        (document.activeElement as HTMLElement)?.blur?.();
      },
      onSwitchTab: (tabIndex: number) => {
        if (tabIndex >= 0 && tabIndex < TAB_MAP.length) {
          setTab(TAB_MAP[tabIndex]);
          setCategoryFilter("all");
          setUniquesPage(1);
          setCurrenciesPage(1);
          setHighlightedRowIndex(null);
        }
      },
      onShowHelp: () => {
        setShortcutsHelpOpen(true);
      },
    }),
    [tab, uiState.exchange.viewMode, setExchangeViewMode, navigableList, highlightedRowIndex, openPairDetail, setTab]
  );

  useKeyboardShortcuts(keyboardActions);

  // --- Export handler ---
  const handleExport = useCallback(
    (format: "csv" | "json") => {
      const timestamp = new Date().toISOString().slice(0, 10);
      if (tab === "currencies" && currenciesData) {
        const data = currenciesData.items.map((i) => ({
          name: i.name,
          type: i.type,
          price: i.relativePrice ?? i.chaosEquivalentRate,
          changePercent: i.changePercent,
          volume: i.volume,
        }));
        const fname = `currencies-${effectiveLeague}-${timestamp}`;
        if (format === "csv") exportToCsv(data, fname);
        else exportToJson(data, fname);
      } else if (tab === "uniques" && uniquesData) {
        const data = uniquesData.items.map((i) => ({
          name: i.name,
          type: i.type,
          price: i.relativePrice ?? i.chaosEquivalentRate,
          changePercent: i.changePercent,
          sevenDayChange: i.sevenDayPriceChangePercent,
          volume: i.volume,
        }));
        const fname = `uniques-${effectiveLeague}-${timestamp}`;
        if (format === "csv") exportToCsv(data, fname);
        else exportToJson(data, fname);
      } else if (tab === "exchange" && exchangeData) {
        const data = exchangePairs.map((p) => ({
          from: p.currency1Name,
          to: p.currency2Name,
          price: p.relativePrice,
          volume: p.volume,
          changePercent: p.changePercent,
          sevenDayChangePercent: p.sevenDayChangePercent,
        }));
        const fname = `exchange-${effectiveLeague}-${timestamp}`;
        if (format === "csv") exportToCsv(data, fname);
        else exportToJson(data, fname);
      }
    },
    [tab, currenciesData, uniquesData, exchangeData, exchangePairs, effectiveLeague]
  );

  // --- Loading state ---
  const isLoading =
    (tab === "currencies" && currenciesLoading) ||
    (tab === "uniques" && uniquesLoading) ||
    (tab === "exchange" && exchangeLoading);

  // --- Error state ---
  const activeError =
    tab === "currencies"
      ? currenciesError
      : tab === "uniques"
      ? uniquesError
      : tab === "exchange"
      ? exchangeError
      : null;

  const showExport = tab === "currencies" || tab === "uniques" || tab === "exchange";

  return (
    <div className="min-h-screen bg-background">
      {/* §3.1: Skip-to-content link for keyboard/screen reader users */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-md focus:text-sm focus:font-medium"
      >
        {t("skipToContent")}
      </a>

      {/* Header — now with flipper backend status, phase badge, events button */}
      <Header
        realms={realms}
        leagues={leagues}
        realmsLoading={realmsLoading}
        leaguesLoading={leaguesLoading}
        realm={realm}
        league={league}
        effectiveLeague={effectiveLeague}
        search={search}
        onRealmChange={(v) => {
          setRealm(v);
          setLeague("");
        }}
        onLeagueChange={setLeague}
        onSearchChange={setSearch}
        onRefresh={handleRefresh}
        autoRefresh={autoRefresh}
        onAutoRefreshToggle={() => setAutoRefresh(!autoRefresh)}
        lastUpdated={lastUpdated}
        referenceCurrencies={referenceCurrencies}
        referenceCurrency={referenceCurrency}
        onReferenceCurrencyChange={(apiId) => {
          setReferenceCurrency(apiId);
          // P0-2: Sync base currency in store with the selected reference currency
          // so that formatPrice() shows the correct suffix (e.g. "Div" instead of "Exa")
          // P0: "_adaptive" mode — store the special value; useDisplayPrice handles per-row logic
          if (apiId === "_adaptive") {
            setBaseCurrency("_adaptive", "Adaptive");
          } else if (apiId && referenceCurrencies) {
            const selected = referenceCurrencies.find((c) => c.apiId === apiId);
            if (selected) {
              setBaseCurrency(selected.apiId, selected.text);
            }
          } else if (!apiId) {
            // Reset to league default when user selects "_default"
            const currentLeague = leagues?.find((l) => l.name === effectiveLeague);
            if (currentLeague?.baseCurrencyApiId || currentLeague?.baseCurrencyText) {
              setBaseCurrency(
                currentLeague.baseCurrencyApiId ?? null,
                currentLeague.baseCurrencyText ?? null,
              );
            }
          }
        }}
        onExport={showExport ? handleExport : undefined}
        flipperBackendOnline={flipperBackendOnline}
        phaseInfo={flipperPhaseData ?? null}
        activeEventsCount={activeEventsCount}
        onEventsClick={() => setEventsSidebarOpen(true)}
        exchangePairs={exchangeData ?? []}
        allItems={allItems ?? []}
        activeTab={tab}
        onSearchResultSelect={(result) => {
          // Navigate to the relevant tab
          setTab(result.tab);
          // §3.5: Set the highlighted item ID so the component scrolls to it + pulses
          setHighlightedItemId(result.id);
          // Clear the highlight after 3 seconds
          setTimeout(() => setHighlightedItemId(null), 3000);
          setSearch(""); // Clear search after navigation
        }}
        denseMode={uiState.denseMode}
        onDenseModeToggle={() => setDenseMode(!uiState.denseMode)}
        baseCurrencyApiId={safeBaseCurrencyApiId}
        baseCurrencyText={safeBaseCurrencyText}
      />

      <FlipperStickyBar backendOnline={flipperBackendOnline} correlationWarning={false} />

      {/* Main content — id for skip-to-content a11y link */}
      <main id="main-content" className="max-w-[1600px] mx-auto px-4 py-4" role="main">
        {!effectiveLeague ? (
          <div className="flex flex-col items-center justify-center py-32 text-muted-foreground" role="status">
            <AlertTriangle className="h-12 w-12 mb-4" aria-hidden="true" />
            <p className="text-lg">{t("selectRealmLeague")}</p>
          </div>
        ) : (
          <Tabs
            value={tab}
            onValueChange={(v) => {
              setTab(v);
              setCategoryFilter("all");
              setUniquesPage(1);
              setCurrenciesPage(1);
            }}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <TabsList aria-label={t("ariaDashboardSections")}>
                <TabsTrigger value="overview" className="gap-1.5" aria-label={t("tabOverview")}>
                  <BarChart3 className="h-4 w-4" aria-hidden="true" /> {t("tabOverview")}
                </TabsTrigger>
                <TabsTrigger value="currencies" className="gap-1.5" aria-label={t("tabCurrencies")}>
                  <Coins className="h-4 w-4" aria-hidden="true" /> {t("tabCurrencies")}
                </TabsTrigger>
                <TabsTrigger value="uniques" className="gap-1.5" aria-label={t("tabUniques")}>
                  <Shield className="h-4 w-4" aria-hidden="true" /> {t("tabUniques")}
                </TabsTrigger>
                <TabsTrigger value="exchange" className="gap-1.5" aria-label={t("tabExchange")}>
                  <ArrowLeftRight className="h-4 w-4" aria-hidden="true" /> {t("tabExchange")}
                </TabsTrigger>
                {/* Arbitrage tab removed (iter 34) — merged into Flips */}
                <TabsTrigger value="flips" className="gap-1.5" aria-label={t("tabFlips")}>
                  <TrendingUp className="h-4 w-4" aria-hidden="true" /> {t("tabFlips")}
                </TabsTrigger>
                <TabsTrigger value="optimizer" className="gap-1.5" aria-label={t("tabOptimizer") || "Optimizer"}>
                  <Route className="h-4 w-4" aria-hidden="true" /> {t("tabOptimizer") || "Optimizer"}
                </TabsTrigger>
                <TabsTrigger value="analyst" className="gap-1.5" aria-label={t("tabAnalyst") || "Analyst"}>
                  <LineChart className="h-4 w-4" aria-hidden="true" /> {t("tabAnalyst") || "Analyst"}
                </TabsTrigger>
                <TabsTrigger value="liquid-chain" className="gap-1.5" aria-label={t("tabLiquidChain")}>
                  <Droplets className="h-4 w-4" aria-hidden="true" /> {t("tabLiquidChain")}
                </TabsTrigger>
                <TabsTrigger value="graph" className="gap-1.5" aria-label={t("tabGraph")}>
                  <Network className="h-4 w-4" aria-hidden="true" /> {t("tabGraph")}
                </TabsTrigger>
                <TabsTrigger value="watchlist" className="gap-1.5" aria-label={t("tabWatchlist")}>
                  <Star className="h-4 w-4" aria-hidden="true" /> {t("tabWatchlist")}
                </TabsTrigger>
              </TabsList>

              <div className="flex items-center gap-2">
                {/* §3.2: Keyboard Shortcuts help button */}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5"
                  onClick={() => setShortcutsHelpOpen(true)}
                  aria-label={t("keyboardShortcuts")}
                  title={t("keyboardShortcuts")}
                >
                  <Keyboard className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>

                {/* Price Alerts button — with pluralization */}
                <Button
                  variant={alerts.length > 0 ? "default" : "outline"}
                  size="sm"
                  className="h-8 gap-1.5"
                  onClick={() => setAlertOpen(true)}
                  aria-label={alerts.length > 0 ? t("alertsCount", { "0": alerts.length }) : t("alerts")}
                >
                  <Bell className="h-3.5 w-3.5" aria-hidden="true" />
                  {alerts.length > 0
                    ? tp(t("_pl_alertsCount"), alerts.length, { "0": alerts.length })
                    : t("alerts")}
                </Button>

                {/* Item Comparison button — with pluralization */}
                {comparisonIds.length > 0 && (
                  <Button
                    variant={comparisonIds.length >= 2 ? "default" : "outline"}
                    size="sm"
                    className="h-8 gap-1.5"
                    onClick={() => setComparisonOpen(true)}
                    disabled={comparisonIds.length < 2}
                    aria-label={t("compare", { "0": comparisonIds.length })}
                  >
                    <GitCompare className="h-3.5 w-3.5" aria-hidden="true" />
                    {tp(t("_pl_compare"), comparisonIds.length, { "0": comparisonIds.length })}
                  </Button>
                )}

                {/* Pair Comparison button */}
                {pairComparisonIds.length > 0 && (
                  <Button
                    variant={pairComparisonIds.length >= 2 ? "default" : "outline"}
                    size="sm"
                    className="h-8 gap-1.5"
                    onClick={() => setPairComparisonOpen(true)}
                    disabled={pairComparisonIds.length < 2}
                    aria-label={t("pairCompare", { "0": pairComparisonIds.length })}
                  >
                    <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden="true" />
                    {tp(t("_pl_pairCompare"), pairComparisonIds.length, { "0": pairComparisonIds.length })}
                  </Button>
                )}

                {/* Category filter buttons (only for currencies/uniques) */}
                {(tab === "currencies" || tab === "uniques") && (
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("ariaCategoryFilter")}>
                    <Badge
                      variant={categoryFilter === "all" ? "default" : "outline"}
                      className="cursor-pointer"
                      onClick={() => setCategoryFilter("all")}
                      role="button"
                      aria-pressed={categoryFilter === "all"}
                      tabIndex={0}
                    >
                      {t("all")}
                    </Badge>
                    {currentCategories.map((cat) => (
                      <Badge
                        key={cat.name}
                        variant={
                          categoryFilter === cat.name ? "default" : "outline"
                        }
                        className="cursor-pointer"
                        onClick={() => setCategoryFilter(cat.name)}
                        role="button"
                        aria-pressed={categoryFilter === cat.name}
                        tabIndex={0}
                      >
                        {cat.displayName}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* ============ OVERVIEW TAB ============ */}
            {/* P2-1 (iter 72): inlined JSX extracted to <OverviewTabContent /> */}
            <TabsContent value="overview">
              <OverviewTabContent
                realm={realm}
                league={effectiveLeague}
                referenceCurrency={referenceCurrency}
                allItems={allItems ?? []}
                backendOnline={flipperBackendOnline}
                t={t}
                onItemClick={openDetail}
              />
            </TabsContent>

            {/* ============ CURRENCIES TAB ============ */}
            {/* P2-1 (iter 72): inlined JSX extracted to <CurrenciesTabContent /> */}
            <TabsContent value="currencies">
              <CurrenciesTabContent
                currenciesFetchedAt={currenciesFetchedAt}
                currenciesData={currenciesData}
                refetchCurrencies={refetchCurrencies}
                currenciesPage={currenciesPage}
                currenciesPerPage={currenciesPerPage}
                setCurrenciesPage={setCurrenciesPage}
                setCurrenciesPerPage={setCurrenciesPerPage}
                isLoading={isLoading}
                activeError={activeError}
                search={search}
                useVirtualCurrencies={useVirtualCurrencies}
                denseMode={uiState.denseMode}
                highlightedItemId={highlightedItemId}
                realm={realm}
                league={effectiveLeague}
                referenceCurrency={referenceCurrency}
                exchangeData={exchangeData}
                t={t}
                onItemClick={openDetail}
              />
            </TabsContent>

            {/* ============ UNIQUES TAB ============ */}
            {/* P2-1 (iter 72): inlined JSX extracted to <UniquesTabContent /> */}
            <TabsContent value="uniques">
              <UniquesTabContent
                uniquesFetchedAt={uniquesFetchedAt}
                uniquesData={uniquesData}
                refetchUniques={refetchUniques}
                uniquesPage={uniquesPage}
                uniquesPerPage={uniquesPerPage}
                setUniquesPage={setUniquesPage}
                setUniquesPerPage={setUniquesPerPage}
                isLoading={isLoading}
                activeError={activeError}
                search={search}
                denseMode={uiState.denseMode}
                highlightedItemId={highlightedItemId}
                realm={realm}
                league={effectiveLeague}
                referenceCurrency={referenceCurrency}
                t={t}
                onItemClick={openDetail}
              />
            </TabsContent>

            {/* ============ EXCHANGE TAB ============ */}
            {/* P2-1 (iter 71): inlined JSX extracted to <ExchangeTabContent /> */}
            <TabsContent value="exchange">
              <ExchangeTabContent
                exchangeFetchedAt={exchangeFetchedAt}
                exchangeData={exchangeData}
                exchangePairs={exchangePairs}
                exchangeLoading={exchangeLoading}
                exchangeError={exchangeError}
                refetchExchange={refetchExchange}
                isLoading={isLoading}
                activeError={activeError}
                viewMode={uiState.exchange.viewMode}
                activeFilter={uiState.exchange.activeFilter}
                favorites={uiState.exchange.favorites}
                extendedFilters={uiState.exchange.extendedFilters}
                extendedFiltersOpen={extendedFiltersOpen}
                activeExtFilterCount={activeExtFilterCount}
                denseMode={uiState.denseMode}
                optimalPaymentByPair={optimalPaymentByPair}
                crossRateFlips={crossRateFlips}
                anchorId={selectedAnchorId}
                highlightedRowIndex={highlightedRowIndex}
                highlightedItemId={highlightedItemId}
                realm={realm}
                league={effectiveLeague}
                backendOnline={flipperBackendOnline}
                isExchangeTab={tab === "exchange"}
                setExchangeViewMode={setExchangeViewMode}
                setExchangeFilter={setExchangeFilter}
                setExchangeExtendedFilters={setExchangeExtendedFilters}
                clearExchangeExtendedFilters={clearExchangeExtendedFilters}
                setExtendedFiltersOpen={setExtendedFiltersOpen}
                t={t}
                onPairClick={openPairDetail}
              />
            </TabsContent>

            {/* ============ FLIPS TAB (unified with old Arbitrage) ============ */}
            <TabsContent value="flips">
              <ErrorBoundary fallbackTitle={t("fallbackFlips")}>
                <FlipsTab backendOnline={flipperBackendOnline} upstreamDegraded={flipperBackendOnline && !flipperUpstreamReachable} optimalPaymentByDisplayName={optimalPaymentByDisplayName} anchorId={selectedAnchorId} league={effectiveLeague} crossRates={crossRates} />
              </ErrorBoundary>
              {/* P3-7: Tier Drift Tracker */}
              <ErrorBoundary fallbackTitle={t("fallbackTierDrift")}>
                <TierDriftTracker backendOnline={flipperBackendOnline} />
              </ErrorBoundary>
            </TabsContent>

            {/* ============ OPTIMIZER TAB ============ */}
            <TabsContent value="optimizer">
              <ErrorBoundary fallbackTitle="Optimizer Error">
                <OptimizerTab backendOnline={flipperBackendOnline} />
              </ErrorBoundary>
            </TabsContent>

            {/* ============ ANALYST TAB ============ */}
            <TabsContent value="analyst">
              <ErrorBoundary fallbackTitle="Analyst Error">
                <AnalystTab backendOnline={flipperBackendOnline} realm={realm} league={effectiveLeague} />
              </ErrorBoundary>
            </TabsContent>

            {/* ============ LIQUID CHAIN TAB ============ */}
            <TabsContent value="liquid-chain">
              <ErrorBoundary fallbackTitle={t("fallbackLiquidChain")}>
                <LiquidChainTab backendOnline={flipperBackendOnline} upstreamDegraded={flipperBackendOnline && !flipperUpstreamReachable} />
              </ErrorBoundary>
            </TabsContent>

            {/* ============ FORECAST TAB (removed) ============ */}

            {/* ============ CURRENCY GRAPH TAB ============ */}
            <TabsContent value="graph">
              <ErrorBoundary fallbackTitle={t("fallbackCurrencyGraph")}>
                <CurrencyGraphTab backendOnline={flipperBackendOnline} upstreamDegraded={flipperBackendOnline && !flipperUpstreamReachable} />
              </ErrorBoundary>
            </TabsContent>

            {/* ============ WATCHLIST TAB ============ */}
            <TabsContent value="watchlist">
              <ErrorBoundary fallbackTitle={t("fallbackWatchlist")}>
                <WatchlistTab
                  realm={realm}
                  league={effectiveLeague}
                  onPairClick={openPairDetail}
                />
              </ErrorBoundary>
            </TabsContent>
          </Tabs>
        )}
      </main>

      {/* ============ ITEM DETAIL DIALOG ============ */}
      <ErrorBoundary fallbackTitle={t("fallbackItemDetails")}>
        <DetailDialog
          item={detailItem}
          open={detailOpen}
          onOpenChange={setDetailOpen}
          realm={realm}
          league={effectiveLeague}
          referenceCurrency={referenceCurrency}
        />
      </ErrorBoundary>

      {/* ============ PAIR DETAIL DIALOG ============ */}
      <ErrorBoundary fallbackTitle={t("fallbackPairDetails")}>
        <PairDetailDialog
          pair={detailPair}
          open={pairDetailOpen}
          onOpenChange={setPairDetailOpen}
          realm={realm}
          league={effectiveLeague}
        />
      </ErrorBoundary>

      {/* ============ ITEM COMPARISON DIALOG ============ */}
      <ComparisonDialog
        open={comparisonOpen}
        onOpenChange={setComparisonOpen}
        realm={realm}
        league={effectiveLeague}
        referenceCurrency={referenceCurrency}
        allItems={allItems}
      />

      {/* ============ PAIR COMPARISON DIALOG ============ */}
      <PairComparisonDialog
        open={pairComparisonOpen}
        onOpenChange={setPairComparisonOpen}
        realm={realm}
        league={effectiveLeague}
      />

      {/* ============ PRICE ALERT DIALOG ============ */}
      <PriceAlertDialog
        open={alertOpen}
        onOpenChange={setAlertOpen}
        realm={realm}
        league={effectiveLeague}
        allItems={allItems}
      />

      {/* ============ EVENTS SIDEBAR (Sheet) ============ */}
      <EventsSidebar
        open={eventsSidebarOpen}
        onOpenChange={setEventsSidebarOpen}
        backendOnline={flipperBackendOnline}
      />

      {/* ============ OFFLINE BANNER (PWA) ============ */}
      <OfflineBanner />

      {/* ============ §3.2: KEYBOARD SHORTCUTS HELP DIALOG ============ */}
      <ShortcutsDialog
        open={shortcutsHelpOpen}
        onOpenChange={setShortcutsHelpOpen}
      />
    </div>
  );
}
