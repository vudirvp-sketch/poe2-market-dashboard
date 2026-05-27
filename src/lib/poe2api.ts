// ============================================================================
// PoE2 Scout API — Server-side fetch functions + in-memory cache
// Base URL: https://poe2scout.com/api
//
// v3 FIXES:
// 1. API returns PascalCase for Leagues/Items/etc., snake_case for Realms
// 2. Category=all returns EMPTY results from API — when category is "all",
//    we fetch all categories separately and merge results
// 3. League IsCurrent is always false in API — we use default_league_value
//    from the Realm to mark the active league
// 4. CurrencyPairHistory API returns nested structure {history, meta} not a flat array
// 5. ItemHistory API returns {price_history, has_more} not a flat array
// 6. DailyStatsHistory API returns {daily_stats, has_more} not a flat array
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

// ---------- Fetch with timeout + retry ----------
const FETCH_TIMEOUT = 15_000; // 15 seconds
const FETCH_RETRIES = 2;

/**
 * Fetch with AbortController timeout and automatic retry.
 * This prevents ETIMEDOUT errors from hanging the server indefinitely
 * and causing "failed to pipe response" errors in API routes.
 */
async function fetchWithTimeout(url: string, timeoutMs: number, signal?: AbortSignal): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // Link external signal if provided
  if (signal) {
    signal.addEventListener("abort", () => controller.abort());
  }

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      next: { revalidate: 60 },
    });
    return res;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function cachedFetch<T>(url: string): Promise<T> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.ts < CACHE_TTL) {
    return hit.data as T;
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= FETCH_RETRIES; attempt++) {
    try {
      const res = await fetchWithTimeout(url, FETCH_TIMEOUT);

      if (!res.ok) {
        throw new Error(`API ${res.status}: ${res.statusText} — ${url}`);
      }

      const data = (await res.json()) as T;
      cache.set(url, { data, ts: Date.now() });
      return data;
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // Don't retry on 4xx errors (client errors)
      if (lastError.message.startsWith("API 4")) {
        throw lastError;
      }

      // Don't retry on abort (timeout) — just fail fast
      if (lastError.name === "AbortError") {
        throw new Error(
          `API request timed out after ${FETCH_TIMEOUT / 1000}s — ${url}. ` +
          `The poe2scout.com server may be unreachable from your network. ` +
          `Try using a VPN or check your internet connection.`
        );
      }

      // Wait before retrying (exponential backoff)
      if (attempt < FETCH_RETRIES) {
        const delay = Math.min(500 * Math.pow(2, attempt), 3000);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  throw lastError ?? new Error(`Failed to fetch ${url} after ${FETCH_RETRIES + 1} attempts`);
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
  ValueTraded: string;
  RelativePrice: string;
  StockValue: string;
  VolumeTraded: number;
  HighestStock: number;
}

interface RawSnapshotPair {
  CurrencyExchangeSnapshotPairId: number;
  CurrencyExchangeSnapshotId: number;
  Volume: string; // FIX v3: Volume is a string in API response (e.g. "1683.00000000")
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

// FIX v3: CurrencyPairHistory returns PascalCase {History: [...], Meta, BaseCurrencyApiId}
interface RawCurrencyPairHistoryResponse {
  History: Array<{
    Epoch: number;
    Data: {
      CurrencyOneData: RawSnapshotPairData;
      CurrencyTwoData: RawSnapshotPairData;
    };
  }>;
  Meta: { HasMore: boolean };
  BaseCurrencyApiId: string;
  BaseCurrencyText: string;
}

// FIX v3: ItemHistory returns PascalCase {PriceHistory: [...], HasMore}
interface RawItemHistoryResponse {
  PriceHistory: RawItemHistoryPoint[];
  HasMore: boolean;
}

interface RawItemHistoryPoint {
  Price: number;
  Time: string;
  Quantity: number;
}

// FIX v3: DailyStatsHistory returns PascalCase {DailyStats: [...], HasMore, BaseCurrencyApiId}
interface RawDailyStatsHistoryResponse {
  DailyStats: RawDailyStat[];
  HasMore: boolean;
  BaseCurrencyApiId: string;
  BaseCurrencyText: string;
}

interface RawDailyStat {
  Time: string;
  Open: number;
  High: number;
  Low: number;
  Close: number;
  Average: number;
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
function mapCurrencyItem(item: RawCurrencyItem, referencePrice?: number): PoeItem {
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
  // FIX v3: ValueTraded, RelativePrice, StockValue are strings in API response
  const relPrice = parseFloat(raw.CurrencyOneData.RelativePrice) || 0;
  const volTraded = raw.CurrencyOneData.VolumeTraded ?? 0;

  return {
    id: String(raw.CurrencyExchangeSnapshotPairId),
    currency1Id: raw.CurrencyOne.ApiId,
    currency1Name: raw.CurrencyOne.Text,
    currency1IconUrl: raw.CurrencyOne.IconUrl,
    currency2Id: raw.CurrencyTwo.ApiId,
    currency2Name: raw.CurrencyTwo.Text,
    currency2IconUrl: raw.CurrencyTwo.IconUrl,
    price: relPrice,
    relativePrice: relPrice,
    volume: volTraded,
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
    // FIX v3: Pass default_league_value so frontend can auto-select the active league
    defaultLeague: r.default_league_value || undefined,
  }));
}

export async function getRealmFilters(realm: string): Promise<unknown> {
  return cachedFetch(`${BASE_URL}/Realms/${realm}/Filters`);
}

// --- Leagues ---
export async function getLeagues(realm: string): Promise<League[]> {
  const raw = await cachedFetch<RawLeague[]>(`${BASE_URL}/${encodeURIComponent(realm)}/Leagues`);

  // FIX v3: API IsCurrent is always false. We determine the active league
  // by getting the realm's default_league_value and matching it.
  let defaultLeagueValue = "";
  try {
    const realms = await cachedFetch<RawRealm[]>(`${BASE_URL}/Realms`);
    const matchingRealm = realms.find((r) =>
      r.realm_api_id === realm || (realm === "poe2" && r.game_api_id === "poe2")
    );
    if (matchingRealm) {
      defaultLeagueValue = matchingRealm.default_league_value;
    }
  } catch {
    // If realms fetch fails, fall back to IsCurrent
  }

  return raw.map((l) => ({
    name: l.Value,
    displayName: l.Value,
    startAt: null,
    endAt: null,
    // FIX v3: Mark league as active if it matches the realm's default_league_value
    active: defaultLeagueValue
      ? l.Value === defaultLeagueValue
      : l.IsCurrent,
    // FIX v3: Pass base currency info from league for reference currency
    baseCurrencyApiId: l.BaseCurrencyApiId,
    baseCurrencyText: l.BaseCurrencyText,
    defaultCurrency: l.DefaultCurrency
      ? {
          apiId: l.DefaultCurrency.ApiId,
          text: l.DefaultCurrency.Text,
          iconUrl: l.DefaultCurrency.IconUrl,
          relativePrice: l.DefaultCurrency.RelativePrice,
        }
      : undefined,
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

// FIX v3: ItemHistory API returns {price_history: [...], has_more}
export async function getItemHistory(realm: string, league: string, itemId: string, logCount = 168, referenceCurrency?: string): Promise<PoeItemHistoryPoint[]> {
  let url = `${BASE_URL}/${realm}/Leagues/${encodeURIComponent(league)}/Items/${itemId}/History?LogCount=${logCount}`;
  if (referenceCurrency) url += `&ReferenceCurrency=${encodeURIComponent(referenceCurrency)}`;
  const raw = await cachedFetch<RawItemHistoryResponse>(url);
  return (raw.PriceHistory ?? []).map((p) => ({
    timestamp: p.Time,
    price: p.Price,
    priceChaos: p.Price,
    relativePrice: p.Price,
    volume: p.Quantity,
  }));
}

// FIX v3: DailyStatsHistory API returns {daily_stats: [...], has_more}
export async function getItemDailyStats(realm: string, league: string, itemId: string, dayCount = 30, referenceCurrency?: string): Promise<DailyStat[]> {
  let url = `${BASE_URL}/${realm}/Leagues/${encodeURIComponent(league)}/Items/${itemId}/DailyStatsHistory?DayCount=${dayCount}`;
  if (referenceCurrency) url += `&ReferenceCurrency=${encodeURIComponent(referenceCurrency)}`;
  const raw = await cachedFetch<RawDailyStatsHistoryResponse>(url);
  return (raw.DailyStats ?? []).map((d) => ({
    day: d.Time,
    open: d.Open,
    high: d.High,
    low: d.Low,
    close: d.Close,
    volume: d.Volume,
  }));
}

// --- Uniques (paginated) ---
// FIX v3: Category=all returns EMPTY results from the API.
// When category is "all", we fetch ALL unique categories and merge results.
export async function getUniquesByCategory(
  realm: string,
  league: string,
  category = "all",
  page = 1,
  perPage = 50,
  search = "",
  referenceCurrency?: string
): Promise<PaginatedResponse<PoeItem>> {

  // FIX v3: When category is "all", fetch all categories and merge
  if (category === "all") {
    return getUniquesAllCategories(realm, league, page, perPage, search, referenceCurrency);
  }

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

  return {
    items: raw.Items.map((item) => mapUniqueItem(item)),
    page: raw.CurrentPage,
    perPage: perPage,
    totalItems: raw.Total,
    totalPages: raw.Pages,
  };
}

/**
 * Fetch uniques across ALL categories since Category=all returns empty.
 * Fetches first page of each category, then merges and paginates client-side.
 */
async function getUniquesAllCategories(
  realm: string,
  league: string,
  page = 1,
  perPage = 50,
  search = "",
  referenceCurrency?: string
): Promise<PaginatedResponse<PoeItem>> {
  // First, get the list of unique categories
  const categoriesRaw = await cachedFetch<RawCategoriesResponse>(
    `${BASE_URL}/${realm}/Leagues/${encodeURIComponent(league)}/Items/Categories`
  );

  const uniqueCats = categoriesRaw.UniqueCategories ?? [];

  // Fetch page 1 of each unique category in parallel
  const fetches = uniqueCats.map((cat) => {
    const params = new URLSearchParams({
      Category: cat.ApiId,
      Page: "1",
      PerPage: String(perPage),
    });
    if (search) params.set("Search", search);
    if (referenceCurrency) params.set("ReferenceCurrency", referenceCurrency);

    return cachedFetch<RawPaginatedResponse<RawUniqueItem>>(
      `${BASE_URL}/${realm}/Leagues/${encodeURIComponent(league)}/Uniques/ByCategory?${params}`
    ).catch(() => null);
  });

  const results = await Promise.all(fetches);

  // Merge all items
  const allItems: PoeItem[] = [];
  let totalItems = 0;

  for (const result of results) {
    if (!result) continue;
    totalItems += result.Total;
    allItems.push(...result.Items.map((item) => mapUniqueItem(item)));
  }

  // Sort by price descending (most expensive first)
  allItems.sort((a, b) => (b.price ?? 0) - (a.price ?? 0));

  // Client-side pagination
  const startIdx = (page - 1) * perPage;
  const pageItems = allItems.slice(startIdx, startIdx + perPage);
  const totalPages = Math.max(1, Math.ceil(allItems.length / perPage));

  return {
    items: pageItems,
    page,
    perPage,
    totalItems: allItems.length,
    totalPages,
  };
}

// --- Currencies ---
// FIX v3: Category=all returns EMPTY results from the API.
// When category is "all", we fetch ALL currency categories and merge results.
export async function getCurrenciesByCategory(
  realm: string,
  league: string,
  category = "all",
  page = 1,
  perPage = 50,
  referenceCurrency?: string
): Promise<PaginatedResponse<PoeItem>> {

  // FIX v3: When category is "all", fetch all categories and merge
  if (category === "all") {
    return getCurrenciesAllCategories(realm, league, page, perPage, referenceCurrency);
  }

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
    items: raw.Items.map((item) => mapCurrencyItem(item)),
    page: raw.CurrentPage,
    perPage: perPage,
    totalItems: raw.Total,
    totalPages: raw.Pages,
  };
}

/**
 * Fetch currencies across ALL categories since Category=all returns empty.
 * Fetches first page of each category, then merges and paginates client-side.
 */
async function getCurrenciesAllCategories(
  realm: string,
  league: string,
  page = 1,
  perPage = 50,
  referenceCurrency?: string
): Promise<PaginatedResponse<PoeItem>> {
  // Get the list of currency categories
  const categoriesRaw = await cachedFetch<RawCategoriesResponse>(
    `${BASE_URL}/${realm}/Leagues/${encodeURIComponent(league)}/Items/Categories`
  );

  const currencyCats = categoriesRaw.CurrencyCategories ?? [];

  // Fetch page 1 of each currency category in parallel
  const fetches = currencyCats.map((cat) => {
    const params = new URLSearchParams({
      Category: cat.ApiId,
      Page: "1",
      PerPage: String(perPage),
    });
    if (referenceCurrency) params.set("ReferenceCurrency", referenceCurrency);

    return cachedFetch<RawPaginatedResponse<RawCurrencyItem>>(
      `${BASE_URL}/${realm}/Leagues/${encodeURIComponent(league)}/Currencies/ByCategory?${params}`
    ).catch(() => null);
  });

  const results = await Promise.all(fetches);

  // Merge all items
  const allItems: PoeItem[] = [];

  for (const result of results) {
    if (!result) continue;
    allItems.push(...result.Items.map((item) => mapCurrencyItem(item)));
  }

  // Sort by price descending
  allItems.sort((a, b) => (b.price ?? 0) - (a.price ?? 0));

  // Client-side pagination
  const startIdx = (page - 1) * perPage;
  const pageItems = allItems.slice(startIdx, startIdx + perPage);
  const totalPages = Math.max(1, Math.ceil(allItems.length / perPage));

  return {
    items: pageItems,
    page,
    perPage,
    totalItems: allItems.length,
    totalPages,
  };
}

export async function getCurrency(realm: string, league: string, apiId: string): Promise<PoeItem> {
  const raw = await cachedFetch<RawCurrencyItem>(
    `${BASE_URL}/${realm}/Leagues/${encodeURIComponent(league)}/Currencies/${apiId}`
  );
  return mapCurrencyItem(raw);
}

// FIX v3: CurrencyPairHistory returns nested {history, meta} structure
export async function getCurrencyPairHistory(
  realm: string,
  league: string,
  id1: string,
  id2: string,
  limit = 168
): Promise<ExchangePairHistoryPoint[]> {
  const raw = await cachedFetch<RawCurrencyPairHistoryResponse>(
    `${BASE_URL}/${realm}/Leagues/${encodeURIComponent(league)}/Currencies/Pairs/${id1}/${id2}/History?Limit=${limit}`
  );

  // The API returns {History: [{Epoch, Data: {CurrencyOneData: {RelativePrice (string!), VolumeTraded (number), ...}, CurrencyTwoData: {...}}}], ...}
  // We extract from CurrencyOneData as the primary direction
  return (raw.History ?? []).map((point) => ({
    timestamp: new Date(point.Epoch * 1000).toISOString(),
    relativePrice: parseFloat(point.Data?.CurrencyOneData?.RelativePrice ?? "0") || 0,
    volume: point.Data?.CurrencyOneData?.VolumeTraded ?? 0,
  }));
}

// --- Health ---
export async function getHealth(): Promise<{ status: string }> {
  return cachedFetch<{ status: string }>(`${BASE_URL}/health/live`);
}
