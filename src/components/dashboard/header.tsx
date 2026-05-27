// ============================================================================
// Header Component (realm/league select, search with debounce, refresh, auto-refresh, theme, base currency)
// ============================================================================
"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  Search,
  RefreshCw,
  X,
  Activity,
  Sun,
  Moon,
  Clock,
  Download,
  Globe,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Realm, League, ReferenceCurrency } from "@/lib/types";
import { useTheme } from "next-themes";
import { useI18n, type Locale } from "@/lib/i18n";

interface HeaderProps {
  realms: Realm[] | undefined;
  leagues: League[] | undefined;
  realmsLoading: boolean;
  leaguesLoading: boolean;
  realm: string;
  league: string;
  effectiveLeague: string;
  search: string;
  onRealmChange: (realm: string) => void;
  onLeagueChange: (league: string) => void;
  onSearchChange: (search: string) => void;
  onRefresh: () => void;
  autoRefresh: boolean;
  onAutoRefreshToggle: () => void;
  lastUpdated: Date | null;
  referenceCurrencies?: ReferenceCurrency[];
  referenceCurrency?: string;
  onReferenceCurrencyChange?: (currency: string) => void;
  onExport?: (format: "csv" | "json") => void;
}

const LOCALE_LABELS: Record<Locale, string> = {
  en: "EN",
  ru: "RU",
  zh: "\u4E2D",
  ko: "\uD55C",
};

export function Header({
  realms,
  leagues,
  realmsLoading,
  leaguesLoading,
  realm,
  effectiveLeague,
  search,
  onRealmChange,
  onLeagueChange,
  onSearchChange,
  onRefresh,
  autoRefresh,
  onAutoRefreshToggle,
  lastUpdated,
  referenceCurrencies,
  referenceCurrency,
  onReferenceCurrencyChange,
  onExport,
}: HeaderProps) {
  const { theme, setTheme } = useTheme();
  const { t, tp, locale, setLocale } = useI18n();
  const [timeAgo, setTimeAgo] = useState<string>("");
  const [localSearch, setLocalSearch] = useState(search);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync external search changes (e.g. clear button) back to local
  useEffect(() => {
    if (search !== localSearch) {
      setLocalSearch(search);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // Debounced search handler — 300ms delay
  const handleSearchInput = useCallback(
    (value: string) => {
      setLocalSearch(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onSearchChange(value);
      }, 300);
    },
    [onSearchChange]
  );

  // Clear search immediately
  const handleClearSearch = useCallback(() => {
    setLocalSearch("");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    onSearchChange("");
  }, [onSearchChange]);

  useEffect(() => {
    if (!lastUpdated) return;
    const interval = setInterval(() => {
      const seconds = Math.floor(
        (Date.now() - lastUpdated.getTime()) / 1000
      );
      if (seconds < 60) setTimeAgo(t("secondsAgo", { "0": seconds }));
      else setTimeAgo(t("minutesAgo", { "0": Math.floor(seconds / 60) }));
    }, 1000);
    return () => clearInterval(interval);
  }, [lastUpdated, t]);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Cycle through locales
  const LOCALE_ORDER: Locale[] = ["ru", "en", "zh", "ko"];
  const cycleLocale = useCallback(() => {
    const idx = LOCALE_ORDER.indexOf(locale);
    const next = LOCALE_ORDER[(idx + 1) % LOCALE_ORDER.length];
    setLocale(next);
  }, [locale, setLocale]);

  return (
    <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-40">
      <div className="max-w-[1600px] mx-auto px-4 py-3 flex flex-wrap items-center gap-3">
        {/* Logo */}
        <div className="flex items-center gap-2 mr-4">
          <Activity className="h-6 w-6 text-primary" />
          <h1 className="text-lg font-bold tracking-tight">{t("appTitle")}</h1>
        </div>

        {/* Realm select */}
        <Select
          value={realm}
          onValueChange={(v) => onRealmChange(v)}
        >
          <SelectTrigger className="w-[120px]">
            <SelectValue placeholder={t("realm")} />
          </SelectTrigger>
          <SelectContent>
            {realmsLoading ? (
              <SelectItem value="loading" disabled>
                {t("loading")}
              </SelectItem>
            ) : (
              realms?.map((r) => (
                <SelectItem key={r.name} value={r.name}>
                  {r.displayName}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>

        {/* League select */}
        <Select value={effectiveLeague} onValueChange={onLeagueChange}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder={t("league")} />
          </SelectTrigger>
          <SelectContent>
            {leagues?.map((l) => (
              <SelectItem key={l.name} value={l.name}>
                {l.displayName} {!l.active && `(${t("inactive")})`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Reference Currency select */}
        {referenceCurrencies && referenceCurrencies.length > 0 && onReferenceCurrencyChange && (
          <Select
            value={referenceCurrency || "_default"}
            onValueChange={(v) =>
              onReferenceCurrencyChange(v === "_default" ? "" : v)
            }
          >
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder={t("baseCurrency")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_default">{t("defaultCurrency")}</SelectItem>
              {referenceCurrencies.map((c) => (
                <SelectItem key={c.apiId} value={c.apiId}>
                  {c.text}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Search (debounced) */}
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("searchPlaceholder")}
            value={localSearch}
            onChange={(e) => handleSearchInput(e.target.value)}
            className="pl-9 h-9"
          />
          {localSearch && (
            <button
              onClick={handleClearSearch}
              className="absolute right-2.5 top-2.5"
              aria-label="Clear search"
            >
              <X className="h-4 w-4 text-muted-foreground hover:text-foreground" />
            </button>
          )}
        </div>

        {/* Auto-refresh toggle */}
        <Button
          variant={autoRefresh ? "default" : "outline"}
          size="sm"
          onClick={onAutoRefreshToggle}
          className="h-9"
          aria-label={autoRefresh ? t("disableAutoRefresh") : t("enableAutoRefresh")}
        >
          <Clock className="h-4 w-4 mr-1" aria-hidden="true" />
          {autoRefresh ? "60s" : t("autoRefresh")}
        </Button>

        {/* Refresh */}
        <Button variant="outline" size="sm" onClick={onRefresh} className="h-9" aria-label={t("refreshData")}>
          <RefreshCw className="h-4 w-4 mr-1" aria-hidden="true" />
          {t("refresh")}
        </Button>

        {/* Last updated */}
        {lastUpdated && (
          <span className="text-xs text-muted-foreground" aria-live="polite" role="status">
            {timeAgo}
          </span>
        )}

        {/* Export dropdown */}
        {onExport && (
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-9 text-xs"
              onClick={() => onExport("csv")}
              aria-label={t("exportCsv")}
            >
              <Download className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
              {t("exportCsv")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-9 text-xs"
              onClick={() => onExport("json")}
              aria-label={t("exportJson")}
            >
              <Download className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
              {t("exportJson")}
            </Button>
          </div>
        )}

        {/* Language toggle — cycles ru → en → zh → ko → ru */}
        <Button
          variant="ghost"
          size="sm"
          className="h-9 gap-1"
          onClick={cycleLocale}
          title={t("switchLanguage")}
          aria-label={t("switchLanguage")}
        >
          <Globe className="h-4 w-4" aria-hidden="true" />
          <span className="text-xs">{LOCALE_LABELS[locale]}</span>
        </Button>

        {/* Theme toggle */}
        <Button
          variant="ghost"
          size="sm"
          className="h-9"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          aria-label={theme === "dark" ? t("switchToLightMode") : t("switchToDarkMode")}
        >
          {theme === "dark" ? (
            <Sun className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Moon className="h-4 w-4" aria-hidden="true" />
          )}
        </Button>
      </div>
    </header>
  );
}
