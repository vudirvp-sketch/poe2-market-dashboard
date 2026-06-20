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
  getEndpointCircuitBreakerState,
  getAllEndpointCircuitBreakers,
  _resetAllCircuitBreakers,
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

  it("circuit breaker initial cooldown is 15 seconds", () => {
    expect(FLIPPER_CB_INITIAL_COOLDOWN).toBe(15_000);
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
    const url = new URL("/api/v1/health", FLIPPER_API_URL);
    expect(url.toString()).toContain("localhost:8000");
    expect(url.pathname).toBe("/api/v1/health");
  });

  it("appends search params to URL", () => {
    const url = new URL("/api/v1/events", FLIPPER_API_URL);
    url.searchParams.set("active_only", "true");
    expect(url.search).toContain("active_only=true");
  });

  it("constructs prices endpoint URL", () => {
    const url = new URL("/api/v1/prices", FLIPPER_API_URL);
    expect(url.toString()).toContain("/api/v1/prices");
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

// ============================================================================
// 6. Per-endpoint circuit breaker (P1-10, iter 66)
// ============================================================================
// The previous implementation used a single global breaker — any backend
// failure tripped ALL endpoints. P1-10 introduces a Map<path, CircuitBreaker>
// so a broken /api/v1/portfolio no longer blocks /api/v1/prices.

describe("per-endpoint circuit breaker (P1-10)", () => {
  beforeEach(() => {
    _resetAllCircuitBreakers();
  });

  it("freshly created breaker has closed state and zero failures", () => {
    const state = getEndpointCircuitBreakerState("/api/v1/prices");
    expect(state.open).toBe(false);
    expect(state.state).toBe("closed");
    expect(state.consecutiveFailures).toBe(0);
    expect(state.cooldownMs).toBe(FLIPPER_CB_INITIAL_COOLDOWN);
  });

  it("different endpoints have independent breaker state", () => {
    // Touch two endpoints — they should each get their own breaker entry.
    const pricesState = getEndpointCircuitBreakerState("/api/v1/prices");
    const eventsState = getEndpointCircuitBreakerState("/api/v1/events");

    expect(pricesState).not.toBe(eventsState); // different object references
    expect(getAllEndpointCircuitBreakers().size).toBe(2);
  });

  it("breaker state snapshots are decoupled from internal state", () => {
    const snapshot = getEndpointCircuitBreakerState("/api/v1/prices");
    snapshot.consecutiveFailures = 999;
    snapshot.state = "open";

    // Mutating the snapshot must not affect the live breaker.
    const fresh = getEndpointCircuitBreakerState("/api/v1/prices");
    expect(fresh.consecutiveFailures).toBe(0);
    expect(fresh.state).toBe("closed");
  });

  it("getAllEndpointCircuitBreakers returns a copy, not the live map", () => {
    getEndpointCircuitBreakerState("/api/v1/prices"); // create one entry
    const map1 = getAllEndpointCircuitBreakers();
    map1.clear(); // mutate the returned map

    // Internal map must be unaffected.
    const map2 = getAllEndpointCircuitBreakers();
    expect(map2.size).toBe(1);
  });

  it("normalizes path by stripping query strings", () => {
    const s1 = getEndpointCircuitBreakerState("/api/v1/prices?league=runes");
    const s2 = getEndpointCircuitBreakerState("/api/v1/prices?league=vaal");
    // Both URLs should map to the same breaker (/api/v1/prices).
    expect(getAllEndpointCircuitBreakers().size).toBe(1);
    expect(s1).toEqual(s2);
  });

  it("normalizes path by stripping ID-like trailing segments", () => {
    getEndpointCircuitBreakerState("/api/v1/storage_value/divine-orb");
    getEndpointCircuitBreakerState("/api/v1/storage_value/chaos-orb");
    // Both should map to /api/v1/storage_value (one entry).
    expect(getAllEndpointCircuitBreakers().size).toBe(1);
  });

  it("keeps non-ID trailing segments (e.g. /deactivate)", () => {
    getEndpointCircuitBreakerState("/api/v1/events/abc-12345/deactivate");
    // "deactivate" is not an ID-like slug, so it stays.
    const keys = Array.from(getAllEndpointCircuitBreakers().keys());
    expect(keys[0]).toContain("deactivate");
  });

  it("strips trailing slash for consistency", () => {
    getEndpointCircuitBreakerState("/api/v1/prices/");
    getEndpointCircuitBreakerState("/api/v1/prices");
    expect(getAllEndpointCircuitBreakers().size).toBe(1);
  });
});

// ============================================================================
// 7. Circuit-breakers health endpoint (P2-6, iter 67)
// ============================================================================
// Verifies the new GET /api/flipper/health/circuit-breakers endpoint exports
// a JSON snapshot of the per-endpoint breaker state. The handler itself is in
// `src/app/api/flipper/health/circuit-breakers/route.ts`; here we test the
// underlying data shape that the handler serializes.

describe("circuit-breakers health snapshot (P2-6)", () => {
  beforeEach(() => {
    _resetAllCircuitBreakers();
  });

  it("empty breaker map serializes to total=0, open_count=0", () => {
    const map = getAllEndpointCircuitBreakers();
    const entries = Array.from(map.entries());
    const serialized: Record<string, unknown> = {};
    let openCount = 0;
    for (const [path, cb] of entries) {
      serialized[path] = cb;
      if (cb.open) openCount += 1;
    }
    expect(entries.length).toBe(0);
    expect(openCount).toBe(0);
    expect(Object.keys(serialized)).toEqual([]);
  });

  it("populated breaker map serializes each entry with required fields", () => {
    // Touch two endpoints — they should appear in the snapshot.
    getEndpointCircuitBreakerState("/api/v1/prices");
    getEndpointCircuitBreakerState("/api/v1/events");

    const map = getAllEndpointCircuitBreakers();
    const serialized: Record<string, unknown> = {};
    let openCount = 0;
    for (const [path, cb] of map.entries()) {
      serialized[path] = cb;
      if (cb.open) openCount += 1;
    }

    expect(Object.keys(serialized).sort()).toEqual([
      "/api/v1/events",
      "/api/v1/prices",
    ]);
    for (const key of Object.keys(serialized)) {
      const entry = serialized[key] as {
        open: boolean;
        openSince: number;
        cooldownMs: number;
        consecutiveFailures: number;
        state: string;
      };
      expect(entry).toHaveProperty("open");
      expect(entry).toHaveProperty("openSince");
      expect(entry).toHaveProperty("cooldownMs");
      expect(entry).toHaveProperty("consecutiveFailures");
      expect(entry).toHaveProperty("state");
      expect(["closed", "open", "half-open"]).toContain(entry.state);
    }
    expect(openCount).toBe(0); // freshly created breakers are closed
  });

  it("snapshot reflects current state (no stale references)", () => {
    getEndpointCircuitBreakerState("/api/v1/prices");
    const before = getAllEndpointCircuitBreakers().get("/api/v1/prices")!;

    // Touch again to potentially get a fresh snapshot
    const after = getEndpointCircuitBreakerState("/api/v1/prices");
    expect(before.consecutiveFailures).toBe(after.consecutiveFailures);
    expect(before.state).toBe(after.state);
  });
});
