# Worklog — PoE2 Market Dashboard

> Append-only shared multi-agent work log. Each section starts with `---`.
> Old task history is in `git log`.


Recent iterations kept (iter 82+). Older iter 77-81 records trimmed — those features (F5 live, F6 phase hints, F5 backtest UI, useDashboardData Stage 1) are fully shipped and documented in PRODUCT_VISION.md / STATUS.md / AGENT_NAVIGATION.md.

---
Task ID: iter-82
Agent: main (Sonnet 4.5)
Task: iter 82 — Stage 2 of useDashboardData hook extraction: extract realm/league selection + realms/leagues queries + effectiveLeague memo + auto-select useEffect from dashboard-page.tsx into a new useRealmsAndLeagues hook. Safe additive refactor — no behavior change.

Work Log:
- Read STATUS.md / PRODUCT_VISION.md / AGENT_NAVIGATION.md / worklog.md iter 81 record to understand the hand-off. Confirmed iter 81 shipped Stage 1 (useFlipperBackend). F1 still blocked on live poe2scout.com + poe2db.tw/ru/ API access (no change since iter 80).
- Surveyed what's doable in iter 82 without external API access:
  1. useDashboardData Stage 2 (realms/leagues) — recommended by iter 81 hand-off, well-scoped, low-risk
  2. Stage 3 (derived memos) — riskier, deferred to iter 83+
  3. Full Content Pulse tab / phase hints enhancements — need product feedback, deferred
  4. e2e tests / visual verification — environment-blocked
- Picked Stage 2 — exactly matches the staged plan documented in STATUS.md.

- Inspected dashboard-page.tsx (1197 lines) to identify the realms/leagues extraction target:
  - realm + league useState (lines 145-146) — owned by parent, also used downstream in 10+ queries (useReferenceCurrencies, useAllItems, useCurrencyItems, useItemCategories, useUniqueItems, useExchangePairs, usePrefetch, useInitialBatch, usePriceAlerts, base-currency useEffect).
  - realms + leagues useQuery calls (lines 271-290) — realms has no enabled gate; leagues is `enabled: !!realm` and reuses Fix 5.4 (`defaultLeagueValue` from realms data to avoid redundant /Realms request inside getLeagues()).
  - effectiveLeague useMemo (lines 293-297) — falls back to active league, then first league, then "".
  - setLeague wrapper (lines 316-319) — wraps setLeagueLocal + persistLeague (Zustand store action).
  - Auto-select useEffect (lines 325-333) — fires when `leagues` arrives and `league` is empty; auto-picks first active league (or first league if none flagged active).
  - setRealm + setLeague("") call site at line 905-908 (Header onRealmChange callback).
- Confirmed via grep that `setRealm` is only used at the Header call site (always paired with setLeague("")), and `persistLeague` is only used inside the setLeague wrapper. Both can move into the hook cleanly.
- Confirmed `Realm` and `League` type imports become unused in dashboard-page.tsx after extraction (they're only referenced in the realms/leagues useQuery calls and effectiveLeague memo).

- Frontend — `src/hooks/use-realms-and-leagues.ts` (NEW, 163 lines):
  - Header comment explains: Stage 2 of useDashboardData extraction, lists what the hook owns (realm + league state, two queries, effectiveLeague memo, auto-select useEffect, setRealm/setLeague wrappers), points to STATUS.md for the staged plan.
  - Exports `UseRealmsAndLeaguesResult` interface + `useRealmsAndLeagues()` function.
  - Owns `realm` (default "poe2") + `league` (default "") useState so the auto-select useEffect can fire when `leagues` arrives.
  - Calls `useDashboardStore()` to get `persistLeague` (same Zustand action the parent previously destructured directly).
  - realms useQuery: no enabled gate, queryKey `[QUERY_KEYS.realms]`, queryFn `fetchApi<Realm[]>("/api/poe2/realms")` — UNCHANGED from prior inline call.
  - leagues useQuery: `enabled: !!realm`, queryKey `[QUERY_KEYS.leagues, realm]`, queryFn reuses Fix 5.4 (`defaultLeague` lookup from realms data + `defaultLeagueValue` param forwarding) — UNCHANGED from prior inline call.
  - effectiveLeague useMemo: same fallback chain (user selection > active league > first league > "") — UNCHANGED.
  - setRealm useCallback: wraps setRealmState + setLeagueLocal("") — matches the prior inline `setRealm(v); setLeague("")` call site behaviour. Centralizing this in the hook means the parent doesn't have to remember to clear the league.
  - setLeague useCallback: wraps setLeagueLocal + persistLeague — same wrapper that lived inline in dashboard-page.tsx before iter 82. Deps: [persistLeague].
  - Auto-select useEffect: same logic (auto-pick first active league when none selected), deps: [league, leagues, setLeague]. The `setLeague` dep is stable (useCallback) so the effect behaves identically to the prior inline version (deps: [league, leagues]).
  - Returns: { realm, setRealm, league, setLeague, realms, realmsLoading, leagues, leaguesLoading, effectiveLeague }.

- Frontend — `src/components/dashboard/dashboard-page.tsx` (modified, 1197 → 1169 lines, −28 net):
  - Added `import { useRealmsAndLeagues } from "@/hooks/use-realms-and-leagues";` (with iter-82 comment explaining the extraction).
  - Removed `Realm` + `League` type imports (now consumed inside the hook — added comment explaining why).
  - Removed `const [realm, setRealm] = useState("poe2");` and `const [league, setLeagueLocal] = useState("");` from the Dashboard component.
  - Removed `setLeague: persistLeague,` from the useDashboardStore destructuring (no longer used in the parent — added NOTE comment).
  - Removed the inline 20-line realms+leagues useQuery block.
  - Removed the inline 6-line effectiveLeague useMemo.
  - Removed the inline 4-line setLeague wrapper function.
  - Removed the inline 10-line auto-select useEffect.
  - Added a single 11-line `const { realm, setRealm, league, setLeague, realms, realmsLoading, leagues, leaguesLoading, effectiveLeague } = useRealmsAndLeagues();` destructure at the top of the Dashboard component.
  - All downstream references (12+ places) work unchanged — same variable names, same types, same behaviour.
  - Header `onRealmChange` callback simplified: was `(v) => { setRealm(v); setLeague(""); }`, now just `setRealm` (the hook clears the league internally). Added comment explaining this.
  - `useQuery` import preserved (still used by optimalCurrencyData query).
  - `QUERY_KEYS` import preserved (still used by optimalCurrencyData query key).
  - `useMemo` / `useEffect` / `useCallback` / `useState` imports preserved (still used by many other handlers/memos/effects).

- Verification:
  - `node node_modules/typescript/bin/tsc --noEmit` → 0 errors (clean type-check).
  - `node node_modules/jest/bin/jest.js` (full suite) → **422 pass** / 0 fail across 20 test suites (~5.8s). Unchanged from iter 81 baseline — confirms zero behavior regression.
  - `node node_modules/next/dist/bin/next build` → "✓ Compiled successfully in 4.5s" (1 pre-existing Turbopack warning about next.config.ts NFT tracing — unrelated to this iter).
  - `wc -l src/components/dashboard/dashboard-page.tsx` → 1169 lines (was 1197).

Stage Summary:
- **useDashboardData Stage 2 (useRealmsAndLeagues hook extraction) — DONE.** New hook `src/hooks/use-realms-and-leagues.ts` (163 lines) is the single source of truth for realm/league selection and the two dropdown-populating queries. `dashboard-page.tsx` is now 1169 lines (was 1197, was 1232 in iter 80, was 1685 in iter 70). Zero behavior change — same query keys, same polling intervals, same effectiveLeague fallback chain, same auto-select useEffect logic, same setRealm/setLeague wrappers (just centralized).
- **F1 (additional RU translations) — STILL BLOCKED.** No change from iter 81 — needs live poe2scout.com + poe2db.tw/ru/ access.
- **Baseline:** jest 422 pass (unchanged from iter 81), tsc 0 errors, next build OK.

---
Task ID: iter-83
Agent: main (Sonnet 4.5)
Task: iter 83 — Stage 3a of useDashboardData hook extraction: extract the Exchange tab filter pipeline (exchangePairs useMemo) + currency/unique category-chip list derivation (currencyCategories + uniqueCategoriesList useMemos) from dashboard-page.tsx into two new pure hooks (useFilteredExchangePairs + useItemCategoryLists). Safe additive refactor — no behavior change. Stage 3b (optimalPayment cluster — highest interdependency risk) deferred to iter 84+.

Work Log:
- Read STATUS.md / PRODUCT_VISION.md / AGENT_NAVIGATION.md / worklog.md iter 82 record to understand the hand-off. Confirmed iter 82 shipped Stage 2 (useRealmsAndLeagues, dashboard-page.tsx 1169 lines). F1 still blocked on live poe2scout.com + poe2db.tw/ru/ API access (no change since iter 82).
- Surveyed what's doable in iter 83 without external API access:
  1. useDashboardData Stage 3a (exchangePairs filter + currencyCategories/uniqueCategoriesList) — recommended by iter 82 hand-off, low interdependency risk
  2. Stage 3b (optimalPayment cluster: clientOptimalResult + backend-merge + byDisplayName) — highest interdependency risk, deferred to iter 84+
  3. Full Content Pulse tab / phase hints enhancements — need product feedback, deferred
  4. e2e tests / visual verification — environment-blocked
- Picked Stage 3a — exactly matches the sub-staged plan documented in iter 82 / STATUS.md.

- Inspected dashboard-page.tsx (1169 lines) to identify the Stage 3a extraction targets (3 inline useMemos):
  - `exchangePairs` (lines 421-460, ~40 lines) — filter pipeline. Depends on `exchangeData`, `search`, `uiState.exchange.activeFilter`, `uiState.exchange.favorites`, `uiState.exchange.extendedFilters`. Pure derivation, no side effects, no store reads beyond the `uiState.exchange` slice.
  - `currencyCategories` (lines 631-635, ~5 lines) — chip list for Currencies tab. Depends on `uniqueCategories` (from useItemCategories) + `t` (from useI18n). Filter: `c.name !== "Unique"`. Empty-list fallback pushes `{ name: "all", displayName: t("all"), count: 0 }`.
  - `uniqueCategoriesList` (lines 637-652, ~16 lines) — chip list for Uniques tab. Depends on `uniqueCategories` + `t`. Filter: `name === "Unique"` OR substring match on `Unique`/`Armour`/`Weapon`/`Accessory`/`Flask`/`Jewel`/`Gem`. Same empty-list "all" fallback.
- Confirmed via grep that all 5 derived values are owned by exactly these 3 memos — no other inline call sites. `uniqueCategories` and `t` are already in scope of the parent (from `useItemCategories()` and `useI18n()` respectively), so the new hook can take them as args without re-fetching.
- Confirmed `ItemCategory` and `TranslationKeys` types were NOT explicitly imported into dashboard-page.tsx (they were inferred) — so no type imports to remove. `useMemo` import preserved (still used by 4 other inline memos: `activeExtFilterCount`, `clientOptimalResult`, `optimalPaymentByPair` merge, `optimalPaymentByDisplayName`, `navigableList`, `keyboardActions`).
- Decided to split into TWO pure hooks (instead of one combined hook) because the two concerns are genuinely different:
  - `useFilteredExchangePairs` — Exchange tab filter pipeline (search → quick chip → extended numeric filters)
  - `useItemCategoryLists` — currency/unique category-chip list derivation
  This matches the codebase's existing pattern of small, focused hooks (use-flipper-backend, use-realms-and-leagues, use-cross-rates, etc.).

- Frontend — `src/hooks/use-filtered-exchange-pairs.ts` (NEW, 113 lines):
  - Header comment explains: Stage 3a of useDashboardData extraction, lists what the hook owns (Exchange tab filter pipeline), points to STATUS.md for the staged plan, documents filter rules (case-insensitive search on either currency name; `topVolume` chip = top 20 by volume desc applied AFTER search; `favorites` chip = pairs in `exchangeUiState.favorites`; extended `minVolume`/`maxVolume` inclusive; `minChange`/`maxChange` ignored when 0; `changePercent` treated as -∞/+∞ when null).
  - Exports `UseFilteredExchangePairsInput` interface + `useFilteredExchangePairs()` function.
  - Pure hook — no queries, no store reads, no useState. Takes `{ exchangeData, search, exchangeUiState }` as args (where `exchangeUiState` is the `uiState.exchange` slice from `useDashboardStore()`).
  - Internal `useMemo` deps array matches the prior inline memo exactly: `[exchangeData, search, exchangeUiState.activeFilter, exchangeUiState.favorites, exchangeUiState.extendedFilters]`.
  - Returns derived `ExchangePair[]` (filtered, never mutates input).

- Frontend — `src/hooks/use-item-category-lists.ts` (NEW, 100 lines):
  - Header comment explains: Stage 3a of useDashboardData extraction, lists what the hook owns (currency/unique category-chip list derivation), points to STATUS.md for the staged plan, documents filter rules (currency list = `name !== "Unique"`; unique list = `name === "Unique"` OR substring match on 7 family names; empty-list fallback pushes `{ name: "all", displayName: t("all"), count: 0 }`).
  - Exports `UseItemCategoryListsInput` + `UseItemCategoryListsResult` interfaces + `useItemCategoryLists()` function.
  - Pure hook — no queries, no store reads, no useState. Takes `{ uniqueCategories, t }` as args.
  - Uses `TranslationKeys` type from `@/lib/i18n` for the `t` function signature (proper typing — not a loose `string`-keyed function).
  - Two internal `useMemo`s — one per derived list — same deps array `[uniqueCategories, t]` as prior inline memos.
  - Returns `{ currencyCategories, uniqueCategoriesList }` — same names as prior inline memos so the parent destructure is unchanged.

- Frontend — `src/components/dashboard/dashboard-page.tsx` (modified, 1169 → 1128 lines, −41 net):
  - Added `import { useFilteredExchangePairs } from "@/hooks/use-filtered-exchange-pairs";` + `import { useItemCategoryLists } from "@/hooks/use-item-category-lists";` (with iter-83 comment explaining the Stage 3a extraction).
  - Replaced the inline 40-line `exchangePairs` useMemo with a 5-line `const exchangePairs = useFilteredExchangePairs({ exchangeData, search, exchangeUiState: uiState.exchange });` call. Added iter-83 comment.
  - Replaced the inline 25-line `currencyCategories` + `uniqueCategoriesList` useMemo pair with a 4-line `const { currencyCategories, uniqueCategoriesList } = useItemCategoryLists({ uniqueCategories, t });` destructure. Added iter-83 comment.
  - `const currentCategories = tab === "currencies" ? currencyCategories : uniqueCategoriesList;` line preserved unchanged.
  - All downstream references (Exchange tab `exchangePairs` prop, `navigableList` memo, CSV export, currency/unique chip strips) work unchanged — same variable names, same types, same behaviour.
  - `useMemo` / `useCallback` / `useEffect` / `useState` imports preserved (still used by 6 other inline memos + handlers).

- Verification:
  - `node node_modules/typescript/bin/tsc --noEmit` → 0 errors (clean type-check).
  - `node node_modules/jest/bin/jest.js` (full suite) → **422 pass** / 0 fail across 20 test suites (~5.8s). Unchanged from iter 82 baseline — confirms zero behavior regression.
  - `node node_modules/next/dist/bin/next build` → "✓ Compiled successfully in 4.8s" (1 pre-existing Turbopack warning about next.config.ts NFT tracing — unrelated to this iter).
  - `wc -l src/components/dashboard/dashboard-page.tsx` → 1128 lines (was 1169).

- Documentation updates:
  - `STATUS.md`: bumped "Last updated" to iter 83. Rewrote the technical-debt backlog paragraph: updated line count (1169→1128), noted Stage 3a shipped iter 83 (with both new hook file paths), updated remaining work (only Stage 3b optimalPayment cluster left). Added 2 new Quick Reference entries (filtered exchange pairs → useFilteredExchangePairs hook; currency/unique category chip lists → useItemCategoryLists hook).
  - `PRODUCT_VISION.md`: bumped "Last updated" to iter 83. Updated final DoD paragraph to mention "Stage 1 выполнен в iter 81, Stage 2 в iter 82, Stage 3a в iter 83, остался sub-stage 3b: optimalPayment cluster".
  - `AGENT_NAVIGATION.md`: bumped "Last updated" to iter 83. Updated `dashboard-page.tsx` row in §1 (1169→1128 lines, "Stages 1-2 + 3a done iter 81-83"). Bumped `src/hooks/` count from 16 to 18. Added 2 new §1 module rows for `use-filtered-exchange-pairs.ts` + `use-item-category-lists.ts` with full descriptions (pure hooks, no queries/store/state, filter rules documented, inline useMemo forbidden). Updated "dashboard-page.tsx still 1128 lines" Quick Reference entry. Added invariant #36 (`useFilteredExchangePairs` + `useItemCategoryLists` are the single source of truth for the Exchange tab filter pipeline + currency/unique category-chip list derivation — documents both hook contracts, filter rules, FORBIDDEN inline patterns, and notes Stage 3b still pending). Updated invariant #34 to note Stage 3a done iter 83. Updated invariant #35 to note Stage 3a done iter 83 + Stage 3b still pending.
  - `worklog.md`: trimmed iter 80-81 records (F5 backtest UI + useDashboardData Stage 1 — all fully shipped and documented in PRODUCT_VISION.md/STATUS.md/AGENT_NAVIGATION.md). Kept iter 82 (Stage 2 — directly precedes this iter) + this iter 83 record.

Stage Summary:
- **useDashboardData Stage 3a (useFilteredExchangePairs + useItemCategoryLists hook extraction) — DONE.** Two new pure hooks are the single source of truth for the Exchange tab filter pipeline + currency/unique category-chip list derivation. `dashboard-page.tsx` is now 1128 lines (was 1169, was 1197 in iter 81, was 1232 in iter 80, was 1685 in iter 70). Zero behavior change — same filter rules, same empty-list "all" fallback, same dependency arrays, same variable names downstream.
- **F1 (additional RU translations) — STILL BLOCKED.** No change from iter 82 — needs live poe2scout.com + poe2db.tw/ru/ access.
- **Baseline:** jest 422 pass (unchanged from iter 82), tsc 0 errors, next build OK.
- **Files changed/created (6 total):**
  - `src/hooks/use-filtered-exchange-pairs.ts` (NEW, 113 lines)
  - `src/hooks/use-item-category-lists.ts` (NEW, 100 lines)
  - `src/components/dashboard/dashboard-page.tsx` (modified: −41 lines net — replaced 3 inline useMemos with 2 hook calls)
  - `STATUS.md` (updated — iter 83 stamp, Stage 3a noted, 2 new Quick Reference entries)
  - `PRODUCT_VISION.md` (updated — iter 83 stamp, Stage 3a noted in DoD paragraph)
  - `AGENT_NAVIGATION.md` (updated — iter 83 stamp, dashboard-page.tsx row updated, hooks count 16→18, 2 new module rows, invariant #36 added, invariants #34/#35 updated, Quick Reference entry updated)
  - `worklog.md` (this record + iter 80-81 trim)

Next iteration (iter 84) — recommended priorities:
1. **F1 (when live API available)** — `scripts/sync_currency_names_from_poe2db.py`: enumerate 625 api_ids, fetch poe2db.tw/ru/, update `currency_names.json`, bump assertion counters in `tests/test_currency_names_ru.py`. Still the only blocked feature.
2. **useDashboardData Stage 3b** (optional tech debt) — extract the optimalPayment cluster into a new `useOptimalPayment()` hook. Highest interdependency risk in the entire extraction plan:
   - `clientOptimalResult` memo depends on `exchangeData` + `crossRates.relativePriceMap` + `crossRates.anchorId` + `crossRates.anchorRelPrice` + `crossRates.crossRateFlips` + `findOptimalPayment` + `isItemCategory`.
   - Backend-merge memo (`optimalPaymentByPair`/`crossRateFlips`/`selectedAnchorId`) depends on `optimalCurrencyData` (useQuery) + `exchangeData` + `clientOptimalResult`.
   - `optimalPaymentByDisplayName` memo depends on `exchangeData` + `optimalPaymentByPair` (output of the merge memo).
   - The `optimalCurrencyData` useQuery itself also needs to move into the new hook (currently inline at line 481) — it's `enabled: flipperBackendOnline`, queryKey `[QUERY_KEYS.flipperOptimalCurrency]`, 60s refetch.
   - Verify tsc + jest after extraction. May need to break into 2 sub-stages if the interdependency proves too tight for one hook: (3b-i) `clientOptimalResult` + the useQuery; (3b-ii) merge memo + byDisplayName memo.
3. **Full Content Pulse tab** — F4 widget is the MVP; full version with sorting/filters/drill-down if widget proves useful.
4. **Phase hints enhancements** (optional) — pull hints from `config.yaml` instead of hardcoding; add per-pattern metrics by cross-referencing the snapshot's `price_histories`; filter hints based on actual market state.
5. **Visual verification with real backend data** — manual verification of the backtest panel against real snapshot data needs a running backend with ≥21d of price_logs collected.
6. **e2e tests** (optional) — frontend is covered by jest; e2e would require running backend + browser.

NOT done in iter 83 (intentionally deferred):
- F1 (blocked on live API access)
- useDashboardData Stage 3b (optimalPayment cluster extraction) — deferred to iter 84+ to keep this iter small and reviewable. Highest interdependency risk — may need 2 sub-stages.
- Full Content Pulse tab (the F4 widget is the MVP; full tab deferred until product feedback)
- Phase hints enhancements (hardcoded MVP shipped — config-driven hints + per-pattern metrics deferred)
- e2e tests not run (frontend changes are unit-tested via jest; e2e would require running backend + browser)
- Visual verification with real backend data (jest tests use mocked data; manual verification needs a running backend with ≥21d of price_logs collected)
