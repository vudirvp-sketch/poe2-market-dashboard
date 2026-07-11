// ============================================================================
// I18n Context — Simple client-side internationalization
// Stores locale in localStorage, provides t() function with interpolation
// and tp() function with pluralization via Intl.PluralRules
// ============================================================================
//
// iter 121 (RE-DO of iter 119, see KI-25) — refactored from
// `useState(locale) + useEffect(setLocaleState(stored)) + useEffect(setHydrated(true))`
// to `useSyncExternalStore` for BOTH `locale` and `hydrated`. This eliminates
// the `react-hooks/set-state-in-effect` warning (KI-24) because there is no
// `useEffect` + `setState` pattern — the external-store subscription is
// handled by the primitive itself.
//
// Key design: a module-level `hasMounted` flag preserves the "first render =
// DEFAULT_LOCALE" invariant (to avoid hydration mismatches). `useSyncExternalStore`'s
// `getServerSnapshot` is ONLY used during hydration — in non-hydration contexts
// (jsdom tests, client-only routes), `getSnapshot` is used from the very first
// render. So `getSnapshot` returns `DEFAULT_LOCALE` until `subscribe` is first
// called (during the commit phase of `I18nProvider`), at which point `hasMounted`
// flips to `true`, the stored locale is read, and the callback is invoked to
// schedule a re-render — mimicking the old `useEffect(() => setState(stored))`
// transition WITHOUT calling setState inside an effect.
//
// Test isolation: the module-level `hasMounted` flag persists across tests.
// `__resetI18nForTesting()` is called in `jest.setup.ts` `beforeEach` to reset
// `hasMounted`, `currentLocale`, and the listener set.
"use client";

import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import en, { type TranslationKeys } from "./locales/en";
import ru from "./locales/ru";
import zh from "./locales/zh";
import ko from "./locales/ko";

export type Locale = "en" | "ru" | "zh" | "ko";
export type { TranslationKeys };

const messages: Record<Locale, Record<TranslationKeys, string>> = { en, ru, zh, ko };

const LOCALE_STORAGE_KEY = "poe2-locale";
const DEFAULT_LOCALE: Locale = "ru";
const VALID_LOCALES: Locale[] = ["en", "ru", "zh", "ko"];

// ============================================================================
// Module-level external store (iter 121 — useSyncExternalStore, KI-25/KI-24)
// ============================================================================
// The store holds the current locale in module scope so that locale changes
// are visible to ALL I18nProvider instances (and useSyncExternalStore
// subscribers) in the same JS context — same-tab sync without a `storage`
// event listener (the `storage` event only fires in OTHER tabs).
//
// State machine:
//   hasMounted = false  → getSnapshot returns DEFAULT_LOCALE (SSR / first render)
//   hasMounted = true   → getSnapshot returns currentLocale (post-commit)
//
// The `hasMounted` flag flips inside `subscribeLocale` on its FIRST call
// (which happens during I18nProvider's commit phase), and the stored locale
// is read at that moment. The callback is then invoked to schedule a
// re-render, mimicking the old useEffect-based hydration transition.

let currentLocale: Locale = DEFAULT_LOCALE;
let hasMounted = false;
const listeners = new Set<() => void>();

/**
 * Read the stored locale from localStorage. Returns DEFAULT_LOCALE if the
 * stored value is missing, invalid, or if we're in SSR (no window).
 */
function readStoredLocale(): Locale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored && (VALID_LOCALES as string[]).includes(stored)) {
      return stored as Locale;
    }
  } catch {
    // ignore — localStorage may be disabled (private mode, etc.)
  }
  return DEFAULT_LOCALE;
}

function notifyListeners(): void {
  listeners.forEach((l) => l());
}

/**
 * Subscribe to locale changes. On the FIRST call (first client render of
 * I18nProvider), flips `hasMounted` to true, reads the stored locale, and
 * invokes the callback to schedule a re-render — this mimics the old
 * `useEffect(() => setState(stored))` transition WITHOUT calling setState
 * inside an effect. Subsequent calls (e.g. StrictMode double-invoke) are
 * no-ops because `hasMounted` is already true.
 */
function subscribeLocale(callback: () => void): () => void {
  listeners.add(callback);
  if (!hasMounted) {
    hasMounted = true;
    const stored = readStoredLocale();
    if (stored !== currentLocale) {
      currentLocale = stored;
    }
    // Schedule a re-render so getSnapshot returns the stored locale.
    callback();
  }
  return () => {
    listeners.delete(callback);
  };
}

function getLocaleSnapshot(): Locale {
  return hasMounted ? currentLocale : DEFAULT_LOCALE;
}

function getLocaleServerSnapshot(): Locale {
  return DEFAULT_LOCALE;
}

// `hydrated` is derived from the same `hasMounted` flag. It uses the same
// subscribe function so the first-call mount trigger fires once for both.
function subscribeHydrated(callback: () => void): () => void {
  return subscribeLocale(callback);
}

function getHydratedSnapshot(): boolean {
  return hasMounted;
}

function getHydratedServerSnapshot(): boolean {
  return false;
}

/**
 * Update the locale. Writes to localStorage (same-tab — the `storage` event
 * only fires in OTHER tabs, so same-tab consumers are notified via the
 * listener set), updates the in-memory store, and notifies all subscribers.
 */
function setLocaleInternal(newLocale: Locale): void {
  if (newLocale === currentLocale) return;
  currentLocale = newLocale;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, newLocale);
    } catch {
      // ignore — localStorage may be disabled
    }
  }
  notifyListeners();
}

/**
 * Reset the module-level i18n store to its initial state.
 * Exposed for test isolation — called in jest.setup.ts beforeEach so each
 * test gets a fresh "first subscribe" behavior (hasMounted reset to false,
 * currentLocale reset to DEFAULT_LOCALE, listeners cleared).
 */
export function __resetI18nForTesting(): void {
  currentLocale = DEFAULT_LOCALE;
  hasMounted = false;
  listeners.clear();
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
 *
 * Chinese/Korean: always return 0 (no inflection).
 * English/default: 1 -> singular (0), other -> plural (1).
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
  if (locale === "zh" || locale === "ko") {
    // Chinese and Korean do not inflect nouns for count
    return 0;
  }
  // English / default: 1 -> singular (0), other -> plural (1)
  return count === 1 ? 0 : 1;
}

/**
 * Plural translation key pattern: "key|form0|form1|form2"
 * Pipe-separated: key is the lookup key, then plural forms follow.
 * For English: "items|item|items"  (2 forms)
 * For Russian: "items|предмет|предмета|предметов"  (3 forms)
 * For Chinese/Korean: "items|物品|物品|物品"  (all same)
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
  /** Plural translation: tp(t("_pl_items"), count, { ... }) — template comes from locale _pl_* keys */
  tp: (template: string, count: number, params?: Record<string, string | number>) => string;
  /** Whether the locale has been hydrated from localStorage */
  hydrated: boolean;
}

export const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  // useSyncExternalStore handles the external-store subscription without a
  // useEffect+setState pattern, eliminating the react-hooks/set-state-in-effect
  // warning. `locale` transitions DEFAULT_LOCALE → stored locale on first
  // commit; `hydrated` transitions false → true on the same commit.
  const locale = useSyncExternalStore(
    subscribeLocale,
    getLocaleSnapshot,
    getLocaleServerSnapshot
  );
  const hydrated = useSyncExternalStore(
    subscribeHydrated,
    getHydratedSnapshot,
    getHydratedServerSnapshot
  );

  // Update <html> lang attribute when locale changes. This effect does NOT
  // call setState — it only mutates the DOM, so it does not trigger the
  // react-hooks/set-state-in-effect rule. localStorage persistence is handled
  // inside setLocaleInternal (the explicit setter), not here.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleInternal(newLocale);
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
