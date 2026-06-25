// ============================================================================
// Unit tests for the Backtest panel inside SpeculationTab (F5 follow-up, iter 80).
//
// The Backtest panel is an internal subcomponent of SpeculationTab — it is
// rendered below the live signals list and is collapsed by default. Clicking
// the "Run backtest" toggle button expands it and triggers the backtest query.
//
// Coverage:
//   - Collapsed by default → toggle button visible, no fetch called
//   - Backend offline → no fetch called (parent short-circuits but panel
//     also guards via `enabled: showBacktest && backendOnline`)
//   - Clicking toggle → panel expands + fetch fires with default params
//   - Loading state → spinner text visible
//   - Error state → error notice visible
//   - dataAvailable=false → "no data" notice visible
//   - dataAvailable=true but trades=[] → "no trades" notice visible
//   - Mixed BUY+SELL trades → stats + breakdown + trades list render
//   - Per-signal stats blocks (Overall / BUY / SELL) render correct numbers
//   - Signal breakdown shows BUY/SELL/HOLD counts + evaluated/unevaluated
//   - Trade rows show signal badge + name + entry → exit + return_pct
//   - Profit/loss coloring on return_pct
//   - Fetched-at footer renders
//   - Proxy path /api/flipper/speculation/backtest is used
//   - signalFilter from parent is forwarded as `signal` query param
//   - Hide button collapses panel back
// ============================================================================
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@/lib/i18n";
import { SpeculationTab } from "@/components/dashboard/speculation-tab";
import type { SpeculationResponse, SpeculationBacktestResponse } from "@/lib/types";

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
// Test data — parent speculation response (so the parent tab renders the
// main panel + the collapsed Backtest toggle button).
// ---------------------------------------------------------------------------

const liveResponse: SpeculationResponse = {
  league: "Standard",
  dataAvailable: true,
  fetchedAt: "2026-06-25T10:00:00Z",
  days: 30,
  signals: [
    {
      apiId: "buy-item",
      text: "Buy Item",
      category: "ritual",
      currentPrice: 50.0,
      mean: 100.0,
      std: 20.0,
      zScore: -2.5,
      percentile: 5.0,
      signal: "BUY",
      horizonHint: "short",
      sampleSize: 14,
      priceHistoryShort: [
        { date: "2026-06-01T00:00:00", price: 100.0 },
        { date: "2026-06-15T00:00:00", price: 50.0 },
      ],
    },
  ],
};

function makeBacktestResponse(
  overrides: Partial<SpeculationBacktestResponse> = {},
): SpeculationBacktestResponse {
  return {
    league: "Standard",
    trades: [
      {
        apiId: "buy-trade",
        text: "Buy Trade",
        category: "ritual",
        signal: "BUY",
        entryPrice: 80.0,
        entryDate: "2026-06-11T00:00:00Z",
        exitPrice: 95.0,
        exitDate: "2026-06-18T00:00:00Z",
        returnPct: 18.75,
        zScoreAtEntry: -2.1,
        sampleSizeAtEntry: 14,
      },
      {
        apiId: "sell-trade",
        text: "Sell Trade",
        category: "breach",
        signal: "SELL",
        entryPrice: 130.0,
        entryDate: "2026-06-11T00:00:00Z",
        exitPrice: 110.0,
        exitDate: "2026-06-18T00:00:00Z",
        returnPct: 15.38,
        zScoreAtEntry: 2.4,
        sampleSizeAtEntry: 12,
      },
    ],
    signalBreakdown: { BUY: 1, SELL: 1, HOLD: 3 },
    evaluatedCount: 2,
    unevaluatedCount: 1,
    buyStats: {
      count: 1,
      winRate: 100.0,
      meanReturnPct: 18.75,
      medianReturnPct: 18.75,
      bestReturnPct: 18.75,
      worstReturnPct: 18.75,
    },
    sellStats: {
      count: 1,
      winRate: 100.0,
      meanReturnPct: 15.38,
      medianReturnPct: 15.38,
      bestReturnPct: 15.38,
      worstReturnPct: 15.38,
    },
    overallStats: {
      count: 2,
      winRate: 100.0,
      meanReturnPct: 17.07,
      medianReturnPct: 17.07,
      bestReturnPct: 18.75,
      worstReturnPct: 15.38,
    },
    dataAvailable: true,
    fetchedAt: "2026-06-25T10:05:00Z",
    evalDaysAgo: 14,
    holdingDays: 7,
    lookbackDays: 30,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ============================================================================

describe("SpeculationTab Backtest panel (F5 follow-up, iter 80)", () => {
  beforeEach(() => {
    mockFetchApi.mockReset();
  });

  it("renders collapsed backtest toggle button when parent has live signals", async () => {
    mockFetchApi.mockResolvedValue(liveResponse);
    renderTab(true);
    await screen.findByTestId("speculation-tab");
    // Collapsed panel should be visible (toggle button only)
    expect(screen.getByTestId("speculation-backtest-panel-collapsed")).toBeInTheDocument();
    expect(screen.getByTestId("speculation-backtest-toggle")).toBeInTheDocument();
    // Expanded panel content should NOT be visible yet
    expect(screen.queryByTestId("speculation-backtest-panel")).not.toBeInTheDocument();
  });

  it("does NOT call fetchApi for backtest path when panel is collapsed", async () => {
    mockFetchApi.mockResolvedValue(liveResponse);
    renderTab(true);
    await screen.findByTestId("speculation-tab");
    // Wait a tick to ensure no async query fires
    await new Promise((r) => setTimeout(r, 100));
    const backtestCalls = mockFetchApi.mock.calls.filter(
      ([path]) => typeof path === "string" && path.includes("/speculation/backtest"),
    );
    expect(backtestCalls).toHaveLength(0);
  });

  it("expands panel and fires backtest query on toggle click", async () => {
    // First call: live signals. Second call: backtest.
    mockFetchApi.mockImplementation((path: string) => {
      if (path.includes("/speculation/backtest")) {
        return Promise.resolve(makeBacktestResponse());
      }
      return Promise.resolve(liveResponse);
    });
    renderTab(true);
    await screen.findByTestId("speculation-tab");
    // Reset to clear the initial live-signals call
    mockFetchApi.mockClear();
    // Click toggle to expand
    fireEvent.click(screen.getByTestId("speculation-backtest-toggle"));
    // Wait for the backtest query to fire
    await waitFor(() => {
      const backtestCalls = mockFetchApi.mock.calls.filter(
        ([p]) => typeof p === "string" && p.includes("/speculation/backtest"),
      );
      expect(backtestCalls.length).toBeGreaterThan(0);
    });
    // Verify expanded panel is visible
    await screen.findByTestId("speculation-backtest-panel");
  });

  it("calls backtest proxy with default params (eval=14, holding=7, lookback=30, limit=50)", async () => {
    mockFetchApi.mockImplementation((path: string) => {
      if (path.includes("/speculation/backtest")) {
        return Promise.resolve(makeBacktestResponse());
      }
      return Promise.resolve(liveResponse);
    });
    renderTab(true);
    await screen.findByTestId("speculation-tab");
    mockFetchApi.mockClear();
    fireEvent.click(screen.getByTestId("speculation-backtest-toggle"));
    await waitFor(() => {
      expect(mockFetchApi).toHaveBeenCalledWith(
        "/api/flipper/speculation/backtest",
        expect.objectContaining({
          eval_days_ago: "14",
          holding_days: "7",
          lookback_days: "30",
          limit: "50",
          signal: "ALL",
        }),
      );
    });
  });

  it("renders loading state while backtest is fetching", async () => {
    mockFetchApi.mockImplementation((path: string) => {
      if (path.includes("/speculation/backtest")) {
        // Never resolves — keeps query in pending state
        return new Promise(() => {});
      }
      return Promise.resolve(liveResponse);
    });
    renderTab(true);
    await screen.findByTestId("speculation-tab");
    fireEvent.click(screen.getByTestId("speculation-backtest-toggle"));
    expect(await screen.findByTestId("speculation-backtest-loading")).toBeInTheDocument();
  });

  it("renders error state when backtest query fails", async () => {
    mockFetchApi.mockImplementation((path: string) => {
      if (path.includes("/speculation/backtest")) {
        return Promise.reject(new Error("network error"));
      }
      return Promise.resolve(liveResponse);
    });
    renderTab(true);
    await screen.findByTestId("speculation-tab");
    fireEvent.click(screen.getByTestId("speculation-backtest-toggle"));
    await waitFor(() => {
      expect(screen.getByTestId("speculation-backtest-error")).toBeInTheDocument();
    }, ERROR_WAIT_OPTS);
  });

  it("renders 'no data' notice when dataAvailable is false", async () => {
    mockFetchApi.mockImplementation((path: string) => {
      if (path.includes("/speculation/backtest")) {
        return Promise.resolve(makeBacktestResponse({ dataAvailable: false, trades: [] }));
      }
      return Promise.resolve(liveResponse);
    });
    renderTab(true);
    await screen.findByTestId("speculation-tab");
    fireEvent.click(screen.getByTestId("speculation-backtest-toggle"));
    expect(await screen.findByTestId("speculation-backtest-no-data")).toBeInTheDocument();
  });

  it("renders 'no trades' notice when dataAvailable=true but trades is empty", async () => {
    mockFetchApi.mockImplementation((path: string) => {
      if (path.includes("/speculation/backtest")) {
        return Promise.resolve(
          makeBacktestResponse({
            dataAvailable: true,
            trades: [],
            evaluatedCount: 0,
            unevaluatedCount: 2,
            signalBreakdown: { BUY: 0, SELL: 0, HOLD: 2 },
            buyStats: { count: 0, winRate: 0, meanReturnPct: 0, medianReturnPct: 0, bestReturnPct: 0, worstReturnPct: 0 },
            sellStats: { count: 0, winRate: 0, meanReturnPct: 0, medianReturnPct: 0, bestReturnPct: 0, worstReturnPct: 0 },
            overallStats: { count: 0, winRate: 0, meanReturnPct: 0, medianReturnPct: 0, bestReturnPct: 0, worstReturnPct: 0 },
          }),
        );
      }
      return Promise.resolve(liveResponse);
    });
    renderTab(true);
    await screen.findByTestId("speculation-tab");
    fireEvent.click(screen.getByTestId("speculation-backtest-toggle"));
    expect(await screen.findByTestId("speculation-backtest-no-trades")).toBeInTheDocument();
  });

  it("renders stats blocks (Overall / BUY / SELL) with aggregated numbers", async () => {
    mockFetchApi.mockImplementation((path: string) => {
      if (path.includes("/speculation/backtest")) {
        return Promise.resolve(makeBacktestResponse());
      }
      return Promise.resolve(liveResponse);
    });
    renderTab(true);
    await screen.findByTestId("speculation-tab");
    fireEvent.click(screen.getByTestId("speculation-backtest-toggle"));
    await screen.findByTestId("speculation-backtest-content");
    // Three stats blocks rendered
    expect(screen.getByTestId("speculation-backtest-stats-overall")).toBeInTheDocument();
    expect(screen.getByTestId("speculation-backtest-stats-buy")).toBeInTheDocument();
    expect(screen.getByTestId("speculation-backtest-stats-sell")).toBeInTheDocument();
    // Overall count=2, win rate=100.0%
    expect(screen.getByTestId("speculation-backtest-stats-overall").textContent).toMatch(/2/);
    expect(screen.getByTestId("speculation-backtest-stats-overall").textContent).toMatch(/100\.0%/);
    // BUY block shows 18.75% mean return
    expect(screen.getByTestId("speculation-backtest-stats-buy").textContent).toMatch(/\+18\.75%/);
    // SELL block shows 15.38% mean return
    expect(screen.getByTestId("speculation-backtest-stats-sell").textContent).toMatch(/\+15\.38%/);
  });

  it("renders signal breakdown with BUY/SELL/HOLD counts + evaluated/unevaluated", async () => {
    mockFetchApi.mockImplementation((path: string) => {
      if (path.includes("/speculation/backtest")) {
        return Promise.resolve(makeBacktestResponse());
      }
      return Promise.resolve(liveResponse);
    });
    renderTab(true);
    await screen.findByTestId("speculation-tab");
    fireEvent.click(screen.getByTestId("speculation-backtest-toggle"));
    const breakdown = await screen.findByTestId("speculation-backtest-breakdown");
    expect(breakdown).toBeInTheDocument();
    // BUY 1, SELL 1, HOLD 3
    expect(breakdown.textContent).toMatch(/BUY\s+1/);
    expect(breakdown.textContent).toMatch(/SELL\s+1/);
    expect(breakdown.textContent).toMatch(/HOLD\s+3/);
    // 2 evaluated, 1 unevaluated
    expect(breakdown.textContent).toMatch(/2 evaluated/i);
    expect(breakdown.textContent).toMatch(/1 unevaluated/i);
  });

  it("renders trade rows with item name + signal + entry/exit + return_pct", async () => {
    mockFetchApi.mockImplementation((path: string) => {
      if (path.includes("/speculation/backtest")) {
        return Promise.resolve(makeBacktestResponse());
      }
      return Promise.resolve(liveResponse);
    });
    renderTab(true);
    await screen.findByTestId("speculation-tab");
    fireEvent.click(screen.getByTestId("speculation-backtest-toggle"));
    await screen.findByTestId("speculation-backtest-content");
    // Two trade rows
    expect(screen.getByTestId("speculation-backtest-trade-buy-trade")).toBeInTheDocument();
    expect(screen.getByTestId("speculation-backtest-trade-sell-trade")).toBeInTheDocument();
    // Item names visible
    expect(screen.getByText("Buy Trade")).toBeInTheDocument();
    expect(screen.getByText("Sell Trade")).toBeInTheDocument();
    // Return pct rendered with sign: BUY 18.75% → "+18.75%", SELL 15.38% → "+15.38%"
    expect(screen.getByTestId("speculation-backtest-trade-buy-trade").textContent).toMatch(/\+18\.75%/);
    expect(screen.getByTestId("speculation-backtest-trade-sell-trade").textContent).toMatch(/\+15\.38%/);
  });

  it("renders fetched-at footer with trade count", async () => {
    mockFetchApi.mockImplementation((path: string) => {
      if (path.includes("/speculation/backtest")) {
        return Promise.resolve(makeBacktestResponse());
      }
      return Promise.resolve(liveResponse);
    });
    renderTab(true);
    await screen.findByTestId("speculation-tab");
    fireEvent.click(screen.getByTestId("speculation-backtest-toggle"));
    await screen.findByTestId("speculation-backtest-content");
    // Footer: "Backtest fetched: ..." + "2 trades"
    expect(screen.getByText(/Backtest fetched:/i)).toBeInTheDocument();
    expect(screen.getByText(/2 trades/i)).toBeInTheDocument();
  });

  it("collapses panel when Hide button is clicked", async () => {
    mockFetchApi.mockImplementation((path: string) => {
      if (path.includes("/speculation/backtest")) {
        return Promise.resolve(makeBacktestResponse());
      }
      return Promise.resolve(liveResponse);
    });
    renderTab(true);
    await screen.findByTestId("speculation-tab");
    // Expand
    fireEvent.click(screen.getByTestId("speculation-backtest-toggle"));
    await screen.findByTestId("speculation-backtest-panel");
    // Collapse
    fireEvent.click(screen.getByTestId("speculation-backtest-toggle"));
    // Wait for collapsed state to reappear
    await waitFor(() => {
      expect(screen.getByTestId("speculation-backtest-panel-collapsed")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("speculation-backtest-panel")).not.toBeInTheDocument();
  });

  it("forwards parent signalFilter (BUY) as `signal` query param to backtest", async () => {
    mockFetchApi.mockImplementation((path: string) => {
      if (path.includes("/speculation/backtest")) {
        return Promise.resolve(makeBacktestResponse());
      }
      return Promise.resolve(liveResponse);
    });
    renderTab(true);
    await screen.findByTestId("speculation-tab");
    // Click the BUY filter chip on the parent
    fireEvent.click(screen.getByTestId("speculation-filter-buy"));
    // Wait for the live-signals query to refire with signal=BUY
    await waitFor(() => {
      const liveCalls = mockFetchApi.mock.calls.filter(
        ([p]) => typeof p === "string" && p === "/api/flipper/speculation",
      );
      expect(liveCalls.some(([, params]) => (params as Record<string, string>).signal === "BUY")).toBe(true);
    });
    // Wait for the main panel (with collapsed backtest toggle) to re-render
    // after the signal-filter change. The parent transitions through a loading
    // state because the queryKey changed — we need to wait until the main
    // speculation-tab testid is back in the DOM.
    await waitFor(() => {
      expect(screen.getByTestId("speculation-backtest-toggle")).toBeInTheDocument();
    });
    // Now expand the backtest panel
    fireEvent.click(screen.getByTestId("speculation-backtest-toggle"));
    await waitFor(() => {
      const backtestCalls = mockFetchApi.mock.calls.filter(
        ([p]) => typeof p === "string" && p.includes("/speculation/backtest"),
      );
      // The last backtest call should pass signal=BUY
      const lastBacktestCall = backtestCalls[backtestCalls.length - 1];
      expect(lastBacktestCall).toBeDefined();
      expect((lastBacktestCall[1] as Record<string, string>).signal).toBe("BUY");
    });
  });

  it("renders day selectors for eval / holding / lookback with default values", async () => {
    mockFetchApi.mockImplementation((path: string) => {
      if (path.includes("/speculation/backtest")) {
        return Promise.resolve(makeBacktestResponse());
      }
      return Promise.resolve(liveResponse);
    });
    renderTab(true);
    await screen.findByTestId("speculation-tab");
    fireEvent.click(screen.getByTestId("speculation-backtest-toggle"));
    await screen.findByTestId("speculation-backtest-panel");
    // Three day selectors present
    expect(screen.getByTestId("speculation-backtest-eval-days")).toBeInTheDocument();
    expect(screen.getByTestId("speculation-backtest-holding-days")).toBeInTheDocument();
    expect(screen.getByTestId("speculation-backtest-lookback-days")).toBeInTheDocument();
    // Default labels show the default values
    expect(screen.getByText(/Eval 14 days ago/i)).toBeInTheDocument();
    expect(screen.getByText(/Hold 7 days/i)).toBeInTheDocument();
    expect(screen.getByText(/Lookback 30 days/i)).toBeInTheDocument();
  });
});
