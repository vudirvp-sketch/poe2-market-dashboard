# Worklog — PoE2 Market Dashboard

> Append-only shared multi-agent work log. Each section starts with `---`.
> Old task history is in `git log`.


Recent iterations kept (iter 80+). Older iter 77-79 records trimmed — those features (F5 live, F6 phase hints, F5 backtest backend) are fully shipped and documented in PRODUCT_VISION.md / STATUS.md.

---
Task ID: iter-80
Agent: main (Sonnet 4.5)
Task: iter 80 — F5 backtest frontend UI (collapsible Backtest panel inside Speculation tab, toggle-driven not autoload).

Work Log:
- Read STATUS.md / PRODUCT_VISION.md / AGENT_NAVIGATION.md / worklog.md iter 79 record to understand the hand-off: F5 backtest backend shipped in iter 79 (pure function + route + 54 pytest), frontend UI was deferred to iter 80 as the recommended priority.
- Inspected existing `speculation-tab.tsx` (504 lines, 18 jest tests) to plan the additive change: a Backtest panel mounted BELOW the live signals list, inside the same `CardContent`, as an internal subcomponent (NOT a separate file) to keep the spec UI cohesive.
- Inspected backend backtest response shape (`SpeculationBacktestResponse` Pydantic model in `response_models.py` + `routes_speculation_backtest.py`) — confirmed: trades list (sorted by |return_pct| desc, capped by `limit`), signal_breakdown {BUY,SELL,HOLD}, evaluated/unevaluated counts, buy_stats/sell_stats/overall_stats blocks (count, win_rate, mean/median/best/worst return_pct), dataAvailable, fetchedAt, evalDaysAgo/holdingDays/lookbackDays.
- Inspected existing Next.js proxy routes (`/api/flipper/speculation/route.ts`, `/api/flipper/phase-hints/route.ts`) for the `proxyWithFallback` pattern — confirmed: returns empty fallback with zeroed stats + `dataAvailable: false` when backend offline (no 503).

- Frontend — `src/app/api/flipper/speculation/backtest/route.ts` (NEW, ~95 lines):
  - Next.js proxy route for `GET /api/v1/speculation/backtest`. Forwards all 5 query params (`eval_days_ago`, `holding_days`, `lookback_days`, `limit`, `signal`) to the backend via `proxyWithFallback`.
  - `emptyFallback` shape matches the camelCase-transformed backend response: empty `trades: []`, zeroed `buyStats`/`sellStats`/`overallStats` blocks (count=0, winRate=0, meanReturnPct=0, etc.), `signalBreakdown: {BUY:0, SELL:0, HOLD:0}`, `evaluatedCount: 0`, `unevaluatedCount: 0`, `dataAvailable: false`, plus passthrough of the requested `evalDaysAgo`/`holdingDays`/`lookbackDays` from query params (or backend defaults 14/7/30 if absent).
  - Uses the same `proxyWithFallback` pattern as the live `/api/flipper/speculation` route — 503 (backend offline / insufficient data) returns the empty fallback as 200, non-503 5xx passes through in dev / becomes 200+fallback in prod.

- Frontend — `src/lib/types.ts` (extended, +80 lines):
  - Added 3 new TS interfaces in a new "Speculation backtest (F5 follow-up, iter 80 — frontend UI)" section after `SpeculationResponse`:
    - `SpeculationBacktestTrade` — per-trade record: apiId, text, category, signal (SpeculationSignalType), entryPrice, entryDate, exitPrice, exitDate, returnPct, zScoreAtEntry (nullable), sampleSizeAtEntry.
    - `SpeculationBacktestStatsBlock` — count, winRate, meanReturnPct, medianReturnPct, bestReturnPct, worstReturnPct.
    - `SpeculationBacktestResponse` — league, trades, signalBreakdown (Record<"BUY"|"SELL"|"HOLD", number>), evaluatedCount, unevaluatedCount, buyStats, sellStats, overallStats, dataAvailable, fetchedAt, evalDaysAgo, holdingDays, lookbackDays.
  - All field names are camelCase (post `transformKeys` from flipper-proxy). Each field has a JSDoc comment matching the backend Pydantic description.

- Frontend — `src/lib/i18n/locales/{en,ru,zh,ko}.ts` (extended, +34 keys × 4 locales = +136 lines total):
  - Added 34 new i18n keys per locale in a new "F5 follow-up (iter 80) — Backtest panel inside Speculation tab" section (after `speculationHorizonUnknown`, before F6 phase hints keys).
  - Keys cover: title (`speculationBacktestTitle`), subtitle, run/hide toggle buttons (long + short), loading/error/no-data/no-trades notices, 3 day-selector labels (`speculationBacktestEvalDaysLabel` / `HoldingDaysLabel` / `LookbackDaysLabel` with `{0}` placeholder for current value), 3 short variants for compact display, 3 stats-block titles (Overall/BUY/SELL), 5 stats labels (winRate, meanReturn, medianReturn, bestReturn, worstReturn), tradesCount + evaluated + unevaluated, breakdownTitle, tradesTitle, 5 trade-table column headers, fetchedAt footer.
  - Verified parity via `grep -c "speculationBacktest"` → 34 keys in each of en/ru/zh/ko.

- Frontend — `src/components/dashboard/speculation-tab.tsx` (extended, ~980 lines total, +~470 lines):
  - Updated file header comment to document the new Backtest panel: toggle behavior, 3 day selectors, stats blocks, signal breakdown, top-trades list, graceful degradation states.
  - Added imports: `History`, `Play`, `ChevronDown`, `ChevronUp` from `lucide-react`; `SpeculationBacktestResponse`, `SpeculationBacktestStatsBlock`, `SpeculationBacktestTrade` from `@/lib/types`.
  - Added constants: `BACKTEST_EVAL_PRESETS` [7,14,30,90], `BACKTEST_HOLDING_PRESETS` [1,3,7,14,30], `BACKTEST_LOOKBACK_PRESETS` [7,14,30,90], `BACKTEST_DEFAULT_EVAL_DAYS=14`, `BACKTEST_DEFAULT_HOLDING_DAYS=7`, `BACKTEST_DEFAULT_LOOKBACK_DAYS=30`, `BACKTEST_LIMIT=50` — defaults match backend `DEFAULT_*` constants in `speculation_backtest.py`.
  - Wired `<BacktestPanel backendOnline={backendOnline} signalFilter={signalFilter} />` inside the main `CardContent`, after the fetched-at footer of the live signals list. Inline comment explains the NOT-autoload rationale.
  - Added `BacktestPanel` subcomponent (~230 lines):
    - Local state: `showBacktest` (default false), `evalDays` (14), `holdingDays` (7), `lookbackDays` (30).
    - `useQuery` with `queryKey: ["speculation-backtest", evalDays, holdingDays, lookbackDays, signalFilter]`, `queryFn: fetchApi("/api/flipper/speculation/backtest", {eval_days_ago, holding_days, lookback_days, limit:50, signal: signalFilter})`, `enabled: showBacktest && backendOnline`, `staleTime: 60_000`, `retry: 1`.
    - When `!showBacktest` → renders only the "Run backtest" toggle button (full-width outline button with Play icon + ChevronDown).
    - When `showBacktest` → renders the expanded panel: header (History icon + title + subtitle + Hide button with ChevronUp), 3 `DaySelector` instances + Refresh button, then conditional content based on query state.
    - Conditional states: `isLoading` → spinner text; `isError` → red notice with AlertTriangle icon; `!dataAvailable` → "no data yet" notice; `dataAvailable && trades.length===0` → "no trades produced" notice; `dataAvailable && trades.length>0` → full content (stats grid + breakdown + trades list + fetched-at footer).
  - Added `DaySelector` helper (~25 lines): label + Select bound to numeric presets.
  - Added `StatsBlock` helper (~60 lines): single card for Overall/BUY/SELL with accent color (emerald for BUY, red for SELL, neutral for Overall). Renders count + winRate (1 decimal) + mean/median/best/worst return_pct (2 decimals, signed, color-coded green/red/muted).
  - Added `TradeRow` helper (~50 lines): single trade row — signal badge (reuses `signalBadgeClass` + `signalIcon` from parent scope) + item name + category (title-cased) + entry price → exit price + return_pct (colored: emerald >0, red <0, muted =0).
  - All subcomponents use `data-testid` attributes for jest testing: `speculation-backtest-panel-collapsed`, `speculation-backtest-panel`, `speculation-backtest-toggle`, `speculation-backtest-eval-days`, `speculation-backtest-holding-days`, `speculation-backtest-lookback-days`, `speculation-backtest-refresh`, `speculation-backtest-loading`, `speculation-backtest-error`, `speculation-backtest-no-data`, `speculation-backtest-no-trades`, `speculation-backtest-content`, `speculation-backtest-stats-{overall,buy,sell}`, `speculation-backtest-breakdown`, `speculation-backtest-trades`, `speculation-backtest-trade-{apiId}`.

- Frontend — `src/__tests__/speculation-backtest-panel.test.tsx` (NEW, ~480 lines, 15 tests):
  - Uses the same `mockFetchApi` pattern as `speculation-tab.test.tsx` — mocks `@/lib/types` `fetchApi` so we can intercept both `/api/flipper/speculation` (live) and `/api/flipper/speculation/backtest` (backtest) calls.
  - Test data: `liveResponse` (1 BUY signal so the parent tab renders the main panel + collapsed Backtest toggle), `makeBacktestResponse()` factory (2 trades: 1 BUY +18.75% + 1 SELL +15.38%, signal_breakdown BUY:1/SELL:1/HOLD:3, evaluated=2, unevaluated=1, populated stats blocks).
  - 15 tests covering:
    1. Collapsed by default → toggle button visible, no expanded panel.
    2. Does NOT call fetchApi for backtest path when panel is collapsed (waits 100ms to confirm no async query fires).
    3. Toggle click → panel expands + backtest query fires.
    4. Default params forwarded correctly (eval_days_ago=14, holding_days=7, lookback_days=30, limit=50, signal=ALL).
    5. Loading state → spinner text visible.
    6. Error state → red error notice visible (uses ERROR_WAIT_OPTS 5s timeout because of `retry: 1`).
    7. dataAvailable=false → "no data" notice.
    8. dataAvailable=true + trades=[] → "no trades" notice.
    9. Stats blocks render with correct numbers (Overall count=2, winRate=100.0%, BUY mean=+18.75%, SELL mean=+15.38%).
    10. Signal breakdown shows BUY 1, SELL 1, HOLD 3, 2 evaluated, 1 unevaluated.
    11. Trade rows render with item name + signal + entry/exit + return_pct (signed: +18.75%, +15.38%).
    12. Fetched-at footer renders with trade count.
    13. Hide button collapses panel back (expanded → collapsed state transition).
    14. Parent signalFilter (BUY) forwarded as `signal` query param to backtest (clicks BUY filter chip on parent, then expands backtest, asserts last backtest call has signal=BUY).
    15. Day selectors render with default values (Eval 14 days ago / Hold 7 days / Lookback 30 days).

- Verification:
  - `npx tsc --noEmit` → 0 errors (clean type-check).
  - `npx jest src/__tests__/speculation-tab.test.tsx` → 18 pass / 0 fail (existing live-signal tests unaffected).
  - `npx jest src/__tests__/speculation-backtest-panel.test.tsx` → 15 pass / 0 fail (new backtest-panel tests).
  - `npx jest` (full frontend suite) → **422 pass** (407 baseline + 15 new) / 0 fail across 20 test suites (~6.6s).
  - Backend unchanged in iter 80 — `pytest tests/test_speculation_backtest.py tests/test_speculation.py` → 97 pass / 0 fail (54 backtest + 43 live, 1.3s). Backend baseline 731 pass preserved.

- Documentation updates:
  - `STATUS.md`: bumped "Last updated" to iter 80. F5 row updated to "iter 77 live + iter 79 backtest backend + iter 80 backtest UI" with iter 80 frontend UI subsection. Added 2 new Quick Reference entries (Speculation tab shows no "Run backtest" button / Backtest panel "Run backtest" click does nothing).
  - `PRODUCT_VISION.md`: bumped "Last updated" to iter 80. §3.2 added iter 80 bullet (toggle, 3 day selectors, 3 stats blocks, signal breakdown, top-trades list). §4 architecture table updated Speculation tab row to mention backtest panel. §5 F5 section title updated to include iter 80; removed the obsolete "No frontend UI yet — backend-only" line from iter 79 subsection; added full "Реализовано в iter 80 (frontend UI)" subsection with all implementation details (proxy route, TS types, i18n keys, BacktestPanel + DaySelector + StatsBlock + TradeRow subcomponents, NOT-autoload rationale, parent signalFilter forwarding, graceful degradation states, 15 jest tests). §6 DoD point 4 updated to mention all 3 iters (77 live + 79 backend + 80 UI). Final paragraph updated: "F5 backtest полностью закрыт в iter 80 (backend + frontend UI)".
  - `AGENT_NAVIGATION.md`: bumped "Last updated" to iter 80. §1 `speculation-tab.tsx` row expanded with iter 80 Backtest panel details (toggle, day selectors, stats blocks, breakdown, trades list, parent signalFilter forwarding, graceful degradation, test counts). Invariant #33 expanded with "Frontend UI (iter 80)" subsection documenting the toggle-driven pattern, query params, parent signalFilter forwarding, Next.js proxy path. Frontend routes table added `/api/flipper/speculation/backtest` row. Quick Reference added 2 new entries (no "Run backtest" button / Run backtest click does nothing).
  - `worklog.md`: appended this iter 80 record.

Stage Summary:
- **F5 backtest frontend UI — DONE (collapsible Backtest panel inside Speculation tab + Next.js proxy + TS types + 4-locale i18n + 15 jest tests).** Toggle button (NOT autoload — gates `useQuery` via `enabled: showBacktest && backendOnline`). 3 day selectors (eval/holding/lookback). 3 stats blocks (Overall/BUY/SELL). Signal breakdown. Top-trades list. Parent's `signalFilter` forwarded as `signal` query param. Full graceful degradation (collapsed/loading/error/no-data/no-trades/full-content).
- **F5 (Speculation tab) — fully closed in iter 80.** All three sub-features shipped: iter 77 live signals (43 pytest + 18 jest), iter 79 backtest backend (54 pytest), iter 80 backtest UI (15 jest). No remaining F5 work.
- **F1 (additional RU translations) — STILL BLOCKED.** No change from iter 79 — needs live poe2scout.com + poe2db.tw/ru/ access.
- **Baseline:** jest 422 pass (+15), pytest 731 pass (unchanged — backend not touched in iter 80), tsc 0 errors.
- **Files changed/created (8 total):**
  - `src/app/api/flipper/speculation/backtest/route.ts` (NEW, ~95 lines)
  - `src/lib/types.ts` (modified: +80 lines — 3 Backtest interfaces)
  - `src/lib/i18n/locales/en.ts` (modified: +34 lines)
  - `src/lib/i18n/locales/ru.ts` (modified: +34 lines)
  - `src/lib/i18n/locales/zh.ts` (modified: +34 lines)
  - `src/lib/i18n/locales/ko.ts` (modified: +34 lines)
  - `src/components/dashboard/speculation-tab.tsx` (modified: +~470 lines — BacktestPanel + DaySelector + StatsBlock + TradeRow subcomponents + wiring)
  - `src/__tests__/speculation-backtest-panel.test.tsx` (NEW, ~480 lines, 15 tests)
  - `STATUS.md` (updated — F5 row + 2 Quick Reference entries)
  - `PRODUCT_VISION.md` (updated — §3.2 + §4 + §5 F5 iter 80 subsection + §6 DoD)
  - `AGENT_NAVIGATION.md` (updated — §1 speculation-tab.tsx row + invariant #33 + frontend routes table + 2 Quick Reference entries)
  - `worklog.md` (this record)

Next iteration (iter 81) — recommended priorities:
1. **F1 (when live API available)** — `scripts/sync_currency_names_from_poe2db.py`: enumerate 625 api_ids, fetch poe2db.tw/ru/, update `currency_names.json`, bump assertion counters in `tests/test_currency_names_ru.py`. Still the only blocked feature.
2. **Full Content Pulse tab** — F4 widget is the MVP; full version with sorting/filters/drill-down if widget proves useful. The widget is mounted on Overview tab; a full tab would let users see ALL categories (not just top-2 rising + top-2 falling) with sortable columns.
3. **Phase hints enhancements** (optional) — pull hints from `config.yaml` instead of hardcoding; add per-pattern metrics by cross-referencing the snapshot's `price_histories`; filter hints based on actual market state (e.g. only show "Temporalis near peak" if its 7d momentum is positive).
4. **useDashboardData hook extraction** (optional, tech debt) — `dashboard-page.tsx` is 1217 lines; ~250 lines of `useQuery`/memo wiring could move into a hook. Staged approach. Not blocking.
5. **Visual verification with real backend data** — manual verification of the backtest panel against real snapshot data (e.g. confirming that `eval_days_ago=14` with `holding_days=7` produces sensible trade counts on a live league) needs a running backend with ≥21d of price_logs collected. Jest tests use mocked data.
6. **e2e tests** (optional) — frontend is covered by jest; e2e would require running backend + browser. Not blocking.

NOT done in iter 80 (intentionally deferred):
- F1 (blocked on live API access)
- Full Content Pulse tab (the F4 widget is the MVP; full tab deferred until product feedback)
- Phase hints enhancements (hardcoded MVP shipped — config-driven hints + per-pattern metrics deferred)
- e2e tests not run (frontend changes are unit-tested via jest; e2e would require running backend + browser)
- useDashboardData hook extraction (optional, deferred)
- Visual verification with real backend data (jest tests use mocked data; manual verification of the backtest panel against real snapshot data needs a running backend with ≥21d of price_logs collected)

---
---
Task ID: iter-81
Agent: main (Sonnet 4.5)
Task: iter 81 — Stage 1 of useDashboardData hook extraction: extract flipper backend health/phase/events queries from dashboard-page.tsx into a new useFlipperBackend hook. Safe additive refactor — no behavior change.

Work Log:
- Read STATUS.md / PRODUCT_VISION.md / AGENT_NAVIGATION.md / worklog.md iter 80 record to understand the hand-off. Confirmed iter 80 closed F5 (Speculation tab backtest UI). F1 still blocked on live poe2scout.com + poe2db.tw/ru/ API access (no change).
- Surveyed what's actually doable in iter 81 without external API access or product feedback:
  1. useDashboardData hook extraction (tech debt, safe, well-scoped, STATUS.md "Approach in stages: (1) flipperBackend queries, (2) realms/leagues queries, (3) derived memos. Verify tsc + jest after each stage.")
  2. Phase hints enhancements (optional, config-driven — needs design work, not pure refactor)
  3. Full Content Pulse tab (deferred until product feedback on F4 widget — would be premature)
  4. e2e tests (need running backend + browser — out of scope for code-only iter)
  5. Visual verification (need ≥21d price_logs in live league — environment-blocked)
- Picked option 1 (useDashboardData Stage 1) — lowest risk, highest certainty, exactly matches the staged plan documented in STATUS.md.

- Inspected dashboard-page.tsx (1232 lines) to identify the safest extraction target:
  - flipperBackend queries (health/phase/events, lines 240-290): 3 useQuery calls + 2 derived booleans (flipperBackendOnline, flipperUpstreamReachable) + 1 derived number (activeEventsCount). SELF-CONTAINED: no state setters, no effect hooks, no inter-dependencies with other parts of the component. Returns clean interface.
  - realms/leagues queries (lines 306-332): COUPLED to setRealm/setLeague/setLeagueLocal wrappers + auto-select useEffect + persistLeague from store. Higher risk.
  - Derived memos (exchangePairs, crossRates, optimalPayment, currencyCategories — lines 482-716): HIGHLY COUPLED to many local state setters and other derived values. Highest risk.
- Confirmed via grep that the extracted symbols (flipperBackendOnline, flipperUpstreamReachable, flipperPhaseData, activeEventsCount) are used in 12 places downstream in dashboard-page.tsx (Header, FlipperStickyBar, all tab ErrorBoundary wrappers, FlipsTab/LiquidChainTab/CurrencyGraphTab upstreamDegraded prop, DashboardDialogs). All consumers continue to work unchanged because the new hook returns the same names.

- Frontend — `src/hooks/use-flipper-backend.ts` (NEW, 132 lines):
  - Header comment explains: Stage 1 of useDashboardData extraction, lists all 3 endpoints wrapped, documents derived flags, points to STATUS.md for staged plan.
  - Exports `UseFlipperBackendResult` interface + `useFlipperBackend()` function.
  - Three `useQuery` calls, all keys via `QUERY_KEYS` (flipperHealth / flipperPhase / flipperEventsCount — UNCHANGED from prior inline calls).
  - Health probe: always on, 30s staleTime + 30s refetchInterval + retry:2 + retryDelay:3000 (matches prior P1-2 retry policy).
  - Phase query: `enabled: flipperBackendOnline`, 60s staleTime + 60s refetchInterval + retry:1.
  - Events query: `enabled: flipperBackendOnline`, 30s staleTime + 30s refetchInterval + retry:1. Uses `{ active_only: "true" }` query param.
  - Derived flags: `flipperBackendOnline = !flipperHealthError && (status === "ok" || "degraded")`, `flipperUpstreamReachable = flipperHealthData?.provider === "reachable"`, `activeEventsCount = flipperEventsData?.total ?? 0`.
  - Returns the raw health state (data/pending/error) + raw events data for future consumers even though dashboard-page.tsx doesn't use them yet (avoids forcing a future re-extraction if a loading indicator is added).

- Frontend — `src/components/dashboard/dashboard-page.tsx` (modified, 1232 → 1197 lines, −35 net):
  - Added `import { useFlipperBackend } from "@/hooks/use-flipper-backend";` (with iter-81 comment explaining the extraction).
  - Removed now-unused type imports: `FlipperHealthResponse`, `FlipperPhaseResponse`, `FlipperEventsSummary` (still used inside the new hook — imported there).
  - Replaced the inline 50-line block (3 useQuery calls + derived flags) with a single 6-line `const { flipperBackendOnline, flipperUpstreamReachable, flipperPhaseData, activeEventsCount } = useFlipperBackend();` destructure.
  - All downstream references (12 places) work unchanged — same variable names, same types.
  - `useQuery` import preserved (still used by realms/leagues/optimalCurrency queries).
  - `QUERY_KEYS` import preserved (still used by realms/leagues/optimalCurrency query keys).

- Verification:
  - `npx tsc --noEmit` → 0 errors (clean type-check).
  - `npx jest` (full suite) → **422 pass** / 0 fail across 20 test suites (~5.7s). Unchanged from iter 80 baseline — confirms zero behavior regression.
  - `npx next build` → "✓ Compiled successfully in 4.5s" (1 pre-existing Turbopack warning about `next.config.ts` NFT tracing — unrelated to this iter).
  - `wc -l src/components/dashboard/dashboard-page.tsx` → 1197 lines (was 1232).

- Documentation updates:
  - `STATUS.md`: bumped "Last updated" to iter 81. Rewrote the technical-debt backlog paragraph: updated line count (1232→1197), noted Stage 1 shipped iter 81, listed remaining stages 2-3 (realms/leagues + derived memos). Added 1 new Quick Reference entry (dashboard-level backend status → useFlipperBackend hook).
  - `PRODUCT_VISION.md`: bumped "Last updated" to iter 81. Updated final DoD paragraph to mention "useDashboardData hook extraction — Stage 1 выполнен в iter 81, осталось 2 stage".
  - `AGENT_NAVIGATION.md`: bumped "Last updated" to iter 81. Updated `dashboard-page.tsx` row in §1 (1216→1197 lines, "Stage 1 done iter 81"). Bumped `src/hooks/` count from 14 to 15. Added new §1 module row for `use-flipper-backend.ts` with full description (single source of truth, 3 endpoints, derived flags, inline useQuery forbidden). Updated "dashboard-page.tsx still 1197 lines" Quick Reference entry. Added invariant #34 (`useFlipperBackend` is the single source of truth for dashboard-level flipper status — documents the hook contract, what's exposed, what's NOT to be done inline, and notes stages 2-3 still pending). Fixed stale §6 note: `worklog.md` was deleted in iter 73 then re-created in iter 74 — old note incorrectly claimed it was deleted permanently. Added `worklog.md` row to the §6 documentation map table.
  - `worklog.md`: appended this iter 81 record.

Stage Summary:
- **useDashboardData Stage 1 (useFlipperBackend hook extraction) — DONE.** New hook `src/hooks/use-flipper-backend.ts` (132 lines) is the single source of truth for dashboard-level flipper backend status. `dashboard-page.tsx` is now 1197 lines (was 1232, was 1685 in iter 70). Zero behavior change — same query keys, same polling intervals, same derived flag logic, same downstream prop names.
- **F1 (additional RU translations) — STILL BLOCKED.** No change from iter 80 — needs live poe2scout.com + poe2db.tw/ru/ access.
- **Baseline:** jest 422 pass (unchanged from iter 80), tsc 0 errors, next build OK.
- **Files changed/created (5 total):**
  - `src/hooks/use-flipper-backend.ts` (NEW, 132 lines)
  - `src/components/dashboard/dashboard-page.tsx` (modified: −35 lines net — replaced inline block with hook call, removed 3 unused type imports)
  - `STATUS.md` (updated — iter 81 stamp, Stage 1 noted, 1 new Quick Reference)
  - `PRODUCT_VISION.md` (updated — iter 81 stamp, Stage 1 noted in DoD paragraph)
  - `AGENT_NAVIGATION.md` (updated — iter 81 stamp, dashboard-page.tsx row updated, hooks count 14→15, new use-flipper-backend.ts row, invariant #34 added, stale worklog note fixed, worklog added to doc map)
  - `worklog.md` (this record)

Next iteration (iter 82) — recommended priorities:
1. **F1 (when live API available)** — `scripts/sync_currency_names_from_poe2db.py`: enumerate 625 api_ids, fetch poe2db.tw/ru/, update `currency_names.json`, bump assertion counters in `tests/test_currency_names_ru.py`. Still the only blocked feature.
2. **useDashboardData Stage 2** (optional tech debt) — extract realms/leagues queries + `effectiveLeague` memo into `useRealmsAndLeagues()` hook. Riskier than Stage 1 because of the auto-select useEffect + persistLeague coupling. Verify tsc + jest after.
3. **useDashboardData Stage 3** (optional tech debt) — extract derived memos (exchangePairs filter, optimalPayment merge, optimalPaymentByDisplayName, currencyCategories, uniqueCategoriesList) into `useDerivedExchangeData()` hook. Highest interdependency risk — break into 2 sub-stages if needed.
4. **Full Content Pulse tab** — F4 widget is the MVP; full version with sorting/filters/drill-down if widget proves useful.
5. **Phase hints enhancements** (optional) — pull hints from `config.yaml` instead of hardcoding; add per-pattern metrics by cross-referencing the snapshot's `price_histories`; filter hints based on actual market state.
6. **Visual verification with real backend data** — manual verification of the backtest panel against real snapshot data needs a running backend with ≥21d of price_logs collected.
7. **e2e tests** (optional) — frontend is covered by jest; e2e would require running backend + browser.

NOT done in iter 81 (intentionally deferred):
- F1 (blocked on live API access)
- useDashboardData Stage 2 (realms/leagues extraction) — deferred to iter 82+ to keep this iter small and reviewable
- useDashboardData Stage 3 (derived memos extraction) — deferred to iter 83+ for the same reason
- Full Content Pulse tab (the F4 widget is the MVP; full tab deferred until product feedback)
- Phase hints enhancements (hardcoded MVP shipped — config-driven hints + per-pattern metrics deferred)
- e2e tests not run (frontend changes are unit-tested via jest; e2e would require running backend + browser)
- Visual verification with real backend data (jest tests use mocked data; manual verification needs a running backend with ≥21d of price_logs collected)

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

- Documentation updates:
  - `STATUS.md`: bumped "Last updated" to iter 82. Rewrote the technical-debt backlog paragraph: updated line count (1197→1169), noted Stage 2 shipped iter 82 (with the new hook file path), updated remaining work (only Stage 3 left). Added 1 new Quick Reference entry (realm/league data or selection → useRealmsAndLeagues hook).
  - `PRODUCT_VISION.md`: bumped "Last updated" to iter 82. Updated final DoD paragraph to mention "Stage 1 выполнен в iter 81, Stage 2 выполнен в iter 82, остался 1 stage".
  - `AGENT_NAVIGATION.md`: bumped "Last updated" to iter 82. Updated `dashboard-page.tsx` row in §1 (1197→1169 lines, "Stages 1-2 done iter 81-82"). Bumped `src/hooks/` count from 15 to 16. Added new §1 module row for `use-realms-and-leagues.ts` with full description (single source of truth, owns realm+league state, setRealm clears league, setLeague persists to store, effectiveLeague fallback chain, auto-select useEffect, inline useQuery forbidden). Updated "dashboard-page.tsx still 1169 lines" Quick Reference entry. Added invariant #35 (`useRealmsAndLeagues` is the single source of truth for realm/league selection + queries — documents the hook contract, what's exposed, what's NOT to be done inline, and notes Stage 3 still pending). Updated invariant #34 to point to invariant #35 for the remaining stages.
  - `worklog.md`: trimmed iter 77-79 records (F5 live + F6 phase hints + F5 backtest backend — all fully shipped and documented in PRODUCT_VISION.md/STATUS.md). Kept iter 80 (F5 backtest UI — recent F5 context) + iter 81 (Stage 1 — directly precedes this iter) + this iter 82 record.

Stage Summary:
- **useDashboardData Stage 2 (useRealmsAndLeagues hook extraction) — DONE.** New hook `src/hooks/use-realms-and-leagues.ts` (163 lines) is the single source of truth for realm/league selection and the two dropdown-populating queries. `dashboard-page.tsx` is now 1169 lines (was 1197, was 1232 in iter 80, was 1685 in iter 70). Zero behavior change — same query keys, same polling intervals, same effectiveLeague fallback chain, same auto-select useEffect logic, same setRealm/setLeague wrappers (just centralized).
- **F1 (additional RU translations) — STILL BLOCKED.** No change from iter 81 — needs live poe2scout.com + poe2db.tw/ru/ access.
- **Baseline:** jest 422 pass (unchanged from iter 81), tsc 0 errors, next build OK.
- **Files changed/created (5 total):**
  - `src/hooks/use-realms-and-leagues.ts` (NEW, 163 lines)
  - `src/components/dashboard/dashboard-page.tsx` (modified: −28 lines net — replaced inline block with hook call, removed 2 unused type imports, removed persistLeague from store destructuring)
  - `STATUS.md` (updated — iter 82 stamp, Stage 2 noted, 1 new Quick Reference)
  - `PRODUCT_VISION.md` (updated — iter 82 stamp, Stage 2 noted in DoD paragraph)
  - `AGENT_NAVIGATION.md` (updated — iter 82 stamp, dashboard-page.tsx row updated, hooks count 15→16, new use-realms-and-leagues.ts row, invariant #35 added, invariant #34 updated, Quick Reference entry updated)
  - `worklog.md` (this record + iter 77-79 trim)

Next iteration (iter 83) — recommended priorities:
1. **F1 (when live API available)** — `scripts/sync_currency_names_from_poe2db.py`: enumerate 625 api_ids, fetch poe2db.tw/ru/, update `currency_names.json`, bump assertion counters in `tests/test_currency_names_ru.py`. Still the only blocked feature.
2. **useDashboardData Stage 3** (optional tech debt) — extract derived memos into `useDerivedExchangeData()` hook. Highest interdependency risk — `exchangePairs` filter memo depends on `exchangeData` + `search` + `uiState.exchange.*`; `clientOptimalResult` memo depends on `exchangeData` + `crossRates.*`; `optimalPaymentByPair` merge memo depends on `optimalCurrencyData` + `exchangeData` + `clientOptimalResult`; `optimalPaymentByDisplayName` depends on `exchangeData` + `optimalPaymentByPair`; `currencyCategories` + `uniqueCategoriesList` depend on `uniqueCategories` + `t`. Break into 2 sub-stages if needed: (3a) exchangePairs filter + currencyCategories/uniqueCategoriesList; (3b) optimalPayment cluster (clientOptimalResult + merge + byDisplayName). Verify tsc + jest after each sub-stage.
3. **Full Content Pulse tab** — F4 widget is the MVP; full version with sorting/filters/drill-down if widget proves useful.
4. **Phase hints enhancements** (optional) — pull hints from `config.yaml` instead of hardcoding; add per-pattern metrics by cross-referencing the snapshot's `price_histories`; filter hints based on actual market state.
5. **Visual verification with real backend data** — manual verification of the backtest panel against real snapshot data needs a running backend with ≥21d of price_logs collected.
6. **e2e tests** (optional) — frontend is covered by jest; e2e would require running backend + browser.

NOT done in iter 82 (intentionally deferred):
- F1 (blocked on live API access)
- useDashboardData Stage 3 (derived memos extraction) — deferred to iter 83+ to keep this iter small and reviewable. Highest interdependency risk — may need 2 sub-stages.
- Full Content Pulse tab (the F4 widget is the MVP; full tab deferred until product feedback)
- Phase hints enhancements (hardcoded MVP shipped — config-driven hints + per-pattern metrics deferred)
- e2e tests not run (frontend changes are unit-tested via jest; e2e would require running backend + browser)
- Visual verification with real backend data (jest tests use mocked data; manual verification needs a running backend with ≥21d of price_logs collected)
