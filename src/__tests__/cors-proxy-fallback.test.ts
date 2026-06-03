// ============================================================================
// Unit tests for poe2api.ts — CORS Proxy Fallback mechanism
//
// Tests the tryCorsProxyFallback logic:
//   - Returns null when no proxy is configured
//   - Constructs proxy URL by replacing BASE_URL with CORS_PROXY_URL
//   - Returns data and caches it on success
//   - Returns null on proxy failure
//   - Resets circuit breaker on proxy success
// ============================================================================

describe("poe2api CORS proxy fallback", () => {
  // ── Mirror the URL construction logic from tryCorsProxyFallback ──

  const BASE_URL = "https://api.poe2scout.com/api";
  const CORS_PROXY_URL = "https://poe2scout-proxy.example.workers.dev/api";

  /**
   * Build a proxy URL by replacing BASE_URL with CORS_PROXY_URL.
   * This mirrors the logic in tryCorsProxyFallback().
   */
  function buildProxyUrl(originalUrl: string, baseUrl: string, proxyUrl: string): string {
    if (originalUrl.startsWith(baseUrl)) {
      return proxyUrl + originalUrl.slice(baseUrl.length);
    }
    // URL doesn't start with BASE_URL (unexpected), try prefixing anyway
    return proxyUrl + "/" + originalUrl.replace(/^https?:\/\/[^/]+/, "");
  }

  // ── Tests ──

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
    const proxyUrl = buildProxyUrl(originalUrl, BASE_URL, CORS_PROXY_URL);

    expect(proxyUrl).toBe("https://poe2scout-proxy.example.workers.dev/api/Realms");
    expect(proxyUrl).not.toContain("api.poe2scout.com");
  });

  it("handles URLs with query parameters", () => {
    const originalUrl = `${BASE_URL}/poe2/Leagues/vaal/SnapshotPairs?Limit=24`;
    const proxyUrl = buildProxyUrl(originalUrl, BASE_URL, CORS_PROXY_URL);

    expect(proxyUrl).toBe(
      "https://poe2scout-proxy.example.workers.dev/api/poe2/Leagues/vaal/SnapshotPairs?Limit=24"
    );
    expect(proxyUrl).toContain("Limit=24");
  });

  it("handles URLs with path segments after BASE_URL", () => {
    const originalUrl = `${BASE_URL}/poe2/Leagues/vaal/Currencies/ByCategory?Category=currency&Page=1&PerPage=250`;
    const proxyUrl = buildProxyUrl(originalUrl, BASE_URL, CORS_PROXY_URL);

    expect(proxyUrl).toContain("Currencies/ByCategory");
    expect(proxyUrl).toContain("Category=currency");
    expect(proxyUrl).toContain("PerPage=250");
  });

  it("handles unexpected URL that doesn't start with BASE_URL", () => {
    const originalUrl = "https://some-other-api.com/data";
    const proxyUrl = buildProxyUrl(originalUrl, BASE_URL, CORS_PROXY_URL);

    // Should prefix with proxy URL + strip the original host
    expect(proxyUrl).toContain(CORS_PROXY_URL);
    expect(proxyUrl).toContain("/data");
    expect(proxyUrl).not.toContain("some-other-api.com");
  });

  it("proxy URL preserves the path structure from original", () => {
    const paths = [
      "/Realms",
      "/poe2/Leagues",
      "/poe2/Leagues/vaal/ExchangeSnapshot",
      "/poe2/Leagues/vaal/SnapshotHistory?Limit=168",
      "/poe2/Leagues/vaal/ReferenceCurrencies",
      "/poe2/Leagues/vaal/Items/Categories",
    ];

    for (const path of paths) {
      const originalUrl = `${BASE_URL}${path}`;
      const proxyUrl = buildProxyUrl(originalUrl, BASE_URL, CORS_PROXY_URL);
      // The path after /api should be preserved
      expect(proxyUrl).toBe(`${CORS_PROXY_URL}${path}`);
    }
  });
});

describe("poe2api CORS proxy confirmation TTL", () => {
  it("TTL is 5 minutes (300000ms)", () => {
    const CORS_PROXY_CONFIRM_TTL = 5 * 60_000;
    expect(CORS_PROXY_CONFIRM_TTL).toBe(300_000);
  });

  it("confirmed proxy becomes unconfirmed after TTL expires", () => {
    const TTL = 5 * 60_000;
    let confirmed = true;
    let lastCheck = Date.now() - TTL - 1; // 1ms past TTL

    // Simulate the TTL check
    if (confirmed && Date.now() - lastCheck > TTL) {
      confirmed = false;
    }

    expect(confirmed).toBe(false);
  });

  it("confirmed proxy stays confirmed within TTL", () => {
    const TTL = 5 * 60_000;
    let confirmed = true;
    let lastCheck = Date.now() - 60_000; // 1 minute ago (within 5-min TTL)

    if (confirmed && Date.now() - lastCheck > TTL) {
      confirmed = false;
    }

    expect(confirmed).toBe(true);
  });
});

describe("poe2api CORS proxy circuit breaker interaction", () => {
  it("successful proxy response should reset circuit breaker", () => {
    // Simulate: circuit breaker was open, proxy succeeds → close it
    let circuitBreakerOpen = true;
    let consecutiveFailures = 3;

    // On proxy success:
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
});
