// ============================================================================
// I18n Context — Simple client-side internationalization
// Stores locale in localStorage, provides t() function with interpolation
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

function getInitialLocale(): Locale {
  if (typeof window === "undefined") return "ru";
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored === "en" || stored === "ru") return stored;
  } catch {
    // ignore
  }
  // Default to Russian as user requested
  return "ru";
}

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKeys, params?: Record<string, string | number>) => string;
}

export const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(getInitialLocale);

  useEffect(() => {
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      // ignore
    }
    // Also update html lang attribute
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

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
