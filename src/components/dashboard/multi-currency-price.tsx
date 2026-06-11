// ============================================================================
// Multi-Currency Price Display — Shows item price across multiple currencies
//
// Inspired by poe2db.tw item pages: shows the price of an item expressed in
// Divine Orbs, Exalted Orbs, Chaos Orbs, and the current base currency.
// Also shows 24h volume for each pricing pair when available.
//
// Uses exchange pair data to compute cross-rates via the anchor currency.
// If exchange pairs are not available, falls back to relativePrice conversion.
// ============================================================================
"use client";

import { memo, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { TrendingDown, ArrowRight } from "lucide-react";
import { fmt } from "@/lib/types";
import { convertBaseCurrency } from "@/lib/utils";
import type { ExchangePair } from "@/lib/types";
import { useI18n } from "@/lib/i18n";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single currency price entry for display */
export interface CurrencyPriceEntry {
  /** Currency API ID (e.g. "divine", "exalted", "chaos") */
  currencyId: string;
  /** Display name of the currency (e.g. "Божественная сфера") */
  currencyName: string;
  /** Short name for compact display (e.g. "Div") */
  shortName: string;
  /** Price of the item in this currency */
  price: number;
  /** 24h trade volume for this pricing pair (null if unknown) */
  volume: number | null;
  /** Whether this is the cheapest option (after normalizing to anchor) */
  isBest: boolean;
  /** Premium % vs the cheapest option (0% for the best) */
  premiumPct: number;
  /** Relative price of this currency in the anchor currency */
  relativePrice: number;
}

interface MultiCurrencyPriceProps {
  /** Price of the item in the base currency */
  priceInBase: number | null | undefined;
  /** API ID of the base currency (e.g. "exalted") */
  baseCurrencyId: string | null | undefined;
  /** Display name of the base currency */
  baseCurrencyName?: string | null;
  /** Exchange pairs with relativePrice data */
  exchangePairs?: ExchangePair[];
  /** Maximum number of currencies to show (default: 4) */
  maxCurrencies?: number;
  /** Compact mode: single line with pills */
  compact?: boolean;
}

// ---------------------------------------------------------------------------
// Currency display configuration
// ---------------------------------------------------------------------------

interface CurrencyDisplay {
  id: string;
  nameKey: string;       // i18n key fallback
  defaultName: string;   // English name fallback
  shortName: string;
}

/** Currencies to display, ordered by preference */
const DISPLAY_CURRENCIES: CurrencyDisplay[] = [
  { id: "divine",  nameKey: "divineOrb",  defaultName: "Divine Orb",  shortName: "Div" },
  { id: "exalted", nameKey: "exaltedOrb", defaultName: "Exalted Orb", shortName: "Exa" },
  { id: "chaos",   nameKey: "chaosOrb",   defaultName: "Chaos Orb",   shortName: "Chaos" },
  { id: "mirror",  nameKey: "mirror",     defaultName: "Mirror of Kalandra", shortName: "Mirror" },
];

// ---------------------------------------------------------------------------
// Core: Compute multi-currency prices
// ---------------------------------------------------------------------------

/**
 * Build a map of currency apiId → relativePrice from exchange pairs.
 * Each pair contributes relativePrice for currency1 and
 * currency2RelativePrice for currency2.
 */
function buildRelativePriceMap(pairs: ExchangePair[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const pair of pairs) {
    if (pair.relativePrice != null && pair.relativePrice > 0) {
      // currency1's relativePrice
      if (!map.has(pair.currency1Id)) {
        map.set(pair.currency1Id, pair.relativePrice);
      }
    }
    if (pair.currency2RelativePrice != null && pair.currency2RelativePrice > 0) {
      if (!map.has(pair.currency2Id)) {
        map.set(pair.currency2Id, pair.currency2RelativePrice);
      }
    }
  }
  return map;
}

/**
 * Find 24h volume for a specific currency pair from exchange data.
 * Looks for a pair where currency1Id matches the target currency.
 */
function findPairVolume(pairs: ExchangePair[], currencyId: string): number | null {
  for (const pair of pairs) {
    if (pair.currency1Id === currencyId && pair.volume != null) {
      return pair.volume;
    }
  }
  return null;
}

/**
 * Compute the effective anchor price for comparison across currencies.
 * This allows comparing "apples to apples" — e.g., is it cheaper to buy
 * an item for 2 Divine or 55 Exalted?
 *
 * effectivePrice = priceInCurrency * (currencyRelPrice / anchorRelPrice)
 */
function effectiveAnchorPrice(
  priceInCurrency: number,
  currencyRelPrice: number,
  anchorRelPrice: number,
): number {
  if (anchorRelPrice <= 0 || currencyRelPrice <= 0) return Infinity;
  return priceInCurrency * (currencyRelPrice / anchorRelPrice);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const MultiCurrencyPrice = memo(function MultiCurrencyPrice({
  priceInBase,
  baseCurrencyId,
  baseCurrencyName,
  exchangePairs,
  maxCurrencies = 4,
  compact = false,
}: MultiCurrencyPriceProps) {
  const { t } = useI18n();

  const entries = useMemo((): CurrencyPriceEntry[] => {
    if (priceInBase == null || priceInBase <= 0) return [];
    if (!exchangePairs || exchangePairs.length === 0) return [];

    const relPriceMap = buildRelativePriceMap(exchangePairs);
    const baseId = baseCurrencyId ?? "exalted";
    const baseRelPrice = relPriceMap.get(baseId) ?? 1.0;

    // If base currency is not in the map, assume it's the base (relPrice=1)
    if (!relPriceMap.has(baseId)) {
      relPriceMap.set(baseId, 1.0);
    }

    const results: CurrencyPriceEntry[] = [];

    for (const displayCur of DISPLAY_CURRENCIES) {
      if (results.length >= maxCurrencies) break;

      const curRelPrice = relPriceMap.get(displayCur.id);
      if (curRelPrice == null || curRelPrice <= 0) continue;

      // Convert item price from base currency to this display currency
      // priceInTarget = priceInBase * baseRelPrice / targetRelPrice
      const convertedPrice = convertBaseCurrency(priceInBase, baseRelPrice, curRelPrice);

      if (!isFinite(convertedPrice) || convertedPrice <= 0) continue;

      // Skip very small fractional prices (< 0.001) for non-base currencies
      // unless it's a high-value currency like Mirror
      if (convertedPrice < 0.001 && displayCur.id !== "mirror") continue;

      // For Mirror, skip if price is absurdly small (< 0.00001)
      if (displayCur.id === "mirror" && convertedPrice < 0.00001) continue;

      const volume = findPairVolume(exchangePairs, displayCur.id);

      const localizedName = t(displayCur.nameKey) !== displayCur.nameKey
        ? t(displayCur.nameKey)
        : displayCur.defaultName;

      results.push({
        currencyId: displayCur.id,
        currencyName: localizedName,
        shortName: displayCur.shortName,
        price: convertedPrice,
        volume,
        isBest: false, // determined below
        premiumPct: 0,
        relativePrice: curRelPrice,
      });
    }

    // If base currency is NOT in the display list, add it
    const baseInList = results.some(r => r.currencyId === baseId);
    if (!baseInList && baseCurrencyName) {
      const baseVol = findPairVolume(exchangePairs, baseId);
      results.unshift({
        currencyId: baseId,
        currencyName: baseCurrencyName,
        shortName: baseId === "exalted" ? "Exa" : baseId === "divine" ? "Div" : baseId.charAt(0).toUpperCase() + baseId.slice(1, 4),
        price: priceInBase,
        volume: baseVol,
        isBest: false,
        premiumPct: 0,
        relativePrice: baseRelPrice,
      });
    }

    // Determine the best (cheapest in anchor terms) option
    if (results.length >= 2) {
      // Use the first available anchor for comparison
      const anchorId = relPriceMap.has("divine") ? "divine" :
                       relPriceMap.has("exalted") ? "exalted" : baseId;
      const anchorRel = relPriceMap.get(anchorId) ?? 1.0;

      // Compute effective anchor prices
      const withEff = results.map(r => ({
        entry: r,
        effPrice: effectiveAnchorPrice(r.price, r.relativePrice, anchorRel),
      }));

      // Sort by effective price
      withEff.sort((a, b) => a.effPrice - b.effPrice);

      const bestEffPrice = withEff[0].effPrice;

      for (const item of withEff) {
        item.entry.isBest = item.effPrice === bestEffPrice;
        item.entry.premiumPct = bestEffPrice > 0 && isFinite(item.effPrice)
          ? ((item.effPrice - bestEffPrice) / bestEffPrice) * 100
          : 0;
      }
    } else if (results.length === 1) {
      results[0].isBest = true;
    }

    // Sort: base currency first, then by premium
    results.sort((a, b) => {
      if (a.currencyId === baseId) return -1;
      if (b.currencyId === baseId) return 1;
      return a.premiumPct - b.premiumPct;
    });

    return results;
  }, [priceInBase, baseCurrencyId, baseCurrencyName, exchangePairs, maxCurrencies, t]);

  if (entries.length === 0) return null;

  // ---- Compact mode: inline pills ----
  if (compact) {
    return (
      <div className="flex items-center gap-1.5 flex-wrap">
        {entries.map((entry) => (
          <Badge
            key={entry.currencyId}
            variant={entry.isBest ? "default" : "outline"}
            className={`text-[10px] px-1.5 py-0.5 font-mono ${
              entry.isBest
                ? "bg-emerald-600/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/50"
                : "text-muted-foreground"
            }`}
          >
            {fmt(entry.price, entry.price >= 100 ? 0 : 2)} {entry.shortName}
            {entry.premiumPct >= 1 && (
              <span className="ml-1 text-[9px] opacity-70">+{entry.premiumPct.toFixed(0)}%</span>
            )}
          </Badge>
        ))}
      </div>
    );
  }

  // ---- Full mode: table-style layout like poe2db ----
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="px-3 py-2 bg-muted/50 border-b border-border">
        <h4 className="text-xs font-semibold flex items-center gap-1.5">
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          {t("multiCurrencyTitle")}
        </h4>
      </div>
      <div className="divide-y divide-border">
        {entries.map((entry) => (
          <div
            key={entry.currencyId}
            className={`flex items-center justify-between px-3 py-2 ${
              entry.isBest ? "bg-emerald-500/5" : ""
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              {entry.isBest && (
                <TrendingDown
                  className="h-3.5 w-3.5 text-emerald-500 shrink-0"
                  aria-hidden="true"
                />
              )}
              <span className="text-sm font-medium truncate">
                {entry.currencyName}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm font-mono font-bold">
                {fmt(entry.price, entry.price >= 100 ? 1 : 2)} {entry.shortName}
              </span>
              {entry.premiumPct >= 1 && (
                <Badge
                  variant="outline"
                  className={`text-[9px] px-1 py-0 ${
                    entry.premiumPct >= 10
                      ? "border-red-500/50 text-red-500"
                      : entry.premiumPct >= 3
                        ? "border-amber-500/50 text-amber-500"
                        : "border-muted-foreground/30 text-muted-foreground"
                  }`}
                >
                  +{entry.premiumPct.toFixed(1)}%
                </Badge>
              )}
              {entry.volume != null && (
                <span className="text-[10px] text-muted-foreground font-mono">
                  {t("vol")}: {entry.volume.toLocaleString()}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});
