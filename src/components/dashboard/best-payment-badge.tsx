// ============================================================================
// Best Payment Badge — Shows which currency is cheapest for a given item
//
// Implements §11.4 of PoE2_Flipper_Canonical_Formulas.md:
// When an exchange pair can be paid in multiple currencies, this badge
// highlights the cheapest option and shows the savings percentage.
// ============================================================================
"use client";

import { memo } from "react";
import { Badge } from "@/components/ui/badge";
import { TrendingDown } from "lucide-react";
import { fmt } from "@/lib/types";
import type { OptimalPaymentResult } from "@/lib/types";

interface BestPaymentBadgeProps {
  /** Result from findOptimalPayment() in currency-optimal.ts */
  result: OptimalPaymentResult;
  /** Anchor currency name for display (e.g., "Divine") */
  anchorName?: string;
  /** Compact mode: show only the badge without details */
  compact?: boolean;
}

/**
 * Badge indicating the cheapest payment currency for an item.
 *
 * When `compact` is true, shows only "Best: X (-Y%)" badge.
 * When `compact` is false (default), shows the badge plus anchor savings.
 */
export const BestPaymentBadge = memo(function BestPaymentBadge({
  result,
  anchorName = "Exa",
  compact = false,
}: BestPaymentBadgeProps) {
  // Don't show badge for negligible savings (< 1%)
  if (result.savingsPct < 1) return null;

  const savingsColor =
    result.savingsPct >= 10
      ? "border-emerald-500/50 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
      : result.savingsPct >= 3
        ? "border-amber-500/50 text-amber-600 dark:text-amber-400 bg-amber-500/10"
        : "border-muted-foreground/30 text-muted-foreground bg-muted/30";

  if (compact) {
    return (
      <Badge
        variant="outline"
        className={`text-[10px] px-1.5 py-0.5 ${savingsColor}`}
      >
        <TrendingDown className="h-2.5 w-2.5 mr-0.5" aria-hidden="true" />
        -{result.savingsPct.toFixed(1)}%
      </Badge>
    );
  }

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <Badge
        variant="outline"
        className={`text-xs px-2 py-0.5 ${savingsColor}`}
      >
        <TrendingDown className="h-3 w-3 mr-1" aria-hidden="true" />
        Pay in {result.bestCurrencyId}
      </Badge>
      <span className="text-[10px] text-muted-foreground">
        Save {fmt(result.savingsAnchor)} {anchorName} ({result.savingsPct.toFixed(1)}%)
      </span>
    </div>
  );
});
