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
        // Phase 0.5: Reduced from 30s to 5s to prevent hanging requests
        // when the backend is completely unreachable.
        signal: AbortSignal.timeout(5_000),
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
      return NextResponse.json(data, { status: res.status });
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
