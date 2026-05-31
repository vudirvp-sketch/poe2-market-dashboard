# PoE2 Market Dashboard — Fix Log (Iteration 2)

## Summary

Removed gold/commission from ALL frontend displays and types, fixed duplicate
network requests in FlipperStickyBar, fixed pre-existing test failures, and
cleaned up unused imports.

## Fixes Applied

### 1. FlipsTable — Removed gold_fee_fraction and gold_fee_actual columns
**File:** `src/components/dashboard/flips-table.tsx`

- Removed the two gold fee columns (Fee % and Gold Fee) from the table header
- Removed the two corresponding data cells from each table row
- Updated grid template from 9 columns to 7 columns
- Spread column width increased from 70px to 80px for better readability

### 2. FlipsDetailDialog — Removed gold fee display cards
**File:** `src/components/dashboard/flips-detail-dialog.tsx`

- Removed the "Fee Fraction" and "Gold Fee" cards from the Score & Spread section
- Changed grid from `grid-cols-2 sm:grid-cols-4` to `grid-cols-2` (now just Score + Spread)

### 3. ArbitrageTab (Flipper mode) — Removed gold fee columns
**File:** `src/components/dashboard/arbitrage-tab.tsx`

- Removed "Gold Fee" column from the Scored Flip Opportunities table
- Removed "Gold Fees" column from the Triangular Arbitrage table
- Updated grid templates accordingly
- Removed unused imports: `FlipEventStatus`, `getFlipperErrorType`
- Removed `opp.gold_fee_actual.toFixed(0)}g` display
- Removed `tri.step_fees_gold.reduce(...)` display

### 4. RecipesTab — Removed gold fee column
**File:** `src/components/dashboard/recipes-tab.tsx`

- Removed "Gold Fee" column header from the table
- Removed the gold_fee_chaos data cell from each recipe row
- Marked `gold_fee_total` and `gold_fee_chaos` as `@deprecated` in the type

### 5. ForecastTab — Removed gold fee from inputs display
**File:** `src/components/dashboard/forecast-tab.tsx`

- Removed `{t("forecastGoldFee")}: {(storageData.inputs.gold_fee_fraction * 100).toFixed(2)}%` span
- Changed grid from `grid-cols-2 sm:grid-cols-4` to `grid-cols-2 sm:grid-cols-3`
- Marked `gold_fee_fraction` as `@deprecated` optional in the type

### 6. FlipOpportunity type — gold_fee fields made optional (deprecated)
**File:** `src/lib/types.ts`

- `gold_fee_fraction: number` → `gold_fee_fraction?: number` with `@deprecated` JSDoc
- `gold_fee_actual: number` → `gold_fee_actual?: number` with `@deprecated` JSDoc
- This ensures backward compatibility: if the backend still sends these fields, they're accepted but ignored

### 7. TriangularCycle type — step_fees_gold made optional (deprecated)
**File:** `src/lib/types.ts`

- `step_fees_gold: number[]` → `step_fees_gold?: number[]` with `@deprecated` JSDoc

### 8. StorageValueResponse — gold_fee_fraction made optional (deprecated)
**File:** `src/components/dashboard/flips-helpers.ts`

- `gold_fee_fraction: number` → `gold_fee_fraction?: number` with `@deprecated` JSDoc

### 9. SortField — Removed gold_fee_actual from sort options
**File:** `src/components/dashboard/flips-helpers.ts`

- Removed `"gold_fee_actual"` from the `SortField` union type
- The flips table no longer shows this column, so sorting by it makes no sense

### 10. CurrencyGraphTab — gold_fee_actual and gold_to_chaos_rate made optional
**File:** `src/components/dashboard/currency-graph-tab.tsx`

- `gold_fee_actual: number` → `gold_fee_actual?: number` with `@deprecated` JSDoc
- `gold_to_chaos_rate: number` → `gold_to_chaos_rate?: number` with `@deprecated` JSDoc

### 11. FlipperStickyBar — Removed duplicate refetchInterval
**File:** `src/components/dashboard/flipper-sticky-bar.tsx`

- Removed `refetchInterval: 60_000` from the `["flipper-triangular"]` useQuery call
- The StickyBar now relies on the shared React Query cache, just like it does
  for `["flipper-phase"]` and `["flipper-portfolio"]`
- This eliminates duplicate network requests for the triangular endpoint

### 12. Test fixes — getByText → getAllByText for "uvicorn" pattern
**Files:**
- `src/__tests__/forecast-tab.test.tsx`
- `src/__tests__/integration.test.tsx`

- Changed `screen.getByText(/uvicorn backend.main:app/)` to
  `screen.getAllByText(/uvicorn backend.main:app/).length).toBeGreaterThan(0)`
- This fixes the "multiple elements found" error that occurred when the
  FlipperBackendStatusCard rendered the same text as the tab's own offline message

## Verification

- **TypeScript compilation:** `npx tsc --noEmit` — 0 errors
- **Jest tests:** 13 suites, 172 tests — ALL PASSING
- **No new test failures introduced**

## NOT YET DONE (Iteration 3 needed)

1. **Swagger API verification** — Live testing of all POE2Scout API endpoints
   against `https://api.poe2scout.com/swagger` to verify response schemas
   match the dashboard's expectations
2. **E2E Playwright tests** — Not run; need `npx playwright test`
3. **Backend scoring module** — Server-side score computation still returns
   `score: 0` for all opportunities (requires backend repo fix, not this repo)
4. **PoE2_Flipper_Canonical_Formulas.md** — still references `gold_fee_fraction`
   in the scorer formula; should be updated to remove it
5. **i18n strings** — `flipperGoldFee`, `flipperGoldFees`, `flipsGoldFeePct`,
   `flipsFeeFraction`, `forecastGoldFee`, `recipesGoldFee` keys still exist
   in all locale files (en, ko, ru, zh) — can be removed in a cleanup pass
6. **Backend API routes** — `src/app/api/flipper/` routes may still accept
   `gold_fee_fraction`, `gold_cost_per_unit`, `gold_to_chaos_rate` as
   deprecated parameters — verify they're truly ignored server-side
