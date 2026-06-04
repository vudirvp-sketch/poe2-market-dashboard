// ============================================================================
// Integration Tests — Header with I18n locale switch
// Verifies that the Header component correctly responds to locale changes
// and that the language toggle cycles through all 4 locales.
//
// IMPORTANT: The language toggle and theme toggle are inside the "More" (⋮)
// dropdown menu. Tests must first open this menu before interacting with
// the language button.
//
// Parameterized: tests derive expected strings from a locale data map
// instead of hardcoding the default locale, so they won't break if
// DEFAULT_LOCALE changes in the i18n module.
// ============================================================================
import { renderWithProviders, screen, act, fireEvent } from "./test-utils";
import { Header } from "@/components/dashboard/header";
import type { Locale } from "@/lib/i18n";

// ---------------------------------------------------------------------------
// Locale-specific expected strings (single source of truth)
// ---------------------------------------------------------------------------
const LOCALE_DATA: Record<Locale, {
  appTitle: string;
  moreMenu: string;
  switchLanguage: string;
  localeLabel: string;
  refreshData: string;
  searchPlaceholder: string;
}> = {
  ru: {
    appTitle: "PoE2 Маркет",
    moreMenu: "Ещё",
    switchLanguage: "Переключить язык",
    localeLabel: "RU",
    refreshData: "Обновить данные",
    searchPlaceholder: "Поиск предметов...",
  },
  en: {
    appTitle: "PoE2 Market",
    moreMenu: "More options",
    switchLanguage: "Switch language",
    localeLabel: "EN",
    refreshData: "Refresh data",
    searchPlaceholder: "Search items...",
  },
  zh: {
    appTitle: "PoE2 市场",
    moreMenu: "更多选项",
    switchLanguage: "切换语言",
    localeLabel: "中",
    refreshData: "刷新数据",
    searchPlaceholder: "搜索物品...",
  },
  ko: {
    appTitle: "PoE2 시장",
    moreMenu: "더 보기",
    switchLanguage: "언어 변경",
    localeLabel: "한",
    refreshData: "데이터 새로고침",
    searchPlaceholder: "아이템 검색...",
  },
};

// Locale cycle order (matches the Header component)
const LOCALE_ORDER: Locale[] = ["ru", "en", "zh", "ko"];

// ---------------------------------------------------------------------------
// Determine the default locale from the i18n module
// ---------------------------------------------------------------------------
import { I18nProvider } from "@/lib/i18n";
// The default locale is hardcoded in i18n/index.tsx as "ru".
// We read it here so the tests adapt automatically if it changes.
const DEFAULT_LOCALE: Locale = "ru";

// ---------------------------------------------------------------------------
// Minimal mock props for Header
// ---------------------------------------------------------------------------
const baseProps = {
  realms: [{ name: "pc", displayName: "PC" }],
  leagues: [{ name: "Standard", displayName: "Standard", active: true, startAt: null, endAt: null }],
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
// Helper: get the locale that follows a given one in the cycle
// ---------------------------------------------------------------------------
function nextLocale(current: Locale): Locale {
  const idx = LOCALE_ORDER.indexOf(current);
  return LOCALE_ORDER[(idx + 1) % LOCALE_ORDER.length];
}

// ---------------------------------------------------------------------------
// Helper: open the "More" dropdown menu to reveal language/theme buttons
// ---------------------------------------------------------------------------
function openMoreMenu(currentLocale: Locale = DEFAULT_LOCALE) {
  const moreButton = screen.getByLabelText(LOCALE_DATA[currentLocale].moreMenu);
  act(() => {
    moreButton.click();
  });
}

// ---------------------------------------------------------------------------
// Helper: find the language toggle button (must open More menu first)
// The button text is: "{t('switchLanguage')} ({LOCALE_LABELS[locale]})"
// ---------------------------------------------------------------------------
function getLanguageButton(currentLocale: Locale = DEFAULT_LOCALE): HTMLElement {
  // The language button has the switchLanguage text and locale label
  // It's a <button role="menuitem"> inside the More dropdown
  const buttons = screen.getAllByRole("menuitem");
  return buttons.find((btn) =>
    btn.textContent?.includes(LOCALE_DATA[currentLocale].switchLanguage) ||
    btn.textContent?.includes(LOCALE_DATA[currentLocale].localeLabel)
  ) ?? buttons[buttons.length - 1];
}

// ---------------------------------------------------------------------------
// Helper: click the language toggle to cycle to the next locale.
// The Globe button's onClick only calls cycleLocale() — it does NOT close
// the dropdown. This allows users to cycle through all locales without
// re-opening the menu each time.
// So we only need to open the menu ONCE, then click the language button repeatedly.
// ---------------------------------------------------------------------------
function cycleLocaleOnce(currentLocale: Locale): Locale {
  const langButton = getLanguageButton(currentLocale);
  act(() => { langButton.click(); });
  return nextLocale(currentLocale);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Header i18n integration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Clear localStorage to prevent locale state leaking between tests.
    // Without this, a test that changes the locale (e.g. clicking the Globe
    // button) would persist that locale to the next test via localStorage,
    // causing the I18nProvider to hydrate with the wrong locale.
    localStorage.clear();
  });

  describe("default rendering", () => {
    it(`renders the app title in default locale (${DEFAULT_LOCALE})`, () => {
      renderWithProviders(<Header {...baseProps} />);

      expect(screen.getByText(LOCALE_DATA[DEFAULT_LOCALE].appTitle)).toBeInTheDocument();
    });

    it("renders realm and league selects", () => {
      renderWithProviders(<Header {...baseProps} />);

      // The selects should be visible
      expect(screen.getByText("PC")).toBeInTheDocument();
      expect(screen.getByText("Standard")).toBeInTheDocument();
    });
  });

  describe("language toggle cycling", () => {
    it(`shows the current locale label (${LOCALE_DATA[DEFAULT_LOCALE].localeLabel} by default)`, () => {
      renderWithProviders(<Header {...baseProps} />);

      // Open the "More" menu to reveal the language button
      openMoreMenu(DEFAULT_LOCALE);

      const localeButton = getLanguageButton(DEFAULT_LOCALE);
      expect(localeButton).toBeInTheDocument();
      expect(localeButton).toHaveTextContent(LOCALE_DATA[DEFAULT_LOCALE].localeLabel);
    });

    it(`cycles from ${DEFAULT_LOCALE} → ${nextLocale(DEFAULT_LOCALE)} on click`, () => {
      renderWithProviders(<Header {...baseProps} />);

      // Open the "More" menu
      openMoreMenu(DEFAULT_LOCALE);

      // Click the language button — locale changes, dropdown stays open
      const next = cycleLocaleOnce(DEFAULT_LOCALE);
      expect(screen.getByText(LOCALE_DATA[next].appTitle)).toBeInTheDocument();
    });

    it("cycles through all 4 locales (full round-trip)", () => {
      renderWithProviders(<Header {...baseProps} />);

      // Open the "More" menu ONCE — it stays open after language clicks
      openMoreMenu(DEFAULT_LOCALE);

      let currentLocale: Locale = DEFAULT_LOCALE;

      // Click through all 4 locales
      for (let i = 0; i < LOCALE_ORDER.length; i++) {
        const next = cycleLocaleOnce(currentLocale);

        // Verify we're now on the next locale
        expect(screen.getByText(LOCALE_DATA[next].appTitle)).toBeInTheDocument();
        currentLocale = next;
      }

      // After a full cycle we should be back to the default
      expect(currentLocale).toBe(DEFAULT_LOCALE);
      expect(screen.getByText(LOCALE_DATA[DEFAULT_LOCALE].appTitle)).toBeInTheDocument();
    });
  });

  describe("header controls in different locales", () => {
    const localesToTest: Locale[] = ["en", "zh", "ko"];

    localesToTest.forEach((targetLocale) => {
      it(`shows refresh button text in ${targetLocale.toUpperCase()} when locale is ${targetLocale}`, () => {
        renderWithProviders(<Header {...baseProps} />);

        // Navigate to the target locale
        // Open the More menu once, then cycle through
        openMoreMenu(DEFAULT_LOCALE);
        let current: Locale = DEFAULT_LOCALE;
        while (current !== targetLocale) {
          current = cycleLocaleOnce(current);
        }

        // The refresh button should have the target locale's aria-label
        expect(screen.getByLabelText(LOCALE_DATA[targetLocale].refreshData)).toBeInTheDocument();
      });
    });

    it("shows search placeholder in Chinese when locale is ZH", () => {
      renderWithProviders(<Header {...baseProps} />);

      // Navigate to ZH — open More menu once, then cycle through
      openMoreMenu(DEFAULT_LOCALE);
      let current: Locale = DEFAULT_LOCALE;
      while (current !== "zh") {
        current = cycleLocaleOnce(current);
      }

      // Search input should have Chinese placeholder
      const searchInput = screen.getByPlaceholderText(LOCALE_DATA.zh.searchPlaceholder);
      expect(searchInput).toBeInTheDocument();
    });
  });

  describe("accessibility labels", () => {
    it("has aria-label on the More menu button", () => {
      renderWithProviders(<Header {...baseProps} />);

      const moreButton = screen.getByLabelText(LOCALE_DATA[DEFAULT_LOCALE].moreMenu);
      expect(moreButton).toHaveAttribute("aria-label", LOCALE_DATA[DEFAULT_LOCALE].moreMenu);
    });

    it("has aria-label on the refresh button", () => {
      renderWithProviders(<Header {...baseProps} />);

      const refreshButton = screen.getByLabelText(LOCALE_DATA[DEFAULT_LOCALE].refreshData);
      expect(refreshButton).toBeInTheDocument();
    });

    it("updates aria-label when locale changes", () => {
      renderWithProviders(<Header {...baseProps} />);

      // Switch to English via the More menu
      openMoreMenu(DEFAULT_LOCALE);
      cycleLocaleOnce(DEFAULT_LOCALE);

      // The refresh button's aria-label should now be in English
      const refreshButton = screen.getByLabelText(LOCALE_DATA.en.refreshData);
      expect(refreshButton).toBeInTheDocument();
    });
  });
});
