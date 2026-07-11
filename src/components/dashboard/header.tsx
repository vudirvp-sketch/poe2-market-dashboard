// ============================================================================
// Header Component (§1.4: Simplified layout)
//
// Always visible: Logo, Realm+League selector, Search, Auto-refresh toggle
// "More" menu (⋮): Export, Theme, Language, Events, Reference Currency
//
// Updated: Phase badge + Backend status indicator (kept — minimal, useful)
// ============================================================================
"use client";

import { useEffect, useState, useCallback, useRef, useSyncExternalStore } from "react";
import {
  RefreshCw,
  Activity,
  Sun,
  Moon,
  Clock,
  Download,
  Globe,
  Bell,
  Circle,
  MoreVertical,
  FileDown,
  Rows3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FuzzySearch } from "@/components/dashboard/fuzzy-search";
import type { Realm, League, ReferenceCurrency, ExchangePair, PoeItem } from "@/lib/types";
import { useTheme } from "next-themes";
import { useI18n, type Locale, type TranslationKeys } from "@/lib/i18n";

// ---------------------------------------------------------------------------
// Phase info type (from /api/flipper/phase)
// ---------------------------------------------------------------------------
interface PhaseInfo {
  phase: string;
  daysSinceReference: number;
  league: string;
}

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
  /** Whether the flipper backend is online */
  flipperBackendOnline?: boolean;
  /** Phase info from /api/flipper/phase */
  phaseInfo?: PhaseInfo | null;
  /** Number of active events (for the indicator dot) */
  activeEventsCount?: number;
  /** Callback when the Events button is clicked */
  onEventsClick?: () => void;
  /** §2.5: Exchange pairs for fuzzy search indexing */
  exchangePairs?: ExchangePair[];
  /** §2.5: All items for fuzzy search indexing */
  allItems?: PoeItem[];
  /** §2.5: Current active tab */
  activeTab?: string;
  /** §2.5: Callback when a fuzzy search result is selected */
  onSearchResultSelect?: (item: { tab: string; id: string }) => void;
  /** §3.5: Whether dense mode is enabled */
  denseMode?: boolean;
  /** §3.5: Callback to toggle dense mode */
  onDenseModeToggle?: () => void;
  /** Base currency API ID (e.g. "exalted") for currency labels */
  baseCurrencyApiId?: string | null;
  /** Base currency display text (e.g. "Exalted Orb") for currency labels */
  baseCurrencyText?: string | null;
}

const LOCALE_LABELS: Record<Locale, string> = {
  en: "EN",
  ru: "RU",
  zh: "\u4e2d",
  ko: "\ud55c",
};

// ---------------------------------------------------------------------------
// Phase badge helpers
// ---------------------------------------------------------------------------

/**
 * Determine the effective phase, accounting for backend misreporting.
 * If the backend says "late" but the league is very young (<14 days),
 * override to the correct phase based on league age.
 */
function getEffectivePhase(phaseInfo: PhaseInfo | null | undefined): {
  phase: string;
  isEstimated: boolean;
} {
  if (!phaseInfo) return { phase: "", isEstimated: false };

  const days = phaseInfo.daysSinceReference;
  const reportedPhase = phaseInfo.phase?.toLowerCase();

  // Client-side validation: if backend says "late" but league is clearly young
  if (reportedPhase === "late" && days < 14) {
    return { phase: "early", isEstimated: true };
  }
  if (reportedPhase === "late" && days < 42) {
    return { phase: "mid", isEstimated: true };
  }
  if (reportedPhase === "mid" && days < 14) {
    return { phase: "early", isEstimated: true };
  }

  return { phase: reportedPhase, isEstimated: false };
}

function phaseBadgeClass(phase: string): string {
  switch (phase?.toLowerCase()) {
    case "early":
      return "border-emerald-500/50 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10";
    case "mid":
      return "border-amber-500/50 text-amber-600 dark:text-amber-400 bg-amber-500/10";
    case "late":
      return "border-red-500/50 text-red-600 dark:text-red-400 bg-red-500/10";
    default:
      return "border-muted-foreground/30 text-muted-foreground bg-muted";
  }
}

function phaseLabel(phase: string, t: (key: TranslationKeys) => string): string {
  switch (phase?.toLowerCase()) {
    case "early": return t("phaseEarly");
    case "mid": return t("phaseMid");
    case "late": return t("phaseLate");
    default: return phase?.toUpperCase() ?? "?";
  }
}

// ---------------------------------------------------------------------------
// `mounted` flag via useSyncExternalStore (KI-24 fixed iter 117)
// ---------------------------------------------------------------------------
// Replaces the previous `useState(false) + useEffect(() => setMounted(true))`
// pattern, which fired the `react-hooks/set-state-in-effect` warning.
//
// This is the canonical "is client post-hydration" pattern:
//   - getServerSnapshot returns `false` (used during SSR AND during the first
//     client render that hydrates the server HTML, so the markup matches).
//   - getSnapshot returns `true` (always, on the client after hydration).
//   - subscribe is a no-op — there is no external store to subscribe to; the
//     only "transition" is the hydration boundary itself, which React handles
//     internally by switching from getServerSnapshot to getSnapshot.
//
// Semantic equivalence with the previous implementation:
//   - SSR: mounted = false (theme toggle button not rendered)
//   - First client render (hydration): mounted = false (matches SSR HTML)
//   - After hydration: React re-renders with getSnapshot → mounted = true
//     (theme toggle button appears)
//
// The `mounted` flag is only used at line ~516 to gate the theme toggle
// button (avoids SSR/client mismatch for next-themes, which reads
// localStorage and would produce different HTML on server vs client).
function subscribeMounted(): () => void {
  return () => {};
}
function getMountedSnapshot(): boolean {
  return true;
}
function getMountedServerSnapshot(): boolean {
  return false;
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
  flipperBackendOnline,
  phaseInfo,
  activeEventsCount,
  onEventsClick,
  exchangePairs,
  allItems,
  activeTab,
  onSearchResultSelect,
  denseMode,
  onDenseModeToggle,
}: HeaderProps) {
  const { theme, setTheme } = useTheme();
  const { t, tp, locale, setLocale } = useI18n();
  // KI-24 (iter 117): `mounted` flag via useSyncExternalStore — see module-level
  // helpers above. Eliminates the `set-state-in-effect` warning while preserving
  // the SSR/first-render = false, post-hydration = true semantics.
  const mounted = useSyncExternalStore(subscribeMounted, getMountedSnapshot, getMountedServerSnapshot);
  const [timeAgo, setTimeAgo] = useState<string>("");
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  // §2.5: FuzzySearch result selection handler
  const handleSearchResultSelect = useCallback(
    (item: { id: string; name: string; secondary: string; price: string; changeText: string; changeColor: string; iconUrl: string | null; tab: "exchange" | "currencies" | "uniques"; original: ExchangePair | PoeItem }) => {
      if (onSearchResultSelect) {
        onSearchResultSelect({ tab: item.tab, id: item.id });
      }
    },
    [onSearchResultSelect]
  );

  // No need to sync external search changes — FuzzySearch manages its own state

  // FuzzySearch handles debouncing internally — just pass the value up

  // FuzzySearch handles clearing internally

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

  // No more cleanup needed for debounce ref

  // Cycle through locales
  const LOCALE_ORDER: Locale[] = ["ru", "en", "zh", "ko"];
  const cycleLocale = useCallback(() => {
    const idx = LOCALE_ORDER.indexOf(locale);
    const next = LOCALE_ORDER[(idx + 1) % LOCALE_ORDER.length];
    setLocale(next);
  }, [locale, setLocale]);

  // Close "More" on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    }
    if (moreOpen) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [moreOpen]);

  const sortedLeagues = leagues
    ? [...leagues].sort((a, b) => {
        if (a.active && !b.active) return -1;
        if (!a.active && b.active) return 1;
        return a.displayName.localeCompare(b.displayName);
      })
    : [];

  const leagueSelectValue = effectiveLeague || "__none__";

  // Compute effective phase with client-side validation
  const effectivePhase = getEffectivePhase(phaseInfo);

  return (
    <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-40">
      <div className="max-w-[1600px] mx-auto px-4 py-2.5 flex items-center gap-2.5">
        {/* Scrollable bar — all items except "More" menu */}
        <div className="flex items-center gap-2.5 overflow-x-auto min-w-0 flex-1">
        {/* Logo — §1.4: prominent */}
        <div className="flex items-center gap-2 shrink-0">
          <Activity className="h-6 w-6 text-primary" aria-hidden="true" />
          <h1 className="text-lg font-bold tracking-tight">{t("appTitle")}</h1>
        </div>

        {/* Realm + League selector — §1.4: compact */}
        <div className="flex items-center gap-1.5 shrink-0">
          <Select
            value={realm || undefined}
            onValueChange={(v) => onRealmChange(v)}
          >
            <SelectTrigger className="w-[100px] h-8 text-xs">
              <SelectValue placeholder={t("realm")} />
            </SelectTrigger>
            <SelectContent>
              {realmsLoading ? (
                <SelectItem value="__loading__" disabled>{t("loading")}</SelectItem>
              ) : (
                realms?.map((r) => (
                  <SelectItem key={r.name} value={r.name}>{r.displayName}</SelectItem>
                ))
              )}
            </SelectContent>
          </Select>

          <Select
            value={leagueSelectValue}
            onValueChange={onLeagueChange}
          >
            <SelectTrigger className="w-[160px] h-8 text-xs">
              <SelectValue placeholder={t("league")} />
            </SelectTrigger>
            <SelectContent>
              {leaguesLoading ? (
                <SelectItem value="__loading__" disabled>{t("loading")}</SelectItem>
              ) : sortedLeagues.length === 0 ? (
                <SelectItem value="__none__" disabled>{t("league")}</SelectItem>
              ) : (
                <>
                  <SelectItem value="__none__" disabled className="hidden">
                    {t("league")}
                  </SelectItem>
                  {sortedLeagues.map((l) => (
                    <SelectItem key={l.name} value={l.name}>
                      {l.displayName} {!l.active && `(${t("inactive")})`}
                    </SelectItem>
                  ))}
                </>
              )}
            </SelectContent>
          </Select>
        </div>

        {/* Phase badge — compact, useful context with client-side validation */}
        {(flipperBackendOnline ? phaseInfo : leagues?.find(l => l.active)) && (
          <Badge
            variant="outline"
            className={`text-[10px] px-1.5 py-0 font-bold shrink-0 ${phaseBadgeClass(effectivePhase.phase)}`}
            title={effectivePhase.isEstimated ? t("phaseEstimatedTooltip") : t("phaseBackendTooltip")}
          >
            {phaseLabel(effectivePhase.phase, t)}
            {effectivePhase.isEstimated && (
              <span className="ml-0.5 opacity-60 text-[8px]" title={t("phaseEstimatedTooltip")}>~</span>
            )}
          </Badge>
        )}

        {/* P1-4: Base Currency Selector — promoted from "More" menu to main bar */}
        {referenceCurrencies && referenceCurrencies.length > 0 && onReferenceCurrencyChange && (
          <div className="flex items-center gap-1.5 shrink-0">
            <Select
              value={referenceCurrency || "_default"}
              onValueChange={(v) => {
                onReferenceCurrencyChange(v === "_default" ? "" : v);
              }}
            >
              <SelectTrigger className="h-8 text-xs w-[120px]">
                <SelectValue placeholder={t("baseCurrency")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_default">{t("defaultCurrency")}</SelectItem>
                {/* P0: Adaptive mode — auto-selects best currency unit per row */}
                <SelectItem value="_adaptive">Adaptive</SelectItem>
                {referenceCurrencies.map((c) => (
                  <SelectItem key={c.apiId} value={c.apiId}>
                    {c.text} ({(c.relativePrice ?? 0).toFixed(1)})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* P1-4: Phase-aware hint — suggest switching to Divine in MID/LATE */}
            {effectivePhase.phase === "mid" || effectivePhase.phase === "late" ? (
              <span className="text-[10px] text-amber-500 hidden sm:inline" title={t("baseCurrencyPhaseHintTooltip")}>
                {t("baseCurrencyPhaseHint")}
              </span>
            ) : null}
          </div>
        )}

        {/* Backend status indicator — enhanced with text label */}
        {flipperBackendOnline !== undefined && (
          <div
            className="flex items-center gap-1 shrink-0 px-1.5 py-0.5 rounded-md bg-muted/50 text-[10px] font-medium text-muted-foreground"
            title={flipperBackendOnline ? t("flipperBackendOnline") : t("flipperBackendOffline")}
          >
            <Circle
              className={`h-2 w-2 ${
                flipperBackendOnline
                  ? "fill-emerald-500 text-emerald-500"
                  : "fill-red-500 text-red-500"
              }`}
              aria-hidden="true"
            />
            <span className="hidden sm:inline">
              {flipperBackendOnline ? t("flipperBackendOnline") : t("flipperBackendOffline")}
            </span>
          </div>
        )}

        {/* §2.5: Fuzzy Search with Autocomplete */}
        <FuzzySearch
          value={search}
          onValueChange={onSearchChange}
          onResultSelect={handleSearchResultSelect}
          onFilterSubmit={onSearchChange}
          exchangePairs={exchangePairs ?? []}
          allItems={allItems ?? []}
          activeTab={activeTab ?? "overview"}
        />

        {/* Auto-refresh toggle — §1.4: visible with indicator */}
        <Button
          variant={autoRefresh ? "default" : "outline"}
          size="sm"
          onClick={onAutoRefreshToggle}
          className="h-8 text-xs shrink-0"
          aria-label={autoRefresh ? t("disableAutoRefresh") : t("enableAutoRefresh")}
        >
          <Clock className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
          {autoRefresh ? "60s" : t("autoRefresh")}
          {autoRefresh && <span className="ml-1 h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />}
        </Button>

        {/* Refresh button — compact */}
        <Button variant="outline" size="sm" onClick={onRefresh} className="h-8 text-xs shrink-0" aria-label={t("refreshData")}>
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>

        {/* Last updated — minimal */}
        {lastUpdated && (
          <span className="text-[10px] text-muted-foreground shrink-0" aria-live="polite" role="status">
            {timeAgo}
          </span>
        )}
        </div>{/* end scrollable bar */}

        {/* §1.4: "More" menu — OUTSIDE scrollable bar so it's always visible */}
        <div className="relative shrink-0" ref={moreRef}>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => setMoreOpen(!moreOpen)}
            aria-label={t("moreMenu")}
            aria-expanded={moreOpen}
          >
            <MoreVertical className="h-4 w-4" aria-hidden="true" />
          </Button>

          {moreOpen && (
            <div className="absolute right-0 top-full mt-1 w-56 bg-popover border border-border rounded-lg shadow-lg z-50 py-1" role="menu">
              {/* Reference Currency */}
              {referenceCurrencies && referenceCurrencies.length > 0 && onReferenceCurrencyChange && (
                <div className="px-3 py-2 border-b border-border">
                  <p className="text-xs text-muted-foreground mb-1.5">{t("baseCurrency")}</p>
                  <Select
                    value={referenceCurrency || "_default"}
                    onValueChange={(v) => {
                      onReferenceCurrencyChange(v === "_default" ? "" : v);
                    }}
                  >
                    <SelectTrigger className="h-7 text-xs w-full">
                      <SelectValue placeholder={t("baseCurrency")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_default">{t("defaultCurrency")}</SelectItem>
                      <SelectItem value="_adaptive">Adaptive</SelectItem>
                      {referenceCurrencies.map((c) => (
                        <SelectItem key={c.apiId} value={c.apiId}>{c.text}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Export */}
              {onExport && (
                <>
                  <button
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
                    onClick={() => { onExport("csv"); setMoreOpen(false); }}
                    role="menuitem"
                  >
                    <FileDown className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    {t("exportCsv")}
                  </button>
                  <button
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
                    onClick={() => { onExport("json"); setMoreOpen(false); }}
                    role="menuitem"
                  >
                    <Download className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    {t("exportJson")}
                  </button>
                </>
              )}

              {/* Events */}
              <button
                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
                onClick={() => { onEventsClick?.(); setMoreOpen(false); }}
                role="menuitem"
              >
                <Bell className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                {t("eventsButtonLabel")}
                {activeEventsCount && activeEventsCount > 0 && (
                  <span className="ml-auto h-2 w-2 rounded-full bg-orange-500" />
                )}
              </button>

              <div className="border-t border-border my-1" />

              {/* Language — keep menu open so users can cycle through locales */}
              <button
                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
                onClick={() => { cycleLocale(); }}
                role="menuitem"
              >
                <Globe className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                {t("switchLanguage")} ({LOCALE_LABELS[locale]})
              </button>

              {/* §3.5: Dense Mode toggle */}
              <button
                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
                onClick={() => { onDenseModeToggle?.(); setMoreOpen(false); }}
                role="menuitem"
                aria-label={denseMode ? t("disableDenseMode") : t("enableDenseMode")}
              >
                <Rows3 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                {denseMode ? (t("disableDenseMode")) : (t("enableDenseMode"))}
              </button>

              {/* Theme toggle */}
              {mounted && (
                <button
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
                  onClick={() => { setTheme(theme === "dark" ? "light" : "dark"); }}
                  role="menuitem"
                  aria-label={theme === "dark" ? t("switchToLightMode") : t("switchToDarkMode")}
                >
                  {theme === "dark" ? (
                    <Sun className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  ) : (
                    <Moon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  )}
                  {theme === "dark" ? t("switchToLightMode") : t("switchToDarkMode")}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
