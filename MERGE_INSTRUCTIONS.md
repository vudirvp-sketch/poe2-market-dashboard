# iter 82 — Merge Instructions

## What's in this archive

Stage 2 of `useDashboardData` hook extraction. Extracts realm/league selection + realms/leagues queries + `effectiveLeague` memo + auto-select useEffect from `dashboard-page.tsx` into a new `useRealmsAndLeagues` hook.

**Files (6 total — 1 new, 5 modified):**

| File | Status | Description |
|------|--------|-------------|
| `src/hooks/use-realms-and-leagues.ts` | NEW (163 lines) | Single source of truth for realm/league state + realms/leagues queries + `effectiveLeague` memo + auto-select useEffect + `setRealm`/`setLeague` wrappers |
| `src/components/dashboard/dashboard-page.tsx` | MODIFIED (−28 lines: 1197→1169) | Removed inline realm/league state + 2 useQuery + effectiveLeague memo + setLeague wrapper + auto-select useEffect; replaced with hook call |
| `STATUS.md` | UPDATED | iter 82 stamp, Stage 2 noted in tech-debt paragraph, 1 new Quick Reference entry |
| `PRODUCT_VISION.md` | UPDATED | iter 82 stamp, DoD paragraph notes Stage 2 done |
| `AGENT_NAVIGATION.md` | UPDATED | iter 82 stamp, dashboard-page.tsx row updated, hooks count 15→16, new use-realms-and-leagues.ts row, invariant #35 added, Quick Reference entry updated |
| `worklog.md` | UPDATED | iter 82 record appended, iter 77-79 records trimmed (fully-shipped features) |

## How to merge

This archive preserves the original folder structure. To merge with your local clone:

```bash
# From the root of your local poe2-market-dashboard clone:
unzip iter82.zip -d /tmp/iter82
cp /tmp/iter82/src/hooks/use-realms-and-leagues.ts src/hooks/
cp /tmp/iter82/src/components/dashboard/dashboard-page.tsx src/components/dashboard/
cp /tmp/iter82/STATUS.md .
cp /tmp/iter82/PRODUCT_VISION.md .
cp /tmp/iter82/AGENT_NAVIGATION.md .
cp /tmp/iter82/worklog.md .

# Verify no behavior regression
npx tsc --noEmit           # 0 errors
npx jest                   # 422 pass / 0 fail
npx next build             # compiles successfully
```

## Behavior change

**None.** Same query keys, same polling intervals, same `effectiveLeague` fallback chain, same auto-select useEffect logic, same `setRealm`/`setLeague` wrappers (just centralized in the hook).

The only behavioral note: `setRealm` (exposed from the hook) now also clears the league. Previously this was done at the call site (`setRealm(v); setLeague("")`). The hook centralizes this so the parent doesn't have to remember to clear the league. The `Header onRealmChange` callback was simplified from `(v) => { setRealm(v); setLeague("") }` to just `setRealm`.

## Verification results

- `tsc --noEmit` → 0 errors
- `jest` (full suite, 20 test suites) → **422 pass** / 0 fail (~5.8s)
- `next build` → "✓ Compiled successfully in 4.5s" (1 pre-existing Turbopack warning, unrelated)
- `wc -l src/components/dashboard/dashboard-page.tsx` → 1169 lines (was 1197)

## Stop point for next iteration (iter 83)

**Done in iter 82:**
- useDashboardData Stage 2 extraction (`useRealmsAndLeagues` hook)
- Documentation updates (STATUS / PRODUCT_VISION / AGENT_NAVIGATION / worklog)
- worklog trim (iter 77-79 removed — fully shipped features)

**Not done (intentionally deferred):**
- F1 — still blocked on live poe2scout.com + poe2db.tw/ru/ API access
- useDashboardData Stage 3 — derived memos extraction (exchangePairs filter, optimalPayment merge, optimalPaymentByDisplayName, currencyCategories, uniqueCategoriesList). Highest interdependency risk — break into 2 sub-stages if needed.
- Full Content Pulse tab — F4 widget is the MVP; full version deferred until product feedback
- Phase hints enhancements — hardcoded MVP shipped; config-driven hints deferred
- e2e tests — frontend covered by jest; e2e requires running backend + browser
- Visual verification with real backend data — needs ≥21d accumulated price_logs in live league

**Recommended priorities for iter 83:**
1. F1 (when live API available) — `scripts/sync_currency_names_from_poe2db.py`
2. useDashboardData Stage 3 (optional tech debt) — `useDerivedExchangeData()` hook. Sub-stages: (3a) exchangePairs filter + currencyCategories/uniqueCategoriesList; (3b) optimalPayment cluster (clientOptimalResult + merge + byDisplayName)
3. Full Content Pulse tab — if F4 widget proves useful
4. Phase hints enhancements (optional)
5. Visual verification backtest panel with real backend data
6. e2e tests (optional)
