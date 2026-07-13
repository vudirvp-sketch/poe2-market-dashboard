// ============================================================================
// Fuzzy Search with Autocomplete (§2.5)
//
// Replaces the simple exact-match search with fuse.js-based fuzzy matching.
// Searches across pair names (Exchange) and item names (Uniques/Currencies).
// Shows a dropdown with matching results (max 8 items) as user types.
// Clicking a result navigates to the relevant tab and highlights the item.
// Pressing Enter filters the active table to matching items.
// Pressing Escape closes the dropdown and clears the search.
// Debounce: 200ms after the user stops typing.
// ============================================================================
"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
// NOTE (iter 120, KI-24): This component is intentionally UNCONTROLLED with
// respect to the `value` prop. `value` is used ONLY as the initial value of
// `localValue` (via `useState(value)`). Subsequent external changes to `value`
// are NOT mirrored into the input. This is the agreed contract with the parent
// (`header.tsx` lines 239-243: "No need to sync external search changes —
// FuzzySearch manages its own state"). The only external reset in the codebase
// is `setSearch("")` on result selection (`dashboard-page.tsx:799`), which is
// triggered FROM `handleResultClick` below AFTER `setLocalValue("")` runs
// synchronously — so `localValue` is already `""` by the time the parent
// re-renders with `value = ""`, and no sync effect is needed. The previous
// `useEffect(() => setLocalValue(prev => prev !== value ? value : prev), [value])`
// was dead code (the guard was always false) and triggered the
// `react-hooks/set-state-in-effect` warning; removing it is a zero-behavior-
// change fix. If a future feature needs to EXTERNALLY drive the input value
// (e.g. a "populate search from URL" button), reintroduce a controlled sync —
// but prefer the "adjust state during render with prevValue guard" recipe
// (iter 118) over an effect, to avoid re-introducing the warning.
import Fuse from "fuse.js";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { fmt, fmtChange } from "@/lib/types";
import type { ExchangePair, PoeItem } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
// iter 148 (TD-6 phase 2 follow-up): pick RU display name for unique items
// (and currency pairs) when locale=ru. The EN name is kept as `nameAlt` so
// users can search across both languages (e.g. search "Сфера" finds "Сфера
// хаоса" via `name`; search "Chaos" finds the same item via `nameAlt`).
import {
  getCurrencyDisplayName,
  getUniqueDisplayName,
} from "@/lib/currency-names";

// ============================================================================
// Types for search results
// ============================================================================

interface SearchItem {
  id: string;
  name: string;
  /** iter 148: alternate-language name for cross-locale search.
   *  - For unique items in RU locale: the EN upstream name.
   *  - For unique items in EN locale: the poe2db RU name (when available).
   *  - For currency pairs in RU locale: the EN upstream pair string.
   *  - For currency pairs in EN locale: the RU pair string (when different).
   *  Null when no alternate name is available (e.g. no RU translation). */
  nameAlt: string | null;
  /** Secondary text (e.g. category, base type) */
  secondary: string;
  /** Current price or rate */
  price: string;
  /** Change percentage text */
  changeText: string;
  /** Change color class */
  changeColor: string;
  /** Icon URL */
  iconUrl: string | null;
  /** Which tab this result belongs to */
  tab: "exchange" | "currencies" | "uniques";
  /** Original item reference for navigation */
  original: ExchangePair | PoeItem;
}

interface FuzzySearchProps {
  /** Initial search value (used on first render only — see iter 120 NOTE above). */
  value: string;
  /** Called when search value changes */
  onValueChange: (value: string) => void;
  /** Called when a search result is selected */
  onResultSelect: (item: SearchItem) => void;
  /** Called when Enter is pressed (filter active table) */
  onFilterSubmit: (query: string) => void;
  /** Exchange pairs for indexing */
  exchangePairs: ExchangePair[];
  /** All items (currencies + uniques) for indexing */
  allItems: PoeItem[];
  /** Currently active tab */
  activeTab: string;
  /** Placeholder text */
  placeholder?: string;
}

// ============================================================================
// Fuzzy Search Component
// ============================================================================

export function FuzzySearch({
  value,
  onValueChange,
  onResultSelect,
  onFilterSubmit,
  exchangePairs,
  allItems,
  activeTab,
  placeholder,
}: FuzzySearchProps) {
  const { t, locale } = useI18n();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // `value` is the initial value only — see the module-level NOTE (iter 120).
  // No sync effect: the component is uncontrolled w.r.t. `value` after mount.
  const [localValue, setLocalValue] = useState(value);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);

  // Build unified search index from exchange pairs and items.
  // iter 148: locale-aware `name` (RU when available) + `nameAlt` (the other
  // language's name) so users can search across both languages.
  const searchItems = useMemo<SearchItem[]>(() => {
    const items: SearchItem[] = [];

    // Add exchange pairs — derive locale-aware label.
    for (const pair of exchangePairs) {
      const chg = fmtChange(pair.changePercent);
      const enName = `${pair.currency1Name} / ${pair.currency2Name}`;
      const ruName = `${getCurrencyDisplayName(pair.currency1Id, "ru") || pair.currency1Name} / ${getCurrencyDisplayName(pair.currency2Id, "ru") || pair.currency2Name}`;
      const primaryName = locale === "ru" ? ruName : enName;
      // `nameAlt` is the OTHER language's name when it differs from primary.
      const nameAlt = primaryName === enName
        ? (ruName !== enName ? ruName : null)
        : enName;
      items.push({
        id: pair.id,
        name: primaryName,
        nameAlt,
        secondary: "Exchange",
        price: fmt(pair.relativePrice),
        changeText: chg.text,
        changeColor: chg.color,
        iconUrl: pair.currency1IconUrl,
        tab: "exchange",
        original: pair,
      });
    }

    // Add currencies and uniques — derive locale-aware name from `item.nameRu`
    // (already populated by `mapUniqueItem` in poe2api.ts for uniques) plus
    // `getCurrencyDisplayName` for currency items.
    for (const item of allItems) {
      const chg = fmtChange(item.changePercent);
      // For unique items: prefer `item.nameRu` (set by mapUniqueItem via poe2db
      // lookup). For currencies: use `getCurrencyDisplayName(apiId, locale)`.
      // The two paths are mutually exclusive — currencies never have `nameRu`
      // (it's only set for uniques) and uniques don't have a stable `apiId`
      // (they use ItemId). Falling back to `item.name` (the upstream EN name)
      // covers any uncovered case.
      const ruUnique = item.nameRu ?? getUniqueDisplayName(item.name, "ru");
      const enName = item.name;
      const primaryName =
        locale === "ru" && ruUnique ? ruUnique : enName;
      const nameAlt =
        primaryName === enName
          ? (ruUnique && ruUnique !== enName ? ruUnique : null)
          : enName;
      items.push({
        id: item.id,
        name: primaryName,
        nameAlt,
        secondary: item.type || item.category,
        price: fmt(item.relativePrice ?? item.chaosEquivalentRate),
        changeText: chg.text,
        changeColor: chg.color,
        iconUrl: item.iconUrl,
        tab: item.category === "Unique" ? "uniques" : "currencies",
        original: item,
      });
    }

    return items;
  }, [exchangePairs, allItems, locale]);

  // Create Fuse.js instance
  // iter 148: include `nameAlt` as a third search key with lower weight so
  // users can search across both languages (e.g. EN search "Chaos" still
  // finds "Сфера хаоса" when locale=ru). Weights sum to 1.0; `name` is the
  // primary display name, `nameAlt` is the alternate-language name, and
  // `secondary` is the category/base-type hint.
  const fuse = useMemo(
    () =>
      new Fuse(searchItems, {
        keys: [
          { name: "name", weight: 0.6 },
          { name: "nameAlt", weight: 0.25 },
          { name: "secondary", weight: 0.15 },
        ],
        threshold: 0.3,
        includeScore: true,
      }),
    [searchItems]
  );

  // Search results
  const results = useMemo(() => {
    if (!localValue || localValue.length < 2) return [];
    return fuse.search(localValue).slice(0, 8);
  }, [fuse, localValue]);

  // Debounced search handler
  const handleInput = useCallback(
    (inputValue: string) => {
      setLocalValue(inputValue);
      setIsOpen(inputValue.length >= 2);

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onValueChange(inputValue);
      }, 200);
    },
    [onValueChange]
  );

  // Clear search
  const handleClear = useCallback(() => {
    setLocalValue("");
    setIsOpen(false);
    setSelectedIndex(-1);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    onValueChange("");
  }, [onValueChange]);

  // Result selection
  const handleResultClick = useCallback(
    (item: SearchItem) => {
      onResultSelect(item);
      setIsOpen(false);
      setLocalValue("");
      setSelectedIndex(-1);
    },
    [onResultSelect]
  );

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isOpen || results.length === 0) {
        if (e.key === "Enter" && localValue) {
          onFilterSubmit(localValue);
          setIsOpen(false);
        }
        if (e.key === "Escape") {
          handleClear();
        }
        return;
      }

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev < results.length - 1 ? prev + 1 : 0
          );
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev > 0 ? prev - 1 : results.length - 1
          );
          break;
        case "Enter":
          e.preventDefault();
          if (selectedIndex >= 0 && selectedIndex < results.length) {
            handleResultClick(results[selectedIndex].item);
          } else if (localValue) {
            onFilterSubmit(localValue);
            setIsOpen(false);
          }
          break;
        case "Escape":
          handleClear();
          break;
      }
    },
    [isOpen, results, selectedIndex, localValue, handleResultClick, onFilterSubmit, handleClear]
  );

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
        setSelectedIndex(-1);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const defaultPlaceholder = t("searchPlaceholder");

  return (
    <div className="relative flex-1 min-w-[150px] max-w-md" ref={containerRef}>
      <Search
        className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        ref={inputRef}
        placeholder={placeholder ?? defaultPlaceholder}
        value={localValue}
        onChange={(e) => handleInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          if (localValue.length >= 2) setIsOpen(true);
        }}
        className="pl-8 h-8 text-sm"
        role="combobox"
        aria-expanded={isOpen}
        aria-autocomplete="list"
        aria-controls={isOpen ? "fuzzy-search-listbox" : undefined}
        aria-activedescendant={
          selectedIndex >= 0
            ? `fuzzy-search-option-${selectedIndex}`
            : undefined
        }
      />
      {localValue && (
        <button
          onClick={handleClear}
          className="absolute right-2.5 top-2"
          aria-label={t("ariaClearSearch")}
        >
          <X className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
        </button>
      )}

      {/* Autocomplete dropdown */}
      {isOpen && results.length > 0 && (
        <div
          id="fuzzy-search-listbox"
          role="listbox"
          className="absolute top-full left-0 right-0 mt-1 bg-popover border border-border rounded-lg shadow-lg z-50 py-1 max-h-[320px] overflow-y-auto"
        >
          {results.map((result, idx) => {
            const item = result.item;
            const isSelected = idx === selectedIndex;
            return (
              <div
                key={item.id}
                id={`fuzzy-search-option-${idx}`}
                role="option"
                aria-selected={isSelected}
                className={`flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors ${
                  isSelected
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent/50"
                }`}
                onClick={() => handleResultClick(item)}
                onMouseEnter={() => setSelectedIndex(idx)}
              >
                {/* Icon */}
                {item.iconUrl ? (
                  <img
                    src={item.iconUrl}
                    alt=""
                    className="w-6 h-6 object-contain shrink-0"
                  />
                ) : (
                  <div className="w-6 h-6 shrink-0" />
                )}

                {/* Name + secondary */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{item.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {item.secondary}
                  </p>
                </div>

                {/* Price + change */}
                <div className="text-right shrink-0">
                  <p className="text-sm font-mono font-medium">{item.price}</p>
                  <p className={`text-xs font-medium ${item.changeColor}`}>
                    {item.changeText}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* No results message */}
      {isOpen && localValue.length >= 2 && results.length === 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-popover border border-border rounded-lg shadow-lg z-50 py-3 px-4 text-center">
          <p className="text-sm text-muted-foreground">
            {t("searchNoResults")}
          </p>
        </div>
      )}
    </div>
  );
}
