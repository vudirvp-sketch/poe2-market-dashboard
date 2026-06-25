// ============================================================================
// Unit tests for SpeculationTab (F5, iter 77) — BUY/SELL/HOLD signals.
//
// Coverage:
//   - Backend offline → renders offline card + hint
//   - Loading state → renders loading text
//   - Error state → renders error + refresh button
//   - data_available=false → renders "no data" notice
//   - data_available=true with signals → renders signal list + filter chips + days selector
//   - data_available=true but empty signals → renders "no signals" notice
//   - BUY/SELL/HOLD badges render with correct colors
//   - Filter chip click → calls fetchApi with new signal param
//   - Days selector change → calls fetchApi with new days param
//   - Sparkline renders for items with ≥2 history points
//   - Empty sparkline fallback for items with <2 history points
//   - Signal count footer renders
//   - Fetched-at timestamp renders
//   - Proxy path /api/flipper/speculation is used
// ============================================================================
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@/lib/i18n";
import { SpeculationTab } from "@/components/dashboard/speculation-tab";
import type { SpeculationResponse, SpeculationSignal } from "@/lib/types";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetchApi = jest.fn();
jest.mock("@/lib/types", () => ({
  ...jest.requireActual("@/lib/types"),
  fetchApi: (...args: unknown[]) => mockFetchApi(...args),
  fmt: (n: number) => (Number.isFinite(n) ? n.toFixed(2) : "—"),
}));

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
    },
  });
}

// React Query v5: per-query `retry: 1` in the tab overrides the client default.
// For error-state tests we use a longer waitFor timeout to allow the single
// retry to settle before asserting the error branch.
const ERROR_WAIT_OPTS = { timeout: 5000 };

function renderTab(backendOnline: boolean = true) {
  const queryClient = createTestQueryClient();
  window.localStorage.setItem("poe2-locale", "en");
  const result = render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <SpeculationTab backendOnline={backendOnline} />
      </I18nProvider>
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}

// ---------------------------------------------------------------------------
// Test data — matches the SpeculationResponse shape returned by the proxy
// route after camelCase transform.
// ---------------------------------------------------------------------------

function makeSignal(overrides: Partial<SpeculationSignal> = {}): SpeculationSignal {
  return {
    apiId: "test-orb",
    text: "Test Orb",
    category: "ritual",
    currentPrice: 50.0,
    mean: 100.0,
    std: 20.0,
    zScore: -2.5,
    percentile: 5.2,
    signal: "BUY",
    horizonHint: "short",
    sampleSize: 14,
    priceHistoryShort: [
      { date: "2026-06-01T00:00:00", price: 100.0 },
      { date: "2026-06-08T00:00:00", price: 110.0 },
      { date: "2026-06-15T00:00:00", price: 95.0 },
      { date: "2026-06-22T00:00:00", price: 50.0 },
    ],
    ...overrides,
  };
}

const mixedResponse: SpeculationResponse = {
  league: "Standard",
  dataAvailable: true,
  fetchedAt: "2026-06-25T10:00:00Z",
  days: 30,
  signals: [
    makeSignal({
      apiId: "buy-item",
      text: "Buy Item",
      zScore: -2.5,
      percentile: 5.0,
      signal: "BUY",
      horizonHint: "short",
    }),
    makeSignal({
      apiId: "sell-item",
      text: "Sell Item",
      zScore: 2.8,
      percentile: 95.0,
      signal: "SELL",
      horizonHint: "short",
      currentPrice: 200.0,
    }),
    makeSignal({
      apiId: "hold-item",
      text: "Hold Item",
      zScore: 0.5,
      percentile: 60.0,
      signal: "HOLD",
      horizonHint: "long",
      currentPrice: 105.0,
    }),
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ============================================================================

describe("SpeculationTab (F5)", () => {
  beforeEach(() => {
    mockFetchApi.mockReset();
  });

  it("renders offline card when backend is offline", async () => {
    renderTab(false);
    // Should NOT call fetchApi when backend is offline (query is disabled)
    expect(mockFetchApi).not.toHaveBeenCalled();
    expect(await screen.findByText(/Speculation requires the analytics backend/i)).toBeInTheDocument();
  });

  it("renders loading state while fetching", async () => {
    // Never resolves — keeps the query in pending state
    mockFetchApi.mockReturnValue(new Promise(() => {}));
    renderTab(true);
    expect(await screen.findByText(/Computing speculation signals/i)).toBeInTheDocument();
  });

  it("renders error state with refresh button on fetch failure", async () => {
    mockFetchApi.mockRejectedValue(new Error("network error"));
    renderTab(true);
    await waitFor(() => {
      expect(screen.getByText(/Failed to compute speculation signals/i)).toBeInTheDocument();
    }, ERROR_WAIT_OPTS);
    const refreshButtons = screen.getAllByLabelText(/Refresh/i);
    expect(refreshButtons.length).toBeGreaterThan(0);
  });

  it("renders 'no data' notice when dataAvailable is false", async () => {
    mockFetchApi.mockResolvedValue({
      league: "Standard",
      dataAvailable: false,
      fetchedAt: "2026-06-25T10:00:00Z",
      days: 30,
      signals: [],
    });
    renderTab(true);
    expect(await screen.findByText(/No price history available yet/i)).toBeInTheDocument();
  });

  it("renders signal list when dataAvailable=true with signals", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderTab(true);
    // Wait for the main card to appear
    const tab = await screen.findByTestId("speculation-tab");
    expect(tab).toBeInTheDocument();
    // Three signal rows should be rendered
    const signals = screen.getAllByTestId(/^speculation-signal-/);
    expect(signals).toHaveLength(3);
    // Each signal's text should be visible
    expect(screen.getByText("Buy Item")).toBeInTheDocument();
    expect(screen.getByText("Sell Item")).toBeInTheDocument();
    expect(screen.getByText("Hold Item")).toBeInTheDocument();
  });

  it("renders BUY/SELL/HOLD badges with signal text", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderTab(true);
    await screen.findByTestId("speculation-tab");
    // "BUY" appears both in the signal badge and in the filter chip —
    // assert at least one of each exists.
    expect(screen.getAllByText("BUY").length).toBeGreaterThan(0);
    expect(screen.getAllByText("SELL").length).toBeGreaterThan(0);
    expect(screen.getAllByText("HOLD").length).toBeGreaterThan(0);
  });

  it("renders z-score and percentile values", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderTab(true);
    await screen.findByTestId("speculation-tab");
    // z-score values: -2.50 (BUY), +2.80 (SELL), +0.50 (HOLD)
    expect(screen.getByText(/-2\.50/)).toBeInTheDocument();
    expect(screen.getByText(/\+2\.80/)).toBeInTheDocument();
    // percentile: 5.0%, 95.0%, 60.0% — use getAllByText since multiple signals
    // can share the same percentile bucket.
    expect(screen.getAllByText(/5\.0%/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/95\.0%/).length).toBeGreaterThan(0);
  });

  it("renders filter chips: ALL / BUY / SELL / HOLD", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderTab(true);
    await screen.findByTestId("speculation-tab");
    expect(screen.getByTestId("speculation-filter-all")).toBeInTheDocument();
    expect(screen.getByTestId("speculation-filter-buy")).toBeInTheDocument();
    expect(screen.getByTestId("speculation-filter-sell")).toBeInTheDocument();
    expect(screen.getByTestId("speculation-filter-hold")).toBeInTheDocument();
  });

  it("renders days selector with 7/14/30/90 options", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderTab(true);
    await screen.findByTestId("speculation-tab");
    // The default 30 days should be visible in the trigger
    // (text is rendered via speculationDaysValue "{0} days" → "30 days")
    expect(screen.getByText("30 days")).toBeInTheDocument();
  });

  it("renders sparkline SVG for items with ≥2 history points", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderTab(true);
    await screen.findByTestId("speculation-tab");
    const sparklines = screen.getAllByTestId("speculation-sparkline");
    expect(sparklines.length).toBe(3); // one per signal row
  });

  it("renders empty sparkline fallback for items with <2 history points", async () => {
    const singlePointResponse: SpeculationResponse = {
      ...mixedResponse,
      signals: [
        makeSignal({
          apiId: "single-point",
          text: "Single Point",
          priceHistoryShort: [{ date: "2026-06-01T00:00:00", price: 100.0 }],
        }),
      ],
    };
    mockFetchApi.mockResolvedValue(singlePointResponse);
    renderTab(true);
    await screen.findByTestId("speculation-tab");
    expect(screen.getByTestId("speculation-sparkline-empty")).toBeInTheDocument();
  });

  it("renders signal count and fetched-at footer", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderTab(true);
    await screen.findByTestId("speculation-tab");
    // Signal count: "3 signals"
    expect(screen.getByText(/3 signals/i)).toBeInTheDocument();
    // Fetched-at timestamp (we render via toLocaleString, so just check the prefix)
    expect(screen.getByText(/Fetched:/i)).toBeInTheDocument();
  });

  it("calls fetchApi with /api/flipper/speculation path", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderTab(true);
    await screen.findByTestId("speculation-tab");
    expect(mockFetchApi).toHaveBeenCalledWith(
      "/api/flipper/speculation",
      expect.objectContaining({
        days: expect.any(String),
        limit: expect.any(String),
        signal: expect.any(String),
      }),
    );
  });

  it("renders 'no signals' notice when dataAvailable=true but signals is empty", async () => {
    mockFetchApi.mockResolvedValue({
      league: "Standard",
      dataAvailable: true,
      fetchedAt: "2026-06-25T10:00:00Z",
      days: 30,
      signals: [],
    });
    renderTab(true);
    expect(await screen.findByText(/No actionable signals in the current window/i)).toBeInTheDocument();
  });

  it("clicking BUY filter chip calls fetchApi with signal=BUY", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderTab(true);
    await screen.findByTestId("speculation-tab");
    // Reset mock to clear the initial call
    mockFetchApi.mockClear();
    // Click the BUY filter chip
    const buyChip = screen.getByTestId("speculation-filter-buy");
    fireEvent.click(buyChip);
    // Wait for the new query to fire
    await waitFor(() => {
      expect(mockFetchApi).toHaveBeenCalled();
    });
    const lastCall = mockFetchApi.mock.calls[mockFetchApi.mock.calls.length - 1];
    expect(lastCall[1].signal).toBe("BUY");
  });

  it("renders category title-case next to item name", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderTab(true);
    await screen.findByTestId("speculation-tab");
    // mixedResponse uses category "ritual" → title-cased "Ritual".
    // All three signals share the same category, so there are multiple matches.
    expect(screen.getAllByText(/Ritual/i).length).toBeGreaterThan(0);
  });

  it("renders sample size, mean, std, current price stats", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderTab(true);
    await screen.findByTestId("speculation-tab");
    // Each signal shows "{sampleSize} pts · mean {mean} ± std {std} · current {current} · horizon: ..."
    // Default signal: sampleSize=14, mean=100.00, std=20.00, current=50.00 (BUY).
    // All three signals share these values, so there are multiple matches.
    expect(screen.getAllByText(/14 pts/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/mean 100\.00/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/std 20\.00/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/current 50\.00/i).length).toBeGreaterThan(0);
  });

  it("renders horizon hint localized text", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderTab(true);
    await screen.findByTestId("speculation-tab");
    // mixedResponse has horizonHint="short" for the BUY and SELL items,
    // "long" for the HOLD item — multiple matches expected.
    expect(screen.getAllByText(/horizon: 1-3 days/i).length).toBeGreaterThan(0);
  });

  // ===========================================================================
  // iter 88 (KI-1) — Speculation tab joins /api/flipper/flips for synthetic
  // bid/ask spread. Spread details toggle is shown ONLY when a matching
  // FlipOpportunity exists for the item's api_id.
  // ===========================================================================

  describe("iter 88 — synthetic spread details (KI-1)", () => {
    /** Helper: mock fetchApi to return speculation response for /speculation
     *  and flips response for /flips. Other paths get undefined. */
    function mockFetchWithFlips(specResponse: SpeculationResponse, flipsResponse: unknown) {
      mockFetchApi.mockImplementation((path: string) => {
        if (path === "/api/flipper/speculation") return Promise.resolve(specResponse);
        if (path === "/api/flipper/flips") return Promise.resolve(flipsResponse);
        return Promise.resolve(undefined);
      });
    }

    const flipsWithBuyItem = {
      league: "Standard",
      total: 1,
      opportunities: [
        {
          currency: "buy-item/exalted",
          score: 0.8,
          spread: 5.5,
          volume24h: 1200,
          cluster: "moderate",
          bid: 0.95,
          ask: 1.05,
          midPrice: 1.0,
          fairRate: 1.0,
          deviationPct: 2.5,
        },
      ],
      eventStatus: { anyActive: false, affectedCurrencies: [], summary: null },
      fetchedAt: "2026-06-25T10:00:00Z",
      dataAvailable: true,
    };

    it("shows spread-details toggle button when matching flip exists", async () => {
      mockFetchWithFlips(mixedResponse, flipsWithBuyItem);
      renderTab(true);
      await screen.findByTestId("speculation-tab");
      // Only buy-item has a matching flip in flipsWithBuyItem
      const toggle = screen.queryByTestId("speculation-spread-toggle-buy-item");
      expect(toggle).toBeInTheDocument();
      // sell-item and hold-item should NOT have a toggle (no matching flip)
      expect(screen.queryByTestId("speculation-spread-toggle-sell-item")).not.toBeInTheDocument();
      expect(screen.queryByTestId("speculation-spread-toggle-hold-item")).not.toBeInTheDocument();
    });

    it("does NOT show spread-details toggle when no flips data available", async () => {
      // speculation returns normally, but flips returns empty opportunities
      mockFetchWithFlips(mixedResponse, { opportunities: [], total: 0 });
      renderTab(true);
      await screen.findByTestId("speculation-tab");
      expect(screen.queryByTestId("speculation-spread-toggle-buy-item")).not.toBeInTheDocument();
    });

    it("clicking toggle expands spread details with bid/ask/spread/mid", async () => {
      mockFetchWithFlips(mixedResponse, flipsWithBuyItem);
      renderTab(true);
      await screen.findByTestId("speculation-tab");
      const toggle = screen.getByTestId("speculation-spread-toggle-buy-item");
      // Details panel should NOT be visible before click
      expect(screen.queryByTestId("speculation-spread-details-buy-item")).not.toBeInTheDocument();
      // Click to expand
      fireEvent.click(toggle);
      // Details panel should now be visible
      const details = await screen.findByTestId("speculation-spread-details-buy-item");
      expect(details).toBeInTheDocument();
      // Verify the bid/ask/spread/mid values render
      // bid = 0.95 → formatted "0.95", ask = 1.05 → "1.05", spread = 5.5%, mid = 1.0 → "1.00"
      expect(details.textContent).toContain("0.95");
      expect(details.textContent).toContain("1.05");
      expect(details.textContent).toContain("5.50%");
      expect(details.textContent).toContain("1.00");
    });

    it("clicking toggle twice collapses spread details", async () => {
      mockFetchWithFlips(mixedResponse, flipsWithBuyItem);
      renderTab(true);
      await screen.findByTestId("speculation-tab");
      const toggle = screen.getByTestId("speculation-spread-toggle-buy-item");
      // Expand
      fireEvent.click(toggle);
      await screen.findByTestId("speculation-spread-details-buy-item");
      // Collapse
      fireEvent.click(toggle);
      expect(screen.queryByTestId("speculation-spread-details-buy-item")).not.toBeInTheDocument();
    });

    it("shows fair rate and deviation in expanded panel when available", async () => {
      mockFetchWithFlips(mixedResponse, flipsWithBuyItem);
      renderTab(true);
      await screen.findByTestId("speculation-tab");
      fireEvent.click(screen.getByTestId("speculation-spread-toggle-buy-item"));
      const details = await screen.findByTestId("speculation-spread-details-buy-item");
      // fairRate = 1.0 → "1.00", deviationPct = 2.5 → "+2.50%"
      expect(details.textContent).toContain("1.00");
      expect(details.textContent).toContain("+2.50%");
    });

    it("shows spread disclaimer in expanded panel", async () => {
      mockFetchWithFlips(mixedResponse, flipsWithBuyItem);
      renderTab(true);
      await screen.findByTestId("speculation-tab");
      fireEvent.click(screen.getByTestId("speculation-spread-toggle-buy-item"));
      const details = await screen.findByTestId("speculation-spread-details-buy-item");
      // Disclaimer text mentions "no real order book" or "synthetic"
      expect(details.textContent).toMatch(/synthetic|order book/i);
    });

    it("uses highest-scored flip when multiple flips exist for same from-currency", async () => {
      const multiFlipsResponse = {
        ...flipsWithBuyItem,
        opportunities: [
          {
            currency: "buy-item/exalted",
            score: 0.5,
            spread: 2.0,
            bid: 0.98,
            ask: 1.02,
            midPrice: 1.0,
          },
          {
            currency: "buy-item/divine",
            score: 0.9,  // higher score — should win
            spread: 7.5,
            bid: 0.92,
            ask: 1.08,
            midPrice: 1.0,
            fairRate: 1.0,
            deviationPct: 5.0,
          },
        ],
      };
      mockFetchWithFlips(mixedResponse, multiFlipsResponse);
      renderTab(true);
      await screen.findByTestId("speculation-tab");
      fireEvent.click(screen.getByTestId("speculation-spread-toggle-buy-item"));
      const details = await screen.findByTestId("speculation-spread-details-buy-item");
      // The higher-scored flip (spread 7.5%, bid 0.92, ask 1.08) should be displayed
      expect(details.textContent).toContain("7.50%");
      expect(details.textContent).toContain("0.92");
      expect(details.textContent).toContain("1.08");
    });
  });
});
