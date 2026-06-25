// ============================================================================
// Unit tests for ContentPulseWidget (F4, iter 76) — "Что фармить сегодня".
//
// Coverage:
//   - Backend offline → renders compact offline notice (no full-card takeover)
//   - Loading state → renders loading text
//   - Error state → renders error + refresh button
//   - data_available=false → renders "no data yet" notice
//   - data_available=true but all categories stable → renders "no signals" notice
//   - data_available=true with rising categories → renders rising column + movers
//   - data_available=true with falling categories → renders falling column + movers
//   - maxPerSide prop caps how many categories are shown per column
//   - Refresh button visible when data is shown
//   - Empty top_rising/top_falling arrays render "no movers" notice per category
//   - Fetched-at timestamp rendered in footer
// ============================================================================
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@/lib/i18n";
import {
  ContentPulseWidget,
} from "@/components/dashboard/content-pulse-widget";
import type { ContentPulseResponse } from "@/lib/types";

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

// React Query v5: per-query `retry: 1` in the widget overrides the client
// default. For error-state tests we use a longer waitFor timeout to allow
// the single retry to settle before asserting the error branch.
const ERROR_WAIT_OPTS = { timeout: 5000 };

function renderWidget(
  backendOnline: boolean = true,
  options: { maxPerSide?: number } = {},
) {
  const queryClient = createTestQueryClient();
  window.localStorage.setItem("poe2-locale", "en");
  const result = render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <ContentPulseWidget
          backendOnline={backendOnline}
          maxPerSide={options.maxPerSide}
        />
      </I18nProvider>
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}

// ---------------------------------------------------------------------------
// Test data — matches the ContentPulseResponse shape returned by the proxy
// route after camelCase transform.
// ---------------------------------------------------------------------------

function makeMover(
  apiId: string,
  text: string,
  trendPct: number,
  currentPrice = 1.0,
) {
  return { apiId, text, trendPct, currentPrice };
}

const mixedResponse: ContentPulseResponse = {
  league: "Standard",
  dataAvailable: true,
  fetchedAt: new Date().toISOString(),
  categories: [
    {
      category: "breach",
      todayVolume: 1234.5,
      rolling7d: 900.0,
      rolling30d: 850.0,
      delta7dPct: 37.17,
      delta30dPct: 45.24,
      signal: "rising",
      itemCount: 27,
      topRising: [
        makeMover("xoph-catalyst", "Xoph's Catalyst", 12.3),
        makeMover("breachstone", "Breachstone", 9.5),
      ],
      topFalling: [],
    },
    {
      category: "delirium",
      todayVolume: 500.0,
      rolling7d: 420.0,
      rolling30d: 400.0,
      delta7dPct: 19.05,
      delta30dPct: 25.0,
      signal: "rising",
      itemCount: 14,
      topRising: [makeMover("simulacrum-shard", "Simulacrum Shard", 5.1)],
      topFalling: [],
    },
    {
      category: "ritual",
      todayVolume: 800.0,
      rolling7d: 1100.0,
      rolling30d: 1200.0,
      delta7dPct: -27.27,
      delta30dPct: -33.33,
      signal: "falling",
      itemCount: 22,
      topRising: [],
      topFalling: [
        makeMover("omens-ritual", "Omen of Ritual", -8.4),
        makeMover("ritual-vessel", "Ritual Vessel", -6.2),
      ],
    },
    {
      category: "expedition",
      todayVolume: 300.0,
      rolling7d: 350.0,
      rolling30d: 360.0,
      delta7dPct: -14.28,
      delta30dPct: -16.67,
      signal: "falling",
      itemCount: 9,
      topRising: [],
      topFalling: [makeMover("logbook", "Expedition Logbook", -4.0)],
    },
    {
      category: "stable-cat",
      todayVolume: 100.0,
      rolling7d: 102.0,
      rolling30d: 99.0,
      delta7dPct: 1.96,
      delta30dPct: 1.01,
      signal: "stable",
      itemCount: 5,
      topRising: [],
      topFalling: [],
    },
  ],
};

const allStableResponse: ContentPulseResponse = {
  league: "Standard",
  dataAvailable: true,
  fetchedAt: new Date().toISOString(),
  categories: [
    {
      category: "currency",
      todayVolume: 100.0,
      rolling7d: 102.0,
      rolling30d: 99.0,
      delta7dPct: 1.96,
      delta30dPct: 1.01,
      signal: "stable",
      itemCount: 5,
      topRising: [],
      topFalling: [],
    },
  ],
};

const noDataResponse: ContentPulseResponse = {
  league: "Standard",
  dataAvailable: false,
  fetchedAt: new Date().toISOString(),
  categories: [],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ContentPulseWidget", () => {
  beforeEach(() => {
    mockFetchApi.mockReset();
    window.localStorage.clear();
  });

  it("renders offline notice when backendOffline=true", async () => {
    renderWidget(false);
    // Should NOT call fetchApi when offline
    expect(mockFetchApi).not.toHaveBeenCalled();
    expect(
      screen.getByText(/Content pulse requires the analytics backend/i),
    ).toBeInTheDocument();
  });

  it("renders loading state on first load", async () => {
    // Never resolve fetchApi so the query stays in loading state
    mockFetchApi.mockImplementation(
      () => new Promise(() => {}),
    );
    renderWidget(true);
    expect(screen.getByText(/Loading content pulse/i)).toBeInTheDocument();
  });

  it("renders error state when fetchApi rejects", async () => {
    mockFetchApi.mockRejectedValue(new Error("network down"));
    renderWidget(true);
    await waitFor(() => {
      expect(screen.getByText(/Failed to load content pulse/i)).toBeInTheDocument();
    }, ERROR_WAIT_OPTS);
  });

  it("renders 'no data yet' notice when data_available=false", async () => {
    mockFetchApi.mockResolvedValue(noDataResponse);
    renderWidget(true);
    await waitFor(() => {
      expect(
        screen.getByText(/Content pulse data is not available yet/i),
      ).toBeInTheDocument();
    });
  });

  it("renders 'no signals' notice when all categories are stable", async () => {
    mockFetchApi.mockResolvedValue(allStableResponse);
    renderWidget(true);
    await waitFor(() => {
      expect(
        screen.getByText(/No strong signals today/i),
      ).toBeInTheDocument();
    });
  });

  it("renders rising + falling columns when data is mixed", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderWidget(true);

    await waitFor(() => {
      expect(screen.getByTestId("content-pulse-widget")).toBeInTheDocument();
    });

    // Rising column header
    expect(screen.getByText(/Rising — worth farming/i)).toBeInTheDocument();
    // Falling column header
    expect(screen.getByText(/Falling — avoid for now/i)).toBeInTheDocument();

    // Categories present (default maxPerSide=2 → both rising + both falling shown)
    expect(
      screen.getByTestId("content-pulse-category-rising-breach"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("content-pulse-category-rising-delirium"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("content-pulse-category-falling-ritual"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("content-pulse-category-falling-expedition"),
    ).toBeInTheDocument();

    // Stable category should NOT be rendered
    expect(screen.queryByTestId("content-pulse-category-rising-stable-cat")).not.toBeInTheDocument();
    expect(screen.queryByTestId("content-pulse-category-falling-stable-cat")).not.toBeInTheDocument();
  });

  it("renders top movers with their trend %", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderWidget(true);

    await waitFor(() => {
      expect(screen.getByText("Xoph's Catalyst")).toBeInTheDocument();
    });
    // trendPct +12.30% — note that we use jest's textContent match, so
    // we just check the signed format appears somewhere.
    expect(screen.getByText("+12.30%")).toBeInTheDocument();
    expect(screen.getByText("Ritual Vessel")).toBeInTheDocument();
    expect(screen.getByText("-6.20%")).toBeInTheDocument();
  });

  it("renders 7d delta badge per category", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderWidget(true);

    await waitFor(() => {
      // breach: +37.17% (7d)
      expect(screen.getByText("+37.17% (7d)")).toBeInTheDocument();
      // ritual: -27.27% (7d)
      expect(screen.getByText("-27.27% (7d)")).toBeInTheDocument();
    });
  });

  it("respects maxPerSide prop — caps number of categories per column", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderWidget(true, { maxPerSide: 1 });

    await waitFor(() => {
      expect(screen.getByTestId("content-pulse-widget")).toBeInTheDocument();
    });

    // Only ONE rising + ONE falling category shown
    expect(
      screen.getByTestId("content-pulse-category-rising-breach"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("content-pulse-category-rising-delirium"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("content-pulse-category-falling-ritual"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("content-pulse-category-falling-expedition"),
    ).not.toBeInTheDocument();
  });

  it("shows refresh button when data is available", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderWidget(true);

    await waitFor(() => {
      expect(screen.getByTestId("content-pulse-widget")).toBeInTheDocument();
    });

    // Refresh button (aria-label)
    const refreshBtn = screen.getByRole("button", { name: /Refresh/i });
    expect(refreshBtn).toBeInTheDocument();
  });

  it("clicking refresh triggers a refetch", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderWidget(true);

    await waitFor(() => {
      expect(screen.getByTestId("content-pulse-widget")).toBeInTheDocument();
    });

    const initialCallCount = mockFetchApi.mock.calls.length;
    const refreshBtn = screen.getByRole("button", { name: /Refresh/i });
    fireEvent.click(refreshBtn);

    await waitFor(() => {
      expect(mockFetchApi.mock.calls.length).toBeGreaterThan(initialCallCount);
    });
  });

  it("renders 'no movers' notice when a category has empty top_rising/top_falling", async () => {
    // Build a response where the rising category has no top movers
    const responseWithEmptyMovers: ContentPulseResponse = {
      league: "Standard",
      dataAvailable: true,
      fetchedAt: new Date().toISOString(),
      categories: [
        {
          category: "breach",
          todayVolume: 1234.5,
          rolling7d: 900.0,
          rolling30d: 850.0,
          delta7dPct: 37.17,
          delta30dPct: 45.24,
          signal: "rising",
          itemCount: 27,
          topRising: [],
          topFalling: [],
        },
      ],
    };
    mockFetchApi.mockResolvedValue(responseWithEmptyMovers);
    renderWidget(true);

    await waitFor(() => {
      expect(
        screen.getByText(/No notable item movers in this category yet/i),
      ).toBeInTheDocument();
    });
  });

  it("renders fetched-at timestamp in the footer when data is available", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderWidget(true);

    await waitFor(() => {
      expect(screen.getByTestId("content-pulse-widget")).toBeInTheDocument();
    });

    // Footer text: "Fetched: <date>"
    expect(screen.getByText(/^Fetched:/i)).toBeInTheDocument();
  });

  it("calls fetchApi with the correct proxy path", async () => {
    mockFetchApi.mockResolvedValue(noDataResponse);
    renderWidget(true);

    await waitFor(() => {
      expect(mockFetchApi).toHaveBeenCalledWith("/api/flipper/content-pulse");
    });
  });

  it("renders widget title", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderWidget(true);

    await waitFor(() => {
      expect(screen.getByText("What to farm today")).toBeInTheDocument();
    });
  });

  it("renders item count meta per category", async () => {
    mockFetchApi.mockResolvedValue(mixedResponse);
    renderWidget(true);

    await waitFor(() => {
      // breach has 27 items
      expect(screen.getByText(/27 items/i)).toBeInTheDocument();
      // ritual has 22 items
      expect(screen.getByText(/22 items/i)).toBeInTheDocument();
    });
  });
});
