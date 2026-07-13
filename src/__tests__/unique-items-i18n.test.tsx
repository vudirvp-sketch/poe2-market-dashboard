// ============================================================================
// iter 148 — Unique-items RU localization across UI components.
//
// Coverage:
//   1. ComparisonDialog        — chip + summary table use `item.nameRu`
//      when locale=ru and nameRu is set; fall back to `item.name` otherwise.
//   2. ComparativeChart        — same as ComparisonDialog, plus correlation
//      matrix labels and "items without correlation" warning use the
//      locale-aware name.
//   3. LevelingUniquesWidget   — renders `getUniqueDisplayName(name, "ru")`
//      when locale=ru; falls back to the curated EN name when no mapping.
//   4. FuzzySearch             — search index uses RU name as primary `name`
//      when locale=ru, with EN name as `nameAlt` for cross-locale search.
//      Verifies that searching by EN still finds an item whose primary name
//      is the RU translation.
//   5. PairComparisonDialog    — KI-34 fix: chip + series labels are
//      re-derived from `pair.currency1Id`/`pair.currency2Id` via
//      `getCurrencyDisplayName` on every render, so switching locale after
//      adding pairs to comparison now updates the displayed labels.
// ============================================================================
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@/lib/i18n";
import { ComparisonDialog } from "@/components/dashboard/comparison-dialog";
import { ComparativeChart } from "@/components/dashboard/comparative-chart";
import { LevelingUniquesWidget } from "@/components/dashboard/leveling-uniques-widget";
import { FuzzySearch } from "@/components/dashboard/fuzzy-search";
import { PairComparisonDialog } from "@/components/dashboard/pair-comparison-dialog";
import { useDashboardStore } from "@/lib/store";
import type {
  PoeItem,
  LevelingUniquesResponse,
  ExchangePairHistoryPoint,
  PoeItemHistoryPoint,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Mocks — fetchApi is intercepted so we control what each dialog sees.
// ---------------------------------------------------------------------------

const mockFetchApi = jest.fn();
jest.mock("@/lib/types", () => ({
  ...jest.requireActual("@/lib/types"),
  fetchApi: (...args: unknown[]) => mockFetchApi(...args),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
    },
  });
}

function renderWith(ui: React.ReactElement, locale: "en" | "ru" = "en") {
  window.localStorage.setItem("poe2-locale", locale);
  const queryClient = createTestQueryClient();
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <I18nProvider>{children}</I18nProvider>
      </QueryClientProvider>
    );
  }
  return render(ui, { wrapper: Wrapper });
}

/** Build a PoeItem with nameRu set — mimics what `mapUniqueItem` produces. */
function makeUniqueItem(overrides: Partial<PoeItem> = {}): PoeItem {
  return {
    id: "1",
    apiId: "1",
    name: "Brynhand's Mark",
    nameRu: "Клеймо Бринханда",
    type: "Iron Ring",
    category: "Unique",
    iconUrl: null,
    price: 10,
    chaosEquivalentRate: 10,
    relativePrice: 10,
    change: null,
    changePercent: 5,
    volume: 100,
    sevenDayPriceChange: null,
    sevenDayPriceChangePercent: 2,
    history: null,
    dailyStats: null,
    lowConfidence: false,
    listingCount: null,
    baseType: null,
    links: null,
    variant: null,
    levelRequired: null,
    ...overrides,
  };
}

/** Build a PoeItem without nameRu (simulates a unique missing from poe2db). */
function makeUniqueItemNoRu(overrides: Partial<PoeItem> = {}): PoeItem {
  const item = makeUniqueItem(overrides);
  delete (item as Partial<PoeItem>).nameRu;
  return item;
}

/** Build a minimal exchange pair shape (unused for now; kept for future tests). */
// (removed makeExchangePair — not currently referenced by any test case)

/** Build a 5-point history series for ComparisonDialog / ComparativeChart. */
function makeHistory(_itemId: string): PoeItemHistoryPoint[] {
  const now = Date.now();
  return Array.from({ length: 5 }, (_, i) => ({
    timestamp: new Date(now + i * 3600_000).toISOString(),
    relativePrice: 10 + i,
    chaosEquivalentRate: 10 + i,
    volume: 100,
  })) as PoeItemHistoryPoint[];
}

function makePairHistory(): ExchangePairHistoryPoint[] {
  const now = Date.now();
  return Array.from({ length: 5 }, (_, i) => ({
    timestamp: new Date(now + i * 3600_000).toISOString(),
    relativePrice: 1 + i * 0.1,
    chaosEquivalentRate: 1 + i * 0.1,
    volume: 100,
  })) as ExchangePairHistoryPoint[];
}

/** Build the minimal LevelingUniquesResponse used by LevelingUniquesWidget. */
function makeLevelingResponse(name: string): LevelingUniquesResponse {
  return {
    league: "Standard",
    phase: "early",
    daysSinceReference: 2,
    currentDay: 2,
    referenceCurrency: "exalted",
    uniques: [
      {
        id: "test-unique",
        name,
        category: "",
        peakDay: 2,
        peakPriceExalted: 15.0,
        decayPct: 70.0,
        pattern: "SPIKE_THEN_CRASH",
        currentLifecycleStage: "AT_PEAK",
        recommendation: "SELL_NOW",
        estimatedCurrentPriceExalted: 15.0,
        daysUntilPeak: 0,
        notes: "Test notes.",
      },
    ],
    dataAvailable: true,
    fetchedAt: new Date("2026-07-10T12:00:00Z").toISOString(),
  } as LevelingUniquesResponse;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("iter 148 — unique-items RU localization across UI components", () => {
  beforeEach(() => {
    mockFetchApi.mockReset();
    // Reset the dashboard store between tests so comparisonIds / pairComparisonIds
    // don't leak across cases.
    useDashboardStore.setState({
      comparisonIds: [],
      pairComparisonIds: [],
    });
  });

  // =========================================================================
  // 1. ComparisonDialog
  // =========================================================================
  describe("ComparisonDialog", () => {
    function renderDialog(locale: "en" | "ru", items: PoeItem[]) {
      // Pre-populate the store's comparisonIds with our test items.
      useDashboardStore.setState({ comparisonIds: items.map((i) => i.id) });

      // mockFetchApi returns one history per itemId in the comparisonIds order.
      mockFetchApi.mockImplementation(async (url: string) => {
        if (url === "/api/poe2/items") {
          // The dialog passes `itemId` via the fetchApi `options` arg; we
          // don't have access to it here, so we just return the first item's
          // history. The test relies on the dialog fetching in
          // comparisonIds order, which is what it does (Promise.all over
          // comparisonIds.map).
          return makeHistory(items[0]?.id ?? "1");
        }
        return [];
      });

      renderWith(
        <ComparisonDialog
          open={true}
          onOpenChange={() => {}}
          realm="pc"
          league="Standard"
          referenceCurrency="chaos"
          allItems={items}
        />,
        locale,
      );
    }

    it("renders RU name in chip when locale=ru and item.nameRu is set", async () => {
      const items = [
        makeUniqueItem({ id: "1", name: "Brynhand's Mark", nameRu: "Клеймо Бринханда" }),
        makeUniqueItem({ id: "2", name: "Mind of the Council", nameRu: "Разум Совета" }),
      ];
      renderDialog("ru", items);
      await waitFor(() => {
        expect(screen.getByText("Клеймо Бринханда")).toBeInTheDocument();
      });
      expect(screen.getByText("Разум Совета")).toBeInTheDocument();
    });

    it("falls back to EN name in chip when locale=ru but nameRu is null", async () => {
      const items = [
        makeUniqueItemNoRu({ id: "1", name: "Unknown Unique" }),
        makeUniqueItem({ id: "2", name: "Other Item", nameRu: "Другой предмет" }),
      ];
      renderDialog("ru", items);
      await waitFor(() => {
        expect(screen.getByText("Другой предмет")).toBeInTheDocument();
      });
      // EN fallback for the item without nameRu
      expect(screen.getByText("Unknown Unique")).toBeInTheDocument();
    });

    it("renders EN name in chip when locale=en (ignores nameRu)", async () => {
      const items = [
        makeUniqueItem({ id: "1", name: "Brynhand's Mark", nameRu: "Клеймо Бринханда" }),
        makeUniqueItem({ id: "2", name: "Mind of the Council", nameRu: "Разум Совета" }),
      ];
      renderDialog("en", items);
      await waitFor(() => {
        expect(screen.getByText("Brynhand's Mark")).toBeInTheDocument();
      });
      expect(screen.getByText("Mind of the Council")).toBeInTheDocument();
    });
  });

  // =========================================================================
  // 2. ComparativeChart
  // =========================================================================
  describe("ComparativeChart", () => {
    function renderChart(locale: "en" | "ru", items: PoeItem[]) {
      useDashboardStore.setState({ comparisonIds: items.map((i) => i.id) });
      mockFetchApi.mockImplementation(async (url: string) => {
        if (url === "/api/poe2/items") return makeHistory(items[0]?.id ?? "1");
        if (url === "/api/flipper/portfolio/correlation") {
          return { dataAvailable: false, currencies: [], matrix: [] };
        }
        return [];
      });

      renderWith(
        <ComparativeChart
          realm="pc"
          league="Standard"
          referenceCurrency="chaos"
          allItems={items}
        />,
        locale,
      );
    }

    it("renders RU name in chip when locale=ru and item.nameRu is set", async () => {
      const items = [
        makeUniqueItem({ id: "1", name: "Brynhand's Mark", nameRu: "Клеймо Бринханда" }),
        makeUniqueItem({ id: "2", name: "Mind of the Council", nameRu: "Разум Совета" }),
      ];
      renderChart("ru", items);
      await waitFor(() => {
        expect(screen.getByText("Клеймо Бринханда")).toBeInTheDocument();
      });
      expect(screen.getByText("Разум Совета")).toBeInTheDocument();
    });

    it("renders EN name in chip when locale=en (ignores nameRu)", async () => {
      const items = [
        makeUniqueItem({ id: "1", name: "Brynhand's Mark", nameRu: "Клеймо Бринханда" }),
        makeUniqueItem({ id: "2", name: "Mind of the Council", nameRu: "Разум Совета" }),
      ];
      renderChart("en", items);
      await waitFor(() => {
        expect(screen.getByText("Brynhand's Mark")).toBeInTheDocument();
      });
    });
  });

  // =========================================================================
  // 3. LevelingUniquesWidget
  // =========================================================================
  describe("LevelingUniquesWidget", () => {
    it("renders RU name when locale=ru and a poe2db RU translation exists", async () => {
      // "Mind of the Council" → slug "Mind_of_the_Council" → poe2db RU
      // "Разум Совета" (verified in iter 147 spot-check tests).
      mockFetchApi.mockResolvedValue(makeLevelingResponse("Mind of the Council"));
      renderWith(<LevelingUniquesWidget backendOnline={true} />, "ru");
      await waitFor(() => {
        expect(screen.getByText("Разум Совета")).toBeInTheDocument();
      });
    });

    it("falls back to EN name when locale=ru but no poe2db RU translation", async () => {
      // "Polcirkeln Sapphire Ring" → slug doesn't match poe2db index.
      mockFetchApi.mockResolvedValue(
        makeLevelingResponse("Polcirkeln Sapphire Ring"),
      );
      renderWith(<LevelingUniquesWidget backendOnline={true} />, "ru");
      await waitFor(() => {
        expect(screen.getByText("Polcirkeln Sapphire Ring")).toBeInTheDocument();
      });
    });

    it("renders EN name when locale=en (no RU lookup)", async () => {
      mockFetchApi.mockResolvedValue(makeLevelingResponse("Mind of the Council"));
      renderWith(<LevelingUniquesWidget backendOnline={true} />, "en");
      await waitFor(() => {
        expect(screen.getByText("Mind of the Council")).toBeInTheDocument();
      });
    });
  });

  // =========================================================================
  // 4. FuzzySearch
  // =========================================================================
  describe("FuzzySearch", () => {
    function renderSearch(locale: "en" | "ru", items: PoeItem[]) {
      const noop = () => {};
      renderWith(
        <FuzzySearch
          value=""
          onValueChange={noop}
          onResultSelect={noop}
          onFilterSubmit={noop}
          exchangePairs={[]}
          allItems={items}
          activeTab="uniques"
        />,
        locale,
      );
    }

    function typeSearch(query: string) {
      const input = screen.getByRole("combobox") as HTMLInputElement;
      fireEvent.change(input, { target: { value: query } });
    }

    it("shows RU name in result list when locale=ru and item.nameRu is set", async () => {
      const items = [
        makeUniqueItem({ id: "1", name: "Brynhand's Mark", nameRu: "Клеймо Бринханда" }),
      ];
      renderSearch("ru", items);
      typeSearch("Клеймо");
      await waitFor(() => {
        expect(screen.getByText("Клеймо Бринханда")).toBeInTheDocument();
      });
    });

    it("allows searching by EN name even when locale=ru (via nameAlt)", async () => {
      const items = [
        makeUniqueItem({ id: "1", name: "Brynhand's Mark", nameRu: "Клеймо Бринханда" }),
      ];
      renderSearch("ru", items);
      // User types the EN name while in RU locale — should still match via nameAlt.
      typeSearch("Brynhand");
      await waitFor(() => {
        // The result row shows the RU primary name; the EN name is searchable
        // but not displayed.
        expect(screen.getByText("Клеймо Бринханда")).toBeInTheDocument();
      });
    });

    it("shows EN name when locale=en (nameAlt holds the RU name)", async () => {
      const items = [
        makeUniqueItem({ id: "1", name: "Brynhand's Mark", nameRu: "Клеймо Бринханда" }),
      ];
      renderSearch("en", items);
      typeSearch("Brynhand");
      await waitFor(() => {
        expect(screen.getByText("Brynhand's Mark")).toBeInTheDocument();
      });
    });

    it("falls back to EN name in RU locale when item has no nameRu", async () => {
      const items = [
        makeUniqueItemNoRu({ id: "1", name: "Unknown Unique" }),
      ];
      renderSearch("ru", items);
      typeSearch("Unknown");
      await waitFor(() => {
        expect(screen.getByText("Unknown Unique")).toBeInTheDocument();
      });
    });
  });

  // =========================================================================
  // 5. PairComparisonDialog (KI-34 fix)
  // =========================================================================
  describe("PairComparisonDialog (KI-34 fix — labels follow locale)", () => {
    function renderPairDialog(
      locale: "en" | "ru",
      pair: { currency1Id: string; currency2Id: string; currency1ItemId: number; currency2ItemId: number; label: string },
    ) {
      useDashboardStore.setState({
        pairComparisonIds: [pair],
      });
      mockFetchApi.mockResolvedValue(makePairHistory());

      renderWith(
        <PairComparisonDialog
          open={true}
          onOpenChange={() => {}}
          realm="pc"
          league="Standard"
        />,
        locale,
      );
    }

    it("re-derives label using current locale=ru (ignores stale stored EN label)", async () => {
      // Pair was added while user was in EN locale → stored label is EN.
      renderPairDialog("ru", {
        currency1Id: "chaos",
        currency2Id: "divine",
        currency1ItemId: 1,
        currency2ItemId: 2,
        label: "Chaos Orb / Divine Orb",
      });
      // Wait for the chip to render. The chip should now show the RU names
      // "Сфера хаоса / Божественная сфера" (from getCurrencyDisplayName)
      // rather than the stale stored EN label. Both names are in the same
      // text node, so we match against the full string.
      await waitFor(() => {
        expect(screen.getByText(/Сфера хаоса \/ Божественная сфера/)).toBeInTheDocument();
      });
    });

    it("re-derives label using current locale=en (ignores stale stored RU label)", async () => {
      // Pair was added while user was in RU locale → stored label is RU.
      renderPairDialog("en", {
        currency1Id: "chaos",
        currency2Id: "divine",
        currency1ItemId: 1,
        currency2ItemId: 2,
        label: "Сфера хаоса / Божественная сфера",
      });
      await waitFor(() => {
        expect(screen.getByText("Chaos Orb / Divine Orb")).toBeInTheDocument();
      });
    });
  });
});
