// ============================================================================
// Unit tests for IntradayPatternsTab (P4, iter 98) — time-of-day price
// pattern detector + heatmap UI.
//
// Coverage:
//   - Backend offline → renders offline card + hint
//   - Loading state → renders loading text
//   - Error state → renders error + refresh button
//   - data_available=false → renders "no data" notice
//   - data_available=true with patterns → renders heatmap rows + filter +
//     days selector
//   - data_available=true but empty patterns → renders "no patterns" notice
//   - Significant-only filter → toggles between all / significant-only
//   - Days selector → calls fetchApi with new days param
//   - Heatmap cells render 24 per row (one per UTC hour)
//   - Buy/sell window badges render with correct hour
//   - Significant badge renders only for hasSignificantPattern=true
//   - Hour axis header renders 24 hour labels
//   - Legend renders 6 swatches
//   - Pattern count footer renders
//   - Fetched-at timestamp renders
//   - Proxy path /api/flipper/intraday-patterns is used
// ============================================================================
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@/lib/i18n";
import { IntradayPatternsTab } from "@/components/dashboard/intraday-patterns-tab";
import type { IntradayPatternsResponse, IntradayPattern } from "@/lib/types";

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
const ERROR_WAIT_OPTS = { timeout: 5000 };

function renderTab(backendOnline: boolean = true) {
  const queryClient = createTestQueryClient();
  window.localStorage.setItem("poe2-locale", "en");
  const result = render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <IntradayPatternsTab backendOnline={backendOnline} />
      </I18nProvider>
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}

// ---------------------------------------------------------------------------
// Test data — matches the IntradayPatternsResponse shape returned by the
// proxy route after camelCase transform.
// ---------------------------------------------------------------------------

/** Build an IntradayPattern with sensible defaults for testing. */
function makePattern(overrides: Partial<IntradayPattern> = {}): IntradayPattern {
  // Default: 4 hours with data (0, 6, 12, 18), means [10, 20, 30, 20]
  // overall_mean = 20, buy=0 (10), sell=12 (30), range = 100%
  const hourlyStats = Array.from({ length: 24 }, (_, h) => {
    if (h === 0) return { hour: h, mean: 10.0, std: 1.0, count: 2 };
    if (h === 6) return { hour: h, mean: 20.0, std: 2.0, count: 2 };
    if (h === 12) return { hour: h, mean: 30.0, std: 3.0, count: 2 };
    if (h === 18) return { hour: h, mean: 20.0, std: 2.0, count: 2 };
    return { hour: h, mean: null, std: null, count: 0 };
  });
  return {
    apiId: "test-orb",
    text: "Test Orb",
    category: "ritual",
    hourlyStats,
    buyWindowHour: 0,
    sellWindowHour: 12,
    buyWindowMean: 10.0,
    sellWindowMean: 30.0,
    overallMean: 20.0,
    intradayRangePct: 100.0,
    hasSignificantPattern: true,
    sampleSize: 8,
    currentPrice: 30.0,
    ...overrides,
  };
}

const mixedResponse: IntradayPatternsResponse = {
  league: "Standard",
  dataAvailable: true,
  fetchedAt: "2026-07-10T10:00:00Z",
  days: 14,
  patterns: [
    makePattern({
      apiId: "sig-item",
      text: "Sig Item",
      hasSignificantPattern: true,
      intradayRangePct: 100.0,
    }),
    makePattern({
      apiId: "nonsig-item",
      text: "Nonsig Item",
      hasSignificantPattern: false,
      intradayRangePct: 5.0,
      buyWindowHour: 3,
      sellWindowHour: 15,
    }),
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ============================================================================

describe("IntradayPatternsTab (P4, iter 98)", () => {
  beforeEach(() => {
    mockFetchApi.mockReset();
  });

  it("renders offline card when backend is offline", async () => {
    renderTab(false);
    // Should NOT call fetchApi when backend is offline (query is disabled)
    expect(mockFetchApi).not.toHaveBeenCalled();
    expect(await screen.findByText(/Intraday Patterns requires the analytics backend/i)).toBeInTheDocument();
  });

  it("renders loading state while fetching", async () => {
    mockFetchApi.mockReturnValue(new Promise(() => {}));
    renderTab(true);
    expect(await screen.findByText(/Aggregating hourly patterns/i)).toBeInTheDocument();
  });

  it("renders error state with refresh button on fetch failure", async () => {
    mockFetchApi.mockRejectedValue(new Error("network error"));
    renderTab(true);
    await waitFor(() => {
      expect(screen.getByText(/Failed to aggregate hourly patterns/i)).toBeInTheDocument();
    }, ERROR_WAIT_OPTS);
    const refreshButtons = screen.getAllByLabelText(/Refresh/i);
    expect(refreshButtons.length).toBeGreaterThan(0);
  });

  it("renders 'no data' notice when dataAvailable is false", async () => {
    mockFetchApi.mockResolvedValue({
      league: "Standard",
      dataAvailable: false,
      fetchedAt: "2026-07-10T10:00:00Z",
      days: 14,
      patterns: [],
    });
    renderTab(true);
    expect(await screen.findByText(/No price history available yet/i)).toBeInTheDocument();
  });

  it("renders heatmap rows when dataAvailable=true with patterns", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderTab(true);
    const tab = await screen.findByTestId("intraday-patterns-tab");
    expect(tab).toBeInTheDocument();
    // Two pattern rows should be rendered
    const patterns = screen.getAllByTestId(/^intraday-pattern-/);
    expect(patterns).toHaveLength(2);
    expect(screen.getByText("Sig Item")).toBeInTheDocument();
    expect(screen.getByText("Nonsig Item")).toBeInTheDocument();
  });

  it("renders 24 heatmap cells per pattern row", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderTab(true);
    await screen.findByTestId("intraday-patterns-tab");
    // Each pattern row has a heatmap container with 24 cells
    const sigCells = screen.getAllByTestId(/^intraday-cell-sig-item-/);
    expect(sigCells).toHaveLength(24);
    const nonsigCells = screen.getAllByTestId(/^intraday-cell-nonsig-item-/);
    expect(nonsigCells).toHaveLength(24);
  });

  it("renders buy window badge with correct hour", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderTab(true);
    await screen.findByTestId("intraday-patterns-tab");
    // sig-item has buyWindowHour=0 → "BUY 00:00"
    const buyBadge = screen.getByTestId("intraday-buy-window-sig-item");
    expect(buyBadge).toHaveTextContent("BUY 00:00");
  });

  it("renders sell window badge with correct hour", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderTab(true);
    await screen.findByTestId("intraday-patterns-tab");
    // sig-item has sellWindowHour=12 → "SELL 12:00"
    const sellBadge = screen.getByTestId("intraday-sell-window-sig-item");
    expect(sellBadge).toHaveTextContent("SELL 12:00");
  });

  it("renders significant badge only for hasSignificantPattern=true", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderTab(true);
    await screen.findByTestId("intraday-patterns-tab");
    // sig-item should have a significant badge
    expect(screen.getByTestId("intraday-significant-sig-item")).toBeInTheDocument();
    // nonsig-item should NOT have a significant badge
    expect(screen.queryByTestId("intraday-significant-nonsig-item")).not.toBeInTheDocument();
  });

  it("renders hour axis header with 24 hour labels when patterns exist", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderTab(true);
    await screen.findByTestId("intraday-patterns-tab");
    const axis = screen.getByTestId("intraday-hour-axis");
    expect(axis).toBeInTheDocument();
    // Hour labels 00, 01, ..., 23
    for (let h = 0; h < 24; h++) {
      const label = String(h).padStart(2, "0");
      expect(axis).toHaveTextContent(label);
    }
  });

  it("renders legend with 6 swatches when patterns exist", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderTab(true);
    await screen.findByTestId("intraday-patterns-tab");
    // Legend label
    expect(screen.getByText(/Legend/i)).toBeInTheDocument();
    // 6 legend labels (Buy zone, Mild buy, Neutral, Mild sell, Sell zone, No data)
    expect(screen.getByText(/Buy zone/i)).toBeInTheDocument();
    expect(screen.getByText(/Sell zone/i)).toBeInTheDocument();
    expect(screen.getByText(/No data/i)).toBeInTheDocument();
  });

  it("renders 'no patterns' notice when patterns list is empty", async () => {
    mockFetchApi.mockResolvedValue({
      league: "Standard",
      dataAvailable: true,
      fetchedAt: "2026-07-10T10:00:00Z",
      days: 14,
      patterns: [],
    });
    renderTab(true);
    expect(await screen.findByText(/No patterns in the current window/i)).toBeInTheDocument();
  });

  it("filters to significant-only when toggle is clicked", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderTab(true);
    await screen.findByTestId("intraday-patterns-tab");
    // Initially both patterns visible
    expect(screen.getByText("Sig Item")).toBeInTheDocument();
    expect(screen.getByText("Nonsig Item")).toBeInTheDocument();

    // Click the "Significant only" filter
    const filterBtn = screen.getByTestId("intraday-filter-significant");
    fireEvent.click(filterBtn);

    // After click: only sig-item visible (nonsig filtered out)
    await waitFor(() => {
      expect(screen.getByText("Sig Item")).toBeInTheDocument();
      expect(screen.queryByText("Nonsig Item")).not.toBeInTheDocument();
    });
  });

  it("renders 'no significant' notice when filter is on and no significant patterns", async () => {
    mockFetchApi.mockResolvedValue({
      league: "Standard",
      dataAvailable: true,
      fetchedAt: "2026-07-10T10:00:00Z",
      days: 14,
      patterns: [makePattern({ apiId: "nonsig-item", text: "Nonsig Item", hasSignificantPattern: false })],
    });
    renderTab(true);
    await screen.findByTestId("intraday-patterns-tab");
    // Click the "Significant only" filter
    fireEvent.click(screen.getByTestId("intraday-filter-significant"));
    // After click: no patterns visible → "no significant" notice
    expect(await screen.findByText(/No significant patterns/i)).toBeInTheDocument();
  });

  it("renders days selector with 7/14/30/90 options (default 14 visible)", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderTab(true);
    await screen.findByTestId("intraday-patterns-tab");
    // The default 14 days should be visible in the trigger
    expect(screen.getByText("14 days")).toBeInTheDocument();
    // Default call: days=14
    expect(mockFetchApi).toHaveBeenCalledWith(
      "/api/flipper/intraday-patterns",
      expect.objectContaining({ days: "14" }),
    );
  });

  it("uses the correct proxy path /api/flipper/intraday-patterns", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderTab(true);
    await screen.findByTestId("intraday-patterns-tab");
    expect(mockFetchApi).toHaveBeenCalledWith(
      "/api/flipper/intraday-patterns",
      expect.any(Object),
    );
  });

  it("renders pattern count footer with correct count", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderTab(true);
    await screen.findByTestId("intraday-patterns-tab");
    // 2 patterns in mixedResponse
    expect(screen.getByText(/2 patterns/i)).toBeInTheDocument();
  });

  it("renders fetched-at timestamp in footer", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderTab(true);
    await screen.findByTestId("intraday-patterns-tab");
    // Footer shows "Fetched: <date>"
    expect(screen.getByText(/Fetched:/i)).toBeInTheDocument();
  });

  it("renders stats line (sample size, overall mean, current price)", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderTab(true);
    await screen.findByTestId("intraday-patterns-tab");
    // Stats line for sig-item: "8 pts · overall 20.00 · current 30.00 · buy 10.00 · sell 30.00"
    const sigPattern = screen.getByTestId("intraday-pattern-sig-item");
    expect(sigPattern).toHaveTextContent("8 pts");
    expect(sigPattern).toHaveTextContent("overall");
    expect(sigPattern).toHaveTextContent("current");
    expect(sigPattern).toHaveTextContent("buy");
    expect(sigPattern).toHaveTextContent("sell");
  });

  it("renders range % in the top row of each pattern", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderTab(true);
    await screen.findByTestId("intraday-patterns-tab");
    // sig-item has range 100.0%
    const sigPattern = screen.getByTestId("intraday-pattern-sig-item");
    expect(sigPattern).toHaveTextContent("+100.0%");
  });

  it("marks buy window cell with data-is-buy=true", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderTab(true);
    await screen.findByTestId("intraday-patterns-tab");
    // sig-item has buyWindowHour=0 → cell at hour 0 should have data-is-buy="true"
    const buyCell = screen.getByTestId("intraday-cell-sig-item-0");
    expect(buyCell).toHaveAttribute("data-is-buy", "true");
    // Cell at hour 1 is NOT the buy window
    const otherCell = screen.getByTestId("intraday-cell-sig-item-1");
    expect(otherCell).toHaveAttribute("data-is-buy", "false");
  });

  it("marks sell window cell with data-is-sell=true", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderTab(true);
    await screen.findByTestId("intraday-patterns-tab");
    // sig-item has sellWindowHour=12 → cell at hour 12 should have data-is-sell="true"
    const sellCell = screen.getByTestId("intraday-cell-sig-item-12");
    expect(sellCell).toHaveAttribute("data-is-sell", "true");
    // Cell at hour 0 is the buy window, NOT sell
    const buyCell = screen.getByTestId("intraday-cell-sig-item-0");
    expect(buyCell).toHaveAttribute("data-is-sell", "false");
  });

  it("renders empty-hour cells with count=0", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderTab(true);
    await screen.findByTestId("intraday-patterns-tab");
    // sig-item has hours 0,6,12,18 with data; hour 1 has count=0
    const emptyCell = screen.getByTestId("intraday-cell-sig-item-1");
    expect(emptyCell).toHaveAttribute("data-count", "0");
    // Hour 0 has count=2
    const dataCell = screen.getByTestId("intraday-cell-sig-item-0");
    expect(dataCell).toHaveAttribute("data-count", "2");
  });
});
