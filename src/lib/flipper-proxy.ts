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
// ============================================================================

import { NextResponse } from "next/server";
import { transformKeys } from "./case-transform";

export const FLIPPER_API_URL = process.env.FLIPPER_API_URL || "http://localhost:8000";

// CORS Proxy for backend — if the flipper backend also can't reach poe2scout.com
// (same blocked network), it will return degraded/unreachable status. We can't
// proxy through CORS here directly (the backend makes its own API calls), but
// we track the fallback hint so the frontend can inform the user.
export const FLIPPER_CORS_PROXY_URL = process.env.FLIPPER_CORS_PROXY_URL || "";

// Circuit breaker for flipper-backend requests
let flipperCircuitBreakerOpen = false;
let flipperCircuitBreakerOpenSince = 0;
let flipperCircuitBreakerCooldownMs = 15_000; // starts at 15s for faster cold-start recovery, grows exponentially
export const FLIPPER_CB_INITIAL_COOLDOWN = 15_000; // 15s — reduced from 60s for faster recovery during backend cold start
export const FLIPPER_CB_MAX_COOLDOWN = 300_000; // P1-2: max 5 minutes
let flipperConsecutiveFailures = 0;
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

// P1-2: Circuit breaker state for debugging
let flipperCircuitBreakerState: "closed" | "open" | "half-open" = "closed";

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

// P1-2: Health probe with short timeout
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

  // Circuit breaker: skip request if backend is known-down
  if (flipperCircuitBreakerOpen) {
    const elapsed = Date.now() - flipperCircuitBreakerOpenSince;
    if (elapsed < flipperCircuitBreakerCooldownMs) {
      const retryIn = Math.round((flipperCircuitBreakerCooldownMs - elapsed) / 1000);
      return {
        data: {
          error: "Flipper backend unavailable",
          error_type: ERROR_TYPE_OFFLINE,
          detail: `Circuit breaker open — backend unreachable (retry in ${retryIn}s)`,
          hint: BACKEND_OFFLINE_HINT,
          cors_proxy_hint: FLIPPER_CORS_PROXY_URL
            ? "Backend upstream (poe2scout.com) may be blocked. Configure POE2_CORS_PROXY_URL for the frontend."
            : undefined,
          circuit_breaker_state: flipperCircuitBreakerState, // P1-2: debug info
        },
        status: 503,
      };
    }
    // P1-2: Cooldown expired — enter half-open state, send health probe
    flipperCircuitBreakerState = "half-open";
    const isHealthy = await probeHealth();
    if (isHealthy) {
      // Backend is back! Close the breaker
      flipperCircuitBreakerOpen = false;
      flipperCircuitBreakerState = "closed";
      flipperConsecutiveFailures = 0;
      flipperCircuitBreakerCooldownMs = FLIPPER_CB_INITIAL_COOLDOWN; // P1-2: reset cooldown
      console.info(
        `[flipper-proxy] Circuit breaker CLOSED via health probe — backend is back. `
      );
    } else {
      // Still down — keep breaker open, increase cooldown (exponential backoff)
      flipperCircuitBreakerState = "open";
      flipperCircuitBreakerOpenSince = Date.now(); // restart cooldown from now
      flipperCircuitBreakerCooldownMs = Math.min(
        flipperCircuitBreakerCooldownMs * 2,
        FLIPPER_CB_MAX_COOLDOWN
      );
      console.warn(
        `[flipper-proxy] Circuit breaker stays OPEN — health probe failed. `
        + `Cooldown increased to ${flipperCircuitBreakerCooldownMs / 1000}s`
      );
      return {
        data: {
          error: "Flipper backend unavailable",
          error_type: ERROR_TYPE_OFFLINE,
          detail: `Circuit breaker open — health probe failed (retry in ${Math.round(flipperCircuitBreakerCooldownMs / 1000)}s)`,
          circuit_breaker_state: flipperCircuitBreakerState,
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
        flipperConsecutiveFailures = 0;
        if (flipperCircuitBreakerOpen) {
          flipperCircuitBreakerOpen = false;
          flipperCircuitBreakerState = "closed";
          flipperCircuitBreakerCooldownMs = FLIPPER_CB_INITIAL_COOLDOWN; // P1-2: reset cooldown
          console.info(
            `[flipper-proxy] Circuit breaker CLOSED — backend responded OK (status ${res.status}).`
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

      // Update circuit breaker on connection failures
      flipperConsecutiveFailures++;
      if (flipperConsecutiveFailures >= FLIPPER_CB_THRESHOLD) {
        flipperCircuitBreakerOpen = true;
        flipperCircuitBreakerOpenSince = Date.now();
        flipperCircuitBreakerState = "open";
        flipperCircuitBreakerCooldownMs = FLIPPER_CB_INITIAL_COOLDOWN; // start at 60s
        console.warn(
          `[flipper-proxy] Circuit breaker OPENED — backend appears unreachable. ` +
          `Will probe health after ${FLIPPER_CB_INITIAL_COOLDOWN / 1000}s. Consecutive failures: ${flipperConsecutiveFailures}`
        );
      }

      if (isTransient && attempt < maxRetries) {
        // Exponential backoff with jitter
        const baseDelay = 500 * Math.pow(2, attempt);
        const jitter = Math.random() * 300;
        const delay = Math.min(baseDelay + jitter, 5000);
        console.warn(
          `[flipper-proxy] Transient error on attempt ${attempt + 1}/${maxRetries + 1}: ` +
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
// ============================================================================

export interface ProxyFallbackOptions {
  /** Fallback data to return when the backend is offline (503 with backend_offline error_type) */
  offlineFallback: unknown;
  /** Fallback data to return when the backend returns 503 with backend_insufficient_data */
  insufficientDataFallback?: unknown;
  /**
   * If true, inspect the proxy response for 503 status and return fallback
   * instead of passing the error through. Default: true.
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
 * @returns          Response with backend data or fallback data (always 200)
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

    // If 503 with backend_offline error type, return fallback
    if (res.status === 503) {
      try {
        const data = await res.json();
        const errorType = data?.error_type;

        if (errorType === "backend_offline" || errorType === "backend_timeout" || errorType === "backend_connection_reset") {
          return Response.json(fallback.offlineFallback);
        }

        if (errorType === "backend_insufficient_data" && fallback.insufficientDataFallback !== undefined) {
          return Response.json(fallback.insufficientDataFallback);
        }
      } catch {
        // JSON parse failed — return offline fallback
        return Response.json(fallback.offlineFallback);
      }

      // Other 503 errors (e.g., backend running but insufficient data)
      // Return insufficient data fallback if provided, otherwise offline fallback
      if (fallback.insufficientDataFallback !== undefined) {
        return Response.json(fallback.insufficientDataFallback);
      }
      return Response.json(fallback.offlineFallback);
    }

    // For 5xx errors (500, 502, etc.), return fallback instead of propagating.
    // The backend may be running but crashing (e.g., portfolio _build_portfolio
    // throws). The frontend already checks data_available: false, so returning
    // fallback is better than a 500 that causes console errors and React Query
    // retry storms.
    if (res.status >= 500) {
      if (fallback.insufficientDataFallback !== undefined) {
        return Response.json(fallback.insufficientDataFallback);
      }
      return Response.json(fallback.offlineFallback);
    }

    // For other error statuses (422, 404, etc.), pass through as-is
    return res;
  } catch {
    // Unexpected error — return offline fallback
    return Response.json(fallback.offlineFallback);
  }
}
