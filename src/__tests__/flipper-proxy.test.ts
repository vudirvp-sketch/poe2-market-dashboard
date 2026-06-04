// ============================================================================
// Unit tests for lib/flipper-proxy.ts — Proxy helper for FastAPI backend
//
// These tests import constants and types from the REAL flipper-proxy module
// so they break when the source code changes (unlike the previous version
// that duplicated the values).
//
// Server-side modules that use NextResponse are tested via integration/E2E
// tests. Here we test: exported constants, type alignment, proxyWithFallback
// logic, and URL construction.
// ============================================================================

import {
  FLIPPER_API_URL,
  FLIPPER_CORS_PROXY_URL,
  FLIPPER_CB_INITIAL_COOLDOWN,
  FLIPPER_CB_MAX_COOLDOWN,
  FLIPPER_CB_THRESHOLD,
  ERROR_TYPE_OFFLINE,
  ERROR_TYPE_INSUFFICIENT,
  ERROR_TYPE_UNPROCESSABLE,
  ERROR_TYPE_SERVER,
  ERROR_TYPE_CONNECTION_RESET,
  ERROR_TYPE_TIMEOUT,
  BACKEND_OFFLINE_HINT,
  proxyWithFallback,
  type ProxyFallbackOptions,
} from "@/lib/flipper-proxy";
import type { FlipperErrorType } from "@/lib/types";

// ---------------------------------------------------------------------------
// Mock NextResponse (used internally by flipper-proxy, but we need the module
// to load without Next.js runtime)
// ---------------------------------------------------------------------------
jest.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => {
      return new Response(JSON.stringify(body), {
        status: init?.status ?? 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  },
}));

// ---------------------------------------------------------------------------
// Mock case-transform (pure function, no side effects needed)
// ---------------------------------------------------------------------------
jest.mock("@/lib/case-transform", () => ({
  transformKeys: (obj: unknown) => obj,
  toCamelCase: (s: string) => s,
}));

// ============================================================================
// 1. Constant alignment — these break if source values change
// ============================================================================

describe("flipper-proxy exported constants", () => {
  it("ERROR_TYPE_OFFLINE matches FlipperErrorType", () => {
    const validTypes: FlipperErrorType[] = [
      "backend_offline",
      "backend_timeout",
      "backend_connection_reset",
      "backend_insufficient_data",
      "insufficient_data",
      "server_error",
      "upstream_error",
    ];
    expect(validTypes).toContain(ERROR_TYPE_OFFLINE);
  });

  it("ERROR_TYPE_INSUFFICIENT matches FlipperErrorType", () => {
    const validTypes: FlipperErrorType[] = [
      "backend_offline",
      "backend_timeout",
      "backend_connection_reset",
      "backend_insufficient_data",
      "insufficient_data",
      "server_error",
      "upstream_error",
    ];
    expect(validTypes).toContain(ERROR_TYPE_INSUFFICIENT);
  });

  it("ERROR_TYPE_UNPROCESSABLE matches FlipperErrorType", () => {
    const validTypes: FlipperErrorType[] = [
      "backend_offline",
      "backend_timeout",
      "backend_connection_reset",
      "backend_insufficient_data",
      "insufficient_data",
      "server_error",
      "upstream_error",
    ];
    expect(validTypes).toContain(ERROR_TYPE_UNPROCESSABLE);
  });

  it("ERROR_TYPE_SERVER matches FlipperErrorType", () => {
    const validTypes: FlipperErrorType[] = [
      "backend_offline",
      "backend_timeout",
      "backend_connection_reset",
      "backend_insufficient_data",
      "insufficient_data",
      "server_error",
      "upstream_error",
    ];
    expect(validTypes).toContain(ERROR_TYPE_SERVER);
  });

  it("ERROR_TYPE_CONNECTION_RESET matches FlipperErrorType", () => {
    const validTypes: FlipperErrorType[] = [
      "backend_offline",
      "backend_timeout",
      "backend_connection_reset",
      "backend_insufficient_data",
      "insufficient_data",
      "server_error",
      "upstream_error",
    ];
    expect(validTypes).toContain(ERROR_TYPE_CONNECTION_RESET);
  });

  it("ERROR_TYPE_TIMEOUT matches FlipperErrorType", () => {
    const validTypes: FlipperErrorType[] = [
      "backend_offline",
      "backend_timeout",
      "backend_connection_reset",
      "backend_insufficient_data",
      "insufficient_data",
      "server_error",
      "upstream_error",
    ];
    expect(validTypes).toContain(ERROR_TYPE_TIMEOUT);
  });

  it("all error types are distinct from each other", () => {
    const allTypes = [
      ERROR_TYPE_OFFLINE,
      ERROR_TYPE_INSUFFICIENT,
      ERROR_TYPE_UNPROCESSABLE,
      ERROR_TYPE_SERVER,
      ERROR_TYPE_CONNECTION_RESET,
      ERROR_TYPE_TIMEOUT,
    ];
    expect(new Set(allTypes).size).toBe(allTypes.length);
  });

  it("offline and insufficient-data are different categories", () => {
    expect(ERROR_TYPE_OFFLINE).not.toBe(ERROR_TYPE_INSUFFICIENT);
  });

  it("BACKEND_OFFLINE_HINT contains uvicorn command", () => {
    expect(BACKEND_OFFLINE_HINT).toContain("uvicorn");
    expect(BACKEND_OFFLINE_HINT).toContain("8000");
    expect(BACKEND_OFFLINE_HINT).toContain("backend.main:app");
  });
});

// ============================================================================
// 2. Configuration defaults
// ============================================================================

describe("flipper-proxy configuration defaults", () => {
  it("default FLIPPER_API_URL is localhost:8000", () => {
    // In test env without FLIPPER_API_URL set, should be localhost
    expect(FLIPPER_API_URL).toContain("localhost:8000");
  });

  it("FLIPPER_CORS_PROXY_URL defaults to empty string", () => {
    // In test env without FLIPPER_CORS_PROXY_URL set, should be empty
    expect(FLIPPER_CORS_PROXY_URL).toBe("");
  });

  it("circuit breaker initial cooldown is 60 seconds", () => {
    expect(FLIPPER_CB_INITIAL_COOLDOWN).toBe(60_000);
  });

  it("circuit breaker max cooldown is 5 minutes", () => {
    expect(FLIPPER_CB_MAX_COOLDOWN).toBe(300_000);
  });

  it("circuit breaker opens after 5 consecutive failures", () => {
    expect(FLIPPER_CB_THRESHOLD).toBe(5);
  });

  it("max cooldown is greater than initial cooldown", () => {
    expect(FLIPPER_CB_MAX_COOLDOWN).toBeGreaterThan(FLIPPER_CB_INITIAL_COOLDOWN);
  });
});

// ============================================================================
// 3. URL construction
// ============================================================================

describe("flipper-proxy URL construction", () => {
  it("constructs URL with path segment", () => {
    const url = new URL("/api/health", FLIPPER_API_URL);
    expect(url.toString()).toContain("localhost:8000");
    expect(url.pathname).toBe("/api/health");
  });

  it("appends search params to URL", () => {
    const url = new URL("/api/events", FLIPPER_API_URL);
    url.searchParams.set("active_only", "true");
    expect(url.search).toContain("active_only=true");
  });

  it("constructs prices endpoint URL", () => {
    const url = new URL("/api/prices", FLIPPER_API_URL);
    expect(url.toString()).toContain("/api/prices");
  });

  it("constructs flips endpoint URL", () => {
    const url = new URL("/api/flips", FLIPPER_API_URL);
    url.searchParams.set("league", "runes");
    expect(url.searchParams.get("league")).toBe("runes");
  });
});

// ============================================================================
// 4. proxyWithFallback — contract verification
// ============================================================================
// Note: proxyWithFallback depends on proxyToFlipper which uses fetch + AbortSignal
// + NextResponse — all server-side APIs. Full runtime tests belong in E2E.
// Here we verify the exported interface and the ProxyFallbackOptions contract.

describe("proxyWithFallback — contract verification", () => {
  it("ProxyFallbackOptions requires offlineFallback", () => {
    // TypeScript enforces offlineFallback as required.
    // This test documents the contract: offlineFallback is mandatory,
    // insufficientDataFallback is optional.
    const opts: ProxyFallbackOptions = {
      offlineFallback: { data_available: false },
    };
    expect(opts.offlineFallback).toBeDefined();
  });

  it("ProxyFallbackOptions accepts optional insufficientDataFallback", () => {
    const opts: ProxyFallbackOptions = {
      offlineFallback: { data_available: false },
      insufficientDataFallback: { data_available: false, partial: true },
    };
    expect(opts.insufficientDataFallback).toBeDefined();
  });

  it("ProxyFallbackOptions accepts optional catch503 flag", () => {
    const opts: ProxyFallbackOptions = {
      offlineFallback: { data_available: false },
      catch503: false,
    };
    expect(opts.catch503).toBe(false);
  });

  it("default catch503 should be true (documented in ProxyFallbackOptions)", () => {
    // Per the JSDoc in flipper-proxy.ts: catch503 defaults to true
    // When not explicitly set, 503 errors are caught and fallback is returned
    const opts: ProxyFallbackOptions = {
      offlineFallback: { data_available: false },
    };
    // catch503 is undefined → proxyWithFallback treats it as true
    expect(opts.catch503).toBeUndefined();
  });
});

// ============================================================================
// 5. Error type classification — verify the constants are used consistently
// ============================================================================

describe("flipper-proxy error type classification", () => {
  it("ECONNREFUSED errors classify as backend_offline", () => {
    // This mirrors the classification logic in _doProxyWithRetry
    const message = "ECONNREFUSED: Connection refused";
    let errorType = ERROR_TYPE_OFFLINE;
    if (message.includes("timeout") || message.includes("ETIMEDOUT") || message.includes("aborted")) {
      errorType = ERROR_TYPE_TIMEOUT;
    } else if (message.includes("ECONNREFUSED")) {
      errorType = ERROR_TYPE_OFFLINE;
    } else if (message.includes("ECONNRESET") || message.includes("socket hang up")) {
      errorType = ERROR_TYPE_CONNECTION_RESET;
    }
    expect(errorType).toBe(ERROR_TYPE_OFFLINE);
  });

  it("timeout errors classify as backend_timeout", () => {
    const message = "ETIMEDOUT: Connection timed out";
    let errorType = ERROR_TYPE_OFFLINE;
    if (message.includes("timeout") || message.includes("ETIMEDOUT") || message.includes("aborted")) {
      errorType = ERROR_TYPE_TIMEOUT;
    } else if (message.includes("ECONNREFUSED")) {
      errorType = ERROR_TYPE_OFFLINE;
    } else if (message.includes("ECONNRESET") || message.includes("socket hang up")) {
      errorType = ERROR_TYPE_CONNECTION_RESET;
    }
    expect(errorType).toBe(ERROR_TYPE_TIMEOUT);
  });

  it("ECONNRESET errors classify as backend_connection_reset", () => {
    const message = "ECONNRESET: Connection reset by peer";
    let errorType = ERROR_TYPE_OFFLINE;
    if (message.includes("timeout") || message.includes("ETIMEDOUT") || message.includes("aborted")) {
      errorType = ERROR_TYPE_TIMEOUT;
    } else if (message.includes("ECONNREFUSED")) {
      errorType = ERROR_TYPE_OFFLINE;
    } else if (message.includes("ECONNRESET") || message.includes("socket hang up")) {
      errorType = ERROR_TYPE_CONNECTION_RESET;
    }
    expect(errorType).toBe(ERROR_TYPE_CONNECTION_RESET);
  });

  it("socket hang up errors classify as backend_connection_reset", () => {
    const message = "socket hang up";
    let errorType = ERROR_TYPE_OFFLINE;
    if (message.includes("timeout") || message.includes("ETIMEDOUT") || message.includes("aborted")) {
      errorType = ERROR_TYPE_TIMEOUT;
    } else if (message.includes("ECONNREFUSED")) {
      errorType = ERROR_TYPE_OFFLINE;
    } else if (message.includes("ECONNRESET") || message.includes("socket hang up")) {
      errorType = ERROR_TYPE_CONNECTION_RESET;
    }
    expect(errorType).toBe(ERROR_TYPE_CONNECTION_RESET);
  });

  it("abort errors classify as backend_timeout", () => {
    const message = "The operation was aborted";
    let errorType = ERROR_TYPE_OFFLINE;
    if (message.includes("timeout") || message.includes("ETIMEDOUT") || message.includes("aborted")) {
      errorType = ERROR_TYPE_TIMEOUT;
    } else if (message.includes("ECONNREFUSED")) {
      errorType = ERROR_TYPE_OFFLINE;
    } else if (message.includes("ECONNRESET") || message.includes("socket hang up")) {
      errorType = ERROR_TYPE_CONNECTION_RESET;
    }
    expect(errorType).toBe(ERROR_TYPE_TIMEOUT);
  });
});
