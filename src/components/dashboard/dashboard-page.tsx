"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Tabs, TabsContent } from "@/components/ui/tabs";

import { Header } from "@/components/dashboard/header";
// P2-1 (iter 71): ExchangeTabContent extracted from this file.
import { ExchangeTabContent } from "@/components/dashboard/exchange-tab-content";
// P2-1 (iter 72): CurrenciesTabContent / UniquesTabContent / OverviewTabContent extracted.
import { CurrenciesTabContent } from "@/components/dashboard/currencies-tab-content";
import { UniquesTabContent } from "@/components/dashboard/uniques-tab-content";
import { OverviewTabContent } from "@/components/dashboard/overview-tab-content";
// P2-1 (iter 73, step 4a): DashboardToolbar extracted (TabsList + action buttons + category chips).
import { DashboardToolbar } from "@/components/dashboard/dashboard-toolbar";
// P2-1 (iter 73, step 4b): DashboardDialogs extracted (8 dialog/sheet/banner wrappers).
import { DashboardDialogs } from "@/components/dashboard/dashboard-dialogs";
// WatchlistTab — lazy-loaded (Phase 4.1)
// ArbitrageTab, ArbitrageFlipperFlips, ArbitrageHelpers — deleted (iter 37)
// FlipsTab, OptimizerTab, AnalystTab — lazy-loaded (Phase 4.1)
// MarketHeatmap — deleted (iter 37)
import { TierDriftTracker } from "@/components/dashboard/tier-drift-tracker";
// LiquidChainTab — lazy-loaded (Phase 4.1)

// Phase 4.1: Lazy-loaded tab components via next/dynamic.
// Heavy tabs (Flips, Optimizer, Analyst, LiquidChain, Watchlist)
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

const WatchlistTab = dynamic(
  () => import("@/components/dashboard/watchlist-tab").then((m) => ({ default: m.WatchlistTab })),
  { loading: TabSkeleton },
);

// F2 (iter 74): Storage Value tab — lazy-loaded. Wraps the existing
// /api/v1/storage-value/{currency} endpoint with a Hold/Sell decision UI.
const StorageValueTab = dynamic(
  () => import("@/components/dashboard/storage-value-tab").then((m) => ({ default: m.StorageValueTab })),
  { loading: TabSkeleton },
);

// F5 (iter 77): Speculation tab — lazy-loaded. Wraps the new
// /api/v1/speculation endpoint with a BUY/SELL/HOLD list driven by z-score.
const SpeculationTab = dynamic(
  () => import("@/components/dashboard/speculation-tab").then((m) => ({ default: m.SpeculationTab })),
  { loading: TabSkeleton },
);

import { FlipperStickyBar } from "@/components/dashboard/flipper-sticky-bar";
import { ErrorBoundary } from "@/components/dashboard/error-boundary";

import { exportToCsv, exportToJson } from "@/lib/types";
import { useExchangePairs, useReferenceCurrencies } from "@/hooks/use-exchange-pairs";
// iter 81 (useDashboardData Stage 1): flipper backend health/phase/events
// queries extracted into a dedicated hook to keep dashboard-page.tsx lean.
import { useFlipperBackend } from "@/hooks/use-flipper-backend";
// iter 82 (useDashboardData Stage 2): realm/league selection + realms/leagues
// queries extracted into a dedicated hook. The hook owns the realm+league
// state so the auto-select useEffect can fire when leagues arrive.
import { useRealmsAndLeagues } from "@/hooks/use-realms-and-leagues";
// iter 83 (useDashboardData Stage 3a): exchange-pairs filter pipeline +
// currency/unique category-chip list derivation extracted into two new
// hooks.
// iter 84 (useDashboardData Stage 3b): optimalPayment cluster (useQuery +
// clientOptimalResult memo + merge memo + byDisplayName memo) extracted into
// useOptimalPayment(). With Stage 3b shipped, the useDashboardData
// extraction is COMPLETE — dashboard-page.tsx is now legitimate parent
// wiring. Stage 3b was the highest interdependency risk in the entire
// extraction plan (merge memo consumes both the useQuery result AND the
// clientOptimalResult memo; byDisplayName memo consumes the merge memo's
// output). A single hook suffices because the pipeline is internally linear.
import { useFilteredExchangePairs } from "@/hooks/use-filtered-exchange-pairs";
import { useItemCategoryLists } from "@/hooks/use-item-category-lists";
import { useOptimalPayment } from "@/hooks/use-optimal-payment";
import { useCrossRates } from "@/hooks/use-cross-rates";
import { useCurrencyItems, useAllItems, useItemCategories } from "@/hooks/use-currency-items";
import { useUniqueItems } from "@/hooks/use-unique-items";
import { usePrefetch } from "@/hooks/use-prefetch";
import { useInitialBatch } from "@/hooks/use-batch-query";
import { usePriceStream } from "@/hooks/use-price-stream";
// iter 84: useQuery + QUERY_KEYS + fetchApi + OptimalPaymentResult +
// OptimalCurrencyResponse + CrossRateFlip + findOptimalPayment +
// isItemCategory imports removed — they are now consumed inside
// useOptimalPayment() (see src/hooks/use-optimal-payment.ts).
import type {
  PoeItem,
  ExchangePair,
  ReferenceCurrency,
} from "@/lib/types";
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
  // iter 82: realm + league state + realms/leagues queries + effectiveLeague
  // + auto-select useEffect extracted into useRealmsAndLeagues().
  const {
    realm,
    setRealm,
    league,
    setLeague,
    realms,
    realmsLoading,
    leagues,
    leaguesLoading,
    effectiveLeague,
  } = useRealmsAndLeagues();
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
    setExchangeViewMode,
    setExchangeFilter,
    setExchangeExtendedFilters,
    clearExchangeExtendedFilters,
    setDenseMode,
    setBaseCurrency,
    _hydrated: storeHydrated,
  } = useDashboardStore();
  // NOTE: `persistLeague` (formerly `setLeague: persistLeague`) is now consumed
  // inside useRealmsAndLeagues() — see src/hooks/use-realms-and-leagues.ts.

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
  // Flipper backend health / phase / events (dashboard-level, shared)
  // ============================================================================
  // iter 81 (useDashboardData Stage 1): extracted into useFlipperBackend()
  // to keep dashboard-page.tsx focused on parent wiring. The hook returns
  // flipperBackendOnline, flipperUpstreamReachable, flipperPhaseData, and
  // activeEventsCount — exactly what this component consumes below.
  const {
    flipperBackendOnline,
    flipperUpstreamReachable,
    flipperPhaseData,
    activeEventsCount,
  } = useFlipperBackend();

  // Portfolio data query removed — the Portfolio tab used a mock correlation matrix.
  // FlipperStickyBar now defaults to correlationWarning=false.

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

  // --- Realms / leagues queries + effectiveLeague + auto-select useEffect
  // moved to useRealmsAndLeagues() in iter 82 (Stage 2 of useDashboardData
  // hook extraction). See src/hooks/use-realms-and-leagues.ts.

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

  // Wrapper for league changes moved to useRealmsAndLeagues() in iter 82.
  // The hook also owns the auto-select useEffect that fires when `leagues`
  // first arrives (was inline in dashboard-page.tsx before iter 82).

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
  // iter 83 (Stage 3a): filter pipeline (search → quick chip → extended
  // numeric filters) extracted into useFilteredExchangePairs. The hook is
  // pure — it receives exchangeData, search, and the exchangeUiState slice
  // as inputs and returns a derived array. Zero behavior change.
  const exchangePairs = useFilteredExchangePairs({
    exchangeData,
    search,
    exchangeUiState: uiState.exchange,
  });

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
  // iter 84 (Stage 3b): the entire optimalPayment cluster — useQuery +
  // clientOptimalResult memo + backend/client merge memo + byDisplayName
  // memo — is now owned by useOptimalPayment(). The hook receives
  // exchangeData + crossRates + flipperBackendOnline as inputs (all already
  // in scope here) and returns the four values consumed downstream:
  //   - optimalPaymentByPair         → ExchangeTabContent prop
  //   - crossRateFlips                → ExchangeTabContent prop
  //   - selectedAnchorId              → ExchangeTabContent + FlipsTab prop
  //   - optimalPaymentByDisplayName   → FlipsTab prop
  // Same query key, same polling interval, same merge priority (backend
  // first → client fallback), same dependency arrays. Zero behavior change.
  // With Stage 3b shipped, the useDashboardData extraction is COMPLETE.
  const {
    optimalPaymentByPair,
    crossRateFlips,
    selectedAnchorId,
    optimalPaymentByDisplayName,
    bestPaymentTopList,
  } = useOptimalPayment({
    exchangeData,
    crossRates,
    flipperBackendOnline,
  });

  // iter 83 (Stage 3a): currencyCategories + uniqueCategoriesList derivation
  // extracted into useItemCategoryLists. The hook is pure — receives
  // uniqueCategories and t as inputs, returns two derived arrays. Zero
  // behavior change (same filter rules, same empty-list "all" fallback).
  const { currencyCategories, uniqueCategoriesList } = useItemCategoryLists({
    uniqueCategories,
    t,
  });

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
  // "storage-value" added iter 74 (F2).
  // "speculation" added iter 77 (F5) — placed after storage-value so the
  // analytics-cluster (storage-value → speculation) sits together.
  // iter 92 (KI-7): Removed dead "arbitrage" (was idx 4, shortcut 5 silently did nothing)
  // and dead "graph" (was idx 11, removed in iter 87). Now shortcuts 1–0 all work.
  const TAB_MAP = ["overview", "currencies", "uniques", "exchange", "flips", "optimizer", "analyst", "storage-value", "speculation", "liquid-chain", "watchlist"];

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
        // iter 82: setRealm already clears the league inside the hook.
        onRealmChange={setRealm}
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
            {/* P2-1 (iter 73, step 4a): toolbar JSX extracted to <DashboardToolbar /> */}
            <DashboardToolbar
              categoryFilter={categoryFilter}
              currentCategories={currentCategories}
              showCategoryFilter={tab === "currencies" || tab === "uniques"}
              alertsCount={alerts.length}
              comparisonCount={comparisonIds.length}
              pairComparisonCount={pairComparisonIds.length}
              onCategoryChange={setCategoryFilter}
              onShortcutsClick={() => setShortcutsHelpOpen(true)}
              onAlertsClick={() => setAlertOpen(true)}
              onComparisonClick={() => setComparisonOpen(true)}
              onPairComparisonClick={() => setPairComparisonOpen(true)}
              t={t}
              tp={tp}
            />

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
                bestPaymentTopList={bestPaymentTopList}
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
              <ErrorBoundary fallbackTitle={t("fallbackOptimizer")}>
                <OptimizerTab backendOnline={flipperBackendOnline} />
              </ErrorBoundary>
            </TabsContent>

            {/* ============ ANALYST TAB ============ */}
            <TabsContent value="analyst">
              <ErrorBoundary fallbackTitle={t("fallbackAnalyst")}>
                <AnalystTab backendOnline={flipperBackendOnline} realm={realm} league={effectiveLeague} />
              </ErrorBoundary>
            </TabsContent>

            {/* ============ STORAGE VALUE TAB (F2, iter 74) ============ */}
            <TabsContent value="storage-value">
              <ErrorBoundary fallbackTitle={t("fallbackStorageValue")}>
                <StorageValueTab backendOnline={flipperBackendOnline} />
              </ErrorBoundary>
            </TabsContent>

            {/* ============ SPECULATION TAB (F5, iter 77) ============ */}
            <TabsContent value="speculation">
              <ErrorBoundary fallbackTitle={t("fallbackSpeculation")}>
                <SpeculationTab backendOnline={flipperBackendOnline} />
              </ErrorBoundary>
            </TabsContent>

            {/* ============ LIQUID CHAIN TAB ============ */}
            <TabsContent value="liquid-chain">
              <ErrorBoundary fallbackTitle={t("fallbackLiquidChain")}>
                <LiquidChainTab backendOnline={flipperBackendOnline} upstreamDegraded={flipperBackendOnline && !flipperUpstreamReachable} />
              </ErrorBoundary>
            </TabsContent>

            {/* ============ FORECAST TAB (removed) ============ */}

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

      {/* P2-1 (iter 73, step 4b): 8 dialog/sheet/banner wrappers extracted to <DashboardDialogs /> */}
      <DashboardDialogs
        detailItem={detailItem}
        detailOpen={detailOpen}
        setDetailOpen={setDetailOpen}
        detailPair={detailPair}
        pairDetailOpen={pairDetailOpen}
        setPairDetailOpen={setPairDetailOpen}
        comparisonOpen={comparisonOpen}
        setComparisonOpen={setComparisonOpen}
        pairComparisonOpen={pairComparisonOpen}
        setPairComparisonOpen={setPairComparisonOpen}
        alertOpen={alertOpen}
        setAlertOpen={setAlertOpen}
        eventsSidebarOpen={eventsSidebarOpen}
        setEventsSidebarOpen={setEventsSidebarOpen}
        shortcutsHelpOpen={shortcutsHelpOpen}
        setShortcutsHelpOpen={setShortcutsHelpOpen}
        realm={realm}
        league={effectiveLeague}
        referenceCurrency={referenceCurrency}
        allItems={allItems}
        backendOnline={flipperBackendOnline}
        t={t}
      />
    </div>
  );
}
