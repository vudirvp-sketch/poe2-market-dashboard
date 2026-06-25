// ============================================================================
// useItemCategoryLists — Currency/unique category chip list derivation
// ============================================================================
//
// Stage 3a of the useDashboardData hook extraction (iter 83, deferred from
// P2-1). See STATUS.md "Technical-debt backlog" for the staged plan.
//
// This hook owns the derivation of the two category-chip arrays rendered
// above the Currencies and Uniques tabs. Both lists come from the same
// `useItemCategories()` response — the only difference is which category
// names each tab considers "in scope":
//
//   - `currencyCategories`: everything EXCEPT the "Unique" family (used by
//     the Currencies tab's chip strip).
//   - `uniqueCategoriesList`: only "Unique" and the unique-slot equipment
//     families (Armour / Weapon / Accessory / Flask / Jewel / Gem — used by
//     the Uniques tab's chip strip).
//
// When a list is empty (e.g. the snapshot has not loaded yet, or the
// response contains no matching categories) a synthetic `{ name: "all",
// displayName: t("all"), count: 0 }` entry is pushed so the chip strip
// still renders a single "All" chip — matches the prior inline behaviour.
//
// The hook does NOT own any state. It receives `uniqueCategories` and `t`
// as inputs and returns two derived arrays. The `t` function comes from
// `useI18n()` and is used only for the synthetic "all" fallback label.
//
// Behaviour parity (verified by jest baseline 422/422 in iter 83):
//   - Currency list filter: `c.name !== "Unique"` (case-sensitive, exact).
//   - Unique list filter: case-sensitive substring match for each of the
//     seven family names (`Unique`, `Armour`, `Weapon`, `Accessory`,
//     `Flask`, `Jewel`, `Gem`). `name === "Unique"` is also matched exactly
//     so a bare "Unique" category is always included even if "Unique" is
//     also a substring of another name (matches original inline behaviour).
//   - Empty-list fallback uses `t("all")` — same translation key the
//     toolbar uses for the "All" chip.
//
// Future stages (NOT in this hook):
//   - Stage 3b: optimalPayment cluster (clientOptimalResult + merge +
//               optimalPaymentByDisplayName) — highest interdependency risk.
// ============================================================================

"use client";

import { useMemo } from "react";
import type { ItemCategory } from "@/lib/types";
import type { TranslationKeys } from "@/lib/i18n";

/** Inputs for useItemCategoryLists. */
export interface UseItemCategoryListsInput {
  /** Raw category list from useItemCategories (undefined while loading). */
  uniqueCategories: ItemCategory[] | undefined;
  /** Translation function from useI18n() — used only for the synthetic "all" fallback. */
  t: (key: TranslationKeys) => string;
}

/** Result of useItemCategoryLists. */
export interface UseItemCategoryListsResult {
  /** Category chips for the Currencies tab (excludes "Unique"). */
  currencyCategories: ItemCategory[];
  /** Category chips for the Uniques tab (unique-slot families only). */
  uniqueCategoriesList: ItemCategory[];
}

/**
 * Derive the two category-chip arrays for the Currencies and Uniques tabs
 * from a single `useItemCategories()` response. Both lists get a synthetic
 * "all" entry when empty so the chip strip always renders something.
 */
export function useItemCategoryLists({
  uniqueCategories,
  t,
}: UseItemCategoryListsInput): UseItemCategoryListsResult {
  // --- Currencies tab: everything except the "Unique" family ---
  const currencyCategories = useMemo(() => {
    const cats = uniqueCategories?.filter((c) => c.name !== "Unique") || [];
    if (cats.length === 0) cats.push({ name: "all", displayName: t("all"), count: 0 });
    return cats;
  }, [uniqueCategories, t]);

  // --- Uniques tab: Unique + unique-slot equipment families ---
  const uniqueCategoriesList = useMemo(() => {
    const cats =
      uniqueCategories?.filter(
        (c) =>
          c.name === "Unique" ||
          c.name.includes("Unique") ||
          c.name.includes("Armour") ||
          c.name.includes("Weapon") ||
          c.name.includes("Accessory") ||
          c.name.includes("Flask") ||
          c.name.includes("Jewel") ||
          c.name.includes("Gem")
      ) || [];
    if (cats.length === 0) cats.push({ name: "all", displayName: t("all"), count: 0 });
    return cats;
  }, [uniqueCategories, t]);

  return { currencyCategories, uniqueCategoriesList };
}
