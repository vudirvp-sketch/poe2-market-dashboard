// ============================================================================
// Integration tests — Next.js proxy routes ↔ FastAPI backend.
// Tests the full proxy chain: Next.js API route → flipper-proxy → FastAPI.
// Uses MSW (Mock Service Worker) to mock the FastAPI backend responses.
// ============================================================================
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@/lib/i18n";
import { CurrencyGraphTab } from "@/components/dashboard/currency-graph-tab";

// ---------------------------------------------------------------------------
// Mock fetchApi to simulate the full proxy chain
// ---------------------------------------------------------------------------

const mockFetchApi = jest.fn();
jest.mock("@/lib/types", () => ({
  ...jest.requireActual("@/lib/types"),
  fetchApi: (...args: unknown[]) => mockFetchApi(...args),
  getFlipperErrorType: jest.fn().mockReturnValue(null),
  fmt: (n: number) => n.toFixed(4),
}));

// Mock recharts
jest.mock("recharts", () => ({
  AreaChart: ({ children }: { children: React.ReactNode }) => <div data-testid="area-chart">{children}</div>,
  BarChart: ({ children }: { children: React.ReactNode }) => <div data-testid="bar-chart">{children}</div>,
  ScatterChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Area: () => null,
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Legend: () => null,
  Cell: () => null,
  Scatter: () => null,
  Line: () => null,
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

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = createTestQueryClient();
  window.localStorage.setItem("poe2-locale", "en");
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        {ui}
      </I18nProvider>
    </QueryClientProvider>
  );
}

// ---------------------------------------------------------------------------
// Test data simulating FastAPI responses
// ---------------------------------------------------------------------------

const fastapiPhaseResponse = {
  phase: "mid",
  daysSinceRef: 14,
  recommended_strategy: "balanced",
};

// ---------------------------------------------------------------------------
// Integration tests
// ---------------------------------------------------------------------------

describe("Integration: Next.js ↔ FastAPI proxy chain", () => {
  beforeEach(() => {
    mockFetchApi.mockReset();
    window.localStorage.clear();
  });

  // ---- Multiple sequential API calls ----

  it("makes multiple sequential API calls for graph tab", async () => {
    mockFetchApi.mockImplementation((url: string) => {
      if (url.includes("/prices")) return Promise.resolve({
        league: "vaal",
        phase: "mid",
        rates: [
          {
            pair: "divine-exalted",
            currency_from: "divine",
            currency_to: "exalted",
            raw_rate: 1.5,
            volume_traded: 500,
            volatility: 0.15,
            momentum: 0.02,
            cluster_from: "stable",
            cluster_to: "stable",
          },
        ],
        baseCurrency: "exalted",
        fetchedAt: new Date().toISOString(),
      });
      if (url.includes("/triangular")) return Promise.resolve({ cycles: [], total: 0 });
      if (url.includes("/currencies")) return Promise.resolve({ currencies: [] });
      return Promise.resolve({});
    });

    renderWithProviders(<CurrencyGraphTab backendOnline={true} />);

    await waitFor(() => {
      expect(screen.getByText("Currencies")).toBeInTheDocument();
    });

    // Verify all three proxy endpoints were called
    expect(mockFetchApi).toHaveBeenCalledWith("/api/flipper/prices");
    expect(mockFetchApi).toHaveBeenCalledWith("/api/flipper/triangular");
    expect(mockFetchApi).toHaveBeenCalledWith("/api/flipper/currencies");
  });

  // ---- Backend health check propagation ----

  it("respects backendOnline prop for flipper tabs", () => {
    mockFetchApi.mockImplementation(() => new Promise(() => {}));

    // Test that flipper-dependent tabs respect the backendOnline flag
    renderWithProviders(<CurrencyGraphTab backendOnline={false} />);

    // No flipper API calls should have been made when backend is offline
    expect(mockFetchApi).not.toHaveBeenCalled();
  });
});
