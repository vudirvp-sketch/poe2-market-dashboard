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
  LineChart,
  TrendingUp,
  Briefcase,
  Network,
  LayoutGrid,
  List,
  Filter,
  SearchX,
  Inbox,
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

// Heavy tab components — lazy-loaded via next/dynamic to reduce initial bundle size.
// These tabs use Recharts (forecast, portfolio) or complex force-layout (graph)
// which add significant JS weight. Users rarely visit all tabs in one session,
// so deferring these imports improves Time-to-Interactive significantly.
import dynamic from "next/dynamic";

const ForecastTab = dynamic(
  () => import("@/components/dashboard/forecast-tab").then((m) => ({ default: m.ForecastTab })),
  {
    loading: () => (
      <div className="space-y-4">
        <div className="h-20 w-full animate-pulse rounded bg-muted" />
        <div className="h-[300px] w-full animate-pulse rounded bg-muted" />
        <div className="h-48 w-full animate-pulse rounded bg-muted" />
      </div>
    ),
  },
);

const PortfolioTab = dynamic(
  () => import("@/components/dashboard/portfolio-tab").then((m) => ({ default: m.PortfolioTab })),
  {
    loading: () => (
      <div className="space-y-4">
        <div className="h-20 w-full animate-pulse rounded bg-muted" />
        <div className="grid grid-cols-3 gap-4">
          <div className="h-24 animate-pulse rounded bg-muted" />
          <div className="h-24 animate-pulse rounded bg-muted" />
          <div className="h-24 animate-pulse rounded bg-muted" />
        </div>
        <div className="h-64 w-full animate-pulse rounded bg-muted" />
        <div className="h-48 w-full animate-pulse rounded bg-muted" />
      </div>
    ),
  },
);

const CurrencyGraphTab = dynamic(
  () => import("@/components/dashboard/currency-graph-tab").then((m) => ({ default: m.CurrencyGraphTab })),
  {
    loading: () => (
      <div className="space-y-4">
        <div className="h-20 w-full animate-pulse rounded bg-muted" />
        <div className="grid grid-cols-4 gap-4">
          <div className="h-24 animate-pulse rounded bg-muted" />
          <div className="h-24 animate-pulse rounded bg-muted" />
          <div className="h-24 animate-pulse rounded bg-muted" />
          <div className="h-24 animate-pulse rounded bg-muted" />
        </div>
        <div className="h-[500px] w-full animate-pulse rounded bg-muted" />
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

import {
  fetchApi,
  fmt,
  fmtChange,
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
} from "@/lib/types";
import { useDashboardStore } from "@/lib/store";
import { usePriceAlerts } from "@/hooks/use-price-alerts";
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
  } = useDashboardStore();

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
    retry: false,
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

  // Reference currencies
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

  // Categories
  const currencyCategories = useMemo(() => {
    const cats = uniqueCategories?.filter((c) => c.name !== "Unique") || [];
    if (cats.length === 0) cats.push({ name: "all", displayName: "All", count: 0 });
    return cats;
  }, [uniqueCategories]);

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
    if (cats.length === 0) cats.push({ name: "all", displayName: "All", count: 0 });
    return cats;
  }, [uniqueCategories]);

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

  // --- Export handler ---
  const handleExport = useCallback(
    (format: "csv" | "json") => {
      const timestamp = new Date().toISOString().slice(0, 10);
      if (tab === "currencies" && currenciesData) {
        const data = currenciesData.items.map((i) => ({
          name: i.name,
          type: i.type,
          price: i.relativePrice ?? i.priceChaos,
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
          price: i.relativePrice ?? i.priceChaos,
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
        onReferenceCurrencyChange={setReferenceCurrency}
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
          // Set the search so the table filters to show the item
          // For exchange, we use pair names; for items, we use item names
          setSearch(""); // Clear search after navigation — the tab switch itself highlights
        }}
      />

      <FlipperStickyBar backendOnline={flipperBackendOnline} />

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
              <TabsList aria-label="Dashboard sections">
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
                <TabsTrigger value="forecast" className="gap-1.5" aria-label={t("tabForecast")}>
                  <LineChart className="h-4 w-4" aria-hidden="true" /> {t("tabForecast")}
                </TabsTrigger>
                <TabsTrigger value="portfolio" className="gap-1.5" aria-label={t("tabPortfolio")}>
                  <Briefcase className="h-4 w-4" aria-hidden="true" /> {t("tabPortfolio")}
                </TabsTrigger>
                <TabsTrigger value="graph" className="gap-1.5" aria-label={t("tabGraph")}>
                  <Network className="h-4 w-4" aria-hidden="true" /> {t("tabGraph")}
                </TabsTrigger>
                <TabsTrigger value="watchlist" className="gap-1.5" aria-label={t("tabWatchlist")}>
                  <Star className="h-4 w-4" aria-hidden="true" /> {t("tabWatchlist")}
                </TabsTrigger>
              </TabsList>

              <div className="flex items-center gap-2">
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
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label="Category filter">
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
              <ErrorBoundary fallbackTitle="Market Overview">
                <MarketOverview
                  realm={realm}
                  league={effectiveLeague}
                  onItemClick={openDetail}
                  backendOnline={flipperBackendOnline}
                />
              </ErrorBoundary>
            </TabsContent>

            {/* ============ CURRENCIES TAB ============ */}
            <TabsContent value="currencies">
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
                  suggestion={search ? t("noResultsSuggestion") ?? "Try adjusting your search or switching to a different category." : undefined}
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
                    />
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2" role="list" aria-label="Currency items">
                      {currenciesData.items.map((item) => (
                        <CurrencyCard
                          key={item.id}
                          item={item}
                          onClick={openDetail}
                          realm={realm}
                          league={effectiveLeague}
                          referenceCurrency={referenceCurrency}
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
                  suggestion={search ? t("noResultsSuggestion") ?? "Try adjusting your search or switching to a different category." : undefined}
                />
              ) : (
                <>
                  <UniqueTable
                    items={uniquesData.items}
                    onItemClick={openDetail}
                    realm={realm}
                    league={effectiveLeague}
                    referenceCurrency={referenceCurrency}
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
                  suggestion={search ? t("noResultsSuggestion") ?? "Try adjusting your search or switching to 'All Pairs'." : undefined}
                />
              ) : (
                <>
                  {/* §1.1: View toggle + §1.2: Quick Filter Chips + §2.3: Extended Filters */}
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    {/* Quick Filter Chips (§1.2) */}
                    <div className="flex items-center gap-1.5" role="group" aria-label="Exchange filters">
                      <Badge
                        variant={uiState.exchange.activeFilter === "all" ? "default" : "outline"}
                        className="cursor-pointer"
                        onClick={() => setExchangeFilter("all")}
                        role="button"
                        aria-pressed={uiState.exchange.activeFilter === "all"}
                        tabIndex={0}
                      >
                        {t("allPairs") ?? "All Pairs"}
                      </Badge>
                      <Badge
                        variant={uiState.exchange.activeFilter === "topVolume" ? "default" : "outline"}
                        className="cursor-pointer"
                        onClick={() => setExchangeFilter("topVolume")}
                        role="button"
                        aria-pressed={uiState.exchange.activeFilter === "topVolume"}
                        tabIndex={0}
                      >
                        {t("topVolume") ?? "Top Volume"}
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
                        title={uiState.exchange.favorites.length === 0 ? (t("favoritesEmptyTooltip") ?? "Add pairs to favorites by clicking the star icon") : undefined}
                      >
                        <Star className="h-3 w-3 mr-1" aria-hidden="true" />
                        {t("favorites") ?? "Favorites"}
                      </Badge>

                      {/* §2.3: Extended Filters toggle button */}
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs gap-1 px-2"
                        onClick={() => setExtendedFiltersOpen(!extendedFiltersOpen)}
                        aria-expanded={extendedFiltersOpen}
                        aria-label={t("filters") ?? "Filters"}
                      >
                        <Filter className="h-3.5 w-3.5" aria-hidden="true" />
                        {t("filters") ?? "Filters"}
                        {activeExtFilterCount > 0 && (
                          <Badge variant="secondary" className="ml-1 h-4 w-4 p-0 text-[10px] flex items-center justify-center rounded-full">
                            {activeExtFilterCount}
                          </Badge>
                        )}
                      </Button>
                    </div>

                    {/* View toggle: Table / Cards (§1.1) */}
                    <div className="flex items-center gap-1" role="group" aria-label="View mode">
                      <Button
                        variant={uiState.exchange.viewMode === "table" ? "default" : "outline"}
                        size="sm"
                        className="h-7 text-xs gap-1 px-2"
                        onClick={() => setExchangeViewMode("table")}
                        aria-pressed={uiState.exchange.viewMode === "table"}
                        aria-label="Table view"
                      >
                        <List className="h-3.5 w-3.5" aria-hidden="true" />
                        {t("tableView") ?? "Table"}
                      </Button>
                      <Button
                        variant={uiState.exchange.viewMode === "cards" ? "default" : "outline"}
                        size="sm"
                        className="h-7 text-xs gap-1 px-2"
                        onClick={() => setExchangeViewMode("cards")}
                        aria-pressed={uiState.exchange.viewMode === "cards"}
                        aria-label="Cards view"
                      >
                        <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" />
                        {t("cardsView") ?? "Cards"}
                      </Button>
                    </div>
                  </div>

                  {/* §2.3: Extended Filters collapsible panel */}
                  {extendedFiltersOpen && (
                    <div className="mb-3 p-3 border border-border rounded-lg bg-muted/30" role="region" aria-label="Extended filters">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {/* Min Volume */}
                        <div>
                          <label className="text-xs text-muted-foreground mb-1 block">{t("minVolume") ?? "Min Volume"}</label>
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
                          <label className="text-xs text-muted-foreground mb-1 block">{t("maxVolume") ?? "Max Volume"}</label>
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
                          <label className="text-xs text-muted-foreground mb-1 block">{t("minChange") ?? "Min Change %"}</label>
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
                          <label className="text-xs text-muted-foreground mb-1 block">{t("maxChange") ?? "Max Change %"}</label>
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
                            {t("resetFilters") ?? "Reset filters"}
                          </Button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Empty state for favorites filter */}
                  {uiState.exchange.activeFilter === "favorites" && exchangePairs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-muted-foreground" role="status">
                      <Star className="h-12 w-12 mb-4 opacity-30" aria-hidden="true" />
                      <p className="text-lg mb-1">{t("noFavoritesYet") ?? "No favorite pairs yet"}</p>
                      <p className="text-sm">{t("addFavoritesHint") ?? "Click the ★ icon on any pair to add it."}</p>
                    </div>
                  ) : uiState.exchange.viewMode === "table" ? (
                    /* §1.1: Table-First Layout */
                    <ExchangeTable
                      pairs={exchangePairs}
                      onPairClick={openPairDetail}
                      realm={realm}
                      league={effectiveLeague}
                    />
                  ) : (
                    /* Cards view (original) */
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2" role="list" aria-label="Exchange pairs">
                      {exchangePairs.map((pair) => (
                        <ExchangePairCard
                          key={pair.id}
                          pair={pair}
                          onClick={openPairDetail}
                          realm={realm}
                          league={effectiveLeague}
                          showHoverPreview={true}
                          maxVolume={Math.max(...(exchangeData ?? []).map((p) => p.volume), 1)}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}
            </TabsContent>

            {/* ============ ARBITRAGE TAB ============ */}
            <TabsContent value="arbitrage">
              <ErrorBoundary fallbackTitle="Arbitrage Calculator">
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
              <ErrorBoundary fallbackTitle="Flips">
                <FlipsTab backendOnline={flipperBackendOnline} upstreamDegraded={flipperBackendOnline && !flipperUpstreamReachable} />
              </ErrorBoundary>
            </TabsContent>

            {/* ============ FORECAST TAB ============ */}
            <TabsContent value="forecast">
              <ErrorBoundary fallbackTitle="Forecasts">
                <ForecastTab backendOnline={flipperBackendOnline} upstreamDegraded={flipperBackendOnline && !flipperUpstreamReachable} />
              </ErrorBoundary>
            </TabsContent>

            {/* ============ PORTFOLIO TAB ============ */}
            <TabsContent value="portfolio">
              <ErrorBoundary fallbackTitle="Portfolio">
                <PortfolioTab backendOnline={flipperBackendOnline} upstreamDegraded={flipperBackendOnline && !flipperUpstreamReachable} />
              </ErrorBoundary>
            </TabsContent>

            {/* ============ CURRENCY GRAPH TAB ============ */}
            <TabsContent value="graph">
              <ErrorBoundary fallbackTitle="Currency Graph">
                <CurrencyGraphTab backendOnline={flipperBackendOnline} upstreamDegraded={flipperBackendOnline && !flipperUpstreamReachable} />
              </ErrorBoundary>
            </TabsContent>

            {/* ============ WATCHLIST TAB ============ */}
            <TabsContent value="watchlist">
              <ErrorBoundary fallbackTitle="Watchlist">
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
      <ErrorBoundary fallbackTitle="Item Details">
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
      <ErrorBoundary fallbackTitle="Pair Details">
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
    </div>
  );
}
