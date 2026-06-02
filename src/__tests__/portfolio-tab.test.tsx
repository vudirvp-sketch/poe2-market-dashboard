// ============================================================================
// Unit tests for PortfolioTab — Portfolio allocation, risk metrics,
// correlation matrix, rebalance controls, efficient frontier chart.
// Tests rendering with backend online/offline, method selection,
// weights display, and correlation shock detection.
// ============================================================================
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@/lib/i18n";
import { PortfolioTab } from "@/components/dashboard/portfolio-tab";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetchApi = jest.fn();
jest.mock("@/lib/types", () => ({
  ...jest.requireActual("@/lib/types"),
  fetchApi: (...args: unknown[]) => mockFetchApi(...args),
  getFlipperErrorType: jest.fn().mockReturnValue(null),
}));

// Mock recharts
jest.mock("recharts", () => ({
  BarChart: ({ children }: { children: React.ReactNode }) => <div data-testid="bar-chart">{children}</div>,
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Cell: () => null,
  ScatterChart: ({ children }: { children: React.ReactNode }) => <div data-testid="scatter-chart">{children}</div>,
  Scatter: () => null,
  Line: () => null,
  Legend: () => null,
  ZAxis: () => null,
}));

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
}

function renderPortfolioTab(backendOnline: boolean = true) {
  const queryClient = createTestQueryClient();
  window.localStorage.setItem("poe2-locale", "en");

  const result = render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <PortfolioTab backendOnline={backendOnline} />
      </I18nProvider>
    </QueryClientProvider>
  );
  return { ...result, queryClient };
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const mockPortfolioData = {
  method: "risk_parity" as const,
  weights: {
    divine: 0.35,
    exalted: 0.30,
    chaos: 0.20,
    gold: 0.15,
  },
  expectedRisk: 0.12,
  correlationWarning: false,
  lastRebalance: "2025-01-01T00:00:00Z",
  correlation_matrix: {
    currencies: ["divine", "exalted", "chaos", "gold"],
    matrix: [
      [1.0, 0.8, 0.3, -0.2],
      [0.8, 1.0, 0.5, 0.1],
      [0.3, 0.5, 1.0, 0.6],
      [-0.2, 0.1, 0.6, 1.0],
    ],
  },
};

const mockPortfolioWithCorrelationShock = {
  ...mockPortfolioData,
  correlationWarning: true,
};

const mockFrontierData = {
  frontier: {
    risks: [0.05, 0.10, 0.15, 0.20, 0.25],
    returns: [0.02, 0.05, 0.08, 0.10, 0.11],
  },
  individual_assets: [
    { name: "divine", risk: 0.12, return: 0.07 },
    { name: "exalted", risk: 0.18, return: 0.09 },
  ],
  current_portfolio: { risk: 0.12, return: 0.07 },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PortfolioTab", () => {
  beforeEach(() => {
    mockFetchApi.mockReset();
    window.localStorage.clear();
  });

  // ---- Backend offline ----

  it("renders backend offline message when backend is offline", () => {
    renderPortfolioTab(false);
    expect(screen.getByText(/uvicorn backend.main:app/)).toBeInTheDocument();
  });

  it("shows offline status indicator when backend is offline", () => {
    renderPortfolioTab(false);
    expect(screen.getByText(/Backend offline/i)).toBeInTheDocument();
  });

  // ---- Backend online with data ----

  it("renders method selector when backend is online", async () => {
    mockFetchApi.mockImplementation((url: string) => {
      if (url.includes("/portfolio/frontier")) return Promise.resolve(mockFrontierData);
      return Promise.resolve(mockPortfolioData);
    });

    renderPortfolioTab(true);

    await waitFor(() => {
      expect(screen.getByText("Risk Parity")).toBeInTheDocument();
    });
  });

  it("renders annualized risk when data is loaded", async () => {
    mockFetchApi.mockResolvedValue(mockPortfolioData);

    renderPortfolioTab(true);

    await waitFor(() => {
      expect(screen.getByText("12.00%")).toBeInTheDocument();
    });
  });

  // ---- Correlation shock ----

  it("shows correlation shock warning when detected", async () => {
    mockFetchApi.mockImplementation((url: string) => {
      if (url.includes("/portfolio/frontier")) return Promise.resolve(mockFrontierData);
      return Promise.resolve(mockPortfolioWithCorrelationShock);
    });

    renderPortfolioTab(true);

    await waitFor(() => {
      expect(screen.getByText("Shock Detected")).toBeInTheDocument();
    });
  });

  it("shows no-shock badge when correlation is normal", async () => {
    mockFetchApi.mockResolvedValue(mockPortfolioData);

    renderPortfolioTab(true);

    await waitFor(() => {
      expect(screen.getByText("No Shock")).toBeInTheDocument();
    });
  });

  // ---- Loading states ----

  it("shows loading skeleton while data is being fetched", () => {
    mockFetchApi.mockImplementation(() => new Promise(() => {}));

    renderPortfolioTab(true);

    const skeletons = document.querySelectorAll('[class*="animate-pulse"]');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  // ---- Allocation details table ----

  it("renders allocation details table with weight percentages", async () => {
    mockFetchApi.mockResolvedValue(mockPortfolioData);

    renderPortfolioTab(true);

    await waitFor(() => {
      expect(screen.getByText("35.00%")).toBeInTheDocument();
      expect(screen.getByText("30.00%")).toBeInTheDocument();
      expect(screen.getByText("20.00%")).toBeInTheDocument();
      expect(screen.getByText("15.00%")).toBeInTheDocument();
    });
  });

  // ---- Correlation matrix ----

  it("renders correlation matrix section when data is available", async () => {
    mockFetchApi.mockResolvedValue(mockPortfolioData);

    renderPortfolioTab(true);

    await waitFor(() => {
      // The correlation matrix renders a table with currency headers and data
      // Check for the table with role="table" that contains correlation data
      // The table cells contain numeric correlation values like "0.80"
      const matrixCells = screen.queryAllByText("0.80");
      expect(matrixCells.length).toBeGreaterThan(0);
    });
  });

  // ---- Method explanation ----

  it("shows method explanation toggle", async () => {
    mockFetchApi.mockResolvedValue(mockPortfolioData);

    renderPortfolioTab(true);

    await waitFor(() => {
      expect(screen.getByText(/Method Explanation/i)).toBeInTheDocument();
    });
  });

  // ---- Rebalance button ----

  it("renders rebalance button", async () => {
    mockFetchApi.mockResolvedValue(mockPortfolioData);

    renderPortfolioTab(true);

    await waitFor(() => {
      expect(screen.getByText(/Rebalance Portfolio/i)).toBeInTheDocument();
    });
  });

  // ---- Empty weights ----

  it("shows no-weights message when portfolio returns empty weights", async () => {
    mockFetchApi.mockResolvedValue({
      ...mockPortfolioData,
      weights: {},
    });

    renderPortfolioTab(true);

    await waitFor(() => {
      expect(screen.getByText(/No portfolio weights computed/i)).toBeInTheDocument();
    });
  });

  // ---- Currency names in table ----

  it("renders currency names in the allocation table", async () => {
    mockFetchApi.mockResolvedValue(mockPortfolioData);

    renderPortfolioTab(true);

    await waitFor(() => {
      // Currency names appear multiple times (in table + in matrix headers)
      // Use getAllByText since names appear both as text and in title attributes
      expect(screen.getAllByText("divine").length).toBeGreaterThan(0);
      expect(screen.getAllByText("exalted").length).toBeGreaterThan(0);
      expect(screen.getAllByText("chaos").length).toBeGreaterThan(0);
      expect(screen.getAllByText("gold").length).toBeGreaterThan(0);
    });
  });

  // ---- Phase context info ----

  it("renders phase context info card", async () => {
    mockFetchApi.mockResolvedValue(mockPortfolioData);

    renderPortfolioTab(true);

    await waitFor(() => {
      expect(screen.getByText(/Portfolio holding is recommended/i)).toBeInTheDocument();
    });
  });
});
