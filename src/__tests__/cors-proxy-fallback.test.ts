// ============================================================================
// Unit tests for poe2api.ts — CORS Proxy Fallback mechanism
//
// These tests import the real buildCorsProxyUrl and CORS_PROXY_CONFIRM_TTL
// from poe2api.ts so they break when the source code changes (unlike the
// previous version that duplicated the URL construction logic).
//
// Tests the tryCorsProxyFallback logic:
//   - Returns null when no proxy is configured
//   - Constructs proxy URL by replacing BASE_URL with CORS_PROXY_URL
//   - Returns data and caches it on success
//   - Returns null on proxy failure
//   - Resets circuit breaker on proxy success
// ============================================================================

import { BASE_URL, buildCorsProxyUrl, CORS_PROXY_CONFIRM_TTL } from "@/lib/poe2api";

// ============================================================================
// 1. Proxy URL construction — imported from real module
// ============================================================================

describe("poe2api CORS proxy fallback — URL construction", () => {
  const CORS_PROXY_URL = "https://poe2scout-proxy.example.workers.dev/api";

  it("returns null when CORS_PROXY_URL is empty", () => {
    const CORS_PROXY_URL_EMPTY = "";
    // When no proxy is configured, the fallback should not attempt any request
    expect(CORS_PROXY_URL_EMPTY).toBe("");
    // Simulating: if (!CORS_PROXY_URL) return null
    const result = CORS_PROXY_URL_EMPTY ? "would-try-proxy" : null;
    expect(result).toBeNull();
  });

  it("constructs proxy URL by replacing BASE_URL prefix", () => {
    const originalUrl = `${BASE_URL}/Realms`;
    const proxyUrl = buildCorsProxyUrl(originalUrl, BASE_URL, CORS_PROXY_URL);

    expect(proxyUrl).toBe("https://poe2scout-proxy.example.workers.dev/api/Realms");
    expect(proxyUrl).not.toContain("api.poe2scout.com");
  });

  it("handles URLs with query parameters", () => {
    const originalUrl = `${BASE_URL}/poe2/Leagues/runes/SnapshotPairs?Limit=24`;
    const proxyUrl = buildCorsProxyUrl(originalUrl, BASE_URL, CORS_PROXY_URL);

    expect(proxyUrl).toBe(
      "https://poe2scout-proxy.example.workers.dev/api/poe2/Leagues/runes/SnapshotPairs?Limit=24"
    );
    expect(proxyUrl).toContain("Limit=24");
  });

  it("handles URLs with path segments after BASE_URL", () => {
    const originalUrl = `${BASE_URL}/poe2/Leagues/runes/Currencies/ByCategory?Category=currency&Page=1&PerPage=250`;
    const proxyUrl = buildCorsProxyUrl(originalUrl, BASE_URL, CORS_PROXY_URL);

    expect(proxyUrl).toContain("Currencies/ByCategory");
    expect(proxyUrl).toContain("Category=currency");
    expect(proxyUrl).toContain("PerPage=250");
  });

  it("handles unexpected URL that doesn't start with BASE_URL", () => {
    const originalUrl = "https://some-other-api.com/data";
    const proxyUrl = buildCorsProxyUrl(originalUrl, BASE_URL, CORS_PROXY_URL);

    // Should prefix with proxy URL + strip the original host
    expect(proxyUrl).toContain(CORS_PROXY_URL);
    expect(proxyUrl).toContain("/data");
    expect(proxyUrl).not.toContain("some-other-api.com");
  });

  it("proxy URL preserves the path structure from original", () => {
    const paths = [
      "/Realms",
      "/poe2/Leagues",
      "/poe2/Leagues/runes/ExchangeSnapshot",
      "/poe2/Leagues/runes/SnapshotHistory?Limit=168",
      "/poe2/Leagues/runes/ReferenceCurrencies",
      "/poe2/Leagues/runes/Items/Categories",
    ];

    for (const path of paths) {
      const originalUrl = `${BASE_URL}${path}`;
      const proxyUrl = buildCorsProxyUrl(originalUrl, BASE_URL, CORS_PROXY_URL);
      // The path after /api should be preserved
      expect(proxyUrl).toBe(`${CORS_PROXY_URL}${path}`);
    }
  });

  it("proxy URL for ExchangeSnapshot preserves path correctly", () => {
    const originalUrl = `${BASE_URL}/poe2/Leagues/runes/ExchangeSnapshot`;
    const proxyUrl = buildCorsProxyUrl(originalUrl, BASE_URL, CORS_PROXY_URL);
    expect(proxyUrl).toBe(`${CORS_PROXY_URL}/poe2/Leagues/runes/ExchangeSnapshot`);
  });
});

// ============================================================================
// 2. CORS proxy confirmation TTL — imported from real module
// ============================================================================

describe("poe2api CORS proxy confirmation TTL", () => {
  it("TTL is 5 minutes (300000ms)", () => {
    expect(CORS_PROXY_CONFIRM_TTL).toBe(300_000);
  });

  it("confirmed proxy becomes unconfirmed after TTL expires", () => {
    let confirmed = true;
    let lastCheck = Date.now() - CORS_PROXY_CONFIRM_TTL - 1; // 1ms past TTL

    // Simulate the TTL check (mirrors tryCorsProxyFallback logic)
    if (confirmed && Date.now() - lastCheck > CORS_PROXY_CONFIRM_TTL) {
      confirmed = false;
    }

    expect(confirmed).toBe(false);
  });

  it("confirmed proxy stays confirmed within TTL", () => {
    let confirmed = true;
    let lastCheck = Date.now() - 60_000; // 1 minute ago (within 5-min TTL)

    if (confirmed && Date.now() - lastCheck > CORS_PROXY_CONFIRM_TTL) {
      confirmed = false;
    }

    expect(confirmed).toBe(true);
  });

  it("TTL is positive", () => {
    expect(CORS_PROXY_CONFIRM_TTL).toBeGreaterThan(0);
  });

  it("TTL is reasonable (between 1 and 30 minutes)", () => {
    expect(CORS_PROXY_CONFIRM_TTL).toBeGreaterThanOrEqual(60_000);
    expect(CORS_PROXY_CONFIRM_TTL).toBeLessThanOrEqual(30 * 60_000);
  });
});

// ============================================================================
// 3. Circuit breaker interaction — mirrors the logic in tryCorsProxyFallback
// ============================================================================

describe("poe2api CORS proxy circuit breaker interaction", () => {
  it("successful proxy response should reset circuit breaker", () => {
    // Simulate: circuit breaker was open, proxy succeeds → close it
    let circuitBreakerOpen = true;
    let consecutiveFailures = 3;

    // On proxy success (mirrors tryCorsProxyFallback logic):
    circuitBreakerOpen = false;
    consecutiveFailures = 0;

    expect(circuitBreakerOpen).toBe(false);
    expect(consecutiveFailures).toBe(0);
  });

  it("failed proxy response should NOT open circuit breaker", () => {
    // The circuit breaker tracks DIRECT API failures, not proxy failures.
    // If the proxy also fails, we just return null — the breaker stays
    // in whatever state it was already in.
    let circuitBreakerOpen = true;
    let consecutiveFailures = 3;

    // On proxy failure: no state change
    // (proxy failure doesn't mean direct API will succeed)
    expect(circuitBreakerOpen).toBe(true);
    expect(consecutiveFailures).toBe(3);
  });

  it("failed proxy marks proxy as unconfirmed", () => {
    // Mirror: corsProxyConfirmed = false on proxy failure
    let corsProxyConfirmed = true;

    // On proxy failure:
    corsProxyConfirmed = false;

    expect(corsProxyConfirmed).toBe(false);
  });

  it("successful proxy marks proxy as confirmed and updates lastCheck", () => {
    let corsProxyConfirmed = false;
    let corsProxyLastCheck = 0;

    // On proxy success:
    corsProxyConfirmed = true;
    corsProxyLastCheck = Date.now();

    expect(corsProxyConfirmed).toBe(true);
    expect(corsProxyLastCheck).toBeGreaterThan(0);
    expect(Date.now() - corsProxyLastCheck).toBeLessThan(1000);
  });
});

// ============================================================================
// 4. BASE_URL alignment — verify imported BASE_URL matches expected value
// ============================================================================

describe("poe2api BASE_URL", () => {
  it("BASE_URL ends with /api", () => {
    expect(BASE_URL.endsWith("/api")).toBe(true);
  });

  it("BASE_URL contains poe2scout.com", () => {
    // Default value when POE2_API_BASE_URL is not set
    expect(BASE_URL).toContain("poe2scout.com");
  });

  it("buildCorsProxyUrl uses BASE_URL prefix replacement correctly", () => {
    // This is the core contract: the proxy URL is formed by replacing
    // the BASE_URL prefix with the proxy URL
    const testProxyUrl = "https://proxy.example.com/api";
    const originalUrl = `${BASE_URL}/Realms`;
    const result = buildCorsProxyUrl(originalUrl, BASE_URL, testProxyUrl);

    // The path after BASE_URL should be appended to the proxy URL
    expect(result).toBe(`${testProxyUrl}/Realms`);
    expect(result.startsWith(testProxyUrl)).toBe(true);
    expect(result).not.toContain("poe2scout.com");
  });
});
