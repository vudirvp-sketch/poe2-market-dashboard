"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Coins,
  Shield,
  ArrowLeftRight,
  Star,
  BarChart3,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";

import { Header } from "@/components/dashboard/header";
import { CurrencyCard } from "@/components/dashboard/currency-card";
import { UniqueTable } from "@/components/dashboard/unique-table";
import { ExchangePairCard } from "@/components/dashboard/exchange-pair-card";
import { DetailDialog } from "@/components/dashboard/detail-dialog";
import { PairDetailDialog } from "@/components/dashboard/pair-detail-dialog";
import { MarketOverview } from "@/components/dashboard/market-overview";
import { WatchlistTab } from "@/components/dashboard/watchlist-tab";
import { Pagination } from "@/components/dashboard/pagination";

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
} from "@/lib/types";

// ============================================================================
// Main Dashboard
// ============================================================================
export default function Dashboard() {
  // --- Selection state ---
  const [realm, setRealm] = useState("pc");
  const [league, setLeague] = useState("");
  const [tab, setTab] = useState("overview");
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

  // --- Auto-refresh ---
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // --- Base currency ---
  const [referenceCurrency, setReferenceCurrency] = useState("");

  // --- Data queries ---
  const { data: realms, isLoading: realmsLoading } = useQuery({
    queryKey: ["realms"],
    queryFn: () => fetchApi<Realm[]>("/api/poe2/realms"),
  });

  const { data: leagues, isLoading: leaguesLoading } = useQuery({
    queryKey: ["leagues", realm],
    queryFn: () => fetchApi<League[]>("/api/poe2/leagues", { realm }),
    enabled: !!realm,
  });

  // Auto-select first active league
  const effectiveLeague = useMemo(() => {
    if (league && leagues?.some((l) => l.name === league)) return league;
    const active = leagues?.find((l) => l.active);
    return active?.name || leagues?.[0]?.name || "";
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

  // Currencies
  const {
    data: currenciesData,
    isLoading: currenciesLoading,
    refetch: refetchCurrencies,
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
  });

  // Exchange
  const {
    data: exchangeData,
    isLoading: exchangeLoading,
    refetch: refetchExchange,
  } = useQuery({
    queryKey: ["exchange", realm, effectiveLeague],
    queryFn: () =>
      fetchApi<ExchangePair[]>("/api/poe2/exchange", {
        realm,
        league: effectiveLeague,
        action: "pairs",
      }),
    enabled: tab === "exchange" && !!effectiveLeague,
    refetchInterval: autoRefresh ? 60_000 : false,
    refetchIntervalInBackground: false,
  });

  // --- Derived data ---
  const exchangePairs = useMemo(() => {
    const pairs = exchangeData || [];
    if (!search) return pairs;
    return pairs.filter(
      (p) =>
        p.currency1Name.toLowerCase().includes(search.toLowerCase()) ||
        p.currency2Name.toLowerCase().includes(search.toLowerCase())
    );
  }, [exchangeData, search]);

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

  const showExport = tab === "currencies" || tab === "uniques" || tab === "exchange";

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
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
      />

      {/* Main content */}
      <main className="max-w-[1600px] mx-auto px-4 py-4">
        {!effectiveLeague ? (
          <div className="flex flex-col items-center justify-center py-32 text-muted-foreground">
            <AlertTriangle className="h-12 w-12 mb-4" />
            <p className="text-lg">Select a realm and league to begin</p>
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
              <TabsList>
                <TabsTrigger value="overview" className="gap-1.5">
                  <BarChart3 className="h-4 w-4" /> Overview
                </TabsTrigger>
                <TabsTrigger value="currencies" className="gap-1.5">
                  <Coins className="h-4 w-4" /> Currencies
                </TabsTrigger>
                <TabsTrigger value="uniques" className="gap-1.5">
                  <Shield className="h-4 w-4" /> Uniques
                </TabsTrigger>
                <TabsTrigger value="exchange" className="gap-1.5">
                  <ArrowLeftRight className="h-4 w-4" /> Exchange
                </TabsTrigger>
                <TabsTrigger value="watchlist" className="gap-1.5">
                  <Star className="h-4 w-4" /> Watchlist
                </TabsTrigger>
              </TabsList>

              {/* Category filter buttons (only for currencies/uniques) */}
              {(tab === "currencies" || tab === "uniques") && (
                <div className="flex flex-wrap gap-1.5">
                  <Badge
                    variant={categoryFilter === "all" ? "default" : "outline"}
                    className="cursor-pointer"
                    onClick={() => setCategoryFilter("all")}
                  >
                    All
                  </Badge>
                  {currentCategories.map((cat) => (
                    <Badge
                      key={cat.name}
                      variant={
                        categoryFilter === cat.name ? "default" : "outline"
                      }
                      className="cursor-pointer"
                      onClick={() => setCategoryFilter(cat.name)}
                    >
                      {cat.displayName}
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {/* ============ OVERVIEW TAB ============ */}
            <TabsContent value="overview">
              <MarketOverview
                realm={realm}
                league={effectiveLeague}
                onItemClick={openDetail}
              />
            </TabsContent>

            {/* ============ CURRENCIES TAB ============ */}
            <TabsContent value="currencies">
              {isLoading ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : !currenciesData?.items?.length ? (
                <p className="text-center text-muted-foreground py-20">
                  No currencies found
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                    {currenciesData.items.map((item) => (
                      <CurrencyCard
                        key={item.id}
                        item={item}
                        onClick={openDetail}
                      />
                    ))}
                  </div>
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
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : !uniquesData?.items?.length ? (
                <p className="text-center text-muted-foreground py-20">
                  No unique items found
                </p>
              ) : (
                <>
                  <UniqueTable
                    items={uniquesData.items}
                    onItemClick={openDetail}
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
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : exchangePairs.length === 0 ? (
                <p className="text-center text-muted-foreground py-20">
                  No exchange pairs found
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {exchangePairs.map((pair) => (
                    <ExchangePairCard
                      key={pair.id}
                      pair={pair}
                      onClick={openPairDetail}
                    />
                  ))}
                </div>
              )}
            </TabsContent>

            {/* ============ WATCHLIST TAB ============ */}
            <TabsContent value="watchlist">
              <WatchlistTab
                realm={realm}
                league={effectiveLeague}
                onItemClick={openDetail}
              />
            </TabsContent>
          </Tabs>
        )}
      </main>

      {/* ============ ITEM DETAIL DIALOG ============ */}
      <DetailDialog
        item={detailItem}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        realm={realm}
        league={effectiveLeague}
        referenceCurrency={referenceCurrency}
      />

      {/* ============ PAIR DETAIL DIALOG ============ */}
      <PairDetailDialog
        pair={detailPair}
        open={pairDetailOpen}
        onOpenChange={setPairDetailOpen}
        realm={realm}
        league={effectiveLeague}
      />
    </div>
  );
}
