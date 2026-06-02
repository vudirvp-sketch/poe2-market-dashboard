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
// ============================================================================

import { NextResponse } from "next/server";
import { transformKeys } from "./case-transform";

const FLIPPER_API_URL = process.env.FLIPPER_API_URL || "http://localhost:8000";

// --- Request deduplication ---
const pendingRequests = new Map<string, Promise<Response>>();

/**
 * Proxy a request to the FastAPI flipper backend with retry and deduplication.
 *
 * @param path       API path relative to the backend root, e.g. "/api/prices"
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
): Promise<Response> {
  const url = new URL(path, FLIPPER_API_URL);

  if (searchParams) {
    searchParams.forEach((value, key) => {
      url.searchParams.set(key, value);
    });
  }

  // Deduplicate concurrent identical GET requests
  if (method === "GET") {
    const cacheKey = url.toString();
    const pending = pendingRequests.get(cacheKey);
    if (pending) return pending;

    const promise = _doProxyWithRetry(url.toString(), method, body, maxRetries).finally(() => {
      pendingRequests.delete(cacheKey);
    });
    pendingRequests.set(cacheKey, promise);
    return promise;
  }

  return _doProxyWithRetry(url.toString(), method, body, maxRetries);
}

async function _doProxyWithRetry(
  url: string,
  method: string,
  body: unknown,
  maxRetries: number,
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const fetchOptions: RequestInit = {
        method,
        headers: {
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        // FIX: Increased from 5s to 15s. The backend performs a full
        // refresh snapshot + clustering + scoring on some requests,
        // which can take >5 seconds. 5s was causing all such requests
        // to time out. 15s is a better balance between responsiveness
        // and allowing the backend to complete its work.
        signal: AbortSignal.timeout(15_000),
      };

      if (body && method !== "GET") {
        fetchOptions.body = JSON.stringify(body);
      }

      const res = await fetch(url, fetchOptions);

      // ── Backend responded, but with 503 (insufficient data, etc.) ──
      if (res.status === 503) {
        let data: Record<string, unknown>;
        try {
          data = await res.json();
        } catch {
          data = { detail: "Service Unavailable" };
        }
        return NextResponse.json(
          {
            ...data,
            error_type: "backend_insufficient_data",
          },
          { status: 503 },
        );
      }

      // ── Backend responded with 422 (insufficient data for forecast, etc.) ──
      if (res.status === 422) {
        let data: Record<string, unknown>;
        try {
          data = await res.json();
        } catch {
          data = { detail: "Unprocessable Entity" };
        }
        return NextResponse.json(
          {
            ...data,
            error_type: "insufficient_data",
          },
          { status: 422 },
        );
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
        return NextResponse.json(
          {
            ...data,
            error_type: "server_error",
          },
          { status: res.status },
        );
      }

      const data = await res.json();
      // Transform snake_case keys from backend to camelCase for frontend types
      const transformed = transformKeys(data);
      return NextResponse.json(transformed, { status: res.status });
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

      if (isTransient && attempt < maxRetries) {
        const delay = 500 * Math.pow(2, attempt);
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
  let errorType = "backend_offline";
  if (message.includes("timeout") || message.includes("ETIMEDOUT") || message.includes("aborted")) {
    errorType = "backend_timeout";
  } else if (message.includes("ECONNREFUSED")) {
    errorType = "backend_offline";
  } else if (message.includes("ECONNRESET") || message.includes("socket hang up")) {
    errorType = "backend_connection_reset";
  }

  return NextResponse.json(
    {
      error: "Flipper backend unavailable",
      error_type: errorType,
      detail: message,
      hint: "Start the FastAPI backend: uvicorn backend.main:app --reload --port 8000",
    },
    { status: 503 },
  );
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
): Promise<Response> {
  try {
    const res = await proxyToFlipper(path, searchParams, method, body, 0);

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
