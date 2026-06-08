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
  Zap,
  TrendingUp,
  Route,
  Network,
  Keyboard,
  LineChart,
  Filter,
  List,
  LayoutGrid,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { Header } from "@/components/dashboard/header";
import { CurrencyCard } from "@/components/dashboard/currency-card";
import { VirtualCurrencyGrid } from "@/components/dashboard/virtual-currency-grid";
import { UniqueTable } from "@/components/dashboard/unique-table";
import { ExchangePairCard } from "@/components/dashboard/exchange-pair-card";
import { ExchangeTable } from "@/components/dashboard/exchange-table";
import { DetailDialog } from "@/components/dashboard/detail-dialog";
import { PairDetailDialog } from "@/components/dashboard/pair-detail-dialog";
import { MarketOverview } from "@/components/dashboard/market-overview";
import { WatchlistTab } from "@/components/dashboard/watchlist-tab";
import { ComparisonDialog } from "@/components/dashboard/comparison-dialog";
import { PairComparisonDialog } from "@/components/dashboard/pair-comparison-dialog";
import { Pagination } from "@/components/dashboard/pagination";
import { PriceAlertDialog } from "@/components/dashboard/price-alert-dialog";
import { ArbitrageTab } from "@/components/dashboard/arbitrage-tab";
import { FlipsTab } from "@/components/dashboard/flips-tab";
import { OptimizerTab } from "@/components/dashboard/optimizer-tab";
import { AnalystTab } from "@/components/dashboard/analyst-tab";
import { ShortcutsDialog } from "@/components/dashboard/shortcuts-dialog";
import { MarketHeatmap } from "@/components/dashboard/market-heatmap";
import { VolumeLiquidityIndicators } from "@/components/dashboard/volume-liquidity-indicators";
import { TierDriftTracker } from "@/components/dashboard/tier-drift-tracker";
import { ComparativeChart } from "@/components/dashboard/comparative-chart";

// Heavy tab component — lazy-loaded via next/dynamic to reduce initial bundle size.
// ForecastTab and PortfolioTab were removed (forecast was unreliable, portfolio was mock-only).
// CurrencyGraphTab kept as it provides real value.
import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

const CurrencyGraphTab = dynamic(
  () => import("@/components/dashboard/currency-graph-tab").then((m) => ({ default: m.CurrencyGraphTab })),
  {
    loading: () => (
      <div className="space-y-4">
        <Skeleton className="h-20 w-full" />
        <div className="grid grid-cols-4 gap-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
        <Skeleton className="h-[500px] w-full" />
      </div>
    ),
  },
);

import { EventsSidebar } from "@/components/dashboard/events-sidebar";
import { OfflineBanner } from "@/components/dashboard/offline-banner";
import { FlipperStickyBar } from "@/components/dashboard/flipper-sticky-bar";
import { ErrorBoundary } from "@/components/dashboard/error-boundary";
import { ApiErrorFallback } from "@/components/dashboard/api-error-fallback";

// Skeleton loaders (replace Loader2 spinners)
import {
  CurrencyGridSkeleton,
  UniqueTableSkeleton,
  ExchangeGridSkeleton,
  ExchangeTableSkeleton,
} from "@/components/dashboard/skeletons";
import { EmptyState } from "@/components/dashboard/empty-state";
import { DataFreshnessBadge } from "@/components/dashboard/data-freshness-badge";

import {
  fetchApi,
  exportToCsv,
  exportToJson,
} from "@/lib/types";
import type {
  Realm,
  League,
  PoeItem,
  ExchangePair,
  ItemCategory,
  PaginatedResponse,
  ReferenceCurrency,
  FlipperHealthResponse,
  FlipperPhaseResponse,
  FlipperEventsSummary,
  OptimalPaymentResult,
  CrossRateFlip,
} from "@/lib/types";
import {
  findOptimalPayment,
  detectCrossRateFlips,
  buildRelativePriceMap,
  selectAnchor,
} from "@/lib/currency-optimal";
import { useDashboardStore } from "@/lib/store";
import { usePriceAlerts } from "@/hooks/use-price-alerts";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import type { KeyboardShortcutActions } from "@/hooks/use-keyboard-shortcuts";
import { useFlipperWebSocket } from "@/hooks/use-websocket";
import type { WebSocketStatus } from "@/hooks/use-websocket";
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
  const { data: flipperHealthData, isError: flipperHealthError } = useQuery<FlipperHealthResponse>({
    queryKey: ["flipper-health"],
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
    queryKey: ["flipper-phase"],
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
    queryKey: ["flipper-events-count"],
    queryFn: () => fetchApi<FlipperEventsSummary>("/api/flipper/events", { active_only: "true" }),
    enabled: flipperBackendOnline,
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: 1,
  });

  const activeEventsCount = flipperEventsData?.total ?? 0;

  // ============================================================================
  // Flipper WebSocket connection (for StickyBar WS badge)
  // Connects to /ws/flips and /ws/anomalies when the backend is online.
  // The wsStatus prop is passed to FlipperStickyBar to display the
  // connection state badge (connected / connecting / disconnected).
  // ============================================================================
  const { status: wsStatus } = useFlipperWebSocket({
    enabled: flipperBackendOnline,
    backendOnline: flipperBackendOnline,
    onFlipsUpdate: () => {
      // Invalidate flips query cache when WS pushes an update
      // This keeps the StickyBar and Flips tab in sync with live data
    },
    onAnomaly: () => {
      // Anomaly detected via WS — could trigger a toast notification
    },
  });

  // --- Data queries ---
  const { data: realms, isLoading: realmsLoading } = useQuery({
    queryKey: ["realms"],
    queryFn: () => fetchApi<Realm[]>("/api/poe2/realms"),
  });

  const { data: leagues, isLoading: leaguesLoading } = useQuery({
    queryKey: ["leagues", realm],
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

  // Sync tab with persisted state on mount
  useEffect(() => {
    if (uiState.activeTab && tab === "overview") {
      setTabLocal(uiState.activeTab);
    }
  }, [uiState.activeTab]);

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

  // Reference currencies — moved BEFORE the useEffect that depends on it
  // to avoid the "used before declaration" TypeScript error.
  const { data: referenceCurrencies } = useQuery({
    queryKey: ["referenceCurrencies", realm, effectiveLeague],
    queryFn: () =>
      fetchApi<ReferenceCurrency[]>("/api/poe2/exchange", {
        realm,
        league: effectiveLeague,
        action: "reference",
      }),
    enabled: !!effectiveLeague,
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

  // All items (for comparison resolution + overview + alerts)
  const { data: allItems } = useQuery({
    queryKey: ["allItems", realm, effectiveLeague],
    queryFn: () => fetchApi<PoeItem[]>("/api/poe2/items", { realm, league: effectiveLeague }),
    enabled: !!effectiveLeague,
  });

  // --- Price alerts hook (auto-checks in background) ---
  usePriceAlerts({ realm, league: effectiveLeague });

  // Currencies
  const {
    data: currenciesData,
    isLoading: currenciesLoading,
    refetch: refetchCurrencies,
    error: currenciesError,
    dataUpdatedAt: currenciesFetchedAt,
  } = useQuery({
    queryKey: [
      "currencies",
      realm,
      effectiveLeague,
      categoryFilter,
      currenciesPage,
      currenciesPerPage,
      referenceCurrency,
    ],
    queryFn: () =>
      fetchApi<PaginatedResponse<PoeItem>>("/api/poe2/currencies", {
        realm,
        league: effectiveLeague,
        action: "byCategory",
        category: categoryFilter,
        page: String(currenciesPage),
        perPage: String(currenciesPerPage),
        referenceCurrency: referenceCurrency || "",
      }),
    enabled: tab === "currencies" && !!effectiveLeague,
    refetchInterval: autoRefresh ? 60_000 : false,
    refetchIntervalInBackground: false,
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(500 * Math.pow(2, attemptIndex), 10000),
  });

  // Item categories
  const { data: uniqueCategories } = useQuery({
    queryKey: ["itemCategories", realm, effectiveLeague],
    queryFn: () =>
      fetchApi<ItemCategory[]>("/api/poe2/items", {
        realm,
        league: effectiveLeague,
        action: "categories",
      }),
    enabled: !!effectiveLeague,
  });

  // Uniques
  const {
    data: uniquesData,
    isLoading: uniquesLoading,
    refetch: refetchUniques,
    error: uniquesError,
    dataUpdatedAt: uniquesFetchedAt,
  } = useQuery({
    queryKey: [
      "uniques",
      realm,
      effectiveLeague,
      categoryFilter,
      uniquesPage,
      uniquesPerPage,
      search,
      referenceCurrency,
    ],
    queryFn: () =>
      fetchApi<PaginatedResponse<PoeItem>>("/api/poe2/uniques", {
        realm,
        league: effectiveLeague,
        category: categoryFilter,
        page: String(uniquesPage),
        perPage: String(uniquesPerPage),
        search,
        referenceCurrency: referenceCurrency || "",
      }),
    enabled: tab === "uniques" && !!effectiveLeague,
    refetchInterval: autoRefresh ? 60_000 : false,
    refetchIntervalInBackground: false,
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(500 * Math.pow(2, attemptIndex), 10000),
  });

  // Exchange — Fix 4.15: Use snapshot=true for fast initial load; history loads on hover
  const {
    data: exchangeData,
    isLoading: exchangeLoading,
    refetch: refetchExchange,
    error: exchangeError,
    dataUpdatedAt: exchangeFetchedAt,
  } = useQuery({
    queryKey: ["exchange", realm, effectiveLeague],
    queryFn: () =>
      fetchApi<ExchangePair[]>("/api/poe2/exchange", {
        realm,
        league: effectiveLeague,
        action: "pairs",
        snapshot: "true", // Fix 4.15: skip server-side history enrichment
      }),
    enabled: tab === "exchange" && !!effectiveLeague,
    refetchInterval: autoRefresh ? 60_000 : false,
    refetchIntervalInBackground: false,
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(500 * Math.pow(2, attemptIndex), 10000),
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

  // §11: Cross-currency optimal payment — group pairs by currency1Id, find cheapest
  // payment option for each currency across all its exchange pairs.
  const { optimalPaymentByPair, crossRateFlips, anchorId: selectedAnchorId } = useMemo(() => {
    const allPairs = exchangeData ?? [];
    if (allPairs.length === 0) {
      return { optimalPaymentByPair: new Map<string, OptimalPaymentResult>(), crossRateFlips: [] as CrossRateFlip[], anchorId: "exalted" as string };
    }

    // Build relative price map and select anchor
    const relPriceMap = buildRelativePriceMap(allPairs);
    const anchor = selectAnchor(relPriceMap);
    const anchorRelPrice = relPriceMap.get(anchor) ?? 1;

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

    // Detect cross-rate flips across all pairs
    const crossRateFlips = detectCrossRateFlips(allPairs, 5);

    return { optimalPaymentByPair, crossRateFlips, anchorId: anchor };
  }, [exchangeData]);

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
  const TAB_MAP = ["overview", "currencies", "uniques", "exchange", "arbitrage", "flips", "optimizer", "analyst", "graph", "watchlist"];

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
          if (apiId && referenceCurrencies) {
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

      <FlipperStickyBar backendOnline={flipperBackendOnline} correlationWarning={false} wsStatus={wsStatus} />

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
                <TabsTrigger value="arbitrage" className="gap-1.5" aria-label={t("tabArbitrage")}>
                  <Zap className="h-4 w-4" aria-hidden="true" /> {t("tabArbitrage")}
                </TabsTrigger>
                <TabsTrigger value="flips" className="gap-1.5" aria-label={t("tabFlips")}>
                  <TrendingUp className="h-4 w-4" aria-hidden="true" /> {t("tabFlips")}
                </TabsTrigger>
                <TabsTrigger value="optimizer" className="gap-1.5" aria-label={t("tabOptimizer") || "Optimizer"}>
                  <Route className="h-4 w-4" aria-hidden="true" /> {t("tabOptimizer") || "Optimizer"}
                </TabsTrigger>
                <TabsTrigger value="analyst" className="gap-1.5" aria-label={t("tabAnalyst") || "Analyst"}>
                  <LineChart className="h-4 w-4" aria-hidden="true" /> {t("tabAnalyst") || "Analyst"}
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
            <TabsContent value="overview">
              <ErrorBoundary fallbackTitle={t("fallbackMarketOverview")}>
                <MarketOverview
                  realm={realm}
                  league={effectiveLeague}
                  onItemClick={openDetail}
                  backendOnline={flipperBackendOnline}
                />
              </ErrorBoundary>
              {/* P2-2: Market Heatmap with Market Tops (standalone component) */}
              <ErrorBoundary fallbackTitle={t("fallbackMarketHeatmap")}>
                <MarketHeatmap
                  realm={realm}
                  league={effectiveLeague}
                  backendOnline={flipperBackendOnline}
                />
              </ErrorBoundary>

              {/* P3-3: Comparative Analytics — integrated into Overview tab */}
              <ErrorBoundary fallbackTitle={t("fallbackComparativeAnalytics")}>
                <ComparativeChart
                  realm={realm}
                  league={effectiveLeague}
                  referenceCurrency={referenceCurrency}
                  allItems={allItems ?? []}
                />
              </ErrorBoundary>
            </TabsContent>

            {/* ============ CURRENCIES TAB ============ */}
            <TabsContent value="currencies">
              {/* Data freshness badge for POE2Scout API tab */}
              {currenciesFetchedAt > 0 && (
                <DataFreshnessBadge
                  fetchedAt={new Date(currenciesFetchedAt).toISOString()}
                  dataAvailable={!!currenciesData}
                  compact={uiState.denseMode}
                />
              )}
              {isLoading ? (
                <CurrencyGridSkeleton count={currenciesPerPage} />
              ) : activeError && !currenciesData ? (
                <ApiErrorFallback
                  error={activeError}
                  onRetry={() => refetchCurrencies()}
                  title={t("failedToLoadData")}
                />
              ) : !currenciesData?.items?.length ? (
                <EmptyState
                  kind="noResults"
                  message={t("noCurrencies")}
                  suggestion={search ? t("noResultsSuggestion") : undefined}
                />
              ) : (
                <>
                  {useVirtualCurrencies ? (
                    <VirtualCurrencyGrid
                      items={currenciesData.items}
                      onItemClick={openDetail}
                      realm={realm}
                      league={effectiveLeague}
                      referenceCurrency={referenceCurrency}
                      exchangePairs={exchangeData ?? undefined}
                    />
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2" role="list" aria-label={t("ariaCurrencyItems")}>
                      {currenciesData.items.map((item) => (
                        <CurrencyCard
                          key={item.id}
                          item={item}
                          onClick={openDetail}
                          realm={realm}
                          league={effectiveLeague}
                          referenceCurrency={referenceCurrency}
                          highlighted={highlightedItemId === item.id}
                          exchangePairs={exchangeData ?? undefined}
                        />
                      ))}
                    </div>
                  )}
                  <Pagination
                    page={currenciesPage}
                    totalPages={currenciesData.totalPages}
                    totalItems={currenciesData.totalItems}
                    perPage={currenciesPerPage}
                    onPageChange={setCurrenciesPage}
                    onPerPageChange={(v) => {
                      setCurrenciesPerPage(v);
                      setCurrenciesPage(1);
                    }}
                    perPageOptions={[25, 50, 100]}
                  />
                </>
              )}
            </TabsContent>

            {/* ============ UNIQUES TAB ============ */}
            <TabsContent value="uniques">
              {/* Data freshness badge for POE2Scout API tab */}
              {uniquesFetchedAt > 0 && (
                <DataFreshnessBadge
                  fetchedAt={new Date(uniquesFetchedAt).toISOString()}
                  dataAvailable={!!uniquesData}
                  compact={uiState.denseMode}
                />
              )}
              {isLoading ? (
                <UniqueTableSkeleton rows={15} />
              ) : activeError && !uniquesData ? (
                <ApiErrorFallback
                  error={activeError}
                  onRetry={() => refetchUniques()}
                  title={t("failedToLoadData")}
                />
              ) : !uniquesData?.items?.length ? (
                <EmptyState
                  kind="noResults"
                  message={t("noUniques")}
                  suggestion={search ? t("noResultsSuggestion") : undefined}
                />
              ) : (
                <>
                  <UniqueTable
                    items={uniquesData.items}
                    onItemClick={openDetail}
                    realm={realm}
                    league={effectiveLeague}
                    referenceCurrency={referenceCurrency}
                    highlightedItemId={highlightedItemId}
                  />
                  <Pagination
                    page={uniquesPage}
                    totalPages={uniquesData.totalPages}
                    totalItems={uniquesData.totalItems}
                    perPage={uniquesPerPage}
                    onPageChange={setUniquesPage}
                    onPerPageChange={(v) => {
                      setUniquesPerPage(v);
                      setUniquesPage(1);
                    }}
                    perPageOptions={[25, 50, 100]}
                  />
                </>
              )}
            </TabsContent>

            {/* ============ EXCHANGE TAB ============ */}
            <TabsContent value="exchange">
              {/* Data freshness badge for POE2Scout API tab */}
              {exchangeFetchedAt > 0 && (
                <DataFreshnessBadge
                  fetchedAt={new Date(exchangeFetchedAt).toISOString()}
                  dataAvailable={!!exchangeData}
                  compact={uiState.denseMode}
                />
              )}
              {isLoading ? (
                <ExchangeTableSkeleton rows={15} />
              ) : activeError && !exchangeData ? (
                <ApiErrorFallback
                  error={activeError}
                  onRetry={() => refetchExchange()}
                  title={t("failedToLoadData")}
                />
              ) : exchangePairs.length === 0 && !exchangeData ? (
                <EmptyState
                  kind="noResults"
                  message={t("noExchangePairs")}
                  suggestion={search ? t("noResultsSuggestion") : undefined}
                />
              ) : (
                <>
                  {/* §1.1: View toggle + §1.2: Quick Filter Chips + §2.3: Extended Filters */}
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    {/* Quick Filter Chips (§1.2) */}
                    <div className="flex items-center gap-1.5" role="group" aria-label={t("ariaExchangeFilters")}>
                      <Badge
                        variant={uiState.exchange.activeFilter === "all" ? "default" : "outline"}
                        className="cursor-pointer"
                        onClick={() => setExchangeFilter("all")}
                        role="button"
                        aria-pressed={uiState.exchange.activeFilter === "all"}
                        tabIndex={0}
                      >
                        {t("allPairs")}
                      </Badge>
                      <Badge
                        variant={uiState.exchange.activeFilter === "topVolume" ? "default" : "outline"}
                        className="cursor-pointer"
                        onClick={() => setExchangeFilter("topVolume")}
                        role="button"
                        aria-pressed={uiState.exchange.activeFilter === "topVolume"}
                        tabIndex={0}
                      >
                        {t("topVolume")}
                      </Badge>
                      <Badge
                        variant={uiState.exchange.activeFilter === "favorites" ? "default" : "outline"}
                        className={`cursor-pointer ${
                          uiState.exchange.favorites.length === 0 ? "opacity-50 cursor-not-allowed" : ""
                        }`}
                        onClick={() => {
                          if (uiState.exchange.favorites.length > 0) {
                            setExchangeFilter("favorites");
                          }
                        }}
                        role="button"
                        aria-pressed={uiState.exchange.activeFilter === "favorites"}
                        aria-disabled={uiState.exchange.favorites.length === 0}
                        tabIndex={0}
                        title={uiState.exchange.favorites.length === 0 ? (t("favoritesEmptyTooltip")) : undefined}
                      >
                        <Star className="h-3 w-3 mr-1" aria-hidden="true" />
                        {t("favorites")}
                      </Badge>

                      {/* §2.3: Extended Filters toggle button */}
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs gap-1 px-2"
                        onClick={() => setExtendedFiltersOpen(!extendedFiltersOpen)}
                        aria-expanded={extendedFiltersOpen}
                        aria-label={t("filters")}
                      >
                        <Filter className="h-3.5 w-3.5" aria-hidden="true" />
                        {t("filters")}
                        {activeExtFilterCount > 0 && (
                          <Badge variant="secondary" className="ml-1 h-4 w-4 p-0 text-[10px] flex items-center justify-center rounded-full">
                            {activeExtFilterCount}
                          </Badge>
                        )}
                      </Button>
                    </div>

                    {/* View toggle: Table / Cards (§1.1) */}
                    <div className="flex items-center gap-1" role="group" aria-label={t("ariaViewMode")}>
                      <Button
                        variant={uiState.exchange.viewMode === "table" ? "default" : "outline"}
                        size="sm"
                        className="h-7 text-xs gap-1 px-2"
                        onClick={() => setExchangeViewMode("table")}
                        aria-pressed={uiState.exchange.viewMode === "table"}
                        aria-label={t("ariaTableView")}
                      >
                        <List className="h-3.5 w-3.5" aria-hidden="true" />
                        {t("tableView")}
                      </Button>
                      <Button
                        variant={uiState.exchange.viewMode === "cards" ? "default" : "outline"}
                        size="sm"
                        className="h-7 text-xs gap-1 px-2"
                        onClick={() => setExchangeViewMode("cards")}
                        aria-pressed={uiState.exchange.viewMode === "cards"}
                        aria-label={t("ariaCardsView")}
                      >
                        <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" />
                        {t("cardsView")}
                      </Button>
                    </div>
                  </div>

                  {/* §2.3: Extended Filters collapsible panel */}
                  {extendedFiltersOpen && (
                    <div className="mb-3 p-3 border border-border rounded-lg bg-muted/30" role="region" aria-label={t("ariaExtendedFilters")}>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {/* Min Volume */}
                        <div>
                          <label className="text-xs text-muted-foreground mb-1 block">{t("minVolume")}</label>
                          <Input
                            type="number"
                            placeholder="0"
                            value={uiState.exchange.extendedFilters.minVolume ?? ""}
                            onChange={(e) => {
                              const val = e.target.value;
                              setExchangeExtendedFilters({
                                ...uiState.exchange.extendedFilters,
                                minVolume: val === "" ? null : Number(val),
                              });
                            }}
                            className="h-7 text-xs"
                            min={0}
                          />
                        </div>
                        {/* Max Volume */}
                        <div>
                          <label className="text-xs text-muted-foreground mb-1 block">{t("maxVolume")}</label>
                          <Input
                            type="number"
                            placeholder="∞"
                            value={uiState.exchange.extendedFilters.maxVolume ?? ""}
                            onChange={(e) => {
                              const val = e.target.value;
                              setExchangeExtendedFilters({
                                ...uiState.exchange.extendedFilters,
                                maxVolume: val === "" ? null : Number(val),
                              });
                            }}
                            className="h-7 text-xs"
                            min={0}
                          />
                        </div>
                        {/* Min Change % */}
                        <div>
                          <label className="text-xs text-muted-foreground mb-1 block">{t("minChange")}</label>
                          <Input
                            type="number"
                            placeholder="-∞"
                            value={uiState.exchange.extendedFilters.minChange ?? ""}
                            onChange={(e) => {
                              const val = e.target.value;
                              setExchangeExtendedFilters({
                                ...uiState.exchange.extendedFilters,
                                minChange: val === "" ? null : Number(val),
                              });
                            }}
                            className="h-7 text-xs"
                          />
                        </div>
                        {/* Max Change % */}
                        <div>
                          <label className="text-xs text-muted-foreground mb-1 block">{t("maxChange")}</label>
                          <Input
                            type="number"
                            placeholder="∞"
                            value={uiState.exchange.extendedFilters.maxChange ?? ""}
                            onChange={(e) => {
                              const val = e.target.value;
                              setExchangeExtendedFilters({
                                ...uiState.exchange.extendedFilters,
                                maxChange: val === "" ? null : Number(val),
                              });
                            }}
                            className="h-7 text-xs"
                          />
                        </div>
                      </div>
                      {/* Reset button */}
                      {activeExtFilterCount > 0 && (
                        <div className="mt-2 flex justify-end">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 text-xs"
                            onClick={() => clearExchangeExtendedFilters()}
                          >
                            {t("resetFilters")}
                          </Button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* P2-4: Volume & Liquidity Indicators */}
                  <ErrorBoundary fallbackTitle={t("fallbackVolumeLiquidity")}>
                    <VolumeLiquidityIndicators
                      realm={realm}
                      league={effectiveLeague}
                      backendOnline={flipperBackendOnline}
                    />
                  </ErrorBoundary>

                  {/* Empty state for favorites filter */}
                  {uiState.exchange.activeFilter === "favorites" && exchangePairs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-muted-foreground" role="status">
                      <Star className="h-12 w-12 mb-4 opacity-30" aria-hidden="true" />
                      <p className="text-lg mb-1">{t("noFavoritesYet")}</p>
                      <p className="text-sm">{t("addFavoritesHint")}</p>
                    </div>
                  ) : uiState.exchange.viewMode === "table" ? (
                    /* §1.1: Table-First Layout */
                    <ExchangeTable
                      pairs={exchangePairs}
                      onPairClick={openPairDetail}
                      realm={realm}
                      league={effectiveLeague}
                      highlightedRowIndex={tab === "exchange" ? highlightedRowIndex : null}
                      highlightedItemId={highlightedItemId}
                      exchangePairsForConversion={exchangeData ?? undefined}
                      optimalPaymentByPair={optimalPaymentByPair}
                      crossRateFlips={crossRateFlips}
                      anchorId={selectedAnchorId}
                    />
                  ) : (
                    /* Cards view (original) */
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2" role="list" aria-label={t("ariaExchangePairs")}>
                      {exchangePairs.map((pair) => (
                        <ExchangePairCard
                          key={pair.id}
                          pair={pair}
                          onClick={openPairDetail}
                          realm={realm}
                          league={effectiveLeague}
                          showHoverPreview={true}
                          maxVolume={Math.max(...(exchangeData ?? []).map((p) => p.volume), 1)}
                          exchangePairsForConversion={exchangeData ?? undefined}
                          optimalPaymentResult={optimalPaymentByPair.get(pair.id) ?? undefined}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}
            </TabsContent>

            {/* ============ ARBITRAGE TAB ============ */}
            <TabsContent value="arbitrage">
              <ErrorBoundary fallbackTitle={t("fallbackArbitrageCalculator")}>
                <ArbitrageTab
                  realm={realm}
                  league={effectiveLeague}
                  backendOnline={flipperBackendOnline}
                  upstreamDegraded={flipperBackendOnline && !flipperUpstreamReachable}
                />
              </ErrorBoundary>
            </TabsContent>

            {/* ============ FLIPS TAB ============ */}
            <TabsContent value="flips">
              <ErrorBoundary fallbackTitle={t("fallbackFlips")}>
                <FlipsTab backendOnline={flipperBackendOnline} upstreamDegraded={flipperBackendOnline && !flipperUpstreamReachable} />
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
