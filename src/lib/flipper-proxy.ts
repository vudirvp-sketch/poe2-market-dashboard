// ============================================================================
// Flipper Proxy Utility — Forwards requests to the FastAPI backend
// ============================================================================
//
// All Next.js API routes under src/app/api/flipper/ use this helper
// to proxy requests to the FastAPI backend running on port 8000.
// The backend URL is configurable via the FLIPPER_API_URL env var.
//
// IMPROVEMENTS:
// - Retry with exponential backoff on transient errors (ECONNRESET, timeout)
// - Better error categorization for frontend (offline, timeout, insufficient_data, server_error)
// - Request deduplication for concurrent identical requests
// - CORS proxy fallback: when the backend can't reach poe2scout.com directly
//   (e.g. if the Next.js server and backend are both behind a blocked network),
//   we try through the Cloudflare Worker CORS proxy. The backend itself talks
//   to poe2scout.com — this fallback helps when the backend's own connection
//   to poe2scout.com is blocked.
// - P1-10 (iter 66): Per-endpoint circuit breaker. Previously a single global
//   breaker tripped on any backend failure, blocking ALL endpoints even when
//   only one was broken. Now each API path has its own breaker — a broken
//   /api/v1/portfolio no longer blocks /api/v1/prices.
// ============================================================================

import { NextResponse } from "next/server";
import { transformKeys } from "./case-transform";

export const FLIPPER_API_URL = process.env.FLIPPER_API_URL || "http://localhost:8000";

// CORS Proxy for backend — if the flipper backend also can't reach poe2scout.com
// (same blocked network), it will return degraded/unreachable status. We can't
// proxy through CORS here directly (the backend makes its own API calls), but
// we track the fallback hint so the frontend can inform the user.
export const FLIPPER_CORS_PROXY_URL = process.env.FLIPPER_CORS_PROXY_URL || "";

// Circuit breaker constants (unchanged from pre-P1-10; still exported for tests)
export const FLIPPER_CB_INITIAL_COOLDOWN = 15_000; // 15s — reduced from 60s for faster recovery during backend cold start
export const FLIPPER_CB_MAX_COOLDOWN = 300_000; // P1-2: max 5 minutes
export const FLIPPER_CB_THRESHOLD = 5; // Open after 5 consecutive failures

// --- Exported constants for testing & consumer alignment ---
/** Error type used when the backend is unreachable (connection refused / circuit breaker open) */
export const ERROR_TYPE_OFFLINE = "backend_offline";
/** Error type used when the backend returns 503 (not enough data yet) */
export const ERROR_TYPE_INSUFFICIENT = "backend_insufficient_data";
/** Error type used when the backend returns 422 (unprocessable entity / insufficient data for forecast) */
export const ERROR_TYPE_UNPROCESSABLE = "insufficient_data";
/** Error type used when the backend returns 5xx (but not 503) */
export const ERROR_TYPE_SERVER = "server_error";
/** Error type used when connection is reset */
export const ERROR_TYPE_CONNECTION_RESET = "backend_connection_reset";
/** Error type used when request times out */
export const ERROR_TYPE_TIMEOUT = "backend_timeout";
/** Hint shown to users when the backend is offline */
export const BACKEND_OFFLINE_HINT = "Start the FastAPI backend: uvicorn backend.main:app --reload --port 8000";

// ---------------------------------------------------------------------------
// P1-10 (iter 66): Per-endpoint circuit breaker state
// ---------------------------------------------------------------------------

export type CircuitBreakerState = "closed" | "open" | "half-open";

export interface EndpointCircuitBreaker {
  open: boolean;
  openSince: number;
  cooldownMs: number;
  consecutiveFailures: number;
  state: CircuitBreakerState;
}

/**
 * Normalize an API path for circuit-breaker keying.
 *
 * Groups by major endpoint so e.g. /api/v1/storage_value/divine-orb and
 * /api/v1/storage_value/chaos-orb share the same breaker (they hit the same
 * backend handler and fail together). Query strings are stripped. UUID-like
 * path segments are stripped to their parent.
 *
 * Examples:
 *   /api/v1/prices                  → /api/v1/prices
 *   /api/v1/events/active_only=true → /api/v1/events
 *   /api/v1/storage_value/divine    → /api/v1/storage_value
 *   /api/v1/events/abc-123/deactivate → /api/v1/events/abc-123/deactivate
 *     (last segment "deactivate" is not an ID, so it stays)
 */
function normalizePathForCircuitBreaker(fullUrl: string): string {
  let pathname: string;
  try {
    pathname = new URL(fullUrl, FLIPPER_API_URL).pathname;
  } catch {
    // If URL parsing fails, fall back to the raw string with query stripped
    pathname = fullUrl.split("?")[0];
  }
  // Strip trailing slash for consistency
  if (pathname.length > 1 && pathname.endsWith("/")) {
    pathname = pathname.slice(0, -1);
  }
  // If last segment looks like an ID or slug (UUID, hex hash, or hyphenated
  // slug like "divine-orb"), drop it so /api/v1/storage_value/divine-orb
  // groups with /api/v1/storage_value/chaos-orb.
  //
  // Heuristic: matches if the segment contains a hyphen surrounded by
  // alphanumerics (e.g. "divine-orb", "abc-12345") OR is a pure hex/UUID
  // hash of length ≥ 8 (e.g. "deadbeef1234"). Single-word verbs like
  // "deactivate" or nouns like "prices" do NOT match.
  const parts = pathname.split("/");
  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    const looksLikeId = /^[a-f0-9-]{8,}$/i.test(last) || /^[a-z0-9]+-[a-z0-9-]+$/i.test(last);
    if (looksLikeId) {
      parts.pop();
    }
  }
  return parts.join("/");
}

const endpointCircuitBreakers = new Map<string, EndpointCircuitBreaker>();

/**
 * Get (or lazily create) the circuit breaker for a given request URL.
 * The key is derived from the URL via `normalizePathForCircuitBreaker`.
 */
function getEndpointCircuitBreaker(fullUrl: string): EndpointCircuitBreaker {
  const key = normalizePathForCircuitBreaker(fullUrl);
  let cb = endpointCircuitBreakers.get(key);
  if (!cb) {
    cb = {
      open: false,
      openSince: 0,
      cooldownMs: FLIPPER_CB_INITIAL_COOLDOWN,
      consecutiveFailures: 0,
      state: "closed",
    };
    endpointCircuitBreakers.set(key, cb);
  }
  return cb;
}

/**
 * Inspect a circuit breaker's state by URL. Exported for debugging and tests.
 * Returns a snapshot copy — mutating the return value does NOT affect the
 * live breaker.
 */
export function getEndpointCircuitBreakerState(fullUrl: string): EndpointCircuitBreaker {
  const cb = getEndpointCircuitBreaker(fullUrl);
  return { ...cb };
}

/**
 * Inspect all per-endpoint circuit breakers. Exported for /health debugging.
 * Returns a Map keyed by normalized path.
 */
export function getAllEndpointCircuitBreakers(): Map<string, EndpointCircuitBreaker> {
  // Return a deep-ish copy so callers can't mutate internal state.
  const snapshot = new Map<string, EndpointCircuitBreaker>();
  for (const [k, v] of endpointCircuitBreakers.entries()) {
    snapshot.set(k, { ...v });
  }
  return snapshot;
}

/**
 * Reset all per-endpoint circuit breakers. Exported for tests and for a
 * future /admin/reset-circuit-breakers endpoint.
 */
export function _resetAllCircuitBreakers(): void {
  endpointCircuitBreakers.clear();
}

// --- Request deduplication ---
// FIX: Store buffered JSON results instead of raw Response objects.
// Previously, when two consumers deduplicated onto the same Promise<Response>,
// the first consumer calling .json() would consume the body stream, and the
// second consumer would get "body already consumed" error. Now we buffer the
// parsed JSON + status in the dedup map and reconstruct a fresh NextResponse
// for each consumer.
interface BufferedProxyResult {
  data: unknown;
  status: number;
}
const pendingRequests = new Map<string, Promise<BufferedProxyResult>>();

// Health probe with short timeout
// Uses /api/health/ping (ultra-lightweight, plain-text "ok") instead of
// /api/health (JSON with diagnostics). The ping endpoint responds in <1ms
// even during heavy computation because it does zero work — no config
// lookup, no dict construction, no JSON serialization. This prevents
// false-positive "unhealthy" detections when the backend is busy with
// Bellman-Ford or cross-rate validation.
async function probeHealth(): Promise<boolean> {
  try {
    const healthUrl = new URL("/api/v1/health/ping", FLIPPER_API_URL);
    const res = await fetch(healthUrl.toString(), {
      method: "GET",
      signal: AbortSignal.timeout(5_000), // 5s — generous for a plain-text response
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Proxy a request to the FastAPI flipper backend with retry and deduplication.
 *
 * @param path       API path relative to the backend root, e.g. "/api/v1/prices"
 * @param searchParams  Optional query params to forward
 * @param method     HTTP method (GET, POST, etc.)
 * @param body       Optional request body (for POST/PUT)
 * @param maxRetries Max retries for transient errors (default: 1)
 * @returns          NextResponse with the backend JSON or a 503 error
 */
export async function proxyToFlipper(
  path: string,
  searchParams?: URLSearchParams,
  method: string = "GET",
  body?: unknown,
  maxRetries: number = 1,
  timeoutMs: number = 15_000,
): Promise<Response> {
  const url = new URL(path, FLIPPER_API_URL);

  if (searchParams) {
    searchParams.forEach((value, key) => {
      url.searchParams.set(key, value);
    });
  }

  // Deduplicate concurrent identical GET requests
  // FIX: Buffer the result so each consumer gets a fresh NextResponse
  // instead of sharing a single Response whose body can only be read once.
  if (method === "GET") {
    const cacheKey = url.toString();
    const pending = pendingRequests.get(cacheKey);
    if (pending) {
      // Another request is in-flight — await its buffered result and
      // construct a fresh Response for this consumer.
      const buffered = await pending;
      return NextResponse.json(buffered.data, { status: buffered.status });
    }

    const promise = _doProxyWithRetry(url.toString(), method, body, maxRetries, timeoutMs).finally(() => {
      pendingRequests.delete(cacheKey);
    });
    pendingRequests.set(cacheKey, promise);

    // First consumer also gets a fresh Response from the buffered result
    const buffered = await promise;
    return NextResponse.json(buffered.data, { status: buffered.status });
  }

  return _doProxyWithRetry(url.toString(), method, body, maxRetries, timeoutMs)
    .then((buffered) => NextResponse.json(buffered.data, { status: buffered.status }));
}

async function _doProxyWithRetry(
  url: string,
  method: string,
  body: unknown,
  maxRetries: number,
  timeoutMs: number = 15_000,
): Promise<BufferedProxyResult> {
  let lastError: Error | null = null;

  // P1-10: Per-endpoint circuit breaker — each API path has its own state.
  const cb = getEndpointCircuitBreaker(url);

  // Circuit breaker: skip request if backend is known-down for this endpoint
  if (cb.open) {
    const elapsed = Date.now() - cb.openSince;
    if (elapsed < cb.cooldownMs) {
      const retryIn = Math.round((cb.cooldownMs - elapsed) / 1000);
      return {
        data: {
          error: "Flipper backend unavailable",
          error_type: ERROR_TYPE_OFFLINE,
          detail: `Circuit breaker open for this endpoint — backend unreachable (retry in ${retryIn}s)`,
          hint: BACKEND_OFFLINE_HINT,
          cors_proxy_hint: FLIPPER_CORS_PROXY_URL
            ? "Backend upstream (poe2scout.com) may be blocked. Configure POE2_CORS_PROXY_URL for the frontend."
            : undefined,
          circuit_breaker_state: cb.state,
          circuit_breaker_endpoint: normalizePathForCircuitBreaker(url),
        },
        status: 503,
      };
    }
    // Cooldown expired — enter half-open state, send health probe
    cb.state = "half-open";
    const isHealthy = await probeHealth();
    if (isHealthy) {
      // Backend is back! Close the breaker
      cb.open = false;
      cb.state = "closed";
      cb.consecutiveFailures = 0;
      cb.cooldownMs = FLIPPER_CB_INITIAL_COOLDOWN;
      console.info(
        `[flipper-proxy] Circuit breaker CLOSED via health probe for ${normalizePathForCircuitBreaker(url)} — backend is back.`
      );
    } else {
      // Still down — keep breaker open, increase cooldown (exponential backoff)
      cb.state = "open";
      cb.openSince = Date.now(); // restart cooldown from now
      cb.cooldownMs = Math.min(cb.cooldownMs * 2, FLIPPER_CB_MAX_COOLDOWN);
      console.warn(
        `[flipper-proxy] Circuit breaker stays OPEN for ${normalizePathForCircuitBreaker(url)} — health probe failed. `
        + `Cooldown increased to ${cb.cooldownMs / 1000}s`
      );
      return {
        data: {
          error: "Flipper backend unavailable",
          error_type: ERROR_TYPE_OFFLINE,
          detail: `Circuit breaker open — health probe failed (retry in ${Math.round(cb.cooldownMs / 1000)}s)`,
          circuit_breaker_state: cb.state,
          circuit_breaker_endpoint: normalizePathForCircuitBreaker(url),
        },
        status: 503,
      };
    }
  }

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const fetchOptions: RequestInit = {
        method,
        headers: {
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        // Configurable timeout (default 15s). Heavy endpoints like
        // /api/arbitrage/triangular can take 30-60s (Bellman-Ford +
        // cross-rate validation with 600+ currencies). Callers should
        // pass a longer timeout for such endpoints.
        signal: AbortSignal.timeout(timeoutMs),
      };

      if (body && method !== "GET") {
        fetchOptions.body = JSON.stringify(body);
      }

      const res = await fetch(url, fetchOptions);

      // FIX: Only reset circuit breaker on successful responses (2xx).
      // Previously, any HTTP response (including 503) would reset the breaker,
      // which was wrong — a 503 means the backend is having issues and shouldn't
      // cause the breaker to close. Only 2xx means the backend is truly healthy.
      if (res.ok) {
        cb.consecutiveFailures = 0;
        if (cb.open) {
          cb.open = false;
          cb.state = "closed";
          cb.cooldownMs = FLIPPER_CB_INITIAL_COOLDOWN;
          console.info(
            `[flipper-proxy] Circuit breaker CLOSED for ${normalizePathForCircuitBreaker(url)} — backend responded OK (status ${res.status}).`
          );
        }
      }

      // ── Backend responded, but with 503 (insufficient data, etc.) ──
      if (res.status === 503) {
        let data: Record<string, unknown>;
        try {
          data = await res.json();
        } catch {
          data = { detail: "Service Unavailable" };
        }

        // If the backend reports that poe2scout.com is unreachable,
        // add a CORS proxy hint so the frontend can suggest a fix
        const providerStatus = data.provider as string | undefined;
        if (providerStatus === "unreachable" && FLIPPER_CORS_PROXY_URL) {
          data.cors_proxy_hint =
            "Backend cannot reach poe2scout.com. " +
            "Configure the backend to use a CORS proxy or set POE2_CORS_PROXY_URL for the frontend.";
        }

        return {
          data: {
            ...data,
            error_type: ERROR_TYPE_INSUFFICIENT,
          },
          status: 503,
        };
      }

      // ── Backend responded with 422 (insufficient data for forecast, etc.) ──
      if (res.status === 422) {
        let data: Record<string, unknown>;
        try {
          data = await res.json();
        } catch {
          data = { detail: "Unprocessable Entity" };
        }
        return {
          data: {
            ...data,
            error_type: ERROR_TYPE_UNPROCESSABLE,
          },
          status: 422,
        };
      }

      // ── Backend responded with 5xx (but not 503) ──
      if (res.status >= 500) {
        // Retry on server errors
        if (attempt < maxRetries) {
          const delay = 500 * Math.pow(2, attempt);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }

        let data: Record<string, unknown>;
        try {
          data = await res.json();
        } catch {
          data = { detail: `Server error: ${res.status}` };
        }
        return {
          data: {
            ...data,
            error_type: ERROR_TYPE_SERVER,
          },
          status: res.status,
        };
      }

      const data = await res.json();
      // Transform snake_case keys from backend to camelCase for frontend types
      const transformed = transformKeys(data);
      return { data: transformed, status: res.status };
    } catch (e: unknown) {
      lastError = e instanceof Error ? e : new Error(String(e));

      // Check if this is a transient error worth retrying
      const msg = lastError.message;
      const isTransient =
        msg.includes("ECONNRESET") ||
        msg.includes("EPIPE") ||
        msg.includes("socket hang up") ||
        msg.includes("ETIMEDOUT") ||
        msg.includes("timeout") ||
        msg.includes("aborted");

      // P1-10: Update per-endpoint circuit breaker on connection failures.
      // Only network errors trip the breaker — 5xx responses do NOT, because
      // a 5xx from one endpoint doesn't mean the backend is unreachable for
      // other endpoints.
      cb.consecutiveFailures++;
      if (cb.consecutiveFailures >= FLIPPER_CB_THRESHOLD) {
        cb.open = true;
        cb.openSince = Date.now();
        cb.state = "open";
        cb.cooldownMs = FLIPPER_CB_INITIAL_COOLDOWN;
        console.warn(
          `[flipper-proxy] Circuit breaker OPENED for ${normalizePathForCircuitBreaker(url)} — backend appears unreachable for this endpoint. ` +
          `Will probe health after ${FLIPPER_CB_INITIAL_COOLDOWN / 1000}s. Consecutive failures: ${cb.consecutiveFailures}`
        );
      }

      if (isTransient && attempt < maxRetries) {
        // Exponential backoff with jitter
        const baseDelay = 500 * Math.pow(2, attempt);
        const jitter = Math.random() * 300;
        const delay = Math.min(baseDelay + jitter, 5000);
        console.warn(
          `[flipper-proxy] Transient error on attempt ${attempt + 1}/${maxRetries + 1} for ${normalizePathForCircuitBreaker(url)}: ` +
          `${msg}. Retrying in ${Math.round(delay)}ms...`
        );
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      // Non-recoverable: backend is offline
      break;
    }
  }

  // ── Connection refused / timeout / network error ──
  const message = lastError?.message || "Unknown error";

  // Classify the error type for better frontend UX
  let errorType = ERROR_TYPE_OFFLINE;
  if (message.includes("timeout") || message.includes("ETIMEDOUT") || message.includes("aborted")) {
    errorType = ERROR_TYPE_TIMEOUT;
  } else if (message.includes("ECONNREFUSED")) {
    errorType = ERROR_TYPE_OFFLINE;
  } else if (message.includes("ECONNRESET") || message.includes("socket hang up")) {
    errorType = ERROR_TYPE_CONNECTION_RESET;
  }

  const response: Record<string, unknown> = {
    error: "Flipper backend unavailable",
    error_type: errorType,
    detail: message,
    hint: BACKEND_OFFLINE_HINT,
    circuit_breaker_endpoint: normalizePathForCircuitBreaker(url),
  };

  // If the backend is offline AND a CORS proxy is configured, add a hint
  // that the upstream (poe2scout.com) might also be blocked
  if (FLIPPER_CORS_PROXY_URL && (errorType === ERROR_TYPE_OFFLINE || errorType === ERROR_TYPE_CONNECTION_RESET)) {
    response.cors_proxy_hint =
      "If the backend cannot reach poe2scout.com, set POE2_CORS_PROXY_URL " +
      "in your .env.local to your Cloudflare Worker URL.";
  }

  return { data: response, status: 503 };
}

// ============================================================================
// proxyWithFallback — Proxy with graceful fallback when backend is offline
// ============================================================================
//
// When the FastAPI backend is unreachable (ECONNREFUSED, timeout), the proxy
// returns 503. This causes console errors and triggers React Query retries,
// flooding the network. Instead of propagating 503, this helper catches
// offline/timeout errors and returns fallback data with a 200 status.
//
// The frontend already checks `data_available: false` and shows appropriate
// "backend offline" / "insufficient data" UI states. By returning 200 with
// fallback data, we eliminate console error spam while keeping the UX clean.
//
// The health endpoint is an exception — it returns a structured response
// with `status: "offline"` so the dashboard can set `backendOnline = false`.
//
// ── P2-8 (iter 69): 5xx handling is now mode-aware ──
//
// Previously this helper swallowed ALL 5xx (500, 502, 504) into a 200 with
// fallback data, which silently hid real backend crashes behind "no data"
// UI states. The new behavior:
//
//   - 503 with `backend_offline` / `backend_timeout` / `backend_connection_reset`
//     / `backend_insufficient_data` error_type → still returns 200 with the
//     appropriate fallback (unchanged). This is the documented contract: when
//     the backend is offline, the dashboard shows the "backend offline" UI
//     state instead of crashing. Both dev and prod behave the same here —
//     otherwise dev mode would be unusable whenever the backend isn't running.
//
//   - Other 5xx (500, 502, 504 — backend running but crashing):
//       • In dev (`NODE_ENV === "development"`): pass the response through
//         unchanged so the developer sees the real status code, body, and
//         stack trace in the browser console.
//       • In prod: return 200 with fallback data (no console spam, no React
//         Query retry storms) but mark the response with the
//         `X-Flipper-Fallback: <original-status>` header so the frontend can
//         detect that this is a fallback and surface a non-blocking notice
//         if desired.
//
// All fallback responses (503 + non-503 5xx in prod) now carry the
// `X-Flipper-Fallback` header. Frontend code can use `isFlipperFallbackResponse()`
// to detect them.
// ============================================================================

/**
 * HTTP response header set by `proxyWithFallback` whenever it substitutes
 * fallback data for an error response. The value is the original HTTP
 * status code (e.g. `"503"`, `"500"`, `"502"`).
 *
 * Frontend code can read this header to distinguish "real 200 with data"
 * from "200 with fallback data" without inspecting the body.
 */
export const FLIPPER_FALLBACK_HEADER = "X-Flipper-Fallback";

/**
 * Returns true if the given Response was produced by `proxyWithFallback` as
 * a fallback for an errored backend request. Frontend code can use this to
 * surface a non-blocking "showing cached/fallback data" notice without
 * breaking the existing `res.ok`-based data flow.
 *
 * Note: cross-origin fetches only expose this header if the Next.js proxy
 * route is same-origin (which it is — it lives under `/api/flipper/...`).
 */
export function isFlipperFallbackResponse(res: Response): boolean {
  return res.headers.has(FLIPPER_FALLBACK_HEADER);
}

/**
 * Returns the original HTTP status code that `proxyWithFallback` swallowed
 * to produce this fallback response, or `null` if this is not a fallback
 * response.
 */
export function getFlipperFallbackOriginalStatus(res: Response): number | null {
  const raw = res.headers.get(FLIPPER_FALLBACK_HEADER);
  if (!raw) return null;
  const code = Number.parseInt(raw, 10);
  return Number.isNaN(code) ? null : code;
}

function isDevMode(): boolean {
  return process.env.NODE_ENV === "development";
}

/**
 * Build a 200 Response that carries fallback data and marks itself as a
 * fallback via the `X-Flipper-Fallback` header. Used in prod mode (and for
 * 503 in both modes) so the frontend can distinguish real 200s from
 * fallback 200s without inspecting the body.
 */
function jsonFallbackResponse(data: unknown, originalStatus: number): Response {
  return Response.json(data, {
    status: 200,
    headers: { [FLIPPER_FALLBACK_HEADER]: String(originalStatus) },
  });
}

export interface ProxyFallbackOptions {
  /** Fallback data to return when the backend is offline (503 with backend_offline error_type) */
  offlineFallback: unknown;
  /** Fallback data to return when the backend returns 503 with backend_insufficient_data */
  insufficientDataFallback?: unknown;
  /**
   * If true, inspect the proxy response for 503 status and return fallback
   * instead of passing the error through. Default: true.
   *
   * Note (P2-8, iter 69): this flag only governs 503 handling. Non-503 5xx
   * responses follow the mode-aware rule (pass-through in dev, marked
   * fallback in prod) regardless of this flag.
   */
  catch503?: boolean;
}

/**
 * Proxy a request to the flipper backend, returning fallback data when
 * the backend is offline or has insufficient data.
 *
 * @param path       API path relative to the backend root
 * @param fallback   Options object with fallback data for different error scenarios
 * @param searchParams  Optional query params to forward
 * @param method     HTTP method
 * @param body       Optional request body
 * @returns          Response with backend data, or fallback data marked
 *                   with `X-Flipper-Fallback` header (status 200), or — in
 *                   dev mode only — the original 5xx response passed through.
 */
export async function proxyWithFallback(
  path: string,
  fallback: ProxyFallbackOptions,
  searchParams?: URLSearchParams,
  method: string = "GET",
  body?: unknown,
  timeoutMs: number = 15_000,
): Promise<Response> {
  try {
    const res = await proxyToFlipper(path, searchParams, method, body, 0, timeoutMs);

    // If the response is OK (2xx), pass it through
    if (res.ok) {
      return res;
    }

    // ── 503: backend unreachable OR insufficient data ──
    // This branch runs in BOTH dev and prod. Without it, dev mode would be
    // unusable whenever the backend isn't running — every page would throw
    // a 503 instead of showing the "backend offline" UI state.
    if (res.status === 503) {
      try {
        const data = await res.json();
        const errorType = data?.error_type;

        if (errorType === "backend_offline" || errorType === "backend_timeout" || errorType === "backend_connection_reset") {
          return jsonFallbackResponse(fallback.offlineFallback, 503);
        }

        if (errorType === "backend_insufficient_data" && fallback.insufficientDataFallback !== undefined) {
          return jsonFallbackResponse(fallback.insufficientDataFallback, 503);
        }
      } catch {
        // JSON parse failed — return offline fallback
        return jsonFallbackResponse(fallback.offlineFallback, 503);
      }

      // Other 503 errors (e.g., backend running but insufficient data)
      // Return insufficient data fallback if provided, otherwise offline fallback
      if (fallback.insufficientDataFallback !== undefined) {
        return jsonFallbackResponse(fallback.insufficientDataFallback, 503);
      }
      return jsonFallbackResponse(fallback.offlineFallback, 503);
    }

    // ── P2-8 (iter 69): Non-503 5xx — mode-aware handling ──
    //
    // The backend is running but crashed on this request (500, 502, 504).
    // - In dev: pass the response through unchanged so the developer sees
    //   the real status code, body, and stack trace in the browser console.
    // - In prod: return 200 with fallback data, marked with the
    //   `X-Flipper-Fallback` header so the frontend can detect it.
    if (res.status >= 500) {
      if (isDevMode()) {
        return res;
      }

      // Prod: return fallback with X-Flipper-Fallback header
      if (fallback.insufficientDataFallback !== undefined) {
        return jsonFallbackResponse(fallback.insufficientDataFallback, res.status);
      }
      return jsonFallbackResponse(fallback.offlineFallback, res.status);
    }

    // For other error statuses (422, 404, etc.), pass through as-is
    return res;
  } catch {
    // Unexpected error — return offline fallback
    return jsonFallbackResponse(fallback.offlineFallback, 503);
  }
}
