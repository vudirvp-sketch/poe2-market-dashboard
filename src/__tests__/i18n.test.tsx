// ============================================================================
// Integration Tests — I18n Provider (t(), tp(), locale switching, hydration)
// Verifies that the I18n context works correctly with React components.
// ============================================================================
import { renderWithProviders, screen, act } from "./test-utils";
import { useI18n } from "@/lib/i18n";

// ---------------------------------------------------------------------------
// Helper component that reads i18n context and renders translated text.
// Uses locale-appropriate templates for tp() to test plural forms correctly.
// ---------------------------------------------------------------------------
function I18nConsumer({ count }: { count?: number }) {
  const { t, tp, locale, setLocale, hydrated } = useI18n();
  const n = count ?? 5;

  // Use locale-appropriate templates for tp() testing.
  // In real components, the template language must match the active locale
  // for correct plural text (tp resolves form index by locale rules).
  const pluralTemplate: Record<string, string> = {
    ru: "предметов|предмет|предмета|предметов",
    en: "items|item|items",
    zh: "项|项|项",
    ko: "개|개|개",
  };

  return (
    <div>
      <span data-testid="locale">{locale}</span>
      <span data-testid="hydrated">{String(hydrated)}</span>
      <span data-testid="simple-t">{t("appTitle")}</span>
      <span data-testid="interpolated-t">{t("alertsCount", { "0": n })}</span>
      <span data-testid="plural-tp">
        {tp(pluralTemplate[locale] ?? pluralTemplate.en, n, {})}
      </span>
      <button data-testid="switch-ru" onClick={() => setLocale("ru")}>
        RU
      </button>
      <button data-testid="switch-en" onClick={() => setLocale("en")}>
        EN
      </button>
      <button data-testid="switch-zh" onClick={() => setLocale("zh")}>
        ZH
      </button>
      <button data-testid="switch-ko" onClick={() => setLocale("ko")}>
        KO
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("I18nProvider integration", () => {
  describe("default locale", () => {
    it("starts with the default locale (ru) before hydration", () => {
      renderWithProviders(<I18nConsumer />);
      expect(screen.getByTestId("locale")).toHaveTextContent("ru");
    });

    it("returns Russian translation for t() before hydration", () => {
      renderWithProviders(<I18nConsumer />);
      expect(screen.getByTestId("simple-t")).toHaveTextContent("PoE2 Маркет");
    });
  });

  describe("hydration from localStorage", () => {
    it("hydrates locale from localStorage after mount", async () => {
      renderWithProviders(<I18nConsumer />, {
        localStorageData: { "poe2-locale": "en" },
      });

      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      expect(screen.getByTestId("hydrated")).toHaveTextContent("true");
      expect(screen.getByTestId("locale")).toHaveTextContent("en");
      expect(screen.getByTestId("simple-t")).toHaveTextContent("PoE2 Market");
    });

    it("ignores invalid locale in localStorage and falls back to default", async () => {
      renderWithProviders(<I18nConsumer />, {
        localStorageData: { "poe2-locale": "invalid" },
      });

      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      expect(screen.getByTestId("locale")).toHaveTextContent("ru");
      expect(screen.getByTestId("hydrated")).toHaveTextContent("true");
    });
  });

  describe("locale switching with setLocale()", () => {
    it("switches to English and updates t() output", () => {
      renderWithProviders(<I18nConsumer />);

      act(() => {
        screen.getByTestId("switch-en").click();
      });

      expect(screen.getByTestId("locale")).toHaveTextContent("en");
      expect(screen.getByTestId("simple-t")).toHaveTextContent("PoE2 Market");
    });

    it("switches to Chinese and updates t() output", () => {
      renderWithProviders(<I18nConsumer />);

      act(() => {
        screen.getByTestId("switch-zh").click();
      });

      expect(screen.getByTestId("locale")).toHaveTextContent("zh");
      expect(screen.getByTestId("simple-t")).toHaveTextContent("PoE2 市场");
    });

    it("switches to Korean and updates t() output", () => {
      renderWithProviders(<I18nConsumer />);

      act(() => {
        screen.getByTestId("switch-ko").click();
      });

      expect(screen.getByTestId("locale")).toHaveTextContent("ko");
      expect(screen.getByTestId("simple-t")).toHaveTextContent("PoE2 시장");
    });

    it("persists locale change to localStorage", () => {
      renderWithProviders(<I18nConsumer />);

      act(() => {
        screen.getByTestId("switch-en").click();
      });

      expect(window.localStorage.getItem("poe2-locale")).toBe("en");
    });
  });

  describe("t() with interpolation", () => {
    it("replaces {0} placeholder with value in Russian", () => {
      renderWithProviders(<I18nConsumer count={3} />);
      expect(screen.getByTestId("interpolated-t")).toHaveTextContent(
        "Оповещения (3)"
      );
    });

    it("updates interpolation when switching locale", () => {
      renderWithProviders(<I18nConsumer count={7} />);

      act(() => {
        screen.getByTestId("switch-en").click();
      });

      expect(screen.getByTestId("interpolated-t")).toHaveTextContent(
        "Alerts (7)"
      );
    });
  });

  describe("tp() pluralization — English (2 forms)", () => {
    it("returns singular form for count = 1", () => {
      renderWithProviders(<I18nConsumer count={1} />);
      act(() => {
        screen.getByTestId("switch-en").click();
      });
      expect(screen.getByTestId("plural-tp")).toHaveTextContent("item");
    });

    it("returns plural form for count = 0", () => {
      renderWithProviders(<I18nConsumer count={0} />);
      act(() => {
        screen.getByTestId("switch-en").click();
      });
      expect(screen.getByTestId("plural-tp")).toHaveTextContent("items");
    });

    it("returns plural form for count = 2", () => {
      renderWithProviders(<I18nConsumer count={2} />);
      act(() => {
        screen.getByTestId("switch-en").click();
      });
      expect(screen.getByTestId("plural-tp")).toHaveTextContent("items");
    });

    it("returns plural form for count = 5", () => {
      renderWithProviders(<I18nConsumer count={5} />);
      act(() => {
        screen.getByTestId("switch-en").click();
      });
      expect(screen.getByTestId("plural-tp")).toHaveTextContent("items");
    });
  });

  describe("tp() pluralization — Russian (3 forms)", () => {
    // Russian plural rules: 1→form0, 2-4→form1, 5-20→form2,
    // 21→form0, 22-24→form1, 25-30→form2, etc.
    it("returns form 0 (1 предмет) for count = 1", () => {
      renderWithProviders(<I18nConsumer count={1} />);
      expect(screen.getByTestId("plural-tp")).toHaveTextContent("предмет");
    });

    it("returns form 1 (2 предмета) for count = 2", () => {
      renderWithProviders(<I18nConsumer count={2} />);
      expect(screen.getByTestId("plural-tp")).toHaveTextContent("предмета");
    });

    it("returns form 2 (5 предметов) for count = 5", () => {
      renderWithProviders(<I18nConsumer count={5} />);
      expect(screen.getByTestId("plural-tp")).toHaveTextContent("предметов");
    });

    it("returns form 2 (0 предметов) for count = 0", () => {
      renderWithProviders(<I18nConsumer count={0} />);
      expect(screen.getByTestId("plural-tp")).toHaveTextContent("предметов");
    });

    it("returns form 0 (21 предмет) for count = 21", () => {
      renderWithProviders(<I18nConsumer count={21} />);
      expect(screen.getByTestId("plural-tp")).toHaveTextContent("предмет");
    });

    it("returns form 1 (22 предмета) for count = 22", () => {
      renderWithProviders(<I18nConsumer count={22} />);
      expect(screen.getByTestId("plural-tp")).toHaveTextContent("предмета");
    });

    it("returns form 2 (25 предметов) for count = 25", () => {
      renderWithProviders(<I18nConsumer count={25} />);
      expect(screen.getByTestId("plural-tp")).toHaveTextContent("предметов");
    });

    it("returns form 2 (11 предметов) for count = 11 — 11-19 exception", () => {
      renderWithProviders(<I18nConsumer count={11} />);
      expect(screen.getByTestId("plural-tp")).toHaveTextContent("предметов");
    });

    it("returns form 2 (112 предметов) for count = 112", () => {
      renderWithProviders(<I18nConsumer count={112} />);
      expect(screen.getByTestId("plural-tp")).toHaveTextContent("предметов");
    });
  });

  describe("tp() pluralization — Chinese (no inflection)", () => {
    it("always returns the same form regardless of count", () => {
      renderWithProviders(<I18nConsumer count={1} />);
      act(() => {
        screen.getByTestId("switch-zh").click();
      });
      expect(screen.getByTestId("plural-tp")).toHaveTextContent("项");
    });
  });

  describe("tp() pluralization — Korean (no inflection)", () => {
    it("always returns the same form regardless of count", () => {
      renderWithProviders(<I18nConsumer count={1} />);
      act(() => {
        screen.getByTestId("switch-ko").click();
      });
      expect(screen.getByTestId("plural-tp")).toHaveTextContent("개");
    });
  });

  describe("useI18n() outside provider", () => {
    it("throws an error when used outside I18nProvider", () => {
      const spy = jest.spyOn(console, "error").mockImplementation(() => {});

      function NoProvider() {
        useI18n();
        return null;
      }

      expect(() => render(<NoProvider />)).toThrow(
        "useI18n must be used within I18nProvider"
      );

      spy.mockRestore();
    });
  });
});

// Direct import of render without providers for the error case
import { render } from "@testing-library/react";
