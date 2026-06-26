// ============================================================================
// BestPaymentTopList — iter 93
//
// "Best Payment primary view" for the Exchange tab. Shows the top-10 items
// (currencies + craft items like Ritual Omens / Soul Cores) where paying
// with a non-default currency saves ≥1% vs the worst option.
//
// Implements the "Пример А" mockup from iter 92 handoff:
//   "Заплати Divine, сэкономь 47% vs Chaos"
//
// Q1 (iter 93): Top-10 list, sorted by savingsPct desc.
// Q2 (iter 93): Works for currencies + uniques + craft items — the hook
//               groups by currency1Id, which covers every priced item.
// Q3 (iter 93): Items with savingsPct <1% are filtered upstream in
//               useOptimalPayment() — this component never receives them.
//
// Layout:
//   - Header (title + subtitle + collapse toggle).
//   - Horizontal scroll-strip of cards on desktop, vertical list on mobile.
//   - Each card: item name + savings badge + "Pay in X / vs Y / save Z anchor".
//   - Click → opens the representative pair's detail dialog (the pair whose
//     currency2Id === bestCurrencyId, so the user lands on the actual
//     cheapest-payment trade).
//
// All textual content is i18n'd via t() — see new keys in en/ru/zh/ko locales.
// ============================================================================
"use client";

import { memo, useState } from "react";
import { ChevronDown, ChevronUp, TrendingDown, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fmt } from "@/lib/types";
import type { ExchangePair } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { getCurrencyDisplayName } from "@/lib/currency-names";
import type { BestPaymentTopListItem } from "@/hooks/use-optimal-payment";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { TranslationKeys } from "@/lib/i18n/locales/en";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Color band for the savings badge — same thresholds as BestPaymentBadge. */
function savingsColorClass(savingsPct: number): string {
  if (savingsPct >= 10) {
    return "border-emerald-500/50 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10";
  }
  if (savingsPct >= 3) {
    return "border-amber-500/50 text-amber-600 dark:text-amber-400 bg-amber-500/10";
  }
  return "border-muted-foreground/30 text-muted-foreground bg-muted/30";
}

// ---------------------------------------------------------------------------
// Single card
// ---------------------------------------------------------------------------

interface BestPaymentCardProps {
  item: BestPaymentTopListItem;
  anchorId: string;
  onClick: (pairId: string) => void;
}

const BestPaymentCard = memo(function BestPaymentCard({
  item,
  anchorId,
  onClick,
}: BestPaymentCardProps) {
  const { t, locale } = useI18n();
  const anchorName = getCurrencyDisplayName(anchorId, locale) || anchorId || "Exa";

  // Localize the item name (currency or craft item) when a translation exists.
  const itemName = getCurrencyDisplayName(item.itemId, locale) || item.itemName;
  const bestName =
    getCurrencyDisplayName(item.bestCurrencyId, locale) || item.bestCurrencyName;
  const worstName =
    getCurrencyDisplayName(item.worstCurrencyId, locale) || item.worstCurrencyName;

  return (
    <button
      type="button"
      onClick={() => onClick(item.representativePairId)}
      className="group relative flex w-full flex-col gap-1.5 rounded-md border border-border bg-card p-3 text-left transition-colors hover:border-primary/50 hover:bg-accent/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      aria-label={t("bestPaymentCardAria", {
        item: itemName,
        best: bestName,
        worst: worstName,
        pct: item.savingsPct.toFixed(1),
      })}
    >
      {/* Row 1: item name + savings badge */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-foreground">
            {itemName}
          </div>
          {item.isCraftItem && (
            <span className="mt-0.5 inline-block rounded bg-muted/60 px-1 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">
              {t("bestPaymentCraftItem")}
            </span>
          )}
        </div>
        <Badge
          variant="outline"
          className={`shrink-0 text-[10px] ${savingsColorClass(item.savingsPct)}`}
          title={t("bestPaymentSavingsTooltip")}
        >
          <TrendingDown className="mr-0.5 h-2.5 w-2.5" aria-hidden="true" />
          -{item.savingsPct.toFixed(1)}%
        </Badge>
      </div>

      {/* Row 2: "Pay in Divine · vs Chaos" */}
      <div className="flex flex-wrap items-center gap-1 text-xs">
        <span className="text-muted-foreground">{t("bestPaymentPayIn")}</span>
        <span className="font-medium text-emerald-600 dark:text-emerald-400">
          {bestName}
        </span>
        <span className="text-muted-foreground/60">·</span>
        <span className="text-muted-foreground">{t("bestPaymentVs")}</span>
        <span className="font-medium text-amber-600 dark:text-amber-400">
          {worstName}
        </span>
      </div>

      {/* Row 3: "save 0.4 Exa" */}
      <div className="text-[11px] text-muted-foreground">
        {t("bestPaymentSave")}{" "}
        <span className="font-mono">
          {fmt(item.savingsAnchor)} {anchorName}
        </span>
      </div>
    </button>
  );
});

// ---------------------------------------------------------------------------
// Top-list container
// ---------------------------------------------------------------------------

export interface BestPaymentTopListProps {
  /** Top-N best-payment opportunities (already filtered + sorted upstream). */
  items: BestPaymentTopListItem[];
  /** Anchor currency apiId ("exalted" / "divine" / …). */
  anchorId: string;
  /** All exchange pairs — used to look up the representative pair by ID. */
  exchangeData: ExchangePair[] | undefined;
  /** Called when the user clicks a card; receives the pair to open. */
  onPairClick: (pair: ExchangePair) => void;
}

export function BestPaymentTopList({
  items,
  anchorId,
  exchangeData,
  onPairClick,
}: BestPaymentTopListProps) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(false);

  // Empty state — don't render the section at all so the Exchange tab stays
  // compact when no opportunities exist (e.g. fresh league, all pairs <1%).
  if (items.length === 0) return null;

  const handleClick = (pairId: string) => {
    const pair = exchangeData?.find((p) => p.id === pairId);
    if (pair) onPairClick(pair);
  };

  return (
    <section
      className="mb-4 rounded-lg border border-border bg-card/50"
      aria-label={t("bestPaymentTitle")}
    >
      {/* Header */}
      <header className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Sparkles
            className="h-4 w-4 shrink-0 text-primary"
            aria-hidden="true"
          />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-foreground">
              {t("bestPaymentTitle")}
            </h2>
            <p className="truncate text-[11px] text-muted-foreground">
              {t("bestPaymentSubtitle")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="secondary" className="text-[10px]">
                  {items.length}
                </Badge>
              </TooltipTrigger>
              <TooltipContent side="left" className="text-xs">
                {t("bestPaymentCountTooltip")}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setCollapsed((c) => !c)}
            aria-expanded={!collapsed}
            aria-label={collapsed ? t("bestPaymentShow") : t("bestPaymentHide")}
          >
            {collapsed ? (
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {collapsed ? t("bestPaymentShow") : t("bestPaymentHide")}
          </Button>
        </div>
      </header>

      {/* Cards strip — horizontal scroll on desktop, vertical on mobile */}
      {!collapsed && (
        <div
          className="flex gap-2 overflow-x-auto p-3"
          role="list"
          aria-label={t("bestPaymentTitle")}
        >
          {items.map((item) => (
            <div
              key={item.itemId}
              role="listitem"
              className="w-[220px] shrink-0 sm:w-[240px]"
            >
              <BestPaymentCard
                item={item}
                anchorId={anchorId}
                onClick={handleClick}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// Export type for downstream consumers (ExchangeTabContent prop typing).
export type { TranslationKeys as _TranslationKeys };
