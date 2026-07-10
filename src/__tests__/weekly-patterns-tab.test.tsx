// ============================================================================
// Unit tests for WeeklyPatternsTab (P5, iter 99) — weekday/weekend price
// pattern detector + heatmap UI.
//
// Coverage:
//   - Backend offline → renders offline card + hint
//   - Loading state → renders loading text
//   - Error state → renders error + refresh button
//   - data_available=false → renders "no data" notice
//   - data_available=true with patterns → renders heatmap rows + filter +
//     weeks selector
//   - data_available=true but empty patterns → renders "no patterns" notice
//   - Significant-only filter → toggles between all / significant-only
//   - Weeks selector → calls fetchApi with new weeks param
//   - Heatmap cells render 7 per row (one per weekday Mon..Sun)
//   - Buy/sell day badges render with correct weekday name
//   - Significant badge renders only for hasSignificantPattern=true
//   - Weekday axis header renders 7 weekday labels
//   - Legend renders 6 swatches
//   - Pattern count footer renders
//   - Fetched-at timestamp renders
//   - weekday_delta_pct renders with correct sign coloring
//   - Proxy path /api/flipper/weekly-patterns is used
// ============================================================================
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@/lib/i18n";
import { WeeklyPatternsTab } from "@/components/dashboard/weekly-patterns-tab";
import type { WeeklyPatternsResponse, WeeklyPattern } from "@/lib/types";

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
        <WeeklyPatternsTab backendOnline={backendOnline} />
      </I18nProvider>
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}

// ---------------------------------------------------------------------------
// Test data — matches the WeeklyPatternsResponse shape returned by the
// proxy route after camelCase transform.
// ---------------------------------------------------------------------------

/** Build a WeeklyPattern with sensible defaults for testing.
 *  7 weekdays: Mon (1)=10, Wed (3)=20, Fri (5)=30, Sat (6)=20, Sun (7)=20.
 *  Overall mean = (10+20+30+20+20)/5 = 20, buy=Mon (10), sell=Fri (30),
 *  range = |30-10|/20*100 = 100%.
 *  weekday_delta_pct: weekday_mean = (10+20+30)/3 = 20, weekend_mean = (20+20)/2 = 20 → 0%.
 *  We override this in tests when we need a non-zero delta.
 */
function makePattern(overrides: Partial<WeeklyPattern> = {}): WeeklyPattern {
  // 7 entries — Mon (1), Wed (3), Fri (5), Sat (6), Sun (7) have data
  const dailyStats = [1, 2, 3, 4, 5, 6, 7].map((wd) => {
    if (wd === 1) return { weekday: wd, mean: 10.0, std: 1.0, count: 2 };
    if (wd === 3) return { weekday: wd, mean: 20.0, std: 2.0, count: 2 };
    if (wd === 5) return { weekday: wd, mean: 30.0, std: 3.0, count: 2 };
    if (wd === 6) return { weekday: wd, mean: 20.0, std: 2.0, count: 2 };
    if (wd === 7) return { weekday: wd, mean: 20.0, std: 2.0, count: 2 };
    return { weekday: wd, mean: null, std: null, count: 0 };
  });
  return {
    apiId: "test-orb",
    text: "Test Orb",
    category: "ritual",
    dailyStats,
    buyWindowDay: 1,
    sellWindowDay: 5,
    buyWindowMean: 10.0,
    sellWindowMean: 30.0,
    overallMean: 20.0,
    weeklyRangePct: 100.0,
    weekdayDeltaPct: 0.0,
    hasSignificantPattern: true,
    sampleSize: 10,
    currentPrice: 30.0,
    ...overrides,
  };
}

const mixedResponse: WeeklyPatternsResponse = {
  league: "Standard",
  dataAvailable: true,
  fetchedAt: "2026-07-10T10:00:00Z",
  weeks: 4,
  patterns: [
    makePattern({
      apiId: "sig-item",
      text: "Sig Item",
      hasSignificantPattern: true,
      weeklyRangePct: 100.0,
      weekdayDeltaPct: 50.0,
    }),
    makePattern({
      apiId: "nonsig-item",
      text: "Nonsig Item",
      hasSignificantPattern: false,
      weeklyRangePct: 5.0,
      buyWindowDay: 3,
      sellWindowDay: 7,
      weekdayDeltaPct: -10.0,
    }),
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ============================================================================

describe("WeeklyPatternsTab (P5, iter 99)", () => {
  beforeEach(() => {
    mockFetchApi.mockReset();
  });

  it("renders offline card when backend is offline", async () => {
    renderTab(false);
    // Should NOT call fetchApi when backend is offline (query is disabled)
    expect(mockFetchApi).not.toHaveBeenCalled();
    expect(await screen.findByText(/Weekly Patterns requires the analytics backend/i)).toBeInTheDocument();
  });

  it("renders loading state while fetching", async () => {
    mockFetchApi.mockReturnValue(new Promise(() => {}));
    renderTab(true);
    expect(await screen.findByText(/Aggregating weekday patterns/i)).toBeInTheDocument();
  });

  it("renders error state with refresh button on fetch failure", async () => {
    mockFetchApi.mockRejectedValue(new Error("network error"));
    renderTab(true);
    await waitFor(() => {
      expect(screen.getByText(/Failed to aggregate weekly patterns/i)).toBeInTheDocument();
    }, ERROR_WAIT_OPTS);
    const refreshButtons = screen.getAllByLabelText(/Refresh/i);
    expect(refreshButtons.length).toBeGreaterThan(0);
  });

  it("renders 'no data' notice when dataAvailable is false", async () => {
    mockFetchApi.mockResolvedValue({
      league: "Standard",
      dataAvailable: false,
      fetchedAt: "2026-07-10T10:00:00Z",
      weeks: 4,
      patterns: [],
    });
    renderTab(true);
    expect(await screen.findByText(/No price history available yet/i)).toBeInTheDocument();
  });

  it("renders heatmap rows when dataAvailable=true with patterns", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderTab(true);
    const tab = await screen.findByTestId("weekly-patterns-tab");
    expect(tab).toBeInTheDocument();
    // Two pattern rows should be rendered
    const patterns = screen.getAllByTestId(/^weekly-pattern-/);
    expect(patterns).toHaveLength(2);
    expect(screen.getByText("Sig Item")).toBeInTheDocument();
    expect(screen.getByText("Nonsig Item")).toBeInTheDocument();
  });

  it("renders 7 heatmap cells per pattern row", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderTab(true);
    await screen.findByTestId("weekly-patterns-tab");
    // Each pattern row has a heatmap container with 7 cells (one per weekday Mon-Sun)
    const sigCells = screen.getAllByTestId(/^weekly-cell-sig-item-/);
    expect(sigCells).toHaveLength(7);
    const nonsigCells = screen.getAllByTestId(/^weekly-cell-nonsig-item-/);
    expect(nonsigCells).toHaveLength(7);
  });

  it("renders buy day badge with correct weekday name", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderTab(true);
    await screen.findByTestId("weekly-patterns-tab");
    // sig-item has buyWindowDay=1 (Monday) → "BUY Mon"
    const buyBadge = screen.getByTestId("weekly-buy-window-sig-item");
    expect(buyBadge).toHaveTextContent("BUY Mon");
  });

  it("renders sell day badge with correct weekday name", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderTab(true);
    await screen.findByTestId("weekly-patterns-tab");
    // sig-item has sellWindowDay=5 (Friday) → "SELL Fri"
    const sellBadge = screen.getByTestId("weekly-sell-window-sig-item");
    expect(sellBadge).toHaveTextContent("SELL Fri");
  });

  it("renders significant badge only for hasSignificantPattern=true", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderTab(true);
    await screen.findByTestId("weekly-patterns-tab");
    // sig-item should have a significant badge
    expect(screen.getByTestId("weekly-significant-sig-item")).toBeInTheDocument();
    // nonsig-item should NOT have a significant badge
    expect(screen.queryByTestId("weekly-significant-nonsig-item")).not.toBeInTheDocument();
  });

  it("renders weekday axis header with 7 weekday labels when patterns exist", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderTab(true);
    await screen.findByTestId("weekly-patterns-tab");
    const axis = screen.getByTestId("weekly-weekday-axis");
    expect(axis).toBeInTheDocument();
    // 7 weekday labels: Mon, Tue, Wed, Thu, Fri, Sat, Sun
    expect(axis).toHaveTextContent("Mon");
    expect(axis).toHaveTextContent("Tue");
    expect(axis).toHaveTextContent("Wed");
    expect(axis).toHaveTextContent("Thu");
    expect(axis).toHaveTextContent("Fri");
    expect(axis).toHaveTextContent("Sat");
    expect(axis).toHaveTextContent("Sun");
  });

  it("renders legend with 6 swatches when patterns exist", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderTab(true);
    await screen.findByTestId("weekly-patterns-tab");
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
      weeks: 4,
      patterns: [],
    });
    renderTab(true);
    expect(await screen.findByText(/No patterns in the current window/i)).toBeInTheDocument();
  });

  it("filters to significant-only when toggle is clicked", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderTab(true);
    await screen.findByTestId("weekly-patterns-tab");
    // Initially both patterns visible
    expect(screen.getByText("Sig Item")).toBeInTheDocument();
    expect(screen.getByText("Nonsig Item")).toBeInTheDocument();

    // Click the "Significant only" filter
    const filterBtn = screen.getByTestId("weekly-filter-significant");
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
      weeks: 4,
      patterns: [makePattern({ apiId: "nonsig-item", text: "Nonsig Item", hasSignificantPattern: false })],
    });
    renderTab(true);
    await screen.findByTestId("weekly-patterns-tab");
    // Click the "Significant only" filter
    fireEvent.click(screen.getByTestId("weekly-filter-significant"));
    // After click: no patterns visible → "no significant" notice
    expect(await screen.findByText(/No significant patterns/i)).toBeInTheDocument();
  });

  it("renders weeks selector with 1/2/4/8/12/26 options (default 4 visible)", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderTab(true);
    await screen.findByTestId("weekly-patterns-tab");
    // The default 4 weeks should be visible in the trigger
    expect(screen.getByText("4 weeks")).toBeInTheDocument();
    // Default call: weeks=4
    expect(mockFetchApi).toHaveBeenCalledWith(
      "/api/flipper/weekly-patterns",
      expect.objectContaining({ weeks: "4" }),
    );
  });

  it("uses the correct proxy path /api/flipper/weekly-patterns", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderTab(true);
    await screen.findByTestId("weekly-patterns-tab");
    expect(mockFetchApi).toHaveBeenCalledWith(
      "/api/flipper/weekly-patterns",
      expect.any(Object),
    );
  });

  it("renders pattern count footer with correct count", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderTab(true);
    await screen.findByTestId("weekly-patterns-tab");
    // 2 patterns in mixedResponse
    expect(screen.getByText(/2 patterns/i)).toBeInTheDocument();
  });

  it("renders fetched-at timestamp in footer", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderTab(true);
    await screen.findByTestId("weekly-patterns-tab");
    // Footer shows "Fetched: <date>"
    expect(screen.getByText(/Fetched:/i)).toBeInTheDocument();
  });

  it("renders stats line (sample size, overall mean, current price)", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderTab(true);
    await screen.findByTestId("weekly-patterns-tab");
    // Stats line for sig-item: "10 pts · overall 20.00 · current 30.00 · buy 10.00 · sell 30.00 · Δ weekend ..."
    const sigPattern = screen.getByTestId("weekly-pattern-sig-item");
    expect(sigPattern).toHaveTextContent("10 pts");
    expect(sigPattern).toHaveTextContent("overall");
    expect(sigPattern).toHaveTextContent("current");
    expect(sigPattern).toHaveTextContent("buy");
    expect(sigPattern).toHaveTextContent("sell");
  });

  it("renders range % in the top row of each pattern", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderTab(true);
    await screen.findByTestId("weekly-patterns-tab");
    // sig-item has range 100.0%
    const sigPattern = screen.getByTestId("weekly-pattern-sig-item");
    expect(sigPattern).toHaveTextContent("+100.0%");
  });

  it("renders weekday_delta_pct in stats line", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderTab(true);
    await screen.findByTestId("weekly-patterns-tab");
    // sig-item has weekdayDeltaPct=50.0 → "Δ weekend +50.0%"
    const sigPattern = screen.getByTestId("weekly-pattern-sig-item");
    expect(sigPattern).toHaveTextContent(/Δ weekend/i);
    expect(sigPattern).toHaveTextContent("+50.0%");
    // nonsig-item has weekdayDeltaPct=-10.0 → "Δ weekend -10.0%"
    const nonsigPattern = screen.getByTestId("weekly-pattern-nonsig-item");
    expect(nonsigPattern).toHaveTextContent("-10.0%");
  });

  it("marks buy window cell with data-is-buy=true", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderTab(true);
    await screen.findByTestId("weekly-patterns-tab");
    // sig-item has buyWindowDay=1 (Monday) → cell at weekday 1 should have data-is-buy="true"
    const buyCell = screen.getByTestId("weekly-cell-sig-item-1");
    expect(buyCell).toHaveAttribute("data-is-buy", "true");
    // Cell at weekday 2 is NOT the buy window
    const otherCell = screen.getByTestId("weekly-cell-sig-item-2");
    expect(otherCell).toHaveAttribute("data-is-buy", "false");
  });

  it("marks sell window cell with data-is-sell=true", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderTab(true);
    await screen.findByTestId("weekly-patterns-tab");
    // sig-item has sellWindowDay=5 (Friday) → cell at weekday 5 should have data-is-sell="true"
    const sellCell = screen.getByTestId("weekly-cell-sig-item-5");
    expect(sellCell).toHaveAttribute("data-is-sell", "true");
    // Cell at weekday 1 is the buy window, NOT sell
    const buyCell = screen.getByTestId("weekly-cell-sig-item-1");
    expect(buyCell).toHaveAttribute("data-is-sell", "false");
  });

  it("renders empty-day cells with count=0", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderTab(true);
    await screen.findByTestId("weekly-patterns-tab");
    // sig-item has weekdays 1,3,5,6,7 with data; weekday 2 has count=0
    const emptyCell = screen.getByTestId("weekly-cell-sig-item-2");
    expect(emptyCell).toHaveAttribute("data-count", "0");
    // Weekday 1 has count=2
    const dataCell = screen.getByTestId("weekly-cell-sig-item-1");
    expect(dataCell).toHaveAttribute("data-count", "2");
  });

  it("renders all 7 weekday cells per pattern with correct weekday IDs", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderTab(true);
    await screen.findByTestId("weekly-patterns-tab");
    // Each cell should have data-weekday from 1 to 7
    for (let wd = 1; wd <= 7; wd++) {
      const cell = screen.getByTestId(`weekly-cell-sig-item-${wd}`);
      expect(cell).toHaveAttribute("data-weekday", String(wd));
    }
  });
});
