# Worklog — PoE2 Market Dashboard

> Append-only shared multi-agent work log. Each section starts with `---`.
> Old task history is in `git log`.


Recent iterations kept (iter 83+). Older iter 77-82 records trimmed — those features (F5 live, F6 phase hints, F5 backtest UI, useDashboardData Stages 1-2 + 3a) are fully shipped and documented in PRODUCT_VISION.md / STATUS.md / AGENT_NAVIGATION.md.

---
Task ID: iter-83
Agent: main (Sonnet 4.5)
Task: iter 83 — Stage 3a of useDashboardData hook extraction: extract the Exchange tab filter pipeline (exchangePairs useMemo) + currency/unique category-chip list derivation (currencyCategories + uniqueCategoriesList useMemos) from dashboard-page.tsx into two new pure hooks (useFilteredExchangePairs + useItemCategoryLists). Safe additive refactor — no behavior change. Stage 3b (optimalPayment cluster — highest interdependency risk) deferred to iter 84.

Stage Summary:
- **useDashboardData Stage 3a (useFilteredExchangePairs + useItemCategoryLists hook extraction) — DONE.** Two new pure hooks are the single source of truth for the Exchange tab filter pipeline + currency/unique category-chip list derivation. `dashboard-page.tsx` shrunk 1169 → 1128 lines. Zero behavior change. jest 422 pass, tsc 0 errors, next build OK.
- Full details in `git log` for iter 83. Documentation: STATUS.md (Stage 3a noted in technical-debt paragraph + 2 new Quick Reference entries), AGENT_NAVIGATION.md (invariant #36 + 2 new §1 module rows + hooks count 16→18), PRODUCT_VISION.md (DoD paragraph).

---
Task ID: iter-84
Agent: main (Sonnet 4.5)
Task: iter 84 — Stage 3b of useDashboardData hook extraction: extract the optimalPayment cluster (optimalCurrencyData useQuery + clientOptimalResult memo + backend/client merge memo + optimalPaymentByDisplayName memo) from dashboard-page.tsx into a new useOptimalPayment hook. Highest interdependency risk in the entire extraction plan. Safe additive refactor — no behavior change. With Stage 3b shipped, the useDashboardData extraction is COMPLETE.

Work Log:
- Read STATUS.md / PRODUCT_VISION.md / AGENT_NAVIGATION.md / worklog.md iter 83 record to understand the hand-off. Confirmed iter 83 shipped Stage 3a (useFilteredExchangePairs + useItemCategoryLists, dashboard-page.tsx 1128 lines). F1 still blocked on live poe2scout.com + poe2db.tw/ru/ API access (no change since iter 83).
- Surveyed what's doable in iter 84 without external API access:
  1. useDashboardData Stage 3b (optimalPayment cluster) — recommended by iter 83 hand-off, highest interdependency risk
  2. Full Content Pulse tab / phase hints enhancements — need product feedback, deferred
  3. e2e tests / visual verification — environment-blocked
- Picked Stage 3b — exactly matches the staged plan documented in iter 83 / STATUS.md. Decided up front to attempt a SINGLE combined hook (vs the 3b-i / 3b-ii split suggested in iter 83's hand-off) because the pipeline is internally linear: useQuery → clientOptimalResult memo → merge memo → byDisplayName memo. The "interdependency risk" mentioned in iter 83 was the merge memo consuming both the useQuery result AND the clientOptimalResult memo, plus the byDisplayName memo consuming the merge memo's output. This is a pipeline, not a tangle — a single hook with internal sectioning is cleaner than two hooks with a parent-child relationship.

- Inspected dashboard-page.tsx (1128 lines) to identify the Stage 3b extraction target (4 inline blocks, ~138 lines total):
  - `optimalCurrencyData` useQuery (lines 455-462, ~8 lines) — `enabled: flipperBackendOnline`, queryKey `[QUERY_KEYS.flipperOptimalCurrency]`, queryFn `fetchApi<OptimalCurrencyResponse>("/api/flipper/optimal-currency")`, 60s staleTime/refetchInterval, retry: 1.
  - `clientOptimalResult` memo (lines 466-558, ~93 lines) — client-side fallback. Depends on `exchangeData` + `crossRates.relativePriceMap` + `crossRates.anchorId` + `crossRates.anchorRelPrice` + `crossRates.crossRateFlips` + `findOptimalPayment` (pure fn from `@/lib/currency-optimal`) + `isItemCategory` (pure fn from same module). Two-pass computation: (a) group pairs by `currency1Id` for currency-vs-currency pricing; (b) group pairs by `currency1CategoryApiId` for item-aware optimal payment (Omens, Soul Cores — items appear as `currency1` with payment currencies as `currency2`). Both passes require ≥2 pricing options per group — `findOptimalPayment` returns null for groups with <2 options.
  - Merge memo (lines 561-588, ~28 lines) — backend data takes priority when `optimalCurrencyData?.dataAvailable && optimalCurrencyData.optimalPaymentByPair`. When the backend path is used, the response's `"currencyFrom_currencyTo"` keys are remapped to frontend `pair.id` so downstream components can look up results by pair ID. Falls back to `clientOptimalResult` otherwise. Returns `{ optimalPaymentByPair, crossRateFlips, anchorId: selectedAnchorId }`. Deps array: `[optimalCurrencyData, exchangeData, clientOptimalResult]`.
  - `optimalPaymentByDisplayName` memo (lines 591-602, ~12 lines) — display-name-keyed `Map<string, OptimalPaymentResult>` (key format: `"currency1Name/currency2Name"`) consumed by FlipsTab. Deps array: `[exchangeData, optimalPaymentByPair]`.
- Confirmed via grep that all 4 outputs are consumed downstream by exactly the same names: `optimalPaymentByPair` + `crossRateFlips` + `selectedAnchorId` → ExchangeTabContent props (line ~1015-1017); `optimalPaymentByDisplayName` + `selectedAnchorId` → FlipsTab props (line ~1035). No other consumers — clean extraction boundary.
- Confirmed via grep that after extraction the following imports become unused in dashboard-page.tsx and should be removed:
  - `useQuery` from `@tanstack/react-query` (only used at line 455 — the useQuery we're moving).
  - `QUERY_KEYS` from `@/components/providers` (only used at line 456 — same useQuery).
  - `fetchApi` from `@/lib/types` (only used at line 457 — same useQuery's queryFn).
  - `OptimalPaymentResult`, `OptimalCurrencyResponse`, `CrossRateFlip` types from `@/lib/types` (only used inside the 4 inline blocks).
  - `findOptimalPayment`, `isItemCategory` from `@/lib/currency-optimal` (only used inside the `clientOptimalResult` memo).
- `useMemo` import preserved (still used by 3 other inline memos: `activeExtFilterCount`, `navigableList`, `keyboardActions`).
- Confirmed `useCrossRates` stays in the parent — `crossRates` is passed straight to FlipsTab as a prop (line 1035), so the hook can't own it. The new `useOptimalPayment` receives `crossRates` as an input.
- Confirmed `flipperBackendOnline` is already in scope of the parent (from `useFlipperBackend()` destructure at line 268) — no extra plumbing needed.

- Frontend — `src/hooks/use-optimal-payment.ts` (NEW, 315 lines):
  - Header comment (76 lines) explains: Stage 3b of useDashboardData extraction, lists what the hook owns (the 4 blocks), documents the pipeline (useQuery → clientOptimalResult memo → merge memo → byDisplayName memo), explains why a single hook suffices vs the 3b-i / 3b-ii split, notes that with Stage 3b shipped the useDashboardData extraction is COMPLETE.
  - Exports `UseOptimalPaymentInput` interface + `UseOptimalPaymentResult` interface + `useOptimalPayment()` function.
  - Inputs: `{ exchangeData, crossRates, flipperBackendOnline }` (all owned by the parent — `exchangeData` from `useExchangePairs()`, `crossRates` from `useCrossRates()`, `flipperBackendOnline` from `useFlipperBackend()`).
  - Imports `CrossRatesResult` type from `@/hooks/use-cross-rates` for the `crossRates` parameter type (proper typing — not a loose `any`).
  - Section 1 — `optimalCurrencyData` useQuery: UNCHANGED query key / queryFn / enabled gate / staleTime / refetchInterval / retry. Inline comment notes "When the backend is offline, the query is disabled and we fall through to the client-side computation below."
  - Section 2 — `clientOptimalResult` memo: UNCHANGED logic. Deps array: `[exchangeData, crossRates.relativePriceMap, crossRates.anchorId, crossRates.anchorRelPrice, crossRates.crossRateFlips]`. Note: `relPriceMap` is assigned but not directly referenced inside the memo body (it was a vestigial local in the prior inline version too — preserved for parity to avoid any behavior change).
  - Section 3 — merge memo: UNCHANGED logic. Deps array: `[optimalCurrencyData, exchangeData, clientOptimalResult]`. Returns `{ optimalPaymentByPair, crossRateFlips, anchorId: selectedAnchorId }`.
  - Section 4 — `optimalPaymentByDisplayName` memo: UNCHANGED logic. Deps array: `[exchangeData, optimalPaymentByPair]`.
  - Returns: `{ optimalPaymentByPair, crossRateFlips, selectedAnchorId, optimalPaymentByDisplayName }` — same names as prior inline destructures so the parent destructure is unchanged.

- Frontend — `src/components/dashboard/dashboard-page.tsx` (modified, 1128 → 995 lines, −133 net):
  - Removed `import { useQuery } from "@tanstack/react-query";` (line 4) — no longer used after extraction.
  - Removed `fetchApi` from the `@/lib/types` import (still keeps `exportToCsv`, `exportToJson`).
  - Added `import { useOptimalPayment } from "@/hooks/use-optimal-payment";` (with iter-84 comment explaining the Stage 3b extraction and noting that with Stage 3b shipped the useDashboardData extraction is COMPLETE).
  - Removed `OptimalPaymentResult`, `OptimalCurrencyResponse`, `CrossRateFlip` from the `@/lib/types` type import (still keeps `PoeItem`, `ExchangePair`, `ReferenceCurrency`).
  - Removed the `findOptimalPayment` + `isItemCategory` imports from `@/lib/currency-optimal` (entire import line removed — those were the only names imported from that module).
  - Removed `import { QUERY_KEYS } from "@/components/providers";` (no longer used after extraction).
  - Added iter-84 NOTE comment above the type imports explaining what was removed and where it now lives.
  - Replaced the 138-line inline block (lines 445-600 in the original file) with a single 25-line `useOptimalPayment` call site (including the iter-84 comment explaining what was extracted + listing the 4 returned values + their downstream consumers).
  - All downstream references (ExchangeTabContent props at line ~880, FlipsTab props at line ~900) work unchanged — same variable names, same types, same behaviour.
  - `useMemo` import preserved (still used by 3 other inline memos).

- Verification:
  - `node node_modules/typescript/bin/tsc --noEmit` → 0 errors (clean type-check).
  - `node node_modules/jest/bin/jest.js` (full suite) → **422 pass** / 0 fail across 20 test suites (~5.8s). Unchanged from iter 83 baseline — confirms zero behavior regression.
  - `node node_modules/next/dist/bin/next build` → "✓ Compiled successfully in 4.8s" (1 pre-existing Turbopack warning about next.config.ts NFT tracing — unrelated to this iter, same as iter 82/83).
  - `wc -l src/components/dashboard/dashboard-page.tsx` → 995 lines (was 1128, was 1169 in iter 82, was 1197 in iter 81, was 1232 in iter 80, was 1685 in iter 70).

- Documentation updates:
  - `STATUS.md`: bumped "Last updated" to iter 84. Rewrote the technical-debt backlog paragraph: noted extraction COMPLETE, listed all 4 stages with iter stamps + new hook file paths, updated line count (1128→995), noted dashboard-page.tsx is now legitimate parent wiring with no more staged refactors planned. Added 1 new Quick Reference entry (optimal-payment data → useOptimalPayment hook with full contract description).
  - `PRODUCT_VISION.md`: bumped "Last updated" to iter 84. Updated final DoD paragraph to "useDashboardData hook extraction COMPLETE: Stage 1 в iter 81, Stage 2 в iter 82, Stage 3a в iter 83, Stage 3b в iter 84; dashboard-page.tsx теперь 995 строк, было 1685 в iter 70".
  - `AGENT_NAVIGATION.md`: bumped "Last updated" to iter 84. Updated `dashboard-page.tsx` row in §1 (1128→995 lines, "extraction COMPLETE — no further staged refactors planned"). Bumped `src/hooks/` count from 18 to 19. Added 1 new §1 module row for `use-optimal-payment.ts` with full description (4 owned blocks, inputs/outputs, FORBIDDEN inline patterns). Added invariant #37 (`useOptimalPayment` is the single source of truth for the §11 optimal-payment cluster — documents the full hook contract including the 4 blocks, the merge priority, the byDisplayName key format, the FORBIDDEN inline patterns, and notes that a single hook suffices vs the 3b-i / 3b-ii split). Updated invariants #34/#35/#36 to note "useDashboardData extraction COMPLETE in iter 84". Updated "dashboard-page.tsx still 1128 lines" Quick Reference entry → "dashboard-page.tsx now 995 lines (...extraction COMPLETE...)".
  - `worklog.md`: trimmed iter 82 record (Stage 2 — fully shipped and documented; preserved only a 1-paragraph Stage Summary with file pointers). Kept iter 83 record (Stage 3a — directly precedes this iter; trimmed to Stage Summary only) + this iter 84 record (full detail).

Stage Summary:
- **useDashboardData Stage 3b (useOptimalPayment hook extraction) — DONE.** New hook `src/hooks/use-optimal-payment.ts` (315 lines) is the single source of truth for the §11 optimal-payment cluster: `optimalCurrencyData` useQuery + `clientOptimalResult` memo + backend/client merge memo + `optimalPaymentByDisplayName` memo. `dashboard-page.tsx` is now 995 lines (was 1128, was 1169 in iter 82, was 1197 in iter 81, was 1232 in iter 80, was 1685 in iter 70 — total −690 lines since iter 70, −41% reduction). Zero behavior change — same query key, same polling intervals, same merge priority (backend first → client fallback), same dependency arrays, same variable names downstream.
- **useDashboardData extraction COMPLETE.** Stages 1-2 + 3a-3b all shipped iter 81-84. dashboard-page.tsx is now legitimate parent wiring — no more inline `useQuery` / heavy memo clusters left to extract. No further staged refactors planned; future code-health work should be opportunistic (per-file).
- **F1 (additional RU translations) — STILL BLOCKED.** No change from iter 83 — needs live poe2scout.com + poe2db.tw/ru/ access.
- **Baseline:** jest 422 pass (unchanged from iter 83), tsc 0 errors, next build OK.
- **Files changed/created (6 total):**
  - `src/hooks/use-optimal-payment.ts` (NEW, 315 lines)
  - `src/components/dashboard/dashboard-page.tsx` (modified: −133 lines net — replaced 4 inline blocks with 1 hook call + removed 8 unused imports)
  - `STATUS.md` (updated — iter 84 stamp, extraction COMPLETE noted in technical-debt paragraph, 1 new Quick Reference entry)
  - `PRODUCT_VISION.md` (updated — iter 84 stamp, DoD paragraph updated: extraction COMPLETE)
  - `AGENT_NAVIGATION.md` (updated — iter 84 stamp, dashboard-page.tsx row updated, hooks count 18→19, 1 new module row, invariant #37 added, invariants #34/#35/#36 updated, Quick Reference entry updated)
  - `worklog.md` (this record + iter 82 trim + iter 83 trim)

Next iteration (iter 85) — recommended priorities:
1. **F1 (when live API available)** — `scripts/sync_currency_names_from_poe2db.py`: enumerate 625 api_ids, fetch poe2db.tw/ru/, update `currency_names.json`, bump assertion counters in `tests/test_currency_names_ru.py`. Still the only blocked feature.
2. **Full Content Pulse tab** — F4 widget is the MVP; full version with sorting/filters/drill-down if widget proves useful.
3. **Phase hints enhancements** (optional) — pull hints from `config.yaml` instead of hardcoding; add per-pattern metrics by cross-referencing the snapshot's `price_histories`; filter hints based on actual market state.
4. **Visual verification with real backend data** — manual verification of the backtest panel against real snapshot data needs a running backend with ≥21d of price_logs collected.
5. **e2e tests** (optional) — frontend is covered by jest; e2e would require running backend + browser.
6. **Opportunistic code-health** (no staged plan) — now that the useDashboardData extraction is COMPLETE, future code-health work should be per-file. Candidates: (a) flipper-sticky-bar.tsx — still has inline `useState` for the dismiss flag that could move to the Zustand store's `uiState` slice; (b) dashboard-dialogs.tsx — could be split into 8 separate files (one per dialog) for lazy-loading; (c) the `useMemo` for `navigableList` + `keyboardActions` in dashboard-page.tsx (~25 lines combined) could move into `use-keyboard-shortcuts.ts` as a pure derivation. None are blocking — opportunistic only.

NOT done in iter 84 (intentionally deferred):
- F1 (blocked on live API access)
- Full Content Pulse tab (the F4 widget is the MVP; full tab deferred until product feedback)
- Phase hints enhancements (hardcoded MVP shipped — config-driven hints + per-pattern metrics deferred)
- e2e tests not run (frontend changes are unit-tested via jest; e2e would require running backend + browser)
- Visual verification with real backend data (jest tests use mocked data; manual verification needs a running backend with ≥21d of price_logs collected)
- No 3b-i / 3b-ii split was needed — a single combined hook sufficed because the pipeline is internally linear.
