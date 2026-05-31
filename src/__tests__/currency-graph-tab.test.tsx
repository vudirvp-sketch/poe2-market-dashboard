// ============================================================================
// Unit tests for CurrencyGraphTab — Network visualization of currency trade
// pairs. Tests rendering with backend online/offline, graph statistics,
// focus selector, zoom controls, and cycle detection display.
// ============================================================================
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@/lib/i18n";
import { CurrencyGraphTab } from "@/components/dashboard/currency-graph-tab";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetchApi = jest.fn();
jest.mock("@/lib/types", () => ({
  ...jest.requireActual("@/lib/types"),
  fetchApi: (...args: unknown[]) => mockFetchApi(...args),
  getFlipperErrorType: jest.fn().mockReturnValue(null),
  fmt: (n: number) => n.toFixed(4),
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

function renderCurrencyGraphTab(backendOnline: boolean = true) {
  const queryClient = createTestQueryClient();
  window.localStorage.setItem("poe2-locale", "en");

  const result = render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <CurrencyGraphTab backendOnline={backendOnline} />
      </I18nProvider>
    </QueryClientProvider>
  );
  return { ...result, queryClient };
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const mockPricesData = {
  league: "vaal",
  phase: "mid",
  rates: [
    {
      pair: "divine-exalted",
      currency_from: "divine",
      currency_to: "exalted",
      raw_rate: 1.5,
      volume_traded: 500,
      fee_fraction: 0.02,
      volatility: 0.15,
      momentum: 0.02,
      cluster_from: "stable",
      cluster_to: "stable",
    },
    {
      pair: "exalted-chaos",
      currency_from: "exalted",
      currency_to: "chaos",
      raw_rate: 120.0,
      volume_traded: 1000,
      fee_fraction: 0.01,
      volatility: 0.10,
      momentum: 0.01,
      cluster_from: "stable",
      cluster_to: "moderate",
    },
    {
      pair: "chaos-gold",
      currency_from: "chaos",
      currency_to: "gold",
      raw_rate: 0.8,
      volume_traded: 300,
      fee_fraction: 0.03,
      volatility: 0.25,
      momentum: -0.01,
      cluster_from: "moderate",
      cluster_to: "volatile_illiquid",
    },
  ],
  gold_to_chaos_rate: 150,
  base_currency: "exalted",
  fetched_at: "2025-01-01T00:00:00Z",
};

const mockTriangularData = {
  cycles: [
    {
      cycle: ["divine", "exalted", "chaos", "divine"],
      net_profit_pct: 2.5,
      step_rates: [1.5, 120.0, 0.005],
      step_fees_fraction: [0.02, 0.01, 0.03],
    },
  ],
  total: 1,
};

const mockCurrenciesData = {
  currencies: [
    { api_id: "divine", text: "Divine Orb", icon_url: null },
    { api_id: "exalted", text: "Exalted Orb", icon_url: null },
    { api_id: "chaos", text: "Chaos Orb", icon_url: null },
    { api_id: "gold", text: "Gold", icon_url: null },
  ],
};

const mockEmptyPricesData = {
  league: "vaal",
  phase: "mid",
  rates: [],
  gold_to_chaos_rate: 150,
  base_currency: "exalted",
  fetched_at: "2025-01-01T00:00:00Z",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CurrencyGraphTab", () => {
  beforeEach(() => {
    mockFetchApi.mockReset();
    window.localStorage.clear();
  });

  // ---- Backend offline ----

  it("renders backend offline message when backend is offline", () => {
    renderCurrencyGraphTab(false);
    expect(screen.getByText(/uvicorn backend.main:app/)).toBeInTheDocument();
  });

  it("shows offline status indicator when backend is offline", () => {
    renderCurrencyGraphTab(false);
    expect(screen.getByText(/Backend offline/i)).toBeInTheDocument();
  });

  // ---- Backend online with data ----

  it("renders graph statistics when backend is online", async () => {
    mockFetchApi.mockImplementation((url: string) => {
      if (url.includes("/prices")) return Promise.resolve(mockPricesData);
      if (url.includes("/triangular")) return Promise.resolve(mockTriangularData);
      if (url.includes("/currencies")) return Promise.resolve(mockCurrenciesData);
      return Promise.resolve({});
    });

    renderCurrencyGraphTab(true);

    await waitFor(() => {
      expect(screen.getByText("Currencies")).toBeInTheDocument();
      expect(screen.getByText("Trade Pairs")).toBeInTheDocument();
      expect(screen.getByText("Graph Density")).toBeInTheDocument();
      expect(screen.getByText("Arb Cycles")).toBeInTheDocument();
    });
  });

  // ---- Loading states ----

  it("shows loading skeleton while data is being fetched", () => {
    mockFetchApi.mockImplementation(() => new Promise(() => {}));

    renderCurrencyGraphTab(true);

    const skeletons = document.querySelectorAll('[class*="animate-pulse"]');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  // ---- Empty data ----

  it("shows no-nodes message when prices return empty rates", async () => {
    mockFetchApi.mockImplementation((url: string) => {
      if (url.includes("/prices")) return Promise.resolve(mockEmptyPricesData);
      if (url.includes("/triangular")) return Promise.resolve({ cycles: [], total: 0 });
      if (url.includes("/currencies")) return Promise.resolve(mockCurrenciesData);
      return Promise.resolve({});
    });

    renderCurrencyGraphTab(true);

    await waitFor(() => {
      expect(screen.getByText(/No trade pairs to visualize/i)).toBeInTheDocument();
    });
  });

  // ---- Focus selector ----

  it("renders focus selector with all-currencies option", async () => {
    mockFetchApi.mockImplementation((url: string) => {
      if (url.includes("/prices")) return Promise.resolve(mockPricesData);
      if (url.includes("/triangular")) return Promise.resolve(mockTriangularData);
      if (url.includes("/currencies")) return Promise.resolve(mockCurrenciesData);
      return Promise.resolve({});
    });

    renderCurrencyGraphTab(true);

    await waitFor(() => {
      expect(screen.getByText("All currencies")).toBeInTheDocument();
    });
  });

  // ---- Zoom controls ----

  it("renders zoom controls", async () => {
    mockFetchApi.mockImplementation((url: string) => {
      if (url.includes("/prices")) return Promise.resolve(mockPricesData);
      if (url.includes("/triangular")) return Promise.resolve(mockTriangularData);
      if (url.includes("/currencies")) return Promise.resolve(mockCurrenciesData);
      return Promise.resolve({});
    });

    renderCurrencyGraphTab(true);

    await waitFor(() => {
      expect(screen.getByLabelText("Zoom in")).toBeInTheDocument();
      expect(screen.getByLabelText("Zoom out")).toBeInTheDocument();
      expect(screen.getByLabelText("Reset zoom")).toBeInTheDocument();
    });
  });

  // ---- Cluster legend ----

  it("renders cluster legend", async () => {
    mockFetchApi.mockImplementation((url: string) => {
      if (url.includes("/prices")) return Promise.resolve(mockPricesData);
      if (url.includes("/triangular")) return Promise.resolve(mockTriangularData);
      if (url.includes("/currencies")) return Promise.resolve(mockCurrenciesData);
      return Promise.resolve({});
    });

    renderCurrencyGraphTab(true);

    await waitFor(() => {
      expect(screen.getByText(/Stable/i)).toBeInTheDocument();
      expect(screen.getByText(/Moderate/i)).toBeInTheDocument();
      expect(screen.getByText(/Volatile/i)).toBeInTheDocument();
    });
  });

  // ---- Detected arbitrage cycles ----

  it("renders detected arbitrage cycles section when cycles exist", async () => {
    mockFetchApi.mockImplementation((url: string) => {
      if (url.includes("/prices")) return Promise.resolve(mockPricesData);
      if (url.includes("/triangular")) return Promise.resolve(mockTriangularData);
      if (url.includes("/currencies")) return Promise.resolve(mockCurrenciesData);
      return Promise.resolve({});
    });

    renderCurrencyGraphTab(true);

    await waitFor(() => {
      expect(screen.getByText(/Detected Arbitrage Cycles/i)).toBeInTheDocument();
      expect(screen.getByText("+2.50%")).toBeInTheDocument();
    });
  });

  // ---- SVG graph rendering ----

  it("renders SVG graph element when data is available", async () => {
    mockFetchApi.mockImplementation((url: string) => {
      if (url.includes("/prices")) return Promise.resolve(mockPricesData);
      if (url.includes("/triangular")) return Promise.resolve(mockTriangularData);
      if (url.includes("/currencies")) return Promise.resolve(mockCurrenciesData);
      return Promise.resolve({});
    });

    renderCurrencyGraphTab(true);

    await waitFor(() => {
      const svg = document.querySelector("svg[role='img']");
      expect(svg).toBeInTheDocument();
    });
  });

  // ---- Graph density calculation ----

  it("calculates and displays graph density correctly", async () => {
    mockFetchApi.mockImplementation((url: string) => {
      if (url.includes("/prices")) return Promise.resolve(mockPricesData);
      if (url.includes("/triangular")) return Promise.resolve(mockTriangularData);
      if (url.includes("/currencies")) return Promise.resolve(mockCurrenciesData);
      return Promise.resolve({});
    });

    renderCurrencyGraphTab(true);

    await waitFor(() => {
      // With 4 nodes and 3 edges: density = (2*3)/(4*3) = 0.500
      expect(screen.getByText("0.500")).toBeInTheDocument();
    });
  });

  // ---- No cycles ----

  it("does not render cycles section when no cycles detected", async () => {
    mockFetchApi.mockImplementation((url: string) => {
      if (url.includes("/prices")) return Promise.resolve(mockPricesData);
      if (url.includes("/triangular")) return Promise.resolve({ cycles: [], total: 0 });
      if (url.includes("/currencies")) return Promise.resolve(mockCurrenciesData);
      return Promise.resolve({});
    });

    renderCurrencyGraphTab(true);

    await waitFor(() => {
      expect(screen.queryByText(/Detected Arbitrage Cycles/i)).not.toBeInTheDocument();
    });
  });
});
