"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import {
  Coins,
  Shield,
  ArrowLeftRight,
  Search,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Activity,
  ChevronLeft,
  ChevronRight,
  X,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

// ============================================================================
// Types (mirrored from poe2api.ts for client use)
// ============================================================================
interface Realm {
  name: string;
  displayName: string;
}

interface League {
  name: string;
  displayName: string;
  active: boolean;
}

interface PoeItem {
  id: string;
  apiId: string;
  name: string;
  type: string;
  category: string;
  iconUrl: string | null;
  price: number | null;
  priceChaos: number | null;
  relativePrice: number | null;
  change: number | null;
  changePercent: number | null;
  volume: number | null;
  sevenDayPriceChange: number | null;
  sevenDayPriceChangePercent: number | null;
  lowConfidence: boolean;
  listingCount: number | null;
  history: PoeItemHistoryPoint[] | null;
}

interface PoeItemHistoryPoint {
  timestamp: string;
  price: number;
  priceChaos: number;
  relativePrice: number;
  volume: number;
}

interface ExchangePair {
  id: string;
  currency1Id: string;
  currency1Name: string;
  currency1IconUrl: string | null;
  currency2Id: string;
  currency2Name: string;
  currency2IconUrl: string | null;
  price: number;
  relativePrice: number;
  volume: number;
  change: number | null;
  changePercent: number | null;
}

interface ItemCategory {
  name: string;
  displayName: string;
  count: number;
}

interface PaginatedResponse<T> {
  items: T[];
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
}

// ============================================================================
// Fetch helpers (through our proxy routes)
// ============================================================================
async function fetchApi<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(path, window.location.origin);
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v) url.searchParams.set(k, v);
    });
  }
  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

// ============================================================================
// Sparkline component (tiny inline chart)
// ============================================================================
function Sparkline({ data, color, width = 80, height = 28 }: { data: number[]; color: string; width?: number; height?: number }) {
  if (!data || data.length < 2) return <span className="text-muted-foreground text-xs">—</span>;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data.map((v, i) => `${(i / (data.length - 1)) * width},${height - ((v - min) / range) * height}`).join(" ");
  return (
    <svg width={width} height={height} className="inline-block">
      <polyline fill="none" stroke={color} strokeWidth={1.5} points={points} />
    </svg>
  );
}

// ============================================================================
// Format helpers
// ============================================================================
function fmt(n: number | null | undefined, digits = 2): string {
  if (n == null) return "—";
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 1 });
  return n.toFixed(digits);
}

function fmtChange(pct: number | null | undefined): { text: string; color: string } {
  if (pct == null) return { text: "—", color: "text-muted-foreground" };
  const sign = pct > 0 ? "+" : "";
  const color = pct > 0 ? "text-emerald-400" : pct < 0 ? "text-red-400" : "text-muted-foreground";
  return { text: `${sign}${pct.toFixed(1)}%`, color };
}

// ============================================================================
// Main Dashboard
// ============================================================================
export default function Dashboard() {
  // --- Selection state ---
  const [realm, setRealm] = useState("pc");
  const [league, setLeague] = useState("");
  const [tab, setTab] = useState("currencies");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");

  // --- Pagination state for uniques ---
  const [uniquesPage, setUniquesPage] = useState(1);

  // --- Detail dialog ---
  const [detailItem, setDetailItem] = useState<PoeItem | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

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

  const { data: currenciesData, isLoading: currenciesLoading, refetch: refetchCurrencies } = useQuery({
    queryKey: ["currencies", realm, effectiveLeague, categoryFilter],
    queryFn: () =>
      fetchApi<PaginatedResponse<PoeItem>>("/api/poe2/currencies", {
        realm,
        league: effectiveLeague,
        action: "byCategory",
        category: categoryFilter,
      }),
    enabled: tab === "currencies" && !!effectiveLeague,
  });

  const { data: uniqueCategories } = useQuery({
    queryKey: ["itemCategories", realm, effectiveLeague],
    queryFn: () => fetchApi<ItemCategory[]>("/api/poe2/items", { realm, league: effectiveLeague, action: "categories" }),
    enabled: !!effectiveLeague,
  });

  const { data: uniquesData, isLoading: uniquesLoading, refetch: refetchUniques } = useQuery({
    queryKey: ["uniques", realm, effectiveLeague, categoryFilter, uniquesPage, search],
    queryFn: () =>
      fetchApi<PaginatedResponse<PoeItem>>("/api/poe2/uniques", {
        realm,
        league: effectiveLeague,
        category: categoryFilter,
        page: String(uniquesPage),
        perPage: "50",
        search,
      }),
    enabled: tab === "uniques" && !!effectiveLeague,
  });

  const { data: exchangeData, isLoading: exchangeLoading, refetch: refetchExchange } = useQuery({
    queryKey: ["exchange", realm, effectiveLeague],
    queryFn: () => fetchApi<ExchangePair[]>("/api/poe2/exchange", { realm, league: effectiveLeague, action: "pairs" }),
    enabled: tab === "exchange" && !!effectiveLeague,
  });

  // Detail history
  const { data: detailHistory, isLoading: detailHistoryLoading } = useQuery({
    queryKey: ["itemHistory", realm, effectiveLeague, detailItem?.id],
    queryFn: () =>
      fetchApi<PoeItemHistoryPoint[]>("/api/poe2/items", {
        realm,
        league: effectiveLeague,
        action: "history",
        itemId: detailItem!.id,
      }),
    enabled: !!detailItem && detailOpen,
  });

  // --- Derived data ---
  const currencyItems = useMemo(() => {
    const items = currenciesData?.items || [];
    if (!search) return items;
    return items.filter((i) => i.name.toLowerCase().includes(search.toLowerCase()));
  }, [currenciesData, search]);

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
    const cats = uniqueCategories?.filter((c) => c.name === "Unique" || c.name.includes("Unique") || c.name.includes("Armour") || c.name.includes("Weapon") || c.name.includes("Accessory") || c.name.includes("Flask") || c.name.includes("Jewel") || c.name.includes("Gem")) || [];
    if (cats.length === 0) cats.push({ name: "all", displayName: "All", count: 0 });
    return cats;
  }, [uniqueCategories]);

  const currentCategories = tab === "currencies" ? currencyCategories : uniqueCategoriesList;

  // --- Handlers ---
  function openDetail(item: PoeItem) {
    setDetailItem(item);
    setDetailOpen(true);
  }

  function handleRefresh() {
    if (tab === "currencies") refetchCurrencies();
    else if (tab === "uniques") refetchUniques();
    else refetchExchange();
    toast.success("Refreshing data...");
  }

  // Filter items by search for currencies tab (client-side)
  const filteredCurrencies = useMemo(() => {
    if (!search) return currencyItems;
    return currencyItems.filter((i) => i.name.toLowerCase().includes(search.toLowerCase()));
  }, [currencyItems, search]);

  // --- Loading / Error states ---
  const isLoading =
    (tab === "currencies" && currenciesLoading) ||
    (tab === "uniques" && uniquesLoading) ||
    (tab === "exchange" && exchangeLoading);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-40">
        <div className="max-w-[1600px] mx-auto px-4 py-3 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 mr-4">
            <Activity className="h-6 w-6 text-primary" />
            <h1 className="text-lg font-bold tracking-tight">PoE2 Market</h1>
          </div>

          {/* Realm select */}
          <Select value={realm} onValueChange={(v) => { setRealm(v); setLeague(""); }}>
            <SelectTrigger className="w-[120px]">
              <SelectValue placeholder="Realm" />
            </SelectTrigger>
            <SelectContent>
              {realmsLoading ? (
                <SelectItem value="loading" disabled>Loading...</SelectItem>
              ) : (
                realms?.map((r) => (
                  <SelectItem key={r.name} value={r.name}>
                    {r.displayName}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>

          {/* League select */}
          <Select value={effectiveLeague} onValueChange={setLeague}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="League" />
            </SelectTrigger>
            <SelectContent>
              {leaguesLoading ? (
                <SelectItem value="loading" disabled>Loading...</SelectItem>
              ) : (
                leagues?.map((l) => (
                  <SelectItem key={l.name} value={l.name}>
                    {l.displayName} {!l.active && "(inactive)"}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>

          {/* Search */}
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search items..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-2.5 top-2.5">
                <X className="h-4 w-4 text-muted-foreground hover:text-foreground" />
              </button>
            )}
          </div>

          {/* Refresh */}
          <Button variant="outline" size="sm" onClick={handleRefresh} className="h-9">
            <RefreshCw className="h-4 w-4 mr-1" />
            Refresh
          </Button>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-[1600px] mx-auto px-4 py-4">
        {!effectiveLeague ? (
          <div className="flex flex-col items-center justify-center py-32 text-muted-foreground">
            <AlertTriangle className="h-12 w-12 mb-4" />
            <p className="text-lg">Select a realm and league to begin</p>
          </div>
        ) : (
          <Tabs value={tab} onValueChange={(v) => { setTab(v); setCategoryFilter("all"); setUniquesPage(1); }}>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <TabsList>
                <TabsTrigger value="currencies" className="gap-1.5">
                  <Coins className="h-4 w-4" /> Currencies
                </TabsTrigger>
                <TabsTrigger value="uniques" className="gap-1.5">
                  <Shield className="h-4 w-4" /> Uniques
                </TabsTrigger>
                <TabsTrigger value="exchange" className="gap-1.5">
                  <ArrowLeftRight className="h-4 w-4" /> Exchange
                </TabsTrigger>
              </TabsList>

              {/* Category filter buttons */}
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
                    variant={categoryFilter === cat.name ? "default" : "outline"}
                    className="cursor-pointer"
                    onClick={() => setCategoryFilter(cat.name)}
                  >
                    {cat.displayName}
                  </Badge>
                ))}
              </div>
            </div>

            {/* ============ CURRENCIES TAB ============ */}
            <TabsContent value="currencies">
              {isLoading ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : filteredCurrencies.length === 0 ? (
                <p className="text-center text-muted-foreground py-20">No currencies found</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                  {filteredCurrencies.map((item) => {
                    const chg = fmtChange(item.changePercent);
                    const sparkData = item.history?.map((h) => h.relativePrice ?? h.priceChaos ?? 0) || [];
                    return (
                      <Card
                        key={item.id}
                        className="cursor-pointer hover:border-primary/50 transition-colors"
                        onClick={() => openDetail(item)}
                      >
                        <CardHeader className="pb-2 pt-3 px-3">
                          <div className="flex items-start gap-2">
                            {item.iconUrl ? (
                              <img src={item.iconUrl} alt="" className="w-8 h-8 object-contain shrink-0" />
                            ) : (
                              <Coins className="w-8 h-8 text-muted-foreground shrink-0" />
                            )}
                            <div className="flex-1 min-w-0">
                              <CardTitle className="text-sm font-semibold truncate">{item.name}</CardTitle>
                              <p className="text-xs text-muted-foreground truncate">{item.type}</p>
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent className="px-3 pb-3 pt-0">
                          <div className="flex items-end justify-between">
                            <div>
                              <p className="text-lg font-bold">{fmt(item.relativePrice ?? item.priceChaos)}</p>
                              <p className={`text-xs font-medium ${chg.color}`}>{chg.text}</p>
                            </div>
                            <Sparkline data={sparkData} color={item.changePercent && item.changePercent >= 0 ? "#34d399" : "#f87171"} />
                          </div>
                          {item.volume != null && (
                            <p className="text-xs text-muted-foreground mt-1">Vol: {item.volume.toLocaleString()}</p>
                          )}
                          {item.lowConfidence && (
                            <Badge variant="outline" className="mt-1 text-[10px] px-1 py-0">Low Confidence</Badge>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </TabsContent>

            {/* ============ UNIQUES TAB ============ */}
            <TabsContent value="uniques">
              {isLoading ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : !uniquesData?.items?.length ? (
                <p className="text-center text-muted-foreground py-20">No unique items found</p>
              ) : (
                <>
                  <div className="rounded-md border border-border overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border bg-muted/30">
                            <th className="text-left py-2 px-3 font-medium">Item</th>
                            <th className="text-right py-2 px-3 font-medium">Price</th>
                            <th className="text-right py-2 px-3 font-medium">Change</th>
                            <th className="text-right py-2 px-3 font-medium">7d</th>
                            <th className="text-right py-2 px-3 font-medium">Volume</th>
                            <th className="text-center py-2 px-3 font-medium w-[100px]">Trend</th>
                          </tr>
                        </thead>
                        <tbody>
                          {uniquesData.items.map((item) => {
                            const chg = fmtChange(item.changePercent);
                            const chg7 = fmtChange(item.sevenDayPriceChangePercent);
                            const sparkData = item.history?.map((h) => h.relativePrice ?? h.priceChaos ?? 0) || [];
                            return (
                              <tr
                                key={item.id}
                                className="border-b border-border/50 hover:bg-muted/20 cursor-pointer transition-colors"
                                onClick={() => openDetail(item)}
                              >
                                <td className="py-2 px-3">
                                  <div className="flex items-center gap-2">
                                    {item.iconUrl ? (
                                      <img src={item.iconUrl} alt="" className="w-6 h-6 object-contain" />
                                    ) : (
                                      <Shield className="w-6 h-6 text-muted-foreground" />
                                    )}
                                    <div>
                                      <span className="font-medium">{item.name}</span>
                                      <span className="text-muted-foreground ml-1 text-xs">{item.type}</span>
                                    </div>
                                  </div>
                                </td>
                                <td className="text-right py-2 px-3 font-mono">{fmt(item.relativePrice ?? item.priceChaos)}</td>
                                <td className={`text-right py-2 px-3 font-mono ${chg.color}`}>{chg.text}</td>
                                <td className={`text-right py-2 px-3 font-mono ${chg7.color}`}>{chg7.text}</td>
                                <td className="text-right py-2 px-3 font-mono text-muted-foreground">
                                  {item.volume != null ? item.volume.toLocaleString() : "—"}
                                </td>
                                <td className="py-2 px-3 text-center">
                                  <Sparkline
                                    data={sparkData}
                                    color={item.changePercent && item.changePercent >= 0 ? "#34d399" : "#f87171"}
                                    width={80}
                                    height={20}
                                  />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Pagination */}
                  {uniquesData.totalPages > 1 && (
                    <div className="flex items-center justify-center gap-2 mt-4">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={uniquesPage <= 1}
                        onClick={() => setUniquesPage((p) => Math.max(1, p - 1))}
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <span className="text-sm text-muted-foreground">
                        Page {uniquesData.page} of {uniquesData.totalPages}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={uniquesPage >= uniquesData.totalPages}
                        onClick={() => setUniquesPage((p) => p + 1)}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
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
                <p className="text-center text-muted-foreground py-20">No exchange pairs found</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {exchangePairs.map((pair) => {
                    const chg = fmtChange(pair.changePercent);
                    return (
                      <Card key={pair.id} className="hover:border-primary/50 transition-colors">
                        <CardContent className="py-3 px-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              {pair.currency1IconUrl ? (
                                <img src={pair.currency1IconUrl} alt="" className="w-5 h-5 object-contain" />
                              ) : (
                                <Coins className="w-5 h-5 text-muted-foreground" />
                              )}
                              <span className="font-medium text-sm">{pair.currency1Name}</span>
                            </div>
                            <ArrowLeftRight className="h-4 w-4 text-muted-foreground" />
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm">{pair.currency2Name}</span>
                              {pair.currency2IconUrl ? (
                                <img src={pair.currency2IconUrl} alt="" className="w-5 h-5 object-contain" />
                              ) : (
                                <Coins className="w-5 h-5 text-muted-foreground" />
                              )}
                            </div>
                          </div>
                          <div className="flex items-center justify-between mt-2">
                            <div>
                              <span className="text-lg font-bold font-mono">{fmt(pair.relativePrice)}</span>
                              <span className={`ml-2 text-xs font-medium ${chg.color}`}>{chg.text}</span>
                            </div>
                            <span className="text-xs text-muted-foreground">
                              Vol: {pair.volume?.toLocaleString() ?? "—"}
                            </span>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </TabsContent>
          </Tabs>
        )}
      </main>

      {/* ============ DETAIL DIALOG ============ */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          {detailItem && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {detailItem.iconUrl ? (
                    <img src={detailItem.iconUrl} alt="" className="w-6 h-6 object-contain" />
                  ) : null}
                  {detailItem.name}
                  <Badge variant="outline" className="font-normal">{detailItem.type}</Badge>
                </DialogTitle>
              </DialogHeader>

              {/* Key metrics */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2">
                <div className="rounded-lg bg-muted/50 p-3">
                  <p className="text-xs text-muted-foreground">Price</p>
                  <p className="text-lg font-bold font-mono">{fmt(detailItem.relativePrice ?? detailItem.priceChaos)}</p>
                </div>
                <div className="rounded-lg bg-muted/50 p-3">
                  <p className="text-xs text-muted-foreground">24h Change</p>
                  <p className={`text-lg font-bold font-mono ${fmtChange(detailItem.changePercent).color}`}>
                    {fmtChange(detailItem.changePercent).text}
                  </p>
                </div>
                <div className="rounded-lg bg-muted/50 p-3">
                  <p className="text-xs text-muted-foreground">7d Change</p>
                  <p className={`text-lg font-bold font-mono ${fmtChange(detailItem.sevenDayPriceChangePercent).color}`}>
                    {fmtChange(detailItem.sevenDayPriceChangePercent).text}
                  </p>
                </div>
                <div className="rounded-lg bg-muted/50 p-3">
                  <p className="text-xs text-muted-foreground">Volume</p>
                  <p className="text-lg font-bold font-mono">{detailItem.volume?.toLocaleString() ?? "—"}</p>
                </div>
              </div>

              {/* Price history chart */}
              {detailHistoryLoading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : detailHistory && detailHistory.length > 1 ? (
                <div className="mt-4 space-y-4">
                  <div>
                    <h4 className="text-sm font-medium mb-2 flex items-center gap-1">
                      <TrendingUp className="h-4 w-4" /> Price History
                    </h4>
                    <div className="h-[250px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={detailHistory}>
                          <defs>
                            <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                              <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                          <XAxis
                            dataKey="timestamp"
                            tick={{ fontSize: 10 }}
                            tickFormatter={(v: string) => new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          />
                          <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => fmt(v, 0)} />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: "hsl(var(--card))",
                              border: "1px solid hsl(var(--border))",
                              borderRadius: "8px",
                              fontSize: "12px",
                            }}
                            labelFormatter={(v: string) => new Date(v).toLocaleString()}
                            formatter={(value: number) => [fmt(value), "Price"]}
                          />
                          <Area
                            type="monotone"
                            dataKey="relativePrice"
                            stroke="#8b5cf6"
                            fill="url(#priceGrad)"
                            strokeWidth={2}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* Volume chart */}
                  <div>
                    <h4 className="text-sm font-medium mb-2 flex items-center gap-1">
                      <Activity className="h-4 w-4" /> Trading Volume
                    </h4>
                    <div className="h-[120px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={detailHistory}>
                          <XAxis
                            dataKey="timestamp"
                            tick={{ fontSize: 10 }}
                            tickFormatter={(v: string) => new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          />
                          <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: "hsl(var(--card))",
                              border: "1px solid hsl(var(--border))",
                              borderRadius: "8px",
                              fontSize: "12px",
                            }}
                            labelFormatter={(v: string) => new Date(v).toLocaleString()}
                            formatter={(value: number) => [value.toLocaleString(), "Volume"]}
                          />
                          <Bar dataKey="volume" fill="#6366f1" radius={[2, 2, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-center text-muted-foreground py-10">No history data available</p>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
