// ============================================================================
// Integration Tests — Header with I18n locale switch
// Verifies that the Header component correctly responds to locale changes
// and that the language toggle cycles through all 4 locales.
// ============================================================================
import { renderWithProviders, screen, act } from "./test-utils";
import { Header } from "@/components/dashboard/header";

// ---------------------------------------------------------------------------
// Minimal mock props for Header
// ---------------------------------------------------------------------------
const baseProps = {
  realms: [{ name: "pc", displayName: "PC" }],
  leagues: [{ name: "Standard", displayName: "Standard", active: true }],
  realmsLoading: false,
  leaguesLoading: false,
  realm: "pc",
  league: "Standard",
  effectiveLeague: "Standard",
  search: "",
  onRealmChange: jest.fn(),
  onLeagueChange: jest.fn(),
  onSearchChange: jest.fn(),
  onRefresh: jest.fn(),
  autoRefresh: true,
  onAutoRefreshToggle: jest.fn(),
  lastUpdated: null,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Header i18n integration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("default rendering", () => {
    it("renders the app title in default locale (ru)", () => {
      renderWithProviders(<Header {...baseProps} />);

      // Russian: "PoE2 Маркет"
      expect(screen.getByText("PoE2 Маркет")).toBeInTheDocument();
    });

    it("renders realm and league selects", () => {
      renderWithProviders(<Header {...baseProps} />);

      // The selects should be visible
      expect(screen.getByText("PC")).toBeInTheDocument();
      expect(screen.getByText("Standard")).toBeInTheDocument();
    });
  });

  describe("language toggle cycling", () => {
    it("shows the current locale label (RU by default)", () => {
      renderWithProviders(<Header {...baseProps} />);

      // The Globe button should show "RU"
      const localeButton = screen.getByLabelText("Переключить язык");
      expect(localeButton).toBeInTheDocument();
      expect(localeButton).toHaveTextContent("RU");
    });

    it("cycles from RU → EN on click", () => {
      renderWithProviders(<Header {...baseProps} />);

      const localeButton = screen.getByLabelText("Переключить язык");

      act(() => {
        localeButton.click();
      });

      // After clicking, should switch to EN
      expect(screen.getByText("PoE2 Market")).toBeInTheDocument();
    });

    it("cycles from EN → ZH on second click", () => {
      renderWithProviders(<Header {...baseProps} />);

      const localeButton = screen.getByLabelText("Переключить язык");

      // Click to EN
      act(() => {
        localeButton.click();
      });

      // Click to ZH
      act(() => {
        screen.getByLabelText("Switch language").click();
      });

      // Should show Chinese title
      expect(screen.getByText("PoE2 市场")).toBeInTheDocument();
    });

    it("cycles from ZH → KO on third click", () => {
      renderWithProviders(<Header {...baseProps} />);

      const localeButton = screen.getByLabelText("Переключить язык");

      // Click to EN
      act(() => {
        localeButton.click();
      });

      // Click to ZH
      act(() => {
        screen.getByLabelText("Switch language").click();
      });

      // Click to KO
      act(() => {
        screen.getByLabelText("切换语言").click();
      });

      // Should show Korean title
      expect(screen.getByText("PoE2 시장")).toBeInTheDocument();
    });

    it("cycles from KO → RU on fourth click (full cycle)", () => {
      renderWithProviders(<Header {...baseProps} />);

      const localeButton = screen.getByLabelText("Переключить язык");

      // Click to EN
      act(() => {
        localeButton.click();
      });

      // Click to ZH
      act(() => {
        screen.getByLabelText("Switch language").click();
      });

      // Click to KO
      act(() => {
        screen.getByLabelText("切换语言").click();
      });

      // Click back to RU
      act(() => {
        screen.getByLabelText("언어 변경").click();
      });

      // Should be back to Russian
      expect(screen.getByText("PoE2 Маркет")).toBeInTheDocument();
    });
  });

  describe("header controls in different locales", () => {
    it("shows refresh button text in English when locale is EN", () => {
      renderWithProviders(<Header {...baseProps} />);

      // Switch to English
      act(() => {
        screen.getByLabelText("Переключить язык").click();
      });

      // The refresh button should have English text
      expect(screen.getByLabelText("Refresh data")).toBeInTheDocument();
    });

    it("shows search placeholder in Chinese when locale is ZH", () => {
      renderWithProviders(<Header {...baseProps} />);

      // Switch to Chinese via two clicks
      act(() => {
        screen.getByLabelText("Переключить язык").click();
      });
      act(() => {
        screen.getByLabelText("Switch language").click();
      });

      // Search input should have Chinese placeholder
      const searchInput = screen.getByPlaceholderText("搜索物品...");
      expect(searchInput).toBeInTheDocument();
    });
  });

  describe("accessibility labels", () => {
    it("has aria-label on the language toggle button", () => {
      renderWithProviders(<Header {...baseProps} />);

      const localeButton = screen.getByLabelText("Переключить язык");
      expect(localeButton).toHaveAttribute("aria-label", "Переключить язык");
    });

    it("has aria-label on the refresh button", () => {
      renderWithProviders(<Header {...baseProps} />);

      const refreshButton = screen.getByLabelText("Обновить данные");
      expect(refreshButton).toBeInTheDocument();
    });
  });
});
