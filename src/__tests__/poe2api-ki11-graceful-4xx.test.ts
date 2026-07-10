// ============================================================================
// Unit tests for KI-11 (iter 102): graceful degradation of league-scoped
// GET functions in src/lib/poe2api.ts when the upstream POE2Scout API
// returns 4xx (most commonly 404 because the configured league slug is
// invalid for the current API state).
//
// Without the fix, `cachedFetch` throws `Error("API 4xx: ...")`, which
// propagates through `getUniquesByCategory` / `getCurrenciesByCategory` /
// `getUniquesAllCategories` / `getCurrenciesAllCategories` and is caught
// by the Next.js route handler's top-level catch block, which returns
// 502 Bad Gateway. The browser then sees a 502 and the dashboard's empty-
// state UI never gets a chance to render.
//
// With the fix, the lib functions catch the upstream 4xx and return an
// empty PaginatedResponse — the route handler returns 200 with `items: []`
// and the empty-state UI renders normally.
//
// These tests cover:
//   1. `isUpstream4xxError` — predicate logic for matching "API 4xx: ..."
//   2. `emptyPaginatedResponse` — empty response shape with page/perPage
//   3. `getUniquesByCategory` — returns empty page on upstream 404
//   4. `getCurrenciesByCategory` — returns empty page on upstream 404
//   5. `getUniquesByCategory(category="all")` — returns empty page when
//      the initial Items/Categories call 404s
//   6. `getCurrenciesByCategory(category="all")` — same as above for currencies
//   7. Non-4xx errors still propagate (network errors, 5xx, etc.)
// ============================================================================

import {
  isUpstream4xxError,
  emptyPaginatedResponse,
  getUniquesByCategory,
  getCurrenciesByCategory,
  BASE_URL,
  cache,
} from "@/lib/poe2api";
import type { PoeItem, PaginatedResponse } from "@/lib/types";

// ---------------------------------------------------------------------------
// Mock global fetch — the cachedFetch layer ultimately calls `fetch(url)`
// via `fetchWithTimeout`. We control the response status + body here.
// ---------------------------------------------------------------------------
const fetchMock = jest.fn() as jest.Mock;
global.fetch = fetchMock as unknown as typeof fetch;

// ---------------------------------------------------------------------------
// Helper: build a Next.js fetch Response mock
// ---------------------------------------------------------------------------
function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 404 ? "Not Found" : status === 500 ? "Internal Server Error" : "",
    headers: new Headers(),
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    arrayBuffer: async () => new ArrayBuffer(0),
    blob: async () => new Blob(),
    formData: async () => new FormData(),
    clone() { return this; },
    body: null,
    bodyUsed: false,
    type: "basic",
    url: "",
    redirected: false,
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Reset cache + fetch mock between tests so cached results don't leak.
// Also silence console.warn — the production code intentionally logs a
// warning when upstream 4xx is converted to empty data (useful signal in
// production), but the warning is noise in test output.
// ---------------------------------------------------------------------------
beforeEach(() => {
  fetchMock.mockReset();
  cache.clear();
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "info").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ============================================================================
// 1. isUpstream4xxError — predicate logic
// ============================================================================
describe("KI-11: isUpstream4xxError", () => {
  it("returns true for Error('API 404: Not Found — ...')", () => {
    expect(isUpstream4xxError(new Error("API 404: Not Found — https://api.poe2scout.com/api/poe2/Leagues/runes/Items/Categories"))).toBe(true);
  });

  it("returns true for Error('API 400: Bad Request — ...')", () => {
    expect(isUpstream4xxError(new Error("API 400: Bad Request — url"))).toBe(true);
  });

  it("returns true for Error('API 403: Forbidden — ...')", () => {
    expect(isUpstream4xxError(new Error("API 403: Forbidden — url"))).toBe(true);
  });

  it("returns true for Error('API 422: ...')", () => {
    expect(isUpstream4xxError(new Error("API 422: Unprocessable — url"))).toBe(true);
  });

  it("returns true for Error('API 499: ...') (any 4xx)", () => {
    expect(isUpstream4xxError(new Error("API 499: Something — url"))).toBe(true);
  });

  it("returns false for Error('API 500: Internal Server Error — ...')", () => {
    expect(isUpstream4xxError(new Error("API 500: Internal Server Error — url"))).toBe(false);
  });

  it("returns false for Error('API 503: Service Unavailable — ...')", () => {
    expect(isUpstream4xxError(new Error("API 503: Service Unavailable — url"))).toBe(false);
  });

  it("returns false for Error('API 200: OK — ...') (not 4xx)", () => {
    expect(isUpstream4xxError(new Error("API 200: OK — url"))).toBe(false);
  });

  it("returns false for network errors (ECONNRESET, ETIMEDOUT, fetch failed)", () => {
    expect(isUpstream4xxError(new Error("ECONNRESET: socket hang up"))).toBe(false);
    expect(isUpstream4xxError(new Error("ETIMEDOUT: connection timed out"))).toBe(false);
    expect(isUpstream4xxError(new Error("fetch failed"))).toBe(false);
  });

  it("returns false for non-Error values", () => {
    expect(isUpstream4xxError(null)).toBe(false);
    expect(isUpstream4xxError(undefined)).toBe(false);
    expect(isUpstream4xxError("string error")).toBe(false);
    expect(isUpstream4xxError(42)).toBe(false);
    expect(isUpstream4xxError({ message: "API 404" })).toBe(false);
  });

  it("returns false for undefined message", () => {
    const err = new Error();
    expect(isUpstream4xxError(err)).toBe(false);
  });

  it("does NOT match 'API 4' prefix without a third digit (e.g. 'API 4: foo')", () => {
    expect(isUpstream4xxError(new Error("API 4: foo"))).toBe(false);
  });

  it("does NOT match strings that merely contain 'API 4' somewhere in the middle", () => {
    expect(isUpstream4xxError(new Error("the API 404 endpoint failed"))).toBe(false);
  });
});

// ============================================================================
// 2. emptyPaginatedResponse — empty response shape
// ============================================================================
describe("KI-11: emptyPaginatedResponse", () => {
  it("returns empty items array", () => {
    const r = emptyPaginatedResponse<PoeItem>();
    expect(r.items).toEqual([]);
    expect(Array.isArray(r.items)).toBe(true);
    expect(r.items.length).toBe(0);
  });

  it("defaults to page=1, perPage=50", () => {
    const r = emptyPaginatedResponse<PoeItem>();
    expect(r.page).toBe(1);
    expect(r.perPage).toBe(50);
  });

  it("accepts custom page and perPage", () => {
    const r = emptyPaginatedResponse<PoeItem>(3, 25);
    expect(r.page).toBe(3);
    expect(r.perPage).toBe(25);
  });

  it("always returns totalItems=0 and totalPages=0", () => {
    const r = emptyPaginatedResponse<PoeItem>(5, 100);
    expect(r.totalItems).toBe(0);
    expect(r.totalPages).toBe(0);
  });

  it("satisfies the PaginatedResponse<T> shape contract", () => {
    const r: PaginatedResponse<PoeItem> = emptyPaginatedResponse<PoeItem>(2, 30);
    expect(r).toEqual({
      items: [],
      page: 2,
      perPage: 30,
      totalItems: 0,
      totalPages: 0,
    });
  });
});

// ============================================================================
// 3. getUniquesByCategory — single category returns empty on upstream 404
// ============================================================================
describe("KI-11: getUniquesByCategory (single category) returns empty page on upstream 404", () => {
  it("returns empty PaginatedResponse when upstream returns 404", async () => {
    fetchMock.mockResolvedValue(mockResponse(404, "Not Found"));

    const result = await getUniquesByCategory("poe2", "runes", "weapon", 1, 50);

    expect(result.items).toEqual([]);
    expect(result.page).toBe(1);
    expect(result.perPage).toBe(50);
    expect(result.totalItems).toBe(0);
    expect(result.totalPages).toBe(0);
  });

  it("returns empty PaginatedResponse on upstream 400", async () => {
    fetchMock.mockResolvedValue(mockResponse(400, "Bad Request"));

    const result = await getUniquesByCategory("poe2", "runes", "weapon", 2, 25);

    expect(result.items).toEqual([]);
    expect(result.page).toBe(2);
    expect(result.perPage).toBe(25);
    expect(result.totalItems).toBe(0);
    expect(result.totalPages).toBe(0);
  });

  it("returns empty PaginatedResponse on upstream 403", async () => {
    fetchMock.mockResolvedValue(mockResponse(403, "Forbidden"));

    const result = await getUniquesByCategory("poe2", "runes", "armour");

    expect(result.items).toEqual([]);
    expect(result.totalItems).toBe(0);
  });

  it("propagates non-4xx errors (e.g. 500)", async () => {
    fetchMock.mockResolvedValue(mockResponse(500, "Internal Server Error"));

    await expect(
      getUniquesByCategory("poe2", "runes", "weapon")
    ).rejects.toThrow(/API 500/);
  });

  it("returns populated items when upstream returns 200", async () => {
    fetchMock.mockResolvedValue(mockResponse(200, {
      CurrentPage: 1,
      Pages: 1,
      Total: 1,
      Items: [{
        UniqueItemId: 1,
        ItemId: 100,
        IconUrl: null,
        Text: "Test Unique",
        Name: "Test",
        CategoryApiId: "weapon",
        ItemMetadata: null,
        Type: "Sword",
        IsChanceable: null,
        PriceLogs: [null],
        CurrentPrice: 5.0,
        CurrentQuantity: 100,
      }],
    }));

    const result = await getUniquesByCategory("poe2", "runes", "weapon", 1, 50);

    expect(result.items.length).toBe(1);
    // mapUniqueItem uses raw.Text first (falls back to raw.Name) for the name field
    expect(result.items[0].name).toBe("Test Unique");
    expect(result.totalItems).toBe(1);
    expect(result.totalPages).toBe(1);
  });
});

// ============================================================================
// 4. getCurrenciesByCategory — single category returns empty on upstream 404
// ============================================================================
describe("KI-11: getCurrenciesByCategory (single category) returns empty page on upstream 404", () => {
  it("returns empty PaginatedResponse when upstream returns 404", async () => {
    fetchMock.mockResolvedValue(mockResponse(404, "Not Found"));

    const result = await getCurrenciesByCategory("poe2", "runes", "currency", 1, 50);

    expect(result.items).toEqual([]);
    expect(result.page).toBe(1);
    expect(result.perPage).toBe(50);
    expect(result.totalItems).toBe(0);
    expect(result.totalPages).toBe(0);
  });

  it("returns empty PaginatedResponse on upstream 422", async () => {
    fetchMock.mockResolvedValue(mockResponse(422, "Unprocessable"));

    const result = await getCurrenciesByCategory("poe2", "runes", "currency");

    expect(result.items).toEqual([]);
    expect(result.totalItems).toBe(0);
  });

  it("propagates non-4xx errors (e.g. 500)", async () => {
    fetchMock.mockResolvedValue(mockResponse(500, "Internal Server Error"));

    await expect(
      getCurrenciesByCategory("poe2", "runes", "currency")
    ).rejects.toThrow(/API 500/);
  });

  it("returns populated items when upstream returns 200", async () => {
    fetchMock.mockResolvedValue(mockResponse(200, {
      CurrentPage: 1,
      Pages: 1,
      Total: 1,
      Items: [{
        CurrencyItemId: 1,
        ItemId: 100,
        CurrencyCategoryId: 1,
        ApiId: "exalted",
        Text: "Exalted Orb",
        CategoryApiId: "currency",
        IconUrl: null,
        ItemMetadata: null,
        PriceLogs: [null],
        CurrentPrice: 1.0,
        CurrentQuantity: 1000,
      }],
    }));

    const result = await getCurrenciesByCategory("poe2", "runes", "currency", 1, 50);

    expect(result.items.length).toBe(1);
    expect(result.items[0].name).toBe("Exalted Orb");
    expect(result.totalItems).toBe(1);
  });
});

// ============================================================================
// 5. getUniquesByCategory(category="all") — Items/Categories 404 → empty
// ============================================================================
describe("KI-11: getUniquesByCategory(category='all') returns empty page when Items/Categories 404s", () => {
  it("returns empty PaginatedResponse when Items/Categories returns 404", async () => {
    // First (and only) call is to /Items/Categories — return 404
    fetchMock.mockResolvedValue(mockResponse(404, "Not Found"));

    const result = await getUniquesByCategory("poe2", "runes", "all", 1, 50);

    expect(result.items).toEqual([]);
    expect(result.page).toBe(1);
    expect(result.perPage).toBe(50);
    expect(result.totalItems).toBe(0);
    expect(result.totalPages).toBe(0);
    // Verify we hit the categories endpoint
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/poe2/Leagues/runes/Items/Categories");
  });

  it("returns empty PaginatedResponse on Items/Categories 400", async () => {
    fetchMock.mockResolvedValue(mockResponse(400, "Bad Request"));

    const result = await getUniquesByCategory("poe2", "runes", "all");

    expect(result.items).toEqual([]);
    expect(result.totalItems).toBe(0);
  });

  it("propagates non-4xx errors from Items/Categories", async () => {
    fetchMock.mockResolvedValue(mockResponse(500, "Internal Server Error"));

    await expect(
      getUniquesByCategory("poe2", "runes", "all")
    ).rejects.toThrow(/API 500/);
  });

  it("does NOT call per-category fetches when Items/Categories 404s", async () => {
    fetchMock.mockResolvedValue(mockResponse(404, "Not Found"));

    await getUniquesByCategory("poe2", "runes", "all");

    // Only the categories call should have happened — no per-category fan-out
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// 6. getCurrenciesByCategory(category="all") — Items/Categories 404 → empty
// ============================================================================
describe("KI-11: getCurrenciesByCategory(category='all') returns empty page when Items/Categories 404s", () => {
  it("returns empty PaginatedResponse when Items/Categories returns 404", async () => {
    fetchMock.mockResolvedValue(mockResponse(404, "Not Found"));

    const result = await getCurrenciesByCategory("poe2", "runes", "all", 1, 50);

    expect(result.items).toEqual([]);
    expect(result.page).toBe(1);
    expect(result.perPage).toBe(50);
    expect(result.totalItems).toBe(0);
    expect(result.totalPages).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/poe2/Leagues/runes/Items/Categories");
  });

  it("returns empty PaginatedResponse on Items/Categories 403", async () => {
    fetchMock.mockResolvedValue(mockResponse(403, "Forbidden"));

    const result = await getCurrenciesByCategory("poe2", "runes", "all");

    expect(result.items).toEqual([]);
    expect(result.totalItems).toBe(0);
  });

  it("propagates non-4xx errors from Items/Categories", async () => {
    fetchMock.mockResolvedValue(mockResponse(500, "Internal Server Error"));

    await expect(
      getCurrenciesByCategory("poe2", "runes", "all")
    ).rejects.toThrow(/API 500/);
  });

  it("does NOT call per-category fetches when Items/Categories 404s", async () => {
    fetchMock.mockResolvedValue(mockResponse(404, "Not Found"));

    await getCurrenciesByCategory("poe2", "runes", "all");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// 7. Sanity: BASE_URL still points at the expected upstream
// ============================================================================
describe("KI-11: sanity checks", () => {
  it("BASE_URL ends with /api (so league paths append correctly)", () => {
    expect(BASE_URL.endsWith("/api")).toBe(true);
  });

  it("BASE_URL contains poe2scout.com (default upstream)", () => {
    expect(BASE_URL).toContain("poe2scout.com");
  });
});
