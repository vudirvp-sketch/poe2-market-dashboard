// ============================================================================
// API Fetch with Retry + Exponential Backoff + Rate Limiting
// Wraps the base fetchApi with:
//   - Configurable retry count
//   - Exponential backoff (jittered)
//   - Client-side rate-limit guard (min interval between identical requests)
//   - Better error classification (retryable vs. non-retryable)
// ============================================================================

import { fetchApi } from "@/lib/types";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 500; // 0.5s first retry
const DEFAULT_MAX_DELAY_MS = 10_000; // cap at 10s
const DEFAULT_RATE_LIMIT_MS = 2_000; // min 2s between identical requests

// ---------------------------------------------------------------------------
// Rate-limit tracker (in-memory, per URL)
// ---------------------------------------------------------------------------

const lastRequestTime = new Map<string, number>();

function checkRateLimit(url: string, minIntervalMs: number): boolean {
  const now = Date.now();
  const last = lastRequestTime.get(url) ?? 0;
  if (now - last < minIntervalMs) {
    return false; // rate-limited
  }
  lastRequestTime.set(url, now);
  return true; // ok to proceed
}

// ---------------------------------------------------------------------------
// Retryable status codes
// ---------------------------------------------------------------------------

function isRetryableStatus(status: number): boolean {
  // 429 = Too Many Requests, 502/503/504 = server errors
  return status === 429 || status === 502 || status === 503 || status === 504;
}

// ---------------------------------------------------------------------------
// Exponential backoff with jitter
// ---------------------------------------------------------------------------

function getDelay(attempt: number, baseMs: number, maxMs: number): number {
  // Exponential: baseMs * 2^attempt, capped at maxMs
  const delay = Math.min(baseMs * Math.pow(2, attempt), maxMs);
  // Add random jitter ±25%
  const jitter = delay * 0.25 * (Math.random() * 2 - 1);
  return Math.max(100, delay + jitter);
}

// ---------------------------------------------------------------------------
// Fetch with retry (for use in React Query queryFn)
// ---------------------------------------------------------------------------

export interface FetchWithRetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Base delay in ms for exponential backoff (default: 500) */
  baseDelayMs?: number;
  /** Maximum delay cap in ms (default: 10000) */
  maxDelayMs?: number;
  /** Minimum interval between identical requests in ms (default: 2000) */
  rateLimitMs?: number;
}

/**
 * Enhanced fetch with retry, exponential backoff, and client-side rate limiting.
 * Drop-in replacement for `fetchApi` in React Query `queryFn`.
 *
 * @example
 * ```tsx
 * const { data } = useQuery({
 *   queryKey: ["currencies", realm, league],
 *   queryFn: () => fetchWithRetry<PaginatedResponse<PoeItem>>("/api/poe2/currencies", {
 *     realm, league, action: "byCategory"
 *   }),
 * });
 * ```
 */
export async function fetchWithRetry<T>(
  path: string,
  params?: Record<string, string>,
  options?: FetchWithRetryOptions
): Promise<T> {
  const {
    maxRetries = DEFAULT_MAX_RETRIES,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    maxDelayMs = DEFAULT_MAX_DELAY_MS,
    rateLimitMs = DEFAULT_RATE_LIMIT_MS,
  } = options || {};

  // Build a cache key for rate limiting
  const urlKey = `${path}?${new URLSearchParams(params || {}).toString()}`;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Check rate limit on each attempt
    if (!checkRateLimit(urlKey, rateLimitMs) && attempt > 0) {
      // Wait until rate limit window passes
      const waitMs = rateLimitMs - (Date.now() - (lastRequestTime.get(urlKey) ?? 0));
      if (waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
      lastRequestTime.set(urlKey, Date.now());
    }

    try {
      const result = await fetchApi<T>(path, params);
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Parse HTTP status from our fetchApi error format: "API 429: ..."
      const statusMatch = lastError.message.match(/API (\d+):/);
      const status = statusMatch ? parseInt(statusMatch[1], 10) : 0;

      // Don't retry non-retryable errors (4xx except 429)
      if (status > 0 && !isRetryableStatus(status)) {
        throw lastError;
      }

      // Don't retry if we've exhausted attempts
      if (attempt >= maxRetries) {
        throw lastError;
      }

      // Wait before next attempt with exponential backoff
      const delay = getDelay(attempt, baseDelayMs, maxDelayMs);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError || new Error("fetchWithRetry: unexpected state");
}
