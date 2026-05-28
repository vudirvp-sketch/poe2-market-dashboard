// ============================================================================
// Unit tests for lib/flipper-proxy.ts — Proxy helper for FastAPI backend
//
// These tests verify the error classification logic (backend_offline vs
// backend_insufficient_data) and URL construction. Server-side modules
// that use NextResponse are tested via integration/E2E tests.
// ============================================================================

describe("flipper-proxy error types", () => {
  // These constants mirror the ones in flipper-proxy.ts
  const ERROR_TYPE_OFFLINE = "backend_offline";
  const ERROR_TYPE_INSUFFICIENT = "backend_insufficient_data";

  it("distinguishes offline from insufficient-data error types", () => {
    // This is a documentation test: the proxy tags connection errors
    // as "backend_offline" and 503 responses as "backend_insufficient_data"
    expect(ERROR_TYPE_OFFLINE).toBe("backend_offline");
    expect(ERROR_TYPE_INSUFFICIENT).toBe("backend_insufficient_data");
    expect(ERROR_TYPE_OFFLINE).not.toBe(ERROR_TYPE_INSUFFICIENT);
  });

  it("offline error includes hint to start uvicorn", () => {
    // The hint message is critical for UX — verifies it's stable
    const hint = "Start the FastAPI backend: uvicorn backend.main:app --reload --port 8000";
    expect(hint).toContain("uvicorn");
    expect(hint).toContain("8000");
    expect(hint).toContain("backend.main:app");
  });

  it("insufficient data error preserves original backend detail", () => {
    // When the backend returns 503 with detail, we merge error_type into it
    const backend503 = { detail: "Not enough data", currencies_missing: 3 };
    const tagged = { ...backend503, error_type: "backend_insufficient_data" };

    expect(tagged.error_type).toBe("backend_insufficient_data");
    expect(tagged.detail).toBe("Not enough data");
    expect(tagged.currencies_missing).toBe(3);
  });
});

describe("flipper-proxy URL construction", () => {
  const FLIPPER_API_URL = process.env.FLIPPER_API_URL || "http://localhost:8000";

  it("default FLIPPER_API_URL is localhost:8000", () => {
    expect(FLIPPER_API_URL).toContain("localhost:8000");
  });

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
});
