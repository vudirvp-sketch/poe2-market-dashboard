// ============================================================================
// PoE2 Scout API — Server-side fetch functions + in-memory cache
// Base URL: configurable via POE2_API_BASE_URL env var (default: https://api.poe2scout.com/api)
//
// v5 FIXES (POE2-FIX-SPEC):
// 1. API base URL is now configurable via POE2_API_BASE_URL environment variable
//    so users behind blocked networks can use api.poe2scout.com or a local proxy
// 2. Added User-Agent header to avoid being blocked by bot detection
// 3. Improved error messages with actionable hints
// 4. API returns PascalCase for Leagues/Items/etc., snake_case for Realms
// 5. Category=all returns EMPTY results from API — when category is "all",
//    we fetch all categories separately and merge results
// 6. League IsCurrent is always false in API — we use default_league_value
//    from the Realm to mark the active league
// 7. CurrencyPairHistory API returns nested structure {history, meta} not a flat array
// 8. ItemHistory API returns {price_history, has_more} not a flat array
// 9. DailyStatsHistory API returns {daily_stats, has_more} not a flat array
// 10. Fix 1: unwrapNetworkError — walk AggregateError/cause chain to find
//     real ETIMEDOUT/ECONNRESET instead of misclassifying as "fetch failed"
// 11. Fix 2: Stale-while-revalidate cache — serve stale data up to 10 min
//     while revalidating in background; return very stale data on fetch error
// 12. Fix 3: Request deduplication — identical concurrent requests share
//     one in-flight Promise instead of hitting upstream N times
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
  OHLCVCandle,
} from "./types";

// ---------- Configurable API Base URL ----------
export const BASE_URL = process.env.POE2_API_BASE_URL || "https://api.poe2scout.com/api";

// ---------- CORS Proxy fallback ----------
// When the direct API call fails with ECONNRESET/ETIMEDOUT (common from
// Russian IPs where api.poe2scout.com is blocked), automatically retry
// through a CORS proxy if one is configured.
//
// Set POE2_CORS_PROXY_URL in .env.local to your Cloudflare Worker URL
// (e.g. https://poe2scout-proxy.your-account.workers.dev/api)
//
// The proxy URL replaces BASE_URL for retry requests only.
// If POE2_CORS_PROXY_URL is not set, this feature is disabled and
// behavior is identical to before.
const CORS_PROXY_URL = process.env.POE2_CORS_PROXY_URL || "";

// Track whether we've confirmed the proxy works (to avoid retrying a dead proxy)
let corsProxyConfirmed = false;
let corsProxyLastCheck = 0;
export const CORS_PROXY_CONFIRM_TTL = 5 * 60_000; // Re-confirm every 5 minutes

// ---------- Stale-while-revalidate cache ----------
export const cache = new Map<string, { data: unknown; ts: number }>();
export const CACHE_TTL = 60_000;          // 60s fresh
export const CACHE_STALE_TTL = 1_800_000;  // 30min — serve stale up to this age
const MAX_CACHE_SIZE = 500;

/**
 * Pre-populate a cache entry from an external source (e.g., snapshot file).
 *
 * This is used by the cache-prepopulator to seed the in-memory cache with
 * data from a JSON snapshot so the dashboard works even when the upstream
 * API is unreachable on first load.
 *
 * Entries inserted this way should have `ts` set to
 * `Date.now() - CACHE_STALE_TTL + 60_000` so they are considered "stale
 * but usable" — cachedFetch will serve them immediately while triggering
 * background revalidation.
 */
export function prepopulateCacheEntry(url: string, data: unknown, ts: number): void {
  // Don't overwrite entries that are fresher than what we're inserting
  const existing = cache.get(url);
  if (existing && existing.ts >= ts) return;
  cache.set(url, { data, ts });
}

// Fix 4.6: Periodic cleanup of stale entries that are well past their TTL
function cleanupStaleCacheEntries(): void {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now - entry.ts > CACHE_STALE_TTL * 2) {
      cache.delete(key);
    }
  }
}
let cacheWriteCounter = 0;

// ---------- Fetch with timeout + retry ----------
const FETCH_TIMEOUT = 30_000; // 30 seconds (increased from 20 to reduce ECONNRESET)
const FETCH_RETRIES = 2; // Reduced from 3 — circuit breaker now handles sustained failures

// ---------- Circuit breaker (prevents hammering a dead upstream) ----------
let circuitBreakerOpen = false;
let circuitBreakerOpenSince = 0;
const CIRCUIT_BREAKER_COOLDOWN = 60_000; // 60s — try again after this period
let consecutiveFailures = 0;
const CIRCUIT_BREAKER_THRESHOLD = 3; // Open after 3 consecutive failures

// ---------- Request deduplication (Fix 3) ----------
const pendingRequests = new Map<string, Promise<unknown>>();

// ---------- Background revalidation tracking (Fix 2 + Fix 4.7) ----------
// Fix 4.7: Replace Set<string> with Map<string, number> for TTL-based cleanup
const revalidationTimestamps = new Map<string, number>();
const REVALIDATION_TTL_MS = 60_000; // 1 minute

function isRevalidating(url: string): boolean {
  const ts = revalidationTimestamps.get(url);
  if (ts === undefined) return false;
  if (Date.now() - ts > REVALIDATION_TTL_MS) {
    revalidationTimestamps.delete(url);
    return false;
  }
  return true;
}

function markRevalidationStart(url: string): void {
  revalidationTimestamps.set(url, Date.now());
}

function markRevalidationEnd(url: string): void {
  revalidationTimestamps.delete(url);
}

// ============================================================================
// Fix 1: unwrapNetworkError — walk AggregateError/cause chain
// ============================================================================

/** Type-safe accessor for Error.cause (ES2022, not always in TS lib types). */
function getErrorCause(err: Error): unknown {
  if ("cause" in err) return (err as { cause: unknown }).cause;
  return undefined;
}

/** Type-safe accessor for AggregateError.errors array. */
interface AggregateErrorLike {
  errors: Array<{ code?: string; message?: string }>;
}
function getAggregateErrors(obj: object): Array<{ code?: string; message?: string }> | undefined {
  if ("errors" in obj) {
    const errors = (obj as AggregateErrorLike).errors;
    return Array.isArray(errors) ? errors : undefined;
  }
  return undefined;
}

/** Unwrap nested cause/errors chains to find the real network error code.
 *
 * Node.js `fetch()` throws `TypeError: fetch failed` with
 * `cause: AggregateError` containing nested `Error { code: 'ETIMEDOUT' }`.
 * Without unwrapping, ETIMEDOUT falls through to the non-recoverable
 * branch because `lastError.message` is `"fetch failed"`.
 */
function unwrapNetworkError(err: unknown): Error {
  if (!(err instanceof Error)) return new Error(String(err));

  // Walk cause chain
  let depth = 0;
  let current: unknown = err;
  while (current && depth < 5) {
    if (current instanceof Error) {
      const msg = current.message || "";
      // Direct match on transient codes
      if (
        msg.includes("ECONNRESET") ||
        msg.includes("EPIPE") ||
        msg.includes("socket hang up") ||
        msg.includes("ETIMEDOUT") ||
        msg.includes("ECONNREFUSED") ||
        msg.includes("ENOTFOUND")
      ) {
        return current;
      }
      // Descend into cause (Error.cause is part of ES2022 but not always
      // in TS types; use a type-safe accessor instead of `as any`)
      current = getErrorCause(current);
    } else if (typeof current === "object" && current !== null && Array.isArray(getAggregateErrors(current))) {
      // AggregateError — check each sub-error
      for (const sub of getAggregateErrors(current)!) {
        if (sub?.code === "ETIMEDOUT") return new Error("ETIMEDOUT: " + (sub.message || "connection timed out"));
        if (sub?.code === "ECONNRESET") return new Error("ECONNRESET: " + (sub.message || "connection reset"));
        if (sub?.code === "ECONNREFUSED") return new Error("ECONNREFUSED");
        if (sub?.code === "ENOTFOUND") return new Error("ENOTFOUND");
      }
      // If no matching sub-error code, return original
      return err;
    } else {
      break;
    }
    depth++;
  }
  return err;
}

// ============================================================================
// Fetch with timeout
// ============================================================================

/**
 * Fetch with AbortController timeout.
 * This prevents ETIMEDOUT errors from hanging the server indefinitely
 * and causing "failed to pipe response" errors in API routes.
 */
async function fetchWithTimeout(url: string, timeoutMs: number, signal?: AbortSignal): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // Link external signal if provided (Fix 3.4: prevent listener leak)
  let onAbort: (() => void) | null = null;
  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      onAbort = () => controller.abort();
      signal.addEventListener("abort", onAbort, { once: true });
    }
  }

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        // Some CDNs/reverse-proxies block requests without a User-Agent
        "User-Agent": "PoE2-Market-Dashboard/1.0",
        "Accept": "application/json",
      },
    });
    return res;
  } finally {
    clearTimeout(timeoutId);
    if (onAbort && signal) {
      signal.removeEventListener("abort", onAbort);
    }
  }
}

// ============================================================================
// CORS Proxy Fallback — retry through a Cloudflare Worker when direct API
// access is blocked (ECONNRESET / ETIMEDOUT from Russian IPs)
// ============================================================================

/**
 * Try to fetch a URL through the configured CORS proxy.
 *
 * This is called as a last resort when the direct API request fails with
 * a network error that suggests the API is blocked (ECONNRESET, ETIMEDOUT,
 * ECONNREFUSED, ENOTFOUND).
 *
 * How it works:
 * 1. Replaces BASE_URL in the original URL with CORS_PROXY_URL
 * 2. Fetches through the proxy with the same timeout
 * 3. On success, caches the result (same as direct fetch) and marks proxy as confirmed
 * 4. On failure, returns null (caller should proceed with its own error handling)
 *
 * @param originalUrl  The URL that failed directly
 * @param originalError  The error from the direct attempt
 * @returns  T on success, null on failure (caller handles null)
 */
/**
 * Build a CORS proxy URL by replacing BASE_URL with the proxy URL prefix.
 * Extracted from tryCorsProxyFallback for testability.
 *
 * @param originalUrl  The URL that failed directly
 * @param baseUrl      The base URL to replace (default: BASE_URL from poe2api)
 * @param proxyUrl     The CORS proxy URL prefix
 * @returns            The proxied URL string
 */
export function buildCorsProxyUrl(originalUrl: string, baseUrl: string, proxyUrl: string): string {
  if (originalUrl.startsWith(baseUrl)) {
    return proxyUrl + originalUrl.slice(baseUrl.length);
  }
  // URL doesn't start with BASE_URL (unexpected), try prefixing anyway
  return proxyUrl + "/" + originalUrl.replace(/^https?:\/\/[^/]+/, "");
}

async function tryCorsProxyFallback<T>(originalUrl: string, originalError: Error): Promise<T | null> {
  // No proxy configured — skip entirely
  if (!CORS_PROXY_URL) return null;

  // If proxy was previously confirmed but the TTL hasn't expired,
  // we can use it. If it was never confirmed, we'll try once.
  // If it was confirmed but TTL expired, re-confirm.
  const now = Date.now();
  if (corsProxyConfirmed && now - corsProxyLastCheck > CORS_PROXY_CONFIRM_TTL) {
    corsProxyConfirmed = false;
  }

  // Build the proxy URL by replacing BASE_URL with CORS_PROXY_URL
  const proxyUrl = buildCorsProxyUrl(originalUrl, BASE_URL, CORS_PROXY_URL);

  console.info(
    `[poe2api] Direct API failed (${originalError.message}), trying CORS proxy: ${proxyUrl}`
  );

  try {
    const res = await fetchWithTimeout(proxyUrl, FETCH_TIMEOUT);

    if (!res.ok) {
      console.warn(
        `[poe2api] CORS proxy returned ${res.status} ${res.statusText} for ${proxyUrl}`
      );
      // Don't mark proxy as dead — it might just be a transient issue
      return null;
    }

    const data = (await res.json()) as T;

    // Success! Cache the result under the ORIGINAL URL so subsequent
    // cachedFetch calls find it without needing the proxy again
    cache.set(originalUrl, { data, ts: Date.now() });

    // Mark proxy as confirmed working
    corsProxyConfirmed = true;
    corsProxyLastCheck = Date.now();

    // Reset circuit breaker since we have a working path to the API
    if (circuitBreakerOpen) {
      circuitBreakerOpen = false;
      consecutiveFailures = 0;
      console.info("[poe2api] Circuit breaker CLOSED — CORS proxy is working.");
    }

    console.info(`[poe2api] CORS proxy succeeded for ${originalUrl}`);
    return data;
  } catch (proxyErr: unknown) {
    const unwrappedProxyErr = unwrapNetworkError(proxyErr);
    console.warn(
      `[poe2api] CORS proxy also failed for ${proxyUrl}: ${unwrappedProxyErr.message}`
    );
    // Mark proxy as unconfirmed so we don't waste time on it in the near future
    corsProxyConfirmed = false;
    return null;
  }
}

// ============================================================================
// Fix 2: doFetch — actual fetch logic with retry + cache population
// ============================================================================

async function doFetch<T>(url: string, maxRetries: number): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Circuit breaker: skip upstream request if we know it's down
    if (circuitBreakerOpen) {
      const elapsed = Date.now() - circuitBreakerOpenSince;
      if (elapsed < CIRCUIT_BREAKER_COOLDOWN) {
        // Upstream is known-down. Try CORS proxy if available before giving up.
        if (CORS_PROXY_URL) {
          const proxyResult = await tryCorsProxyFallback<T>(url, new Error(`Circuit breaker open`));
          if (proxyResult !== null) return proxyResult;
        }
        // Still in cooldown — throw immediately so cachedFetch can use stale cache
        throw new Error(`Circuit breaker open — upstream API unreachable (retry in ${Math.round((CIRCUIT_BREAKER_COOLDOWN - elapsed) / 1000)}s)`);
      }
      // Cooldown expired — try one request to test the waters
      circuitBreakerOpen = false;
    }
    try {
      const res = await fetchWithTimeout(url, FETCH_TIMEOUT);

      if (!res.ok) {
        // Provide helpful error messages for common status codes
        if (res.status === 403) {
          throw new Error(
            `API 403 Forbidden — ${url}. Your IP may be blocked by poe2scout.com. ` +
            `Try setting POE2_API_BASE_URL=${BASE_URL} in .env.local ` +
            `or use a VPN.`
          );
        }
        if (res.status === 429) {
          // MEDIUM-3: Retry 429 with backoff instead of throwing immediately
          const retryAfter = res.headers.get('Retry-After');
          const delayMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 5000;
          if (attempt < maxRetries) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            continue; // retry
          }
          throw new Error(
            `API 429 Rate Limited — ${url}. Too many requests. Wait a moment and try again.`
          );
        }
        throw new Error(`API ${res.status}: ${res.statusText} — ${url}`);
      }

      const data = (await res.json()) as T;

      // Reset circuit breaker on success
      consecutiveFailures = 0;
      if (circuitBreakerOpen) {
        circuitBreakerOpen = false;
        console.info("[poe2api] Circuit breaker CLOSED — upstream API is reachable again.");
      }

      // Enforce cache size limit
      if (cache.size > MAX_CACHE_SIZE) {
        const entries = [...cache.entries()].sort((a, b) => a[1].ts - b[1].ts);
        for (let i = 0; i < Math.floor(entries.length / 2); i++) {
          cache.delete(entries[i][0]);
        }
      }
      cache.set(url, { data, ts: Date.now() });
      // Fix 4.6: Periodic stale entry cleanup
      cacheWriteCounter++;
      if (cacheWriteCounter % 10 === 0) {
        cleanupStaleCacheEntries();
      }
      return data;
    } catch (err: unknown) {
      // Fix 1: use unwrapNetworkError to properly classify nested errors
      lastError = unwrapNetworkError(err);

      // Don't retry on 4xx errors (client errors)
      if (lastError.message.startsWith("API 4")) {
        throw lastError;
      }

      // Don't retry on abort (timeout) — just fail fast
      if (lastError.name === "AbortError") {
        throw new Error(
          `API request timed out after ${FETCH_TIMEOUT / 1000}s — ${url}. ` +
          `The poe2scout.com server may be unreachable from your network. ` +
          `Try setting POE2_API_BASE_URL=${BASE_URL} in .env.local ` +
          `or use a VPN.`
        );
      }

      // ECONNRESET is a transient error — the remote server reset the connection.
      // This is common when api.poe2scout.com is under load or when the network
      // is unstable. Unlike ECONNREFUSED (server not listening), ECONNRESET means
      // the server WAS reachable but dropped the connection. Retry with backoff.
      const isTransientNetworkError =
        lastError.message.includes("ECONNRESET") ||
        lastError.message.includes("EPIPE") ||
        lastError.message.includes("socket hang up") ||
        lastError.message.includes("ETIMEDOUT");

      // Non-recoverable network errors (server not reachable at all)
      if (lastError.message.includes("ECONNREFUSED") || lastError.message.includes("ENOTFOUND")) {
        // ── Try CORS proxy fallback before giving up completely ──
        const proxyResult = await tryCorsProxyFallback<T>(url, lastError);
        if (proxyResult !== null) return proxyResult;

        throw new Error(
          `Cannot reach poe2scout.com API — ${url}. ` +
          `Error: ${lastError.message}. ` +
          `Try setting POE2_API_BASE_URL in .env.local to a CORS proxy URL ` +
          `or use a VPN to access poe2scout.com.`
        );
      }

      // If this is a transient error, log and retry with exponential backoff + jitter
      if (isTransientNetworkError) {
        consecutiveFailures++;
        if (consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
          circuitBreakerOpen = true;
          circuitBreakerOpenSince = Date.now();
          console.warn(
            `[poe2api] Circuit breaker OPENED — upstream API appears unreachable. ` +
            `Will retry in ${CIRCUIT_BREAKER_COOLDOWN / 1000}s. Consecutive failures: ${consecutiveFailures}`
          );
        }

        // ── Try CORS proxy fallback on transient errors (ECONNRESET, ETIMEDOUT) ──
        // This is the main use case: API is blocked by Russian ISP.
        // We try the CORS proxy before giving up on the last retry attempt.
        if (attempt >= maxRetries) {
          const proxyResult = await tryCorsProxyFallback<T>(url, lastError);
          if (proxyResult !== null) return proxyResult;
          break; // No proxy available, give up
        }

        const baseDelay = 500 * Math.pow(2, attempt);
        const jitter = Math.random() * 500; // 0–500ms random jitter
        const delay = Math.min(baseDelay + jitter, 5000);
        // Only log on first and last attempt to reduce console spam
        if (attempt === 0 || attempt >= maxRetries - 1) {
          console.warn(
            `[poe2api] Transient network error on attempt ${attempt + 1}/${maxRetries + 1}: ` +
            `${lastError.message}. Retrying in ${Math.round(delay)}ms...`
          );
        }
        await new Promise((r) => setTimeout(r, delay));
        continue; // Skip the generic backoff below
      }

      // Wait before retrying (exponential backoff) for other errors
      if (attempt < maxRetries) {
        const delay = Math.min(500 * Math.pow(2, attempt), 3000);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  throw lastError ?? new Error(`Failed to fetch ${url} after ${maxRetries + 1} attempts`);
}

// ============================================================================
// Fix 2: background revalidation
// ============================================================================

async function revalidateInBackground(url: string, maxRetries: number): Promise<void> {
  if (isRevalidating(url)) return;
  markRevalidationStart(url);
  try {
    await doFetch(url, maxRetries);
    // doFetch already updates cache
  } catch {
    // Silently ignore — stale data still being served
  } finally {
    markRevalidationEnd(url);
  }
}

// ============================================================================
// cachedFetch — with stale-while-revalidate (Fix 2) + deduplication (Fix 3)
// ============================================================================

async function cachedFetch<T>(url: string, options?: { maxRetries?: number }): Promise<T> {
  const maxRetries = options?.maxRetries ?? FETCH_RETRIES;

  const hit = cache.get(url);
  const now = Date.now();

  // Fresh cache hit
  if (hit && now - hit.ts < CACHE_TTL) {
    return hit.data as T;
  }

  // Stale-but-usable — return immediately, revalidate in background (Fix 2)
  if (hit && now - hit.ts < CACHE_STALE_TTL) {
    // Fire-and-forget revalidation
    revalidateInBackground(url, maxRetries).catch(() => {});
    return hit.data as T;
  }

  // Fix 3: Deduplicate in-flight requests
  const pending = pendingRequests.get(url);
  if (pending) return pending as Promise<T>;

  // No cache or too stale — must fetch
  const fetchPromise = doFetch<T>(url, maxRetries)
    .catch((err) => {
      // Fix 2: Last resort — return very stale data if available
      if (hit) {
        console.warn(`[poe2api] Using very stale cache for ${url} due to fetch error`);
        return hit.data as T;
      }
      throw err;
    })
    .finally(() => pendingRequests.delete(url));

  pendingRequests.set(url, fetchPromise);
  return fetchPromise;
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
  Volume: string; // Volume is a string in API response (e.g. "1683.00000000")
  BaseCurrencyApiId: string;
  BaseCurrencyText: string;
  CurrencyOne: RawSnapshotPairCurrencyItem;
  CurrencyTwo: RawSnapshotPairCurrencyItem;
  CurrencyOneData: RawSnapshotPairData;
  CurrencyTwoData: RawSnapshotPairData;
}

interface RawExchangeSnapshot {
  Epoch: number;
  Volume: string | number;  // API sometimes returns string e.g. "3231895.00000000"
  MarketCap: string | number;  // API sometimes returns string
  BaseCurrencyApiId: string;
  BaseCurrencyText: string;
}

interface RawSnapshotHistoryData {
  Epoch: number;
  MarketCap: string | number;  // API sometimes returns string
  Volume: string | number;      // API sometimes returns string
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

// CurrencyPairHistory returns PascalCase {History: [...], Meta, BaseCurrencyApiId}
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

// ItemHistory returns PascalCase {PriceHistory: [...], HasMore}
interface RawItemHistoryResponse {
  PriceHistory: RawItemHistoryPoint[];
  HasMore: boolean;
}

interface RawItemHistoryPoint {
  Price: number;
  Time: string;
  Quantity: number;
}

// DailyStatsHistory returns PascalCase {DailyStats: [...], HasMore, BaseCurrencyApiId}
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

/** Compute 24h change percent from price logs
 *
 *  IMPORTANT: The POE2Scout API returns PriceLogs in REVERSE chronological
 *  order (newest entry first, e.g. [null, null, May25, May24, May23]).
 *  We must sort by timestamp to find the true latest and 24h-ago entries.
 *
 *  Fix 2.6: Added MAX_TIME_DRIFT_MS threshold. If the nearest log entry
 *  is more than 6 hours away from the 24h target, return null instead of
 *  an inaccurate percentage.
 */
/** Max time drift for lookback — scales with lookback period.
 *  For 1h lookback: 30 min. For 24h: 6h. For 7d: 18h.
 *  Formula: max(30min, lookbackMs * 0.1)
 */
function getMaxTimeDriftMs(lookbackMs: number): number {
  return Math.max(30 * 60 * 1000, lookbackMs * 0.1);
}

/** Legacy constant kept for backward compat — equals 6h drift (for 24h lookback) */
const MAX_TIME_DRIFT_MS = 6 * 60 * 60 * 1000;

function computeChangePercent(logs: (RawPriceLogEntry | null)[] | undefined): number | null {
  if (!logs || logs.length === 0) return null;
  const validLogs = logs.filter((l): l is RawPriceLogEntry => l !== null);
  if (validLogs.length < 2) return null;

  // Sort chronologically (oldest first) — API may return newest-first
  sortPriceLogsByTime(validLogs);

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

  // Fix 2.6 + Step 1.2: Scale drift tolerance with lookback period
  const maxDrift24h = getMaxTimeDriftMs(24 * 60 * 60 * 1000);
  if (closestDiff > maxDrift24h) return null;

  if (closest.Price === 0) return null;
  return ((now.Price - closest.Price) / closest.Price) * 100;
}

/** Compute 7-day change percent from price logs
 *
 *  IMPORTANT: The POE2Scout API returns PriceLogs in REVERSE chronological
 *  order (newest entry first). We must sort by timestamp first.
 *
 *  Step 1.2: Scale drift tolerance with lookback (18h for 7d instead of fixed 6h).
 */
function compute7dChangePercent(logs: (RawPriceLogEntry | null)[] | undefined): number | null {
  if (!logs || logs.length === 0) return null;
  const validLogs = logs.filter((l): l is RawPriceLogEntry => l !== null);
  if (validLogs.length < 2) return null;

  // Sort chronologically (oldest first) — API may return newest-first
  sortPriceLogsByTime(validLogs);

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

  // Step 1.2: Scale drift tolerance with lookback period
  // 7d lookback = 604800000ms → 0.1 * 604800000 = 60480000ms ≈ 16.8h
  const maxDrift7d = getMaxTimeDriftMs(7 * 24 * 60 * 60 * 1000);
  if (closestDiff > maxDrift7d) return null;

  if (closest.Price === 0) return null;
  return ((now.Price - closest.Price) / closest.Price) * 100;
}

/** Compute volume from price logs (sum of quantities in last 24h)
 *
 *  IMPORTANT: The POE2Scout API returns PriceLogs in REVERSE chronological
 *  order (newest entry first). We must sort by timestamp first.
 */
function computeVolume24h(logs: (RawPriceLogEntry | null)[] | undefined): number | null {
  if (!logs || logs.length === 0) return null;
  const validLogs = logs.filter((l): l is RawPriceLogEntry => l !== null);
  if (validLogs.length === 0) return null;

  // Sort chronologically (oldest first) — API may return newest-first
  sortPriceLogsByTime(validLogs);

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

/** Fix 2.3: Compute previous price from PriceLogs directly.
 *
 *  Instead of back-calculating change from changePercent (which causes
 *  division by zero at -100%), we extract the previous price from
 *  the second-to-latest PriceLog entry and compute change directly.
 */
function computePreviousPrice(logs: (RawPriceLogEntry | null)[] | undefined): number | null {
  if (!logs || logs.length < 2) return null;
  const validLogs = logs.filter((l): l is RawPriceLogEntry => l !== null);
  if (validLogs.length < 2) return null;
  // Sort chronologically (oldest first)
  sortPriceLogsByTime(validLogs);
  // validLogs[0] = oldest, validLogs[last] = most recent (current)
  // For 24h change: find the entry closest to 24h ago
  const now = validLogs[validLogs.length - 1];
  const targetTime = new Date(now.Time).getTime() - 24 * 60 * 60 * 1000;
  let closest = validLogs[0];
  let closestDiff = Infinity;
  for (const log of validLogs) {
    const diff = Math.abs(new Date(log.Time).getTime() - targetTime);
    if (diff < closestDiff) {
      closestDiff = diff;
      closest = log;
    }
  }
  if (closestDiff > MAX_TIME_DRIFT_MS) return null;
  return closest.Price ?? null;
}

/** Fix 2.3: Compute previous price for 7d change from PriceLogs. */
function computePrevious7dPrice(logs: (RawPriceLogEntry | null)[] | undefined): number | null {
  if (!logs || logs.length < 2) return null;
  const validLogs = logs.filter((l): l is RawPriceLogEntry => l !== null);
  if (validLogs.length < 2) return null;
  sortPriceLogsByTime(validLogs);
  const now = validLogs[validLogs.length - 1];
  const targetTime = new Date(now.Time).getTime() - 7 * 24 * 60 * 60 * 1000;
  let closest = validLogs[0];
  let closestDiff = Infinity;
  for (const log of validLogs) {
    const diff = Math.abs(new Date(log.Time).getTime() - targetTime);
    if (diff < closestDiff) {
      closestDiff = diff;
      closest = log;
    }
  }
  if (closestDiff > MAX_TIME_DRIFT_MS) return null;
  return closest.Price ?? null;
}

/** Map raw currency item to PoeItem */
function mapCurrencyItem(item: RawCurrencyItem, referencePrice?: number): PoeItem {
  const changePercent = computeChangePercent(item.PriceLogs);
  const sevenDayChange = compute7dChangePercent(item.PriceLogs);
  const computedVolume = computeVolume24h(item.PriceLogs);
  const currentPrice = item.CurrentPrice;
  const relPrice = referencePrice && currentPrice ? currentPrice / referencePrice : currentPrice;

  // Fix 2.3: Compute change from two prices directly instead of back-calculating
  // from changePercent (which causes division by zero at -100%)
  const previousPrice = computePreviousPrice(item.PriceLogs);
  const change: number | null =
    currentPrice !== null && previousPrice !== null
      ? currentPrice - previousPrice
      : null;

  const previous7dPrice = computePrevious7dPrice(item.PriceLogs);
  const sevenDayPriceChange: number | null =
    currentPrice !== null && previous7dPrice !== null
      ? currentPrice - previous7dPrice
      : null;

  return {
    id: String(item.ItemId || item.CurrencyItemId),
    apiId: item.ApiId,
    name: item.Text,
    type: item.CategoryApiId || "",
    category: item.CategoryApiId || "",
    iconUrl: item.IconUrl,
    price: currentPrice,
    chaosEquivalentRate: currentPrice,
    relativePrice: relPrice,
    change,
    changePercent,
    volume: computedVolume ?? 0,                    // Fix 2.5: Real 24h trade volume
    sevenDayPriceChange,
    sevenDayPriceChangePercent: sevenDayChange,
    history: mapPriceLogs(item.PriceLogs),
    dailyStats: null,
    lowConfidence: (item.CurrentQuantity ?? 0) < 5,
    listingCount: item.CurrentQuantity ?? 0,        // Fix 2.5: Separate listing count
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
  const computedVolume = computeVolume24h(raw.PriceLogs);
  const currentPrice = raw.CurrentPrice;
  const relPrice = referencePrice && currentPrice ? currentPrice / referencePrice : currentPrice;

  // Fix 2.3: Compute change from two prices directly
  const previousPrice = computePreviousPrice(raw.PriceLogs);
  const change: number | null =
    currentPrice !== null && previousPrice !== null
      ? currentPrice - previousPrice
      : null;

  const previous7dPrice = computePrevious7dPrice(raw.PriceLogs);
  const sevenDayPriceChange: number | null =
    currentPrice !== null && previous7dPrice !== null
      ? currentPrice - previous7dPrice
      : null;

  return {
    id: String(raw.ItemId || raw.UniqueItemId),
    // BUG FIX: Unique items don't have an ApiId field in the POE2Scout API.
    // CategoryApiId (e.g. "armour") is shared by ALL items in the same category,
    // which breaks deduplication, ComparativeChart correlation lookups, and
    // benchmark calls. Use ItemId as a stable, unique identifier instead.
    apiId: String(raw.ItemId || raw.UniqueItemId),
    name: raw.Text || raw.Name,
    type: raw.Type || "",
    category: raw.CategoryApiId || "",
    iconUrl: raw.IconUrl,
    price: currentPrice,
    chaosEquivalentRate: currentPrice,
    relativePrice: relPrice,
    change,
    changePercent,
    volume: computedVolume ?? 0,                    // Fix 2.5: Real 24h trade volume
    sevenDayPriceChange,
    sevenDayPriceChangePercent: sevenDayChange,
    history: mapPriceLogs(raw.PriceLogs),
    dailyStats: null,
    lowConfidence: (raw.CurrentQuantity ?? 0) < 5,
    listingCount: raw.CurrentQuantity ?? 0,        // Fix 2.5: Separate listing count
    baseType: null,
    links: null,
    variant: null,
    levelRequired: null,
  };
}

/** Map price logs to PoeItemHistoryPoint[]
 *
 *  IMPORTANT: The POE2Scout API returns PriceLogs in REVERSE chronological
 *  order (newest entry first). We sort chronologically so charts render correctly.
 */
function mapPriceLogs(logs: (RawPriceLogEntry | null)[] | undefined): PoeItemHistoryPoint[] | null {
  if (!logs || logs.length === 0) return null;
  const valid = logs.filter((l): l is RawPriceLogEntry => l !== null);
  if (valid.length === 0) return null;
  // Sort chronologically (oldest first) — API returns newest-first
  sortPriceLogsByTime(valid);
  return valid.map((l) => ({
    timestamp: l.Time,
    price: l.Price,
    chaosEquivalentRate: l.Price,
    relativePrice: l.Price,
    volume: l.Quantity,
  }));
}

/** Fix 2.4: Safe parse float — returns null instead of masking errors as 0
 *
 *  API returns "0E-8" for pairs with no trades. parseFloat("0E-8") = 0,
 *  which is technically correct but misleading — it means "no data", not
 *  "free". We detect scientific-notation strings that round to 0 and return
 *  null so the UI can display "—" instead of "0".
 */
function safeParseFloat(value: string | number | null | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    // Detect "0E-8", "0e-10", etc. — these mean "no data" in POE2Scout API
    if (/^0[eE]-\d+$/i.test(value.trim())) return null;
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

// ============================================================================
// Step 2.7: Shared sort helpers — eliminate duplicate .sort() comparators
// ============================================================================

/** Step 2.7: Shared sort helper — sort PriceLogs chronologically (oldest first).
 *  Mutates the array in-place (same as the inline .sort() calls it replaces). */
function sortPriceLogsByTime(logs: RawPriceLogEntry[]): void {
  logs.sort((a, b) => new Date(a.Time).getTime() - new Date(b.Time).getTime());
}

/** Step 2.7: Shared sort helper — sort PoeItem[] by price descending (most expensive first).
 *  Mutates the array in-place. */
function sortPoeItemsByPriceDesc(items: PoeItem[]): void {
  items.sort((a, b) => (b.price ?? 0) - (a.price ?? 0));
}

/** Step 2.7: Shared sort helper — sort history-like arrays by timestamp ascending.
 *  Returns a new sorted array (non-mutating), matching the [...items].sort() pattern it replaces. */
function sortByTimestampAsc<T extends { timestamp: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

// ============================================================================
// MEDIUM-3: Concurrency-limited request helper
// ============================================================================

/**
 * Execute an array of async tasks with a maximum concurrency limit.
 * Resolves in order of the input array (preserves indexing).
 * Adds a small delay between requests to avoid triggering 429 rate limits.
 */
async function withConcurrencyLimit<T>(
  tasks: (() => Promise<T>)[],
  maxConcurrent: number = 3,
  delayMs: number = 200,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < tasks.length) {
      const index = nextIndex++;
      if (index > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      results[index] = await tasks[index]();
    }
  }

  const workers = Array.from(
    { length: Math.min(maxConcurrent, tasks.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

/** Map raw snapshot pair to ExchangePair */
function mapSnapshotPair(raw: RawSnapshotPair): ExchangePair {
  // ValueTraded, RelativePrice, StockValue are strings in API response
  // Fix 2.4: Use safeParseFloat instead of parseFloat() || 0
  const relPrice1 = safeParseFloat(raw.CurrencyOneData.RelativePrice);
  const relPrice2 = safeParseFloat(raw.CurrencyTwoData.RelativePrice);
  const volTraded = raw.CurrencyOneData.VolumeTraded ?? 0;

  return {
    id: String(raw.CurrencyExchangeSnapshotPairId),
    currency1Id: raw.CurrencyOne.ApiId,
    currency1Name: raw.CurrencyOne.Text,
    currency1IconUrl: raw.CurrencyOne.IconUrl,
    // Numeric ItemId is required for the CurrencyPairHistory API endpoint
    // (/Currencies/Pairs/{ItemId1}/{ItemId2}/History expects integers, not ApiId strings)
    currency1ItemId: raw.CurrencyOne.ItemId,
    currency1CategoryApiId: raw.CurrencyOne.CategoryApiId || "",
    currency2Id: raw.CurrencyTwo.ApiId,
    currency2Name: raw.CurrencyTwo.Text,
    currency2IconUrl: raw.CurrencyTwo.IconUrl,
    currency2ItemId: raw.CurrencyTwo.ItemId,
    currency2CategoryApiId: raw.CurrencyTwo.CategoryApiId || "",
    price: relPrice1,                          // Fix 2.4: now number | null
    relativePrice: relPrice1,                   // null when no trade data ("0E-8")
    currency2RelativePrice: relPrice2,           // price of currency2 in base currency — needed for cross-rate
    volume: volTraded,
    change: null,
    changePercent: null,
    sevenDayChange: null,
    sevenDayChangePercent: null,
    history: null,
  };
}

// ===================== API FUNCTIONS (mapped) =====================

// --- Health check (for debugging connectivity) ---
export async function getHealth(): Promise<{ status: string; apiBaseUrl: string }> {
  try {
    const data = await cachedFetch<{ status: string }>(`${BASE_URL}/health/live`);
    return { status: data.status || "ok", apiBaseUrl: BASE_URL };
  } catch {
    return { status: "unreachable", apiBaseUrl: BASE_URL };
  }
}

// ============================================================================
// Fallback data — used when the upstream POE2Scout API is unreachable.
//
// NOTE: A dynamic fallback mechanism (dynamicRealmsFallback /
// dynamicLeaguesFallback) automatically caches the last successful API
// response in memory. When the API is unreachable on a subsequent call,
// the last-known-good data is served instead. This means the hardcoded
// tables below are only used on the very first request ever, or when the
// API has never been reached in the current session.
//
// The hardcoded data below should still be periodically updated when new
// leagues launch, but this is now LOWER PRIORITY thanks to the dynamic
// fallback. Check https://poe2scout.com or the API (/poe2/Leagues)
// periodically. Last verified: 2025-05-30.
//
// If the API is reachable, these are never used — they only serve as a
// fallback so the dashboard always has realm/league selectors populated,
// even on first launch behind a restrictive network.
// ============================================================================

const FALLBACK_REALMS: Realm[] = [
  // defaultLeague uses the ShortName format (matches l.ShortName in getLeagues)
  { name: "poe2", displayName: "PoE2", defaultLeague: "runes" },
  { name: "pc", displayName: "PoE1 PC", defaultLeague: "mirage" },
  { name: "xbox", displayName: "PoE1 XBOX", defaultLeague: "mirage" },
  { name: "sony", displayName: "PoE1 PS", defaultLeague: "mirage" },
];

const FALLBACK_LEAGUES: Record<string, League[]> = {
  poe2: [
    { name: "runes", displayName: "Runes of Aldur", startAt: null, endAt: null, active: true, baseCurrencyApiId: "exalted", baseCurrencyText: "Exalted Orb", defaultCurrency: { apiId: "exalted", text: "Exalted Orb", iconUrl: null, relativePrice: 1 } },
    { name: "runeshc", displayName: "HC Runes of Aldur", startAt: null, endAt: null, active: false, baseCurrencyApiId: "exalted", baseCurrencyText: "Exalted Orb", defaultCurrency: { apiId: "exalted", text: "Exalted Orb", iconUrl: null, relativePrice: 1 } },
    { name: "vaal", displayName: "Fate of the Vaal", startAt: null, endAt: null, active: false, baseCurrencyApiId: "exalted", baseCurrencyText: "Exalted Orb", defaultCurrency: { apiId: "exalted", text: "Exalted Orb", iconUrl: null, relativePrice: 1 } },
    { name: "vaalhc", displayName: "HC Fate of the Vaal", startAt: null, endAt: null, active: false, baseCurrencyApiId: "exalted", baseCurrencyText: "Exalted Orb", defaultCurrency: { apiId: "exalted", text: "Exalted Orb", iconUrl: null, relativePrice: 1 } },
    { name: "abyssal", displayName: "Rise of the Abyssal", startAt: null, endAt: null, active: false, baseCurrencyApiId: "exalted", baseCurrencyText: "Exalted Orb", defaultCurrency: { apiId: "exalted", text: "Exalted Orb", iconUrl: null, relativePrice: 1 } },
    { name: "abyssalhc", displayName: "HC Rise of the Abyssal", startAt: null, endAt: null, active: false, baseCurrencyApiId: "exalted", baseCurrencyText: "Exalted Orb", defaultCurrency: { apiId: "exalted", text: "Exalted Orb", iconUrl: null, relativePrice: 1 } },
    { name: "hunt", displayName: "Dawn of the Hunt", startAt: null, endAt: null, active: false, baseCurrencyApiId: "exalted", baseCurrencyText: "Exalted Orb", defaultCurrency: { apiId: "exalted", text: "Exalted Orb", iconUrl: null, relativePrice: 1 } },
    { name: "hunthc", displayName: "HC Dawn of the Hunt", startAt: null, endAt: null, active: false, baseCurrencyApiId: "exalted", baseCurrencyText: "Exalted Orb", defaultCurrency: { apiId: "exalted", text: "Exalted Orb", iconUrl: null, relativePrice: 1 } },
    { name: "standard", displayName: "Standard", startAt: null, endAt: null, active: false, baseCurrencyApiId: "exalted", baseCurrencyText: "Exalted Orb", defaultCurrency: { apiId: "exalted", text: "Exalted Orb", iconUrl: null, relativePrice: 1 } },
    { name: "hardcore", displayName: "Hardcore", startAt: null, endAt: null, active: false, baseCurrencyApiId: "exalted", baseCurrencyText: "Exalted Orb", defaultCurrency: { apiId: "exalted", text: "Exalted Orb", iconUrl: null, relativePrice: 1 } },
  ],
  pc: [
    { name: "mirage", displayName: "Mirage", startAt: null, endAt: null, active: true },
    { name: "standard", displayName: "Standard", startAt: null, endAt: null, active: false },
  ],
  xbox: [
    { name: "mirage", displayName: "Mirage", startAt: null, endAt: null, active: true },
    { name: "standard", displayName: "Standard", startAt: null, endAt: null, active: false },
  ],
  sony: [
    { name: "mirage", displayName: "Mirage", startAt: null, endAt: null, active: true },
    { name: "standard", displayName: "Standard", startAt: null, endAt: null, active: false },
  ],
};

// ============================================================================
// Dynamic fallback: When the API is successfully queried, we update these
// in-memory caches. On subsequent calls where the API is unreachable, the
// last-known-good data is used instead of the hardcoded fallbacks above.
// This eliminates the need to manually update FALLBACK_LEAGUES when new
// leagues launch — the API automatically keeps them current.
// ============================================================================

let dynamicRealmsFallback: Realm[] | null = null;
const dynamicLeaguesFallback: Map<string, League[]> = new Map();

// --- Realms ---

/**
 * Fix 5.5: Hardcoded overrides for POE2Scout /Realms default_league_value bug.
 * The /Realms endpoint returns an outdated default_league_value for some realms
 * (e.g., "Fate of the Vaal" instead of "Runes of Aldur" for poe2).
 * When we detect a known-stale value, we replace it with the correct one.
 *
 * Map key: `${realm_api_id}:${stale_default_league_value}`
 * Map value: corrected default_league_value
 *
 * This table should be updated whenever a new league launches and the
 * POE2Scout /Realms endpoint hasn't been updated yet.
 * TODO: Remove entries once POE2Scout maintainers fix the /Realms endpoint.
 */
const DEFAULT_LEAGUE_OVERRIDES: Record<string, string> = {
  // /Realms returns "Fate of the Vaal" (stale displayName) — override to ShortName "runes"
  "poe2:Fate of the Vaal": "runes",
  // /Realms returns "vaal" (stale ShortName) — override to "runes" (current ShortName)
  "poe2:vaal": "runes",
  // /Realms returns "Runes of Aldur" (correct league but displayName format) —
  // override to ShortName "runes" for consistency with getLeagues() matching logic,
  // FALLBACK_REALMS, and cache-snapshot.json format
  "poe2:Runes of Aldur": "runes",
};

export async function getRealms(): Promise<Realm[]> {
  try {
    const raw = await cachedFetch<RawRealm[]>(`${BASE_URL}/Realms`);
    const result = raw.map((r) => {
      const name = r.realm_api_id;

      let displayName: string;
      if (r.game_api_id === "poe2") {
        displayName = "PoE2";
      } else if (r.game_api_id === "poe") {
        displayName = `PoE1 ${r.realm_api_id.toUpperCase()}`;
      } else {
        displayName = r.realm_api_id;
      }

      // Apply override if the API returned a known-stale default_league_value
      let defaultLeague = r.default_league_value || undefined;
      const overrideKey = `${r.realm_api_id}:${defaultLeague}`;
      if (defaultLeague && DEFAULT_LEAGUE_OVERRIDES[overrideKey]) {
        console.warn(
          `[poe2api] getRealms: overriding stale default_league_value "${defaultLeague}" → "${DEFAULT_LEAGUE_OVERRIDES[overrideKey]}" for realm "${name}". ` +
          `See POE2Scout /Realms bug.`
        );
        defaultLeague = DEFAULT_LEAGUE_OVERRIDES[overrideKey];
      }

      return {
        name,
        displayName,
        defaultLeague,
      };
    });
    // Update dynamic fallback with live data
    dynamicRealmsFallback = result;
    return result;
  } catch (err) {
    // Upstream API unreachable — return dynamic fallback if available, otherwise hardcoded
    if (dynamicRealmsFallback) {
      console.warn("[poe2api] getRealms: upstream API unreachable, using last-known-good data.");
      return dynamicRealmsFallback;
    }
    console.warn("[poe2api] getRealms: upstream API unreachable, using hardcoded fallback.", err instanceof Error ? err.message : err);
    return FALLBACK_REALMS;
  }
}

// --- Leagues ---
// Fix 5.4: Added optional defaultLeagueValue parameter to avoid redundant /Realms request
export async function getLeagues(realm: string, defaultLeagueValue?: string): Promise<League[]> {
  try {
    const raw = await cachedFetch<RawLeague[]>(`${BASE_URL}/${encodeURIComponent(realm)}/Leagues`);

    // Determine the active league. Strategy:
    // 1. If ANY league has IsCurrent=true, use ONLY IsCurrent (ignore default_league_value).
    //    This handles the POE2Scout bug where /Realms returns an outdated
    //    default_league_value (e.g. "Fate of the Vaal") while /Leagues correctly
    //    sets IsCurrent=true for the current league ("Runes of Aldur").
    // 2. If NO league has IsCurrent=true (historically the API always returned false),
    //    fall back to matching default_league_value from the /Realms endpoint.
    //
    // Fix 5.4: If defaultLeagueValue is provided by the caller, skip the /Realms request
    const hasAnyIsCurrent = raw.some((l) => l.IsCurrent);

    if (!hasAnyIsCurrent && !defaultLeagueValue) {
      try {
        const realms = await cachedFetch<RawRealm[]>(`${BASE_URL}/Realms`);
        const matchingRealm = realms.find((r) =>
          r.realm_api_id === realm || (realm === "poe2" && r.game_api_id === "poe2")
        );
        if (matchingRealm) {
          defaultLeagueValue = matchingRealm.default_league_value;
        }
      } catch {
        // If realms fetch fails, no fallback for active detection
      }
    }

    const mapped = raw.map((l) => ({
      // CRITICAL: use ShortName (e.g. "vaal") for API URL paths,
      // NOT Value (e.g. "Fate of the Vaal"). The POE2Scout API uses
      // ShortName as the league identifier in all URL paths.
      // Using Value causes ECONNRESET because the API doesn't recognize
      // the full display name as a valid league path segment.
      name: l.ShortName || l.Value,
      displayName: l.Value,
      startAt: null,
      endAt: null,
      // Active league determination:
      // - When any league has IsCurrent=true: use ONLY IsCurrent (default_league_value
      //   from /Realms may be outdated — known POE2Scout bug)
      // - When no league has IsCurrent=true: fall back to defaultLeagueValue matching
      //   Match against BOTH l.Value (displayName) and l.ShortName (name),
      //   because the /Realms API may return default_league_value in either format.
      active: hasAnyIsCurrent
        ? l.IsCurrent
        : (defaultLeagueValue
            ? l.Value === defaultLeagueValue || l.ShortName === defaultLeagueValue
            : false),
      // Pass base currency info from league for reference currency
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
    // Update dynamic fallback with live data
    dynamicLeaguesFallback.set(realm, mapped);
    return mapped;
  } catch (err) {
    // Upstream API unreachable — return dynamic fallback if available, then hardcoded
    const dynamicFallback = dynamicLeaguesFallback.get(realm);
    if (dynamicFallback) {
      console.warn("[poe2api] getLeagues: upstream API unreachable, using last-known-good data for realm=%s.", realm);
      return dynamicFallback;
    }
    console.warn("[poe2api] getLeagues: upstream API unreachable, using hardcoded fallback for realm=%s.", realm, err instanceof Error ? err.message : err);
    return FALLBACK_LEAGUES[realm] || FALLBACK_LEAGUES["poe2"] || [];
  }
}

export async function getExchangeSnapshot(realm: string, league: string): Promise<ExchangeSnapshot> {
  try {
    const raw = await cachedFetch<RawExchangeSnapshot>(
      `${BASE_URL}/${realm}/Leagues/${encodeURIComponent(league)}/ExchangeSnapshot`
    );
    return {
      pairs: [],
      referenceCurrency: raw.BaseCurrencyApiId,
      timestamp: new Date(Number(raw.Epoch) * 1000).toISOString(),
      volume: Number(raw.Volume) || 0,
      marketCap: Number(raw.MarketCap) || 0,
    };
  } catch (err) {
    console.warn("[poe2api] getExchangeSnapshot: upstream unreachable, returning empty.", err instanceof Error ? err.message : err);
    return { pairs: [], referenceCurrency: "exalted", timestamp: new Date().toISOString(), volume: 0, marketCap: 0 };
  }
}

const FALLBACK_REFERENCE_CURRENCIES: ReferenceCurrency[] = [
  { apiId: "exalted", text: "Exalted Orb", iconUrl: null, relativePrice: 1 },
  { apiId: "divine", text: "Divine Orb", iconUrl: null, relativePrice: 0 },
  { apiId: "chaos", text: "Chaos Orb", iconUrl: null, relativePrice: 0 },
];

export async function getReferenceCurrencies(realm: string, league: string): Promise<ReferenceCurrency[]> {
  try {
    const raw = await cachedFetch<RawReferenceCurrency[]>(
      `${BASE_URL}/${realm}/Leagues/${encodeURIComponent(league)}/ReferenceCurrencies`
    );
    return raw.map((c) => ({
      apiId: c.ApiId,
      text: c.Text,
      iconUrl: c.IconUrl,
      relativePrice: c.RelativePrice,
    }));
  } catch (err) {
    console.warn("[poe2api] getReferenceCurrencies: upstream unreachable, returning fallback.", err instanceof Error ? err.message : err);
    return FALLBACK_REFERENCE_CURRENCIES;
  }
}

export async function getSnapshotHistory(realm: string, league: string, limit = 24): Promise<SnapshotHistoryPoint[]> {
  try {
    const raw = await cachedFetch<RawSnapshotHistoryResponse>(
      `${BASE_URL}/${realm}/Leagues/${encodeURIComponent(league)}/SnapshotHistory?Limit=${limit}`
    );
    return raw.Data.map((d) => ({
      timestamp: new Date(d.Epoch * 1000).toISOString(),
      totalVolume: Number(d.Volume),            // MEDIUM-7: ensure number (API sometimes returns strings)
      totalMarketCap: Number(d.MarketCap),      // MEDIUM-7: ensure number (API sometimes returns strings)
      itemCount: 0,
    }));
  } catch (err) {
    console.warn("[poe2api] getSnapshotHistory: upstream unreachable, returning empty.", err instanceof Error ? err.message : err);
    return [];
  }
}

// ============================================================================
// Fix 5: Enrich ExchangePair with change data
// ============================================================================
//
// Variant B (implemented): Use ByCategory → PriceLogs to compute 24h change
// for ALL exchange pairs, not just top-N.
//
// The ByCategory endpoint returns PriceLogs (7 daily entries) for each
// currency item. Since each currency's price is relative to the base currency
// (e.g., Exalted), we can compute the pair's change from the individual
// currency changes:
//   pair_rate = currency1_price_in_base
//   pair_changePercent ≈ currency1_changePercent (for pairs against base)
//   For cross-pairs: pair_change = computed from both currencies' price changes
//
// This replaces the previous Variant A (top-50 per-pair history enrichment).
// The per-pair history is still fetched lazily on hover (PairHoverPreview)
// and in PairDetailDialog.

// --- Change map cache (TTL ~5 min) ---
// buildCurrencyChangeMap() fetches ~20 API requests (all categories).
// Caching the result avoids hammering the upstream on every exchange page load.
const changeMapCache = new Map<string, { data: Map<string, CurrencyChangeEntry>; ts: number }>();
const CHANGE_MAP_TTL = 5 * 60_000; // 5 minutes
const CHANGE_MAP_STALE_TTL = 20 * 60_000; // 20 minutes — entries older than this are stale

/** Periodic cleanup of stale changeMapCache entries (mirrors main cache cleanup pattern). */
function cleanupStaleChangeMapEntries(): void {
  const now = Date.now();
  for (const [key, entry] of changeMapCache) {
    if (now - entry.ts > CHANGE_MAP_STALE_TTL) {
      changeMapCache.delete(key);
    }
  }
}
let changeMapWriteCounter = 0;

interface CurrencyChangeEntry {
  /** 24h change percent computed from PriceLogs */
  changePercent: number | null;
  /** Absolute price change in 24h */
  change: number | null;
  /** Current price in base currency */
  currentPrice: number | null;
  /** Price ~24h ago in base currency */
  previousPrice: number | null;
  /** 7d change percent computed from PriceLogs */
  sevenDayChangePercent: number | null;
  /** Absolute price change over 7 days */
  sevenDayChange: number | null;
  /** Price ~7d ago in base currency */
  previous7dPrice: number | null;
}

/**
 * Build a map of currency ApiId → change data from ByCategory PriceLogs.
 *
 * Fetches ALL currency categories (currency, verisium, runes, essences, etc.)
 * and computes 24h change from PriceLogs for each item.
 * Returns a Map keyed by ApiId.
 */
async function buildCurrencyChangeMap(
  realm: string,
  league: string,
): Promise<Map<string, CurrencyChangeEntry>> {
  // Check TTL cache first — avoid ~20 API requests on every call
  const cacheKey = `${realm}:${league}`;
  const cached = changeMapCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CHANGE_MAP_TTL) {
    return cached.data;
  }

  const changeMap = new Map<string, CurrencyChangeEntry>();

  try {
    // Fetch all currency categories to discover available categories
    const categoriesRaw = await cachedFetch<RawCategoriesResponse>(
      `${BASE_URL}/${realm}/Leagues/${encodeURIComponent(league)}/Items/Categories`
    );
    const currencyCats = categoriesRaw.CurrencyCategories ?? [];

    // Fetch each category's items (with PriceLogs) using concurrency limit
    const categoryTasks: (() => Promise<void>)[] = [];
    for (const cat of currencyCats) {
      categoryTasks.push(async () => {
        try {
          const params = new URLSearchParams({
            Category: cat.ApiId,
            Page: "1",
            PerPage: "250",
          });
          const raw = await cachedFetch<RawPaginatedResponse<RawCurrencyItem>>(
            `${BASE_URL}/${realm}/Leagues/${encodeURIComponent(league)}/Currencies/ByCategory?${params}`
          );

          // Process items from page 1
          for (const item of raw.Items ?? []) {
            if (!item.ApiId) continue;
            const changePercent = computeChangePercent(item.PriceLogs);
            const currentPrice = item.CurrentPrice;
            const previousPrice = computePreviousPrice(item.PriceLogs);
            const change: number | null =
              currentPrice !== null && previousPrice !== null
                ? currentPrice - previousPrice
                : null;
            const sevenDayChangePercent = compute7dChangePercent(item.PriceLogs);
            const previous7dPrice = computePrevious7dPrice(item.PriceLogs);
            const sevenDayChange: number | null =
              currentPrice !== null && previous7dPrice !== null
                ? currentPrice - previous7dPrice
                : null;
            changeMap.set(item.ApiId, { changePercent, change, currentPrice, previousPrice, sevenDayChangePercent, sevenDayChange, previous7dPrice });
          }

          // Fetch remaining pages if there are more
          if (raw.Pages > 1) {
            const extraFetches: Promise<RawPaginatedResponse<RawCurrencyItem> | null>[] = [];
            for (let p = 2; p <= raw.Pages; p++) {
              const pParams = new URLSearchParams({
                Category: cat.ApiId,
                Page: String(p),
                PerPage: "250",
              });
              extraFetches.push(
                cachedFetch<RawPaginatedResponse<RawCurrencyItem>>(
                  `${BASE_URL}/${realm}/Leagues/${encodeURIComponent(league)}/Currencies/ByCategory?${pParams}`
                ).catch(() => null)
              );
            }
            const extraPages = await Promise.all(extraFetches);
            for (const ep of extraPages) {
              if (!ep) continue;
              for (const item of ep.Items ?? []) {
                if (!item.ApiId) continue;
                const changePercent = computeChangePercent(item.PriceLogs);
                const currentPrice = item.CurrentPrice;
                const previousPrice = computePreviousPrice(item.PriceLogs);
                const change: number | null =
                  currentPrice !== null && previousPrice !== null
                    ? currentPrice - previousPrice
                    : null;
                const sevenDayChangePercent = compute7dChangePercent(item.PriceLogs);
                const previous7dPrice = computePrevious7dPrice(item.PriceLogs);
                const sevenDayChange: number | null =
                  currentPrice !== null && previous7dPrice !== null
                    ? currentPrice - previous7dPrice
                    : null;
                changeMap.set(item.ApiId, { changePercent, change, currentPrice, previousPrice, sevenDayChangePercent, sevenDayChange, previous7dPrice });
              }
            }
          }
        } catch {
          // Non-critical — skip this category
        }
      });
    }

    await withConcurrencyLimit(categoryTasks, 3, 200);
  } catch (err) {
    console.warn("[poe2api] buildCurrencyChangeMap: failed to fetch categories.", err instanceof Error ? err.message : err);
  }

  // Store in TTL cache for subsequent calls
  if (changeMap.size > 0) {
    changeMapCache.set(cacheKey, { data: changeMap, ts: Date.now() });
    // Periodic stale entry cleanup (every 3 writes)
    changeMapWriteCounter++;
    if (changeMapWriteCounter % 3 === 0) {
      cleanupStaleChangeMapEntries();
    }
  }

  return changeMap;
}

/**
 * Fetch exchange snapshot pairs.
 *
 * @param snapshot If true, return pairs WITHOUT per-pair history enrichment
 *                 (fast initial load). Change data is still populated from
 *                 ByCategory PriceLogs for ALL pairs (Variant B).
 *                 If false (default), also enrich top pairs with full history
 *                 data for sparkline charts.
 */
export async function getSnapshotPairs(realm: string, league: string, snapshot = false): Promise<ExchangePair[]> {
  let raw: RawSnapshotPair[];
  try {
    raw = await cachedFetch<RawSnapshotPair[]>(
      `${BASE_URL}/${realm}/Leagues/${encodeURIComponent(league)}/SnapshotPairs`
    );
  } catch (err) {
    console.warn("[poe2api] getSnapshotPairs: upstream unreachable, returning empty.", err instanceof Error ? err.message : err);
    return [];
  }
  const pairs = raw.map(mapSnapshotPair);

  // ── Variant B: Enrich ALL pairs with change data from ByCategory PriceLogs ──
  // This gives every pair changePercent/change, not just the top-N.
  // The PriceLogs contain 7 daily entries, sufficient for 24h change computation.
  try {
    const changeMap = await buildCurrencyChangeMap(realm, league);

    // Extract the base currency ApiId from raw pairs (all pairs in a league
    // share the same base currency, e.g. "exalted"). Used to determine
    // whether to apply cross-pair or direct change calculation.
    const baseCurrencyApiId = raw.length > 0 ? raw[0].BaseCurrencyApiId : null;

    for (const pair of pairs) {
      // The pair's displayed rate is CurrencyOneData.RelativePrice which is
      // the price of CurrencyOne in base currency (e.g., Exalted).
      const entry1 = changeMap.get(pair.currency1Id);
      const entry2 = changeMap.get(pair.currency2Id);

      // Determine if currency2 IS the base currency (e.g. pair = "Chaos/Exalted").
      // In this case the pair rate equals currency1's price in base currency
      // directly, so we should use entry1.changePercent — NOT the cross-pair
      // formula which divides by entry2's price (≈1.0 but may drift due to
      // PriceLog computation, producing slightly wrong results).
      const isCurrency2Base = baseCurrencyApiId !== null && pair.currency2Id === baseCurrencyApiId;

      // FIX: Determine if currency1 IS the base currency (e.g. pair = "Exalted/Chaos").
      // This is an inverse pair: the displayed rate is 1/curr2_price_in_base.
      // If curr2 went up, the inverse rate went down, so changePercent ≈ -entry2.changePercent.
      const isCurrency1Base = baseCurrencyApiId !== null && pair.currency1Id === baseCurrencyApiId;

      if (isCurrency1Base && entry2) {
        // ── Inverse pair (currency1 is the base, e.g. "Exalted/Chaos") ──
        // The pair rate = 1 / curr2_price_in_base, so:
        //   rateNow  = 1 / curr2Now
        //   ratePrev = 1 / curr2Prev
        //   changePercent = (rateNow - ratePrev) / ratePrev * 100
        //                 = ((1/curr2Now - 1/curr2Prev) / (1/curr2Prev)) * 100
        //                 = ((curr2Prev - curr2Now) / curr2Now) * 100
        //                 ≈ -entry2.changePercent (for small changes)
        //
        // For better accuracy we compute the exact inverse rate change:
        const curr2Now = entry2.currentPrice;
        const curr2Prev = entry2.previousPrice;

        // 24h inverse pair change
        if (
          pair.changePercent === null &&
          curr2Now !== null && curr2Now > 0 &&
          curr2Prev !== null && curr2Prev > 0
        ) {
          const rateNow = 1 / curr2Now;
          const ratePrev = 1 / curr2Prev;
          pair.changePercent = ((rateNow - ratePrev) / ratePrev) * 100;
          pair.change = rateNow - ratePrev;
        }

        // 7d inverse pair change
        const curr2Prev7d = entry2.previous7dPrice;
        if (
          pair.sevenDayChangePercent === null &&
          curr2Now !== null && curr2Now > 0 &&
          curr2Prev7d !== null && curr2Prev7d > 0
        ) {
          const rateNow = 1 / curr2Now;
          const ratePrev7d = 1 / curr2Prev7d;
          pair.sevenDayChangePercent = ((rateNow - ratePrev7d) / ratePrev7d) * 100;
          pair.sevenDayChange = rateNow - ratePrev7d;
        }
      } else if (entry1 && entry2 && !isCurrency2Base) {
        // ── True cross-pair (neither currency is the base) ──
        //   pair_rate = curr1_price_in_base / curr2_price_in_base
        //   pair_changePercent = (rate_now - rate_prev) / rate_prev * 100
        //   where rate_now = curr1_current / curr2_current
        //         rate_prev = curr1_previous / curr2_previous
        const curr1Now = entry1.currentPrice;
        const curr1Prev = entry1.previousPrice;
        const curr2Now = entry2.currentPrice;
        const curr2Prev = entry2.previousPrice;

        // 24h cross-pair change
        if (
          pair.changePercent === null &&
          curr1Now !== null && curr1Now > 0 &&
          curr2Now !== null && curr2Now > 0 &&
          curr1Prev !== null && curr1Prev > 0 &&
          curr2Prev !== null && curr2Prev > 0
        ) {
          const rateNow = curr1Now / curr2Now;
          const ratePrev = curr1Prev / curr2Prev;
          pair.changePercent = ((rateNow - ratePrev) / ratePrev) * 100;
          pair.change = rateNow - ratePrev;
        }

        // 7d cross-pair change
        const curr1Prev7d = entry1.previous7dPrice;
        const curr2Prev7d = entry2.previous7dPrice;
        if (
          pair.sevenDayChangePercent === null &&
          curr1Now !== null && curr1Now > 0 &&
          curr2Now !== null && curr2Now > 0 &&
          curr1Prev7d !== null && curr1Prev7d > 0 &&
          curr2Prev7d !== null && curr2Prev7d > 0
        ) {
          const rateNow = curr1Now / curr2Now;
          const ratePrev7d = curr1Prev7d / curr2Prev7d;
          pair.sevenDayChangePercent = ((rateNow - ratePrev7d) / ratePrev7d) * 100;
          pair.sevenDayChange = rateNow - ratePrev7d;
        }
      } else if (entry1) {
        // ── Simple pair against base currency (currency2 is the base, or
        //    entry2 is missing) — use currency1's change directly. ──
        if (pair.changePercent === null && entry1.changePercent !== null) {
          pair.changePercent = entry1.changePercent;
        }
        if (pair.change === null && entry1.change !== null) {
          pair.change = entry1.change;
        }
        // 7d direct change
        if (pair.sevenDayChangePercent === null && entry1.sevenDayChangePercent !== null) {
          pair.sevenDayChangePercent = entry1.sevenDayChangePercent;
        }
        if (pair.sevenDayChange === null && entry1.sevenDayChange !== null) {
          pair.sevenDayChange = entry1.sevenDayChange;
        }
      } else if (entry2 && !isCurrency2Base) {
        // ── Only entry2 exists and it's NOT the base currency. ──
        // The pair rate = curr1_price / curr2_price, but we only have curr2 data.
        // We can infer inverse change: if curr2 went up, the pair rate went down.
        // changePercent ≈ -entry2.changePercent (approximation for small changes)
        if (pair.changePercent === null && entry2.changePercent !== null) {
          pair.changePercent = -entry2.changePercent;
        }
        // 7d inverse approximation
        if (pair.sevenDayChangePercent === null && entry2.sevenDayChangePercent !== null) {
          pair.sevenDayChangePercent = -entry2.sevenDayChangePercent;
        }
      }
    }

    console.info(`[poe2api] Enriched ${pairs.filter(p => p.changePercent !== null).length}/${pairs.length} pairs with 24h change, ${pairs.filter(p => p.sevenDayChangePercent !== null).length} with 7d change from PriceLogs`);
  } catch (err) {
    console.warn("[poe2api] buildCurrencyChangeMap failed, pairs will have no change data.", err instanceof Error ? err.message : err);
  }

  // Snapshot mode: skip per-pair history enrichment for fast initial load
  if (snapshot) return pairs;

  // Additionally enrich top-N pairs by volume with FULL history data
  // (hourly data points for sparkline charts). This is more detailed than
  // the daily PriceLogs change data above.
  //
  // OPTIMIZATION: Cache per-pair history results so that subsequent calls
  // within the TTL don't re-fetch from upstream. The CurrencyPairHistory
  // endpoint is the slowest part of the enrichment (20 sequential API calls).
  const TOP_N = 20;
  const topPairs = pairs
    .filter(p => p.volume > 0)
    .sort((a, b) => b.volume - a.volume)
    .slice(0, TOP_N);

  if (topPairs.length === 0) return pairs;

  // Fetch history for top pairs with increased parallelism (8 concurrent)
  // and per-pair caching via getCurrencyPairHistory (which uses cachedFetch).
  // The cachedFetch layer already handles TTL, dedup, and stale-while-revalidate,
  // so repeated calls for the same pair are essentially free.
  const TOP_N_CONCURRENCY = 8;
  await withConcurrencyLimit(
    topPairs.map((pair) => async () => {
      try {
        // Use numeric ItemIds — the CurrencyPairHistory API expects integers
        const history = await getCurrencyPairHistory(realm, league, pair.currency1ItemId, pair.currency2ItemId, 168);
        if (history.length >= 2) {
          pair.history = history;
          const oldest = history[0];
          const newest = history[history.length - 1];
          if (oldest.relativePrice > 0) {
            // Per-pair history is more accurate than PriceLogs for this pair
            pair.changePercent = ((newest.relativePrice - oldest.relativePrice) / oldest.relativePrice) * 100;
            pair.change = newest.relativePrice - oldest.relativePrice;
          }
        }
      } catch {
        // Non-critical enrichment — ignore failures
      }
    }),
    TOP_N_CONCURRENCY,
    100, // reduced delay: 100ms between batch requests
  );

  return pairs;
}

// --- Items ---
export async function getItems(realm: string, league: string): Promise<PoeItem[]> {
  try {
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
    chaosEquivalentRate: item.CurrentPrice,
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
  } catch (err) {
    console.warn("[poe2api] getItems: upstream unreachable, returning empty.", err instanceof Error ? err.message : err);
    return [];
  }
}

const FALLBACK_CATEGORIES: ItemCategory[] = [
  { name: "all", displayName: "All", count: 0 },
];

export async function getItemCategories(realm: string, league: string): Promise<ItemCategory[]> {
  try {
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
  } catch (err) {
    console.warn("[poe2api] getItemCategories: upstream unreachable, returning fallback.", err instanceof Error ? err.message : err);
    return FALLBACK_CATEGORIES;
  }
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
    chaosEquivalentRate: raw.CurrentPrice,
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

// ItemHistory API returns {PriceHistory: [...], HasMore}
// Fix 1: use maxRetries: 1 for history endpoints — non-critical, fail fast
export async function getItemHistory(realm: string, league: string, itemId: string, logCount = 168, referenceCurrency?: string): Promise<PoeItemHistoryPoint[]> {
  try {
    // API requires LogCount to be a multiple of 4, otherwise returns 400
    const safeLogCount = Math.max(4, Math.ceil(logCount / 4) * 4);
    let url = `${BASE_URL}/${realm}/Leagues/${encodeURIComponent(league)}/Items/${itemId}/History?LogCount=${safeLogCount}`;
    if (referenceCurrency) url += `&ReferenceCurrency=${encodeURIComponent(referenceCurrency)}`;
    const raw = await cachedFetch<RawItemHistoryResponse>(url, { maxRetries: 1 });
    return (raw.PriceHistory ?? []).map((p) => ({
      timestamp: p.Time,
      price: p.Price,
      chaosEquivalentRate: p.Price,
      relativePrice: p.Price,
      volume: p.Quantity,
    }));
  } catch (err) {
    console.warn("[poe2api] getItemHistory: upstream unreachable, returning empty.", err instanceof Error ? err.message : err);
    return [];
  }
}

// DailyStatsHistory API returns {DailyStats: [...], HasMore}
export async function getItemDailyStats(realm: string, league: string, itemId: string, dayCount = 30, referenceCurrency?: string): Promise<DailyStat[]> {
  try {
    let url = `${BASE_URL}/${realm}/Leagues/${encodeURIComponent(league)}/Items/${itemId}/DailyStatsHistory?DayCount=${dayCount}`;
    if (referenceCurrency) url += `&ReferenceCurrency=${encodeURIComponent(referenceCurrency)}`;
    const raw = await cachedFetch<RawDailyStatsHistoryResponse>(url, { maxRetries: 1 });
    return (raw.DailyStats ?? []).map((d) => ({
      day: d.Time,
      open: d.Open,
      high: d.High,
      low: d.Low,
      close: d.Close,
      volume: d.Volume,
    }));
  } catch (err) {
    console.warn("[poe2api] getItemDailyStats: upstream unreachable, returning empty.", err instanceof Error ? err.message : err);
    return [];
  }
}

// ============================================================================
// P3-2: Multi-timeframe OHLCV aggregation from hourly price history
//
// The POE2Scout API provides hourly price history via /Items/{ItemId}/History.
// This function fetches that data and aggregates it into OHLCV candles for
// 1H (raw), 4H (4 candles → 1), and 1W (~168 candles → 1) timeframes.
//
// For 1D candles, use getItemDailyStats() which returns official daily OHLCV
// from the DailyStatsHistory endpoint — it's more accurate than aggregating
// hourly data.
// ============================================================================

/** Aggregate hourly price history points into OHLCV candles for a given timeframe */
export async function getMultiTimeframeOHLCV(
  realm: string,
  league: string,
  itemId: string,
  timeframe: "1H" | "4H" | "1W",
  referenceCurrency?: string,
  logCount?: number,
): Promise<OHLCVCandle[]> {
  try {
    // Determine how many hours to fetch based on timeframe (unless overridden by logCount param)
    // 1H: fetch 168 hours (7 days), 4H: fetch 720 hours (30 days), 1W: fetch 2160 hours (90 days)
    const defaultHourCounts: Record<string, number> = { "1H": 168, "4H": 720, "1W": 2160 };
    const effectiveLogCount = logCount ?? defaultHourCounts[timeframe] ?? 720;

    // Fetch hourly price history
    const history = await getItemHistory(realm, league, itemId, effectiveLogCount, referenceCurrency);
    if (!history || history.length === 0) return [];

    // Sort chronologically (oldest first)
    const sorted = sortByTimestampAsc(history);

    // For 1H, each point IS a candle
    if (timeframe === "1H") {
      return sorted.map((p) => ({
        time: p.timestamp,
        open: p.price,
        high: p.price,
        low: p.price,
        close: p.price,
        volume: p.volume,
      }));
    }

    // Group points into candles
    const groupSize = timeframe === "4H" ? 4 : 168; // 4H = 4 hourly points, 1W = ~168
    const candles: OHLCVCandle[] = [];

    for (let i = 0; i < sorted.length; i += groupSize) {
      const group = sorted.slice(i, i + groupSize);
      if (group.length === 0) continue;

      const prices = group.map((p) => p.price).filter((p) => p > 0);
      if (prices.length === 0) continue;

      candles.push({
        time: group[0].timestamp,
        open: prices[0],
        high: Math.max(...prices),
        low: Math.min(...prices),
        close: prices[prices.length - 1],
        volume: group.reduce((sum, p) => sum + (p.volume || 0), 0),
      });
    }

    return candles;
  } catch (err) {
    console.warn("[poe2api] getMultiTimeframeOHLCV: failed, returning empty.", err instanceof Error ? err.message : err);
    return [];
  }
}

// --- Uniques (paginated) ---
// Category=all returns EMPTY results from the API.
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

  // When category is "all", fetch all categories and merge
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
    items: (raw.Items ?? []).map((item) => mapUniqueItem(item)),
    page: raw.CurrentPage,
    perPage: perPage,
    totalItems: raw.Total,
    totalPages: raw.Pages,
  };
}

/**
 * Fetch uniques across ALL categories since Category=all returns empty.
 * Fetches ALL pages of each category, then merges and paginates client-side.
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

  // Fetch ALL pages of each unique category with concurrency limiting (MEDIUM-3).
  // Previously only page 1 was fetched, causing data loss when a category
  // contained >perPage items.  Now we fetch page 1, check Pages count,
  // and fetch remaining pages concurrently.
  const allCategoryTasks = uniqueCats.map((cat) => async () => {
    const pages: RawPaginatedResponse<RawUniqueItem>[] = [];

    // Fetch page 1 first to discover total page count
    const params1 = new URLSearchParams({
      Category: cat.ApiId,
      Page: "1",
      PerPage: "250",
    });
    if (search) params1.set("Search", search);
    if (referenceCurrency) params1.set("ReferenceCurrency", referenceCurrency);

    const page1 = await cachedFetch<RawPaginatedResponse<RawUniqueItem>>(
      `${BASE_URL}/${realm}/Leagues/${encodeURIComponent(league)}/Uniques/ByCategory?${params1}`
    ).catch(() => null);

    if (!page1) return [];
    pages.push(page1);

    // Fetch remaining pages if there are more
    if (page1.Pages > 1) {
      const extraFetches: Promise<RawPaginatedResponse<RawUniqueItem> | null>[] = [];
      for (let p = 2; p <= page1.Pages; p++) {
        const params = new URLSearchParams({
          Category: cat.ApiId,
          Page: String(p),
          PerPage: "250",
        });
        if (search) params.set("Search", search);
        if (referenceCurrency) params.set("ReferenceCurrency", referenceCurrency);

        extraFetches.push(
          cachedFetch<RawPaginatedResponse<RawUniqueItem>>(
            `${BASE_URL}/${realm}/Leagues/${encodeURIComponent(league)}/Uniques/ByCategory?${params}`
          ).catch(() => null)
        );
      }
      const extraPages = await Promise.all(extraFetches);
      for (const ep of extraPages) {
        if (ep) pages.push(ep);
      }
    }

    return pages;
  });

  const allPages = await withConcurrencyLimit(
    allCategoryTasks,
    3,   // max 3 concurrent category requests
    200, // 200ms delay between requests
  );

  // Merge all items
  const allItems: PoeItem[] = [];

  for (const pages of allPages) {
    for (const result of pages) {
      allItems.push(...(result.Items ?? []).map((item) => mapUniqueItem(item)));
    }
  }

  // Sort by price descending (most expensive first)
  sortPoeItemsByPriceDesc(allItems);

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
// Category=all returns EMPTY results from the API.
// When category is "all", we fetch ALL currency categories and merge results.
export async function getCurrenciesByCategory(
  realm: string,
  league: string,
  category = "all",
  page = 1,
  perPage = 50,
  referenceCurrency?: string
): Promise<PaginatedResponse<PoeItem>> {

  // When category is "all", fetch all categories and merge
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
    items: (raw.Items ?? []).map((item) => mapCurrencyItem(item)),
    page: raw.CurrentPage,
    perPage: perPage,
    totalItems: raw.Total,
    totalPages: raw.Pages,
  };
}

/**
 * Fetch currencies across ALL categories since Category=all returns empty.
 * Fetches ALL pages of each category, then merges and paginates client-side.
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

  // Fetch ALL pages of each currency category with concurrency limiting (MEDIUM-3).
  // Previously only page 1 was fetched, causing data loss when a category
  // contained >perPage items.  Now we fetch page 1, check Pages count,
  // and fetch remaining pages concurrently.
  const allCategoryTasks = currencyCats.map((cat) => async () => {
    const pages: RawPaginatedResponse<RawCurrencyItem>[] = [];

    // Fetch page 1 first to discover total page count
    const params1 = new URLSearchParams({
      Category: cat.ApiId,
      Page: "1",
      PerPage: "250",
    });
    if (referenceCurrency) params1.set("ReferenceCurrency", referenceCurrency);

    const page1 = await cachedFetch<RawPaginatedResponse<RawCurrencyItem>>(
      `${BASE_URL}/${realm}/Leagues/${encodeURIComponent(league)}/Currencies/ByCategory?${params1}`
    ).catch(() => null);

    if (!page1) return [];
    pages.push(page1);

    // Fetch remaining pages if there are more
    if (page1.Pages > 1) {
      const extraFetches: Promise<RawPaginatedResponse<RawCurrencyItem> | null>[] = [];
      for (let p = 2; p <= page1.Pages; p++) {
        const params = new URLSearchParams({
          Category: cat.ApiId,
          Page: String(p),
          PerPage: "250",
        });
        if (referenceCurrency) params.set("ReferenceCurrency", referenceCurrency);

        extraFetches.push(
          cachedFetch<RawPaginatedResponse<RawCurrencyItem>>(
            `${BASE_URL}/${realm}/Leagues/${encodeURIComponent(league)}/Currencies/ByCategory?${params}`
          ).catch(() => null)
        );
      }
      const extraPages = await Promise.all(extraFetches);
      for (const ep of extraPages) {
        if (ep) pages.push(ep);
      }
    }

    return pages;
  });

  const allPages = await withConcurrencyLimit(
    allCategoryTasks,
    3,   // max 3 concurrent category requests
    200, // 200ms delay between requests
  );

  // Merge all items
  const allItems: PoeItem[] = [];

  for (const pages of allPages) {
    for (const result of pages) {
      allItems.push(...(result.Items ?? []).map((item) => mapCurrencyItem(item)));
    }
  }

  // Sort by price descending
  sortPoeItemsByPriceDesc(allItems);

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

// CurrencyPairHistory returns nested {history, meta} structure
// Fix 1: use maxRetries: 1 for history endpoints — non-critical, fail fast
export async function getCurrencyPairHistory(
  realm: string,
  league: string,
  id1: string | number,
  id2: string | number,
  limit = 168
): Promise<ExchangePairHistoryPoint[]> {
  // The POE2Scout CurrencyPairHistory API expects INTEGER ItemIds in the URL
  // path (/Currencies/Pairs/{ItemId1}/{ItemId2}/History), NOT string ApiIds.
  // If string ApiIds are passed (e.g. "divine"), the API returns 422.
  // We accept both string (ApiId) and number (ItemId) for backward compatibility,
  // but callers should prefer passing numeric ItemIds from ExchangePair.currency1ItemId.
  const raw = await cachedFetch<RawCurrencyPairHistoryResponse>(
    `${BASE_URL}/${realm}/Leagues/${encodeURIComponent(league)}/Currencies/Pairs/${id1}/${id2}/History?Limit=${limit}`,
    { maxRetries: 1 }
  );

  return (raw.History ?? []).map((point) => {
    // Compute the true pair RelativePrice: price of currency1 in terms of currency2.
    // CurrencyOneData.RelativePrice is in base currency (Exalted).
    // CurrencyTwoData.RelativePrice is also in base currency.
    // Pair price = CurrencyOneData.RelativePrice / CurrencyTwoData.RelativePrice
    const c1RelPrice = safeParseFloat(point.Data?.CurrencyOneData?.RelativePrice);
    const c2RelPrice = safeParseFloat(point.Data?.CurrencyTwoData?.RelativePrice);
    const pairRelPrice =
      c1RelPrice !== null && c2RelPrice !== null && c2RelPrice !== 0
        ? c1RelPrice / c2RelPrice
        : (c1RelPrice ?? 0);

    return {
      timestamp: new Date(point.Epoch * 1000).toISOString(),
      relativePrice: pairRelPrice,
      volume: point.Data?.CurrencyOneData?.VolumeTraded ?? 0,
    };
  });
}

// ============================================================================
// Pair OHLCV — multi-timeframe OHLCV aggregated from CurrencyPairHistory.
//
// Unlike getMultiTimeframeOHLCV which uses single-item history (only
// currency1ItemId), this function uses the CurrencyPairHistory endpoint
// which includes BOTH ItemIds, producing the true RelativePrice of the pair
// (price of currency1 expressed in currency2) rather than the absolute
// price of currency1 in the base currency.
//
// This is the correct data source for the PairDetailDialog candlestick chart.
// ============================================================================

/**
 * Aggregate pair hourly history into OHLCV candles for a given timeframe.
 * Uses CurrencyPairHistory which computes the true pair RelativePrice
 * (currency1 in terms of currency2) from both CurrencyOneData and
 * CurrencyTwoData returned by the API.
 */
export async function getPairMultiTimeframeOHLCV(
  realm: string,
  league: string,
  id1: string | number,
  id2: string | number,
  timeframe: "1H" | "4H" | "1W",
  logCount?: number,
): Promise<OHLCVCandle[]> {
  try {
    // Determine how many hours to fetch based on timeframe (unless overridden)
    const defaultHourCounts: Record<string, number> = { "1H": 168, "4H": 720, "1W": 2160 };
    const hoursToFetch = logCount ?? defaultHourCounts[timeframe] ?? 720;

    // Fetch pair hourly history — uses both ItemIds for true pair RelativePrice
    const history = await getCurrencyPairHistory(realm, league, id1, id2, hoursToFetch);
    if (!history || history.length === 0) return [];

    // Sort chronologically (oldest first)
    const sorted = sortByTimestampAsc(history);

    // For 1H, each point IS a candle
    if (timeframe === "1H") {
      return sorted.map((p) => ({
        time: p.timestamp,
        open: p.relativePrice,
        high: p.relativePrice,
        low: p.relativePrice,
        close: p.relativePrice,
        volume: p.volume,
      }));
    }

    // Group points into candles
    const groupSize = timeframe === "4H" ? 4 : 168; // 4H = 4 hourly points, 1W = ~168
    const candles: OHLCVCandle[] = [];

    for (let i = 0; i < sorted.length; i += groupSize) {
      const group = sorted.slice(i, i + groupSize);
      if (group.length === 0) continue;

      const prices = group.map((p) => p.relativePrice).filter((p) => p > 0 && Number.isFinite(p));
      if (prices.length === 0) continue;

      candles.push({
        time: group[0].timestamp,
        open: prices[0],
        high: Math.max(...prices),
        low: Math.min(...prices),
        close: prices[prices.length - 1],
        volume: group.reduce((sum, p) => sum + (p.volume || 0), 0),
      });
    }

    return candles;
  } catch (err) {
    console.warn("[poe2api] getPairMultiTimeframeOHLCV: failed, returning empty.", err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * Get daily OHLCV stats for a currency PAIR.
 * Fetches DailyStatsHistory for BOTH currencies and computes the pair price
 * (currency1 / currency2) for each day.
 *
 * Since the DailyStatsHistory API only supports a single itemId, we fetch
 * daily stats for both currencies and compute the pair price as:
 *   pairClose = c1Close / c2Close (when c2Close > 0)
 * This gives a daily-resolution OHLCV of the pair's RelativePrice.
 */
export async function getPairDailyStats(
  realm: string,
  league: string,
  itemId1: string | number,
  itemId2: string | number,
  dayCount = 60,
): Promise<Array<{ day: string; open: number; high: number; low: number; close: number; volume: number }>> {
  try {
    const [stats1, stats2] = await Promise.all([
      getItemDailyStats(realm, league, String(itemId1), dayCount),
      getItemDailyStats(realm, league, String(itemId2), dayCount),
    ]);

    if (!stats1.length || !stats2.length) return [];

    // Build a map of day -> c2 close for efficient lookup
    const c2ByDay = new Map<string, { open: number; high: number; low: number; close: number; volume: number }>();
    for (const d of stats2) {
      const dayKey = d.day?.slice(0, 10) ?? "";
      if (dayKey) c2ByDay.set(dayKey, { open: d.open, high: d.high, low: d.low, close: d.close, volume: d.volume });
    }

    // Compute pair OHLCV by dividing c1 by c2 for each matching day
    const result: Array<{ day: string; open: number; high: number; low: number; close: number; volume: number }> = [];
    for (const d1 of stats1) {
      const dayKey = d1.day?.slice(0, 10) ?? "";
      if (!dayKey) continue;
      const d2 = c2ByDay.get(dayKey);
      if (!d2 || d2.close <= 0) continue;

      // Pair price = c1 / c2. For OHLC we use close/close as the most
      // reliable ratio, and approximate high/low using close ratios.
      // This is an approximation — true pair high/low would require tick data.
      const openPair = d1.open > 0 && d2.open > 0 ? d1.open / d2.open : d1.close / d2.close;
      const closePair = d1.close / d2.close;
      const highPair = Math.max(d1.high / d2.low, d1.high / d2.high, closePair, openPair);
      const lowPair = Math.min(d1.low / d2.high, d1.low / d2.low, closePair, openPair);

      result.push({
        day: d1.day,
        open: openPair,
        high: highPair,
        low: lowPair,
        close: closePair,
        volume: Math.min(d1.volume, d2.volume), // conservatively use the smaller volume
      });
    }

    return result;
  } catch (err) {
    console.warn("[poe2api] getPairDailyStats: failed, returning empty.", err instanceof Error ? err.message : err);
    return [];
  }
}

/** Check if the circuit breaker is currently open (upstream likely unreachable) */
export function isCircuitBreakerOpen(): boolean {
  if (!circuitBreakerOpen) return false;
  // If cooldown expired, it's not really open anymore
  if (Date.now() - circuitBreakerOpenSince >= CIRCUIT_BREAKER_COOLDOWN) {
    circuitBreakerOpen = false;
    return false;
  }
  return true;
}

// ============================================================================
// Auto-prepopulate cache from snapshot (server-side only)
//
// When the app starts and the POE2Scout API is unreachable (e.g., blocked
// in Russia), the dashboard would show empty data. This block reads a
// pre-built snapshot JSON file at module load time and pre-populates the
// in-memory cache so the dashboard has data to show immediately.
//
// Entries are marked as "stale but usable" so cachedFetch will serve them
// right away while triggering background revalidation when the API becomes
// reachable.
// ============================================================================

if (typeof window === "undefined" && typeof globalThis !== "undefined") {
  try {
    // Use dynamic require to avoid bundling fs in client builds
    const _fs = require("fs") as typeof import("fs");
    const _path = require("path") as typeof import("path");
    const snapshotPath = _path.resolve(__dirname, "../data/cache-snapshot.json");

    if (_fs.existsSync(snapshotPath)) {
      const raw = _fs.readFileSync(snapshotPath, "utf-8");
      const snapshot = JSON.parse(raw) as {
        version: number;
        timestamp: string;
        entries: Record<string, { data: unknown; ts: number }>;
      };

      if (snapshot.version === 1 && snapshot.entries) {
        // Set ts so entries are "stale but usable" — the system will try to
        // revalidate them in the background while serving the snapshot data
        const staleTs = Date.now() - CACHE_STALE_TTL + 60_000;
        let count = 0;
        for (const [url, entry] of Object.entries(snapshot.entries)) {
          prepopulateCacheEntry(url, entry.data, entry.ts ?? staleTs);
          count++;
        }
        if (count > 0) {
          console.info(
            `[poe2api] Pre-populated cache with ${count} entries from snapshot ` +
            `(timestamp: ${snapshot.timestamp})`
          );
        }
      }
    }
  } catch (err) {
    // Non-critical — if the snapshot can't be read, the app still works;
    // it just won't have pre-populated data
    console.warn(
      "[poe2api] Failed to pre-populate cache from snapshot:",
      err instanceof Error ? err.message : err
    );
  }
}
