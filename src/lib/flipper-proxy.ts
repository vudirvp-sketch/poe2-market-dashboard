// ============================================================================
// Flipper Proxy Utility — Forwards requests to the FastAPI backend
// ============================================================================
//
// All Next.js API routes under src/app/api/flipper/ use this helper
// to proxy requests to the FastAPI backend running on port 8000.
// The backend URL is configurable via the FLIPPER_API_URL env var.
// ============================================================================

import { NextResponse } from "next/server";

const FLIPPER_API_URL = process.env.FLIPPER_API_URL || "http://localhost:8000";

/**
 * Proxy a request to the FastAPI flipper backend.
 *
 * @param path       API path relative to the backend root, e.g. "/api/prices"
 * @param searchParams  Optional query params to forward
 * @param method     HTTP method (GET, POST, etc.)
 * @param body       Optional request body (for POST/PUT)
 * @returns          NextResponse with the backend JSON or a 503 error
 */
export async function proxyToFlipper(
  path: string,
  searchParams?: URLSearchParams,
  method: string = "GET",
  body?: unknown,
): Promise<Response> {
  const url = new URL(path, FLIPPER_API_URL);

  if (searchParams) {
    searchParams.forEach((value, key) => {
      url.searchParams.set(key, value);
    });
  }

  try {
    const fetchOptions: RequestInit = {
      method,
      headers: {
        Accept: "application/json",
        "Content-Type": body ? "application/json" : "",
      },
      signal: AbortSignal.timeout(30_000),
    };

    if (body && method !== "GET") {
      fetchOptions.body = JSON.stringify(body);
    }

    const res = await fetch(url.toString(), fetchOptions);
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e: unknown) {
    const message =
      e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json(
      {
        error: "Flipper backend unavailable",
        detail: message,
        hint: "Start the FastAPI backend: uvicorn backend.main:app --reload --port 8000",
      },
      { status: 503 },
    );
  }
}
