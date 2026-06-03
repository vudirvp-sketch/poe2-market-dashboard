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
import Fuse from "fuse.js";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { fmt, fmtChange } from "@/lib/types";
import type { ExchangePair, PoeItem } from "@/lib/types";
import { useI18n } from "@/lib/i18n";

// ============================================================================
// Types for search results
// ============================================================================

interface SearchItem {
  id: string;
  name: string;
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
  /** Current search value (controlled from parent) */
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
  const { t } = useI18n();
  const [localValue, setLocalValue] = useState(value);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync external value changes
  useEffect(() => {
    setLocalValue((prev) => (prev !== value ? value : prev));
  }, [value]);

  // Build unified search index from exchange pairs and items
  const searchItems = useMemo<SearchItem[]>(() => {
    const items: SearchItem[] = [];

    // Add exchange pairs
    for (const pair of exchangePairs) {
      const chg = fmtChange(pair.changePercent);
      items.push({
        id: pair.id,
        name: `${pair.currency1Name} / ${pair.currency2Name}`,
        secondary: "Exchange",
        price: fmt(pair.relativePrice),
        changeText: chg.text,
        changeColor: chg.color,
        iconUrl: pair.currency1IconUrl,
        tab: "exchange",
        original: pair,
      });
    }

    // Add currencies and uniques
    for (const item of allItems) {
      const chg = fmtChange(item.changePercent);
      items.push({
        id: item.id,
        name: item.name,
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
  }, [exchangePairs, allItems]);

  // Create Fuse.js instance
  const fuse = useMemo(
    () =>
      new Fuse(searchItems, {
        keys: [
          { name: "name", weight: 0.7 },
          { name: "secondary", weight: 0.3 },
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
