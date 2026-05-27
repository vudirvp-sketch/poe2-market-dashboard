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
      if (seconds < 60) setTimeAgo(`${seconds}s ago`);
      else setTimeAgo(`${Math.floor(seconds / 60)}m ago`);
    }, 1000);
    return () => clearInterval(interval);
  }, [lastUpdated]);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-40">
      <div className="max-w-[1600px] mx-auto px-4 py-3 flex flex-wrap items-center gap-3">
        {/* Logo */}
        <div className="flex items-center gap-2 mr-4">
          <Activity className="h-6 w-6 text-primary" />
          <h1 className="text-lg font-bold tracking-tight">PoE2 Market</h1>
        </div>

        {/* Realm select */}
        <Select
          value={realm}
          onValueChange={(v) => onRealmChange(v)}
        >
          <SelectTrigger className="w-[120px]">
            <SelectValue placeholder="Realm" />
          </SelectTrigger>
          <SelectContent>
            {realmsLoading ? (
              <SelectItem value="loading" disabled>
                Loading...
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
            <SelectValue placeholder="League" />
          </SelectTrigger>
          <SelectContent>
            {leagues?.map((l) => (
              <SelectItem key={l.name} value={l.name}>
                {l.displayName} {!l.active && "(inactive)"}
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
              <SelectValue placeholder="Base Currency" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_default">Default</SelectItem>
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
            placeholder="Search items..."
            value={localSearch}
            onChange={(e) => handleSearchInput(e.target.value)}
            className="pl-9 h-9"
          />
          {localSearch && (
            <button
              onClick={handleClearSearch}
              className="absolute right-2.5 top-2.5"
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
        >
          <Clock className="h-4 w-4 mr-1" />
          {autoRefresh ? "60s" : "Auto"}
        </Button>

        {/* Refresh */}
        <Button variant="outline" size="sm" onClick={onRefresh} className="h-9">
          <RefreshCw className="h-4 w-4 mr-1" />
          Refresh
        </Button>

        {/* Last updated */}
        {lastUpdated && (
          <span className="text-xs text-muted-foreground">
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
            >
              <Download className="h-3.5 w-3.5 mr-1" />
              CSV
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-9 text-xs"
              onClick={() => onExport("json")}
            >
              <Download className="h-3.5 w-3.5 mr-1" />
              JSON
            </Button>
          </div>
        )}

        {/* Theme toggle */}
        <Button
          variant="ghost"
          size="sm"
          className="h-9"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? (
            <Sun className="h-4 w-4" />
          ) : (
            <Moon className="h-4 w-4" />
          )}
        </Button>
      </div>
    </header>
  );
}
