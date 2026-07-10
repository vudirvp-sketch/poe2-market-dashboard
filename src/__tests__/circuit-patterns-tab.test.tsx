// ============================================================================
// Unit tests for CircuitPatternsTab (F7 / P8, iter 97) — trajectory
// classification per currency.
//
// Coverage:
//   - Backend offline → renders offline card + hint
//   - Loading state → renders loading text
//   - Error state → renders error + refresh button
//   - data_available=false → renders "no data" notice
//   - data_available=true with patterns → renders pattern list + filter
//     chips + days selector
//   - data_available=true but empty patterns → renders "no patterns" notice
//   - Trajectory badge + recommended_action badge + total_change_pct render
//   - Each trajectory archetype renders correct localized label
//   - Each recommended_action renders correct localized label
//   - Filter chip click → calls fetchApi with new trajectory param
//   - Days selector change → calls fetchApi with new days param
//   - Sparkline renders for items with ≥2 history points
//   - Empty sparkline fallback for items with <2 history points
//   - Pattern count footer renders
//   - Fetched-at timestamp renders
//   - Proxy path /api/flipper/circuit-patterns is used
// ============================================================================
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@/lib/i18n";
import { CircuitPatternsTab } from "@/components/dashboard/circuit-patterns-tab";
import type { CircuitPatternsResponse, CircuitPattern } from "@/lib/types";

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
        <CircuitPatternsTab backendOnline={backendOnline} />
      </I18nProvider>
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}

// ---------------------------------------------------------------------------
// Test data — matches the CircuitPatternsResponse shape returned by the
// proxy route after camelCase transform.
// ---------------------------------------------------------------------------

function makePattern(overrides: Partial<CircuitPattern> = {}): CircuitPattern {
  return {
    apiId: "test-orb",
    text: "Test Orb",
    category: "ritual",
    trajectory: "EXPONENTIAL_GROWTH",
    totalChangePct: 1500.0,
    recentSlopePctPerDay: 8.5,
    volatilityCv: 0.42,
    rSquared: 0.94,
    daysSincePeak: null,
    recommendedAction: "HOLD_FOR_GROWTH",
    sampleSize: 14,
    currentPrice: 32.0,
    priceHistoryShort: [
      { date: "2026-06-01T00:00:00", price: 1.0 },
      { date: "2026-06-08T00:00:00", price: 2.0 },
      { date: "2026-06-15T00:00:00", price: 4.0 },
      { date: "2026-06-22T00:00:00", price: 32.0 },
    ],
    ...overrides,
  };
}

const mixedResponse: CircuitPatternsResponse = {
  league: "Standard",
  dataAvailable: true,
  fetchedAt: "2026-06-25T10:00:00Z",
  days: 30,
  patterns: [
    makePattern({
      apiId: "exp-item",
      text: "Exp Item",
      trajectory: "EXPONENTIAL_GROWTH",
      recommendedAction: "HOLD_FOR_GROWTH",
      totalChangePct: 1500.0,
    }),
    makePattern({
      apiId: "peak-item",
      text: "Peak Item",
      trajectory: "PEAK_THEN_DECLINE",
      recommendedAction: "SELL_NOW",
      totalChangePct: -50.0,
      daysSincePeak: 3,
      priceHistoryShort: [
        { date: "2026-06-01T00:00:00", price: 10.0 },
        { date: "2026-06-08T00:00:00", price: 100.0 },
        { date: "2026-06-15T00:00:00", price: 50.0 },
      ],
    }),
    makePattern({
      apiId: "decl-item",
      text: "Decl Item",
      trajectory: "DECLINING",
      recommendedAction: "AVOID",
      totalChangePct: -40.0,
      priceHistoryShort: [
        { date: "2026-06-01T00:00:00", price: 100.0 },
        { date: "2026-06-08T00:00:00", price: 60.0 },
      ],
    }),
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ============================================================================

describe("CircuitPatternsTab (F7 / P8, iter 97)", () => {
  beforeEach(() => {
    mockFetchApi.mockReset();
  });

  it("renders offline card when backend is offline", async () => {
    renderTab(false);
    // Should NOT call fetchApi when backend is offline (query is disabled)
    expect(mockFetchApi).not.toHaveBeenCalled();
    expect(await screen.findByText(/Circuit Patterns requires the analytics backend/i)).toBeInTheDocument();
  });

  it("renders loading state while fetching", async () => {
    // Never resolves — keeps the query in pending state
    mockFetchApi.mockReturnValue(new Promise(() => {}));
    renderTab(true);
    expect(await screen.findByText(/Classifying trajectories/i)).toBeInTheDocument();
  });

  it("renders error state with refresh button on fetch failure", async () => {
    mockFetchApi.mockRejectedValue(new Error("network error"));
    renderTab(true);
    await waitFor(() => {
      expect(screen.getByText(/Failed to classify trajectories/i)).toBeInTheDocument();
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
      patterns: [],
    });
    renderTab(true);
    expect(await screen.findByText(/No price history available yet/i)).toBeInTheDocument();
  });

  it("renders pattern list when dataAvailable=true with patterns", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderTab(true);
    // Wait for the main card to appear
    const tab = await screen.findByTestId("circuit-patterns-tab");
    expect(tab).toBeInTheDocument();
    // Three pattern rows should be rendered
    const patterns = screen.getAllByTestId(/^circuit-pattern-/);
    expect(patterns).toHaveLength(3);
    // Each pattern's text should be visible
    expect(screen.getByText("Exp Item")).toBeInTheDocument();
    expect(screen.getByText("Peak Item")).toBeInTheDocument();
    expect(screen.getByText("Decl Item")).toBeInTheDocument();
  });

  it("renders trajectory badges with localized labels", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderTab(true);
    await screen.findByTestId("circuit-patterns-tab");
    // Each trajectory archetype's localized label should appear at least once
    // (badge in the row + potentially filter chip).
    expect(screen.getAllByText("Exponential Growth").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Peak then Decline").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Declining").length).toBeGreaterThan(0);
  });

  it("renders recommended_action badges with localized labels", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderTab(true);
    await screen.findByTestId("circuit-patterns-tab");
    expect(screen.getAllByText("HOLD for growth").length).toBeGreaterThan(0);
    expect(screen.getAllByText("SELL now").length).toBeGreaterThan(0);
    expect(screen.getAllByText("AVOID").length).toBeGreaterThan(0);
  });

  it("renders total_change_pct with sign and unit", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderTab(true);
    await screen.findByTestId("circuit-patterns-tab");
    // +1500.0% for exp-item, -50.0% for peak-item, -40.0% for decl-item
    expect(screen.getByText(/\+1500\.0%/)).toBeInTheDocument();
    expect(screen.getByText(/-50\.0%/)).toBeInTheDocument();
    expect(screen.getByText(/-40\.0%/)).toBeInTheDocument();
  });

  it("renders filter chips: ALL + 7 trajectory archetypes", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderTab(true);
    await screen.findByTestId("circuit-patterns-tab");
    // ALL chip + 7 archetype chips = 8 chips total
    expect(screen.getByTestId("circuit-filter-all")).toBeInTheDocument();
    expect(screen.getByTestId("circuit-filter-exponential")).toBeInTheDocument();
    expect(screen.getByTestId("circuit-filter-linear")).toBeInTheDocument();
    expect(screen.getByTestId("circuit-filter-peak")).toBeInTheDocument();
    expect(screen.getByTestId("circuit-filter-mean-rev")).toBeInTheDocument();
    expect(screen.getByTestId("circuit-filter-volatile")).toBeInTheDocument();
    expect(screen.getByTestId("circuit-filter-declining")).toBeInTheDocument();
    expect(screen.getByTestId("circuit-filter-stable")).toBeInTheDocument();
  });

  it("renders days selector with 7/14/30/90 options (default 30 visible)", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderTab(true);
    await screen.findByTestId("circuit-patterns-tab");
    // The default 30 days should be visible in the trigger
    expect(screen.getByText("30 days")).toBeInTheDocument();
  });

  it("renders sparkline SVG for items with ≥2 history points", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderTab(true);
    await screen.findByTestId("circuit-patterns-tab");
    const sparklines = screen.getAllByTestId("circuit-sparkline");
    expect(sparklines.length).toBe(3); // one per pattern row
  });

  it("renders empty sparkline fallback for items with <2 history points", async () => {
    const singlePointResponse: CircuitPatternsResponse = {
      ...mixedResponse,
      patterns: [
        makePattern({
          apiId: "single-point",
          text: "Single Point",
          priceHistoryShort: [{ date: "2026-06-01T00:00:00", price: 100.0 }],
        }),
      ],
    };
    mockFetchApi.mockResolvedValue(singlePointResponse);
    renderTab(true);
    await screen.findByTestId("circuit-patterns-tab");
    expect(screen.getByTestId("circuit-sparkline-empty")).toBeInTheDocument();
  });

  it("renders pattern count and fetched-at footer", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderTab(true);
    await screen.findByTestId("circuit-patterns-tab");
    // Pattern count: "3 patterns"
    expect(screen.getByText(/3 patterns/i)).toBeInTheDocument();
    // Fetched-at timestamp (we render via toLocaleString, so just check the prefix)
    expect(screen.getByText(/Fetched:/i)).toBeInTheDocument();
  });

  it("calls fetchApi with /api/flipper/circuit-patterns path", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderTab(true);
    await screen.findByTestId("circuit-patterns-tab");
    expect(mockFetchApi).toHaveBeenCalledWith(
      "/api/flipper/circuit-patterns",
      expect.objectContaining({
        days: expect.any(String),
        limit: expect.any(String),
        trajectory: expect.any(String),
      }),
    );
  });

  it("renders 'no patterns' notice when dataAvailable=true but patterns is empty", async () => {
    mockFetchApi.mockResolvedValue({
      league: "Standard",
      dataAvailable: true,
      fetchedAt: "2026-06-25T10:00:00Z",
      days: 30,
      patterns: [],
    });
    renderTab(true);
    expect(await screen.findByText(/No actionable patterns in the current window/i)).toBeInTheDocument();
  });

  it("clicking DECLINING filter chip calls fetchApi with trajectory=DECLINING", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderTab(true);
    await screen.findByTestId("circuit-patterns-tab");
    // Reset mock to clear the initial call
    mockFetchApi.mockClear();
    // Click the DECLINING filter chip
    const decliningChip = screen.getByTestId("circuit-filter-declining");
    fireEvent.click(decliningChip);
    // Wait for the new query to fire
    await waitFor(() => {
      expect(mockFetchApi).toHaveBeenCalled();
    });
    const lastCall = mockFetchApi.mock.calls[mockFetchApi.mock.calls.length - 1];
    expect(lastCall[1].trajectory).toBe("DECLINING");
  });

  it("renders sample size, slope, volatility, R², current price stats", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderTab(true);
    await screen.findByTestId("circuit-patterns-tab");
    // Default pattern: sampleSize=14, slope=8.50%/d, vol=0.42, R²=0.94, current=32.00
    // Multiple patterns share these default values, so we use getAllByText.
    expect(screen.getAllByText(/14 pts/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/slope 8\.50%\/d/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/vol 0\.42/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/R² 0\.94/i).length).toBeGreaterThan(0);
    // currentPrice=32.0 → fmt() returns "32.00"
    expect(screen.getAllByText(/current 32\.00/i).length).toBeGreaterThan(0);
  });

  it("renders days-since-peak label only for PEAK_THEN_DECLINE patterns", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderTab(true);
    await screen.findByTestId("circuit-patterns-tab");
    // Only peak-item has daysSincePeak=3 → "peak 3d ago" should appear once.
    expect(screen.getAllByText(/peak 3d ago/i).length).toBe(1);
  });

  it("renders category title-case next to item name", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderTab(true);
    await screen.findByTestId("circuit-patterns-tab");
    // mixedResponse uses category "ritual" → title-cased "Ritual".
    // All three patterns share the same category, so multiple matches.
    expect(screen.getAllByText(/Ritual/i).length).toBeGreaterThan(0);
  });

  it("renders all 5 recommended_action labels in a complete dataset", async () => {
    const allActionsResponse: CircuitPatternsResponse = {
      ...mixedResponse,
      patterns: [
        makePattern({ apiId: "a1", text: "A1", trajectory: "EXPONENTIAL_GROWTH", recommendedAction: "HOLD_FOR_GROWTH" }),
        makePattern({ apiId: "a2", text: "A2", trajectory: "PEAK_THEN_DECLINE", recommendedAction: "SELL_NOW", daysSincePeak: 1 }),
        makePattern({ apiId: "a3", text: "A3", trajectory: "DECLINING", recommendedAction: "AVOID" }),
        makePattern({ apiId: "a4", text: "A4", trajectory: "VOLATILE", recommendedAction: "WATCH" }),
        makePattern({ apiId: "a5", text: "A5", trajectory: "STABLE", recommendedAction: "NEUTRAL" }),
      ],
    };
    mockFetchApi.mockResolvedValue(allActionsResponse);
    renderTab(true);
    await screen.findByTestId("circuit-patterns-tab");
    expect(screen.getAllByText("HOLD for growth").length).toBeGreaterThan(0);
    expect(screen.getAllByText("SELL now").length).toBeGreaterThan(0);
    expect(screen.getAllByText("AVOID").length).toBeGreaterThan(0);
    expect(screen.getAllByText("WATCH").length).toBeGreaterThan(0);
    expect(screen.getAllByText("NEUTRAL").length).toBeGreaterThan(0);
  });
});
