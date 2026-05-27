// ============================================================================
// PoE2 Scout API — Server-side fetch functions + in-memory cache
// Base URL: https://poe2scout.com/api
//
// v2 FIX: API returns PascalCase fields. All fetch functions now map
// PascalCase API responses to the camelCase types defined in ./types.ts
// so the frontend works correctly.
// ============================================================================

import type {
  Realm,
  League,
  PoeItem,
  PoeItemHistoryPoint,
  DailyStat,
  ItemCategory,
  ExchangePair,
  ExchangePairHistoryPoint,
  PaginatedResponse,
  ExchangeSnapshot,
  SnapshotHistoryPoint,
  ReferenceCurrency,
} from "./types";

const BASE_URL = "https://poe2scout.com/api";

// ---------- Simple in-memory cache (60s TTL) ----------
const cache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL = 60_000; // 60 seconds

async function cachedFetch<T>(url: string): Promise<T> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.ts < CACHE_TTL) {
    return hit.data as T;
  }
  const res = await fetch(url, { next: { revalidate: 60 } });
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${res.statusText} — ${url}`);
  }
  const data = (await res.json()) as T;
  cache.set(url, { data, ts: Date.now() });
  return data;
}

// ============================================================================
// RAW API response types (PascalCase — matches what the server returns)
// ============================================================================

// NOTE: Realms endpoint returns snake_case (unlike other endpoints which return PascalCase)
interface RawRealm {
  value: string;
  label: string;
  game_api_id: string;
  realm_api_id: string;
  trade_api_path: string;
  default_league_value: string;
}

interface RawLeague {
  Value: string;
  ShortName: string;
  IsCurrent: boolean;
  DivinePrice: number;
  ChaosDivinePrice: number;
  BaseCurrencyApiId: string;
  BaseCurrencyText: string;
  BaseCurrencyIconUrl: string | null;
  ExaltedCurrencyText: string;
  ExaltedCurrencyIconUrl: string | null;
  DivineCurrencyText: string;
  DivineCurrencyIconUrl: string | null;
  ChaosCurrencyText: string;
  ChaosCurrencyIconUrl: string | null;
  DefaultCurrency: {
    ApiId: string;
    Text: string;
    IconUrl: string | null;
    RelativePrice: number;
  };
}

interface RawPriceLogEntry {
  Price: number;
  Time: string;
  Quantity: number;
}

interface RawCurrencyItem {
  CurrencyItemId: number;
  ItemId: number;
  CurrencyCategoryId: number;
  ApiId: string;
  Text: string;
  CategoryApiId: string;
  IconUrl: string | null;
  ItemMetadata: Record<string, unknown> | null;
  PriceLogs: (RawPriceLogEntry | null)[];
  CurrentPrice: number | null;
  CurrentQuantity: number | null;
}

interface RawPaginatedResponse<T> {
  CurrentPage: number;
  Pages: number;
  Total: number;
  Items: T[];
}

interface RawUniqueItem {
  UniqueItemId: number;
  ItemId: number;
  IconUrl: string | null;
  Text: string;
  Name: string;
  CategoryApiId: string;
  ItemMetadata: Record<string, unknown> | null;
  Type: string;
  IsChanceable: boolean | null;
  PriceLogs: (RawPriceLogEntry | null)[];
  CurrentPrice: number | null;
  CurrentQuantity: number | null;
}

interface RawItemCategory {
  ItemCategoryId: number;
  ApiId: string;
  Label: string;
  Icon: string;
}

interface RawCurrencyCategory {
  CurrencyCategoryId: number;
  ApiId: string;
  Label: string;
  Icon: string;
}

interface RawCategoriesResponse {
  UniqueCategories: RawItemCategory[];
  CurrencyCategories: RawCurrencyCategory[];
}

interface RawAllItem {
  ItemId: number;
  CategoryApiId: string;
  Text: string;
  Name: string | null;
  Type: string | null;
  ApiId: string | null;
  CurrentPrice: number;
  IconUrl: string | null;
}

interface RawSnapshotPairCurrencyItem {
  CurrencyItemId: number;
  ItemId: number;
  CurrencyCategoryId: number;
  ApiId: string;
  Text: string;
  CategoryApiId: string;
  IconUrl: string | null;
  ItemMetadata: Record<string, unknown> | null;
}

interface RawSnapshotPairData {
  ValueTraded: number;
  RelativePrice: number;
  StockValue: number;
  VolumeTraded: number;
  HighestStock: number;
}

interface RawSnapshotPair {
  CurrencyExchangeSnapshotPairId: number;
  CurrencyExchangeSnapshotId: number;
  Volume: number;
  BaseCurrencyApiId: string;
  BaseCurrencyText: string;
  CurrencyOne: RawSnapshotPairCurrencyItem;
  CurrencyTwo: RawSnapshotPairCurrencyItem;
  CurrencyOneData: RawSnapshotPairData;
  CurrencyTwoData: RawSnapshotPairData;
}

interface RawExchangeSnapshot {
  Epoch: number;
  Volume: number;
  MarketCap: number;
  BaseCurrencyApiId: string;
  BaseCurrencyText: string;
}

interface RawSnapshotHistoryData {
  Epoch: number;
  MarketCap: number;
  Volume: number;
}

interface RawSnapshotHistoryResponse {
  Data: RawSnapshotHistoryData[];
  Meta: { HasMore: boolean };
  BaseCurrencyApiId: string;
  BaseCurrencyText: string;
}

interface RawReferenceCurrency {
  ApiId: string;
  Text: string;
  IconUrl: string | null;
  RelativePrice: number;
}

interface RawCurrencyPairHistoryPoint {
  Time: string;
  RelativePrice: number;
  Volume: number;
}

interface RawItemHistoryPoint {
  Time: string;
  Price: number;
  Quantity: number;
}

interface RawDailyStat {
  Day: string;
  Open: number;
  High: number;
  Low: number;
  Close: number;
  Volume: number;
}

// ============================================================================
// Mapping helpers
// ============================================================================

/** Compute 24h change percent from price logs */
function computeChangePercent(logs: (RawPriceLogEntry | null)[] | undefined): number | null {
  if (!logs || logs.length === 0) return null;
  const validLogs = logs.filter((l): l is RawPriceLogEntry => l !== null);
  if (validLogs.length < 2) return null;

  const now = validLogs[validLogs.length - 1];
  const oneDayAgo = new Date(new Date(now.Time).getTime() - 24 * 60 * 60 * 1000);

  // Find the log entry closest to 24h ago
  let closest = validLogs[0];
  let closestDiff = Infinity;
  for (const log of validLogs) {
    const diff = Math.abs(new Date(log.Time).getTime() - oneDayAgo.getTime());
    if (diff < closestDiff) {
      closestDiff = diff;
      closest = log;
    }
  }

  if (closest.Price === 0) return null;
  return ((now.Price - closest.Price) / closest.Price) * 100;
}

/** Compute 7-day change percent from price logs */
function compute7dChangePercent(logs: (RawPriceLogEntry | null)[] | undefined): number | null {
  if (!logs || logs.length === 0) return null;
  const validLogs = logs.filter((l): l is RawPriceLogEntry => l !== null);
  if (validLogs.length < 2) return null;

  const now = validLogs[validLogs.length - 1];
  const sevenDaysAgo = new Date(new Date(now.Time).getTime() - 7 * 24 * 60 * 60 * 1000);

  let closest = validLogs[0];
  let closestDiff = Infinity;
  for (const log of validLogs) {
    const diff = Math.abs(new Date(log.Time).getTime() - sevenDaysAgo.getTime());
    if (diff < closestDiff) {
      closestDiff = diff;
      closest = log;
    }
  }

  if (closest.Price === 0) return null;
  return ((now.Price - closest.Price) / closest.Price) * 100;
}

/** Compute volume from price logs (sum of quantities in last 24h) */
function computeVolume24h(logs: (RawPriceLogEntry | null)[] | undefined): number | null {
  if (!logs || logs.length === 0) return null;
  const validLogs = logs.filter((l): l is RawPriceLogEntry => l !== null);
  if (validLogs.length === 0) return null;

  const latest = new Date(validLogs[validLogs.length - 1].Time);
  const oneDayAgo = new Date(latest.getTime() - 24 * 60 * 60 * 1000);

  let vol = 0;
  for (const log of validLogs) {
    if (new Date(log.Time).getTime() >= oneDayAgo.getTime()) {
      vol += log.Quantity;
    }
  }
  return vol;
}

/** Map raw currency item to PoeItem */
function mapCurrencyItem(raw: RawCurrencyCategory, item: RawCurrencyItem, referencePrice?: number): PoeItem {
  const changePercent = computeChangePercent(item.PriceLogs);
  const sevenDayChange = compute7dChangePercent(item.PriceLogs);
  const volume = computeVolume24h(item.PriceLogs);
  const currentPrice = item.CurrentPrice;
  const relPrice = referencePrice && currentPrice ? currentPrice / referencePrice : currentPrice;

  return {
    id: String(item.ItemId || item.CurrencyItemId),
    apiId: item.ApiId,
    name: item.Text,
    type: item.CategoryApiId || "",
    category: item.CategoryApiId || "",
    iconUrl: item.IconUrl,
    price: currentPrice,
    priceChaos: currentPrice,
    relativePrice: relPrice,
    change: changePercent !== null ? currentPrice !== null ? currentPrice - (currentPrice / (1 + changePercent / 100)) : null : null,
    changePercent,
    volume: item.CurrentQuantity ?? volume,
    sevenDayPriceChange: sevenDayChange !== null && currentPrice !== null ? currentPrice - (currentPrice / (1 + sevenDayChange / 100)) : null,
    sevenDayPriceChangePercent: sevenDayChange,
    history: mapPriceLogs(item.PriceLogs),
    dailyStats: null,
    lowConfidence: (item.CurrentQuantity ?? 0) < 5,
    listingCount: item.CurrentQuantity,
    baseType: null,
    links: null,
    variant: null,
    levelRequired: null,
  };
}

/** Map raw unique item to PoeItem */
function mapUniqueItem(raw: RawUniqueItem, referencePrice?: number): PoeItem {
  const changePercent = computeChangePercent(raw.PriceLogs);
  const sevenDayChange = compute7dChangePercent(raw.PriceLogs);
  const volume = computeVolume24h(raw.PriceLogs);
  const currentPrice = raw.CurrentPrice;
  const relPrice = referencePrice && currentPrice ? currentPrice / referencePrice : currentPrice;

  return {
    id: String(raw.ItemId || raw.UniqueItemId),
    apiId: raw.CategoryApiId,
    name: raw.Text || raw.Name,
    type: raw.Type || "",
    category: raw.CategoryApiId || "",
    iconUrl: raw.IconUrl,
    price: currentPrice,
    priceChaos: currentPrice,
    relativePrice: relPrice,
    change: changePercent !== null && currentPrice !== null ? currentPrice - (currentPrice / (1 + changePercent / 100)) : null,
    changePercent,
    volume: raw.CurrentQuantity ?? volume,
    sevenDayPriceChange: sevenDayChange !== null && currentPrice !== null ? currentPrice - (currentPrice / (1 + sevenDayChange / 100)) : null,
    sevenDayPriceChangePercent: sevenDayChange,
    history: mapPriceLogs(raw.PriceLogs),
    dailyStats: null,
    lowConfidence: (raw.CurrentQuantity ?? 0) < 5,
    listingCount: raw.CurrentQuantity,
    baseType: null,
    links: null,
    variant: null,
    levelRequired: null,
  };
}

/** Map price logs to PoeItemHistoryPoint[] */
function mapPriceLogs(logs: (RawPriceLogEntry | null)[] | undefined): PoeItemHistoryPoint[] | null {
  if (!logs || logs.length === 0) return null;
  const valid = logs.filter((l): l is RawPriceLogEntry => l !== null);
  if (valid.length === 0) return null;
  return valid.map((l) => ({
    timestamp: l.Time,
    price: l.Price,
    priceChaos: l.Price,
    relativePrice: l.Price,
    volume: l.Quantity,
  }));
}

/** Map raw snapshot pair to ExchangePair */
function mapSnapshotPair(raw: RawSnapshotPair): ExchangePair {
  return {
    id: String(raw.CurrencyExchangeSnapshotPairId),
    currency1Id: raw.CurrencyOne.ApiId,
    currency1Name: raw.CurrencyOne.Text,
    currency1IconUrl: raw.CurrencyOne.IconUrl,
    currency2Id: raw.CurrencyTwo.ApiId,
    currency2Name: raw.CurrencyTwo.Text,
    currency2IconUrl: raw.CurrencyTwo.IconUrl,
    price: raw.CurrencyOneData.RelativePrice,
    relativePrice: raw.CurrencyOneData.RelativePrice,
    volume: raw.CurrencyOneData.VolumeTraded,
    change: null,
    changePercent: null,
    history: null,
  };
}

// ===================== API FUNCTIONS (mapped) =====================

// --- Realms ---
export async function getRealms(): Promise<Realm[]> {
  const raw = await cachedFetch<RawRealm[]>(`${BASE_URL}/Realms`);
  return raw.map((r) => ({
    // FIX: Use realm_api_id as the name because it's the URL path segment
    // e.g., "pc" for PoE1, "poe2" for PoE2 (not "poe2/poe2")
    name: r.realm_api_id === "poe2" ? "poe2" : r.realm_api_id,
    displayName: r.game_api_id === "poe2" ? "PoE2" : `PoE1 ${r.realm_api_id.toUpperCase()}`,
  }));
}

export async function getRealmFilters(realm: string): Promise<unknown> {
  return cachedFetch(`${BASE_URL}/Realms/${realm}/Filters`);
}

// --- Leagues ---
export async function getLeagues(realm: string): Promise<League[]> {
  // FIX: For PoE2, the realm URL path is just "poe2", not "poe2/poe2"
  const raw = await cachedFetch<RawLeague[]>(`${BASE_URL}/${encodeURIComponent(realm)}/Leagues`);
  return raw.map((l) => ({
    name: l.Value,
    displayName: l.Value,
    startAt: null,
    endAt: null,
    active: l.IsCurrent,
  }));
}

export async function getExchangeSnapshot(realm: string, league: string): Promise<ExchangeSnapshot> {
  const raw = await cachedFetch<RawExchangeSnapshot>(
    `${BASE_URL}/${realm}/Leagues/${encodeURIComponent(league)}/ExchangeSnapshot`
  );
  return {
    pairs: [],
    referenceCurrency: raw.BaseCurrencyApiId,
    timestamp: new Date(raw.Epoch * 1000).toISOString(),
  };
}

export async function getReferenceCurrencies(realm: string, league: string): Promise<ReferenceCurrency[]> {
  const raw = await cachedFetch<RawReferenceCurrency[]>(
    `${BASE_URL}/${realm}/Leagues/${encodeURIComponent(league)}/ReferenceCurrencies`
  );
  return raw.map((c) => ({
    apiId: c.ApiId,
    text: c.Text,
    iconUrl: c.IconUrl,
    relativePrice: c.RelativePrice,
  }));
}

export async function getSnapshotHistory(realm: string, league: string, limit = 24): Promise<SnapshotHistoryPoint[]> {
  const raw = await cachedFetch<RawSnapshotHistoryResponse>(
    `${BASE_URL}/${realm}/Leagues/${encodeURIComponent(league)}/SnapshotHistory?Limit=${limit}`
  );
  return raw.Data.map((d) => ({
    timestamp: new Date(d.Epoch * 1000).toISOString(),
    totalVolume: d.Volume,
    totalMarketCap: d.MarketCap,
    itemCount: 0,
  }));
}

export async function getSnapshotPairs(realm: string, league: string): Promise<ExchangePair[]> {
  const raw = await cachedFetch<RawSnapshotPair[]>(
    `${BASE_URL}/${realm}/Leagues/${encodeURIComponent(league)}/SnapshotPairs`
  );
  return raw.map(mapSnapshotPair);
}

// --- Items ---
export async function getItems(realm: string, league: string): Promise<PoeItem[]> {
  const raw = await cachedFetch<RawAllItem[]>(
    `${BASE_URL}/${realm}/Leagues/${encodeURIComponent(league)}/Items`
  );
  return raw.map((item) => ({
    id: String(item.ItemId),
    apiId: item.ApiId || "",
    name: item.Name || item.Text,
    type: item.Type || "",
    category: item.CategoryApiId || "",
    iconUrl: item.IconUrl,
    price: item.CurrentPrice,
    priceChaos: item.CurrentPrice,
    relativePrice: item.CurrentPrice,
    change: null,
    changePercent: null,
    volume: null,
    sevenDayPriceChange: null,
    sevenDayPriceChangePercent: null,
    history: null,
    dailyStats: null,
    lowConfidence: false,
    listingCount: null,
    baseType: null,
    links: null,
    variant: null,
    levelRequired: null,
  }));
}

export async function getItemCategories(realm: string, league: string): Promise<ItemCategory[]> {
  const raw = await cachedFetch<RawCategoriesResponse>(
    `${BASE_URL}/${realm}/Leagues/${encodeURIComponent(league)}/Items/Categories`
  );
  const cats: ItemCategory[] = [];

  // Add unique categories
  for (const uc of raw.UniqueCategories ?? []) {
    cats.push({
      name: uc.ApiId,
      displayName: uc.Label,
      count: 0,
    });
  }

  // Add currency categories
  for (const cc of raw.CurrencyCategories ?? []) {
    cats.push({
      name: cc.ApiId,
      displayName: cc.Label,
      count: 0,
    });
  }

  return cats;
}

export async function getItem(realm: string, league: string, itemId: string): Promise<PoeItem> {
  const raw = await cachedFetch<RawAllItem>(
    `${BASE_URL}/${realm}/Leagues/${encodeURIComponent(league)}/Items/${itemId}`
  );
  return {
    id: String(raw.ItemId),
    apiId: raw.ApiId || "",
    name: raw.Name || raw.Text,
    type: raw.Type || "",
    category: raw.CategoryApiId || "",
    iconUrl: raw.IconUrl,
    price: raw.CurrentPrice,
    priceChaos: raw.CurrentPrice,
    relativePrice: raw.CurrentPrice,
    change: null,
    changePercent: null,
    volume: null,
    sevenDayPriceChange: null,
    sevenDayPriceChangePercent: null,
    history: null,
    dailyStats: null,
    lowConfidence: false,
    listingCount: null,
    baseType: null,
    links: null,
    variant: null,
    levelRequired: null,
  };
}

export async function getItemHistory(realm: string, league: string, itemId: string, logCount = 168, referenceCurrency?: string): Promise<PoeItemHistoryPoint[]> {
  let url = `${BASE_URL}/${realm}/Leagues/${encodeURIComponent(league)}/Items/${itemId}/History?LogCount=${logCount}`;
  if (referenceCurrency) url += `&ReferenceCurrency=${encodeURIComponent(referenceCurrency)}`;
  const raw = await cachedFetch<RawItemHistoryPoint[]>(url);
  return raw.map((p) => ({
    timestamp: p.Time,
    price: p.Price,
    priceChaos: p.Price,
    relativePrice: p.Price,
    volume: p.Quantity,
  }));
}

export async function getItemDailyStats(realm: string, league: string, itemId: string, dayCount = 30, referenceCurrency?: string): Promise<DailyStat[]> {
  let url = `${BASE_URL}/${realm}/Leagues/${encodeURIComponent(league)}/Items/${itemId}/DailyStatsHistory?DayCount=${dayCount}`;
  if (referenceCurrency) url += `&ReferenceCurrency=${encodeURIComponent(referenceCurrency)}`;
  const raw = await cachedFetch<RawDailyStat[]>(url);
  return raw.map((d) => ({
    day: d.Day,
    open: d.Open,
    high: d.High,
    low: d.Low,
    close: d.Close,
    volume: d.Volume,
  }));
}

// --- Uniques (paginated) ---
export async function getUniquesByCategory(
  realm: string,
  league: string,
  category = "all",
  page = 1,
  perPage = 50,
  search = "",
  referenceCurrency?: string
): Promise<PaginatedResponse<PoeItem>> {
  const params = new URLSearchParams({
    Category: category,
    Page: String(page),
    PerPage: String(perPage),
  });
  if (search) params.set("Search", search);
  if (referenceCurrency) params.set("ReferenceCurrency", referenceCurrency);

  const raw = await cachedFetch<RawPaginatedResponse<RawUniqueItem>>(
    `${BASE_URL}/${realm}/Leagues/${encodeURIComponent(league)}/Uniques/ByCategory?${params}`
  );

  const refPrice = referenceCurrency ? undefined : undefined; // TODO: lookup reference price

  return {
    items: raw.Items.map((item) => mapUniqueItem(item, refPrice)),
    page: raw.CurrentPage,
    perPage: perPage,
    totalItems: raw.Total,
    totalPages: raw.Pages,
  };
}

// --- Currencies ---
export async function getCurrenciesByCategory(
  realm: string,
  league: string,
  category = "all",
  page = 1,
  perPage = 50,
  referenceCurrency?: string
): Promise<PaginatedResponse<PoeItem>> {
  const params = new URLSearchParams({
    Category: category,
    Page: String(page),
    PerPage: String(perPage),
  });
  if (referenceCurrency) params.set("ReferenceCurrency", referenceCurrency);

  const raw = await cachedFetch<RawPaginatedResponse<RawCurrencyItem>>(
    `${BASE_URL}/${realm}/Leagues/${encodeURIComponent(league)}/Currencies/ByCategory?${params}`
  );

  return {
    items: raw.Items.map((item) => mapCurrencyItem({} as RawCurrencyCategory, item)),
    page: raw.CurrentPage,
    perPage: perPage,
    totalItems: raw.Total,
    totalPages: raw.Pages,
  };
}

export async function getCurrency(realm: string, league: string, apiId: string): Promise<PoeItem> {
  const raw = await cachedFetch<RawCurrencyItem>(
    `${BASE_URL}/${realm}/Leagues/${encodeURIComponent(league)}/Currencies/${apiId}`
  );
  return mapCurrencyItem({} as RawCurrencyCategory, raw);
}

export async function getCurrencyPairHistory(
  realm: string,
  league: string,
  id1: string,
  id2: string,
  limit = 168
): Promise<ExchangePairHistoryPoint[]> {
  const raw = await cachedFetch<RawCurrencyPairHistoryPoint[]>(
    `${BASE_URL}/${realm}/Leagues/${encodeURIComponent(league)}/Currencies/Pairs/${id1}/${id2}/History?Limit=${limit}`
  );
  return raw.map((p) => ({
    timestamp: p.Time,
    relativePrice: p.RelativePrice,
    volume: p.Volume,
  }));
}

// --- Health ---
export async function getHealth(): Promise<{ status: string }> {
  return cachedFetch<{ status: string }>(`${BASE_URL}/health/live`);
}
