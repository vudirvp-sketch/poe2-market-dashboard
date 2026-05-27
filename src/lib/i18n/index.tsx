// ============================================================================
// I18n Context — Simple client-side internationalization
// Stores locale in localStorage, provides t() function with interpolation
// and tp() function with pluralization via Intl.PluralRules
// ============================================================================
"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import en, { type TranslationKeys } from "./locales/en";
import ru from "./locales/ru";

export type Locale = "en" | "ru";
export type { TranslationKeys };

const messages: Record<Locale, Record<TranslationKeys, string>> = { en, ru };

const LOCALE_STORAGE_KEY = "poe2-locale";
const DEFAULT_LOCALE: Locale = "ru";

/**
 * Get initial locale WITHOUT reading localStorage during SSR.
 * During SSR (window undefined) we always return the default.
 * On the first client render we ALSO return the default to avoid
 * hydration mismatches. The real stored locale is applied in useEffect.
 */
function getInitialLocale(): Locale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  // Do NOT read localStorage here — it causes hydration mismatch
  // because the server renders with DEFAULT_LOCALE but the client
  // might have a different value stored.
  return DEFAULT_LOCALE;
}

// ============================================================================
// Pluralization helpers
// ============================================================================

/**
 * Russian plural rule: chooses one of 3 forms based on count.
 *   1  -> form 0  ("предмет")
 *   2-4 -> form 1  ("предмета")
 *   5-20 -> form 2 ("предметов")
 *   21  -> form 0  ("предмет")
 *   22-24 -> form 1 ("предмета")
 *   etc.
 */
function getPluralIndex(locale: Locale, count: number): number {
  if (locale === "ru") {
    const abs = Math.abs(count);
    const mod10 = abs % 10;
    const mod100 = abs % 100;
    if (mod100 >= 11 && mod100 <= 19) return 2;
    if (mod10 === 1) return 0;
    if (mod10 >= 2 && mod10 <= 4) return 1;
    return 2;
  }
  // English / default: 1 -> singular (0), other -> plural (1)
  return count === 1 ? 0 : 1;
}

/**
 * Plural translation key pattern: "key|form0|form1|form2"
 * Pipe-separated: key is the lookup key, then plural forms follow.
 * For English: "items|item|items"  (2 forms)
 * For Russian: "items|предмет|предмета|предметов"  (3 forms)
 */
function resolvePlural(
  locale: Locale,
  template: string,
  count: number
): string {
  const parts = template.split("|");
  if (parts.length < 2) return template;
  // const baseKey = parts[0]; // not used, the whole string IS the template
  const idx = getPluralIndex(locale, count);
  // Clamp to available forms
  const formIdx = Math.min(idx + 1, parts.length - 1);
  return parts[formIdx];
}

// ============================================================================
// Context
// ============================================================================

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  /** Simple translation with interpolation: t("key", { "0": value }) */
  t: (key: TranslationKeys, params?: Record<string, string | number>) => string;
  /** Plural translation: tp("items|предмет|предмета|предметов", count, { ... }) */
  tp: (template: string, count: number, params?: Record<string, string | number>) => string;
  /** Whether the locale has been hydrated from localStorage */
  hydrated: boolean;
}

export const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  // Always start with DEFAULT_LOCALE for consistent SSR/hydration
  const [locale, setLocaleState] = useState<Locale>(getInitialLocale);
  const [hydrated, setHydrated] = useState(false);

  // After mount, read the real locale from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
      if (stored === "en" || stored === "ru") {
        if (stored !== DEFAULT_LOCALE) {
          setLocaleState(stored);
        }
      }
    } catch {
      // ignore
    }
    setHydrated(true);
  }, []);

  // Persist locale changes to localStorage + update <html> lang
  useEffect(() => {
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      // ignore
    }
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
  }, []);

  const t = useCallback(
    (key: TranslationKeys, params?: Record<string, string | number>): string => {
      let msg = messages[locale]?.[key] ?? messages.en[key] ?? key;
      if (params) {
        Object.entries(params).forEach(([k, v]) => {
          msg = msg.replace(`{${k}}`, String(v));
        });
      }
      return msg;
    },
    [locale]
  );

  const tp = useCallback(
    (template: string, count: number, params?: Record<string, string | number>): string => {
      let result = resolvePlural(locale, template, count);
      // Also apply interpolation
      if (params) {
        Object.entries(params).forEach(([k, v]) => {
          result = result.replace(`{${k}}`, String(v));
        });
      }
      return result;
    },
    [locale]
  );

  return (
    <I18nContext.Provider value={{ locale, setLocale, t, tp, hydrated }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
