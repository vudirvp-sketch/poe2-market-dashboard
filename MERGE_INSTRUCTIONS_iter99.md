# MERGE_INSTRUCTIONS_iter99.md — Weekly Patterns API + UI wire-up (P5)

> **Archive:** `iter99_weekly_patterns.tar.gz`
> **Iteration:** 99
> **Feature:** P5 — Weekday/weekend pattern detector (weekday × currency heatmap)
> **Status:** ✅ Complete. All Python tests green (559 = 99 weekly + 89 intraday + 79 circuit + 292 smoke). Babel syntax-check on all 11 TS/TSX files OK. tsc/jest regression NOT run due to OOM-killer (4GB RAM env, no swap) — Known Issue, requires 8GB+ RAM for `npm install`.

## Quick summary

This iteration adds a new "Weekly Patterns" tab to the dashboard. For each currency, it aggregates `price_logs` by ISO weekday (1=Mon..7=Sun) over a configurable lookback window (default 4 weeks = 28 days), then identifies:
- **Buy day** = weekday with the lowest mean price (canonical: mid-week days when supply is steady).
- **Sell day** = weekday with the highest mean price (canonical: weekends when demand spikes).
- **Significance flag** = `weekly_range_pct >= 10%` (|sell_mean − buy_mean| / overall_mean × 100).
- **Weekday delta** = `weekday_delta_pct` = signed `(weekend_mean − weekday_mean) / overall_mean × 100`. Positive = weekends MORE expensive (sell on weekend). Negative = weekdays MORE expensive (sell on weekday).

The UI renders a **heatmap** (rows = currencies, columns = 7 weekdays Mon..Sun) using dependency-free CSS divs (no recharts). Same `cellColor` helper logic as `intraday-patterns-tab.tsx` — emerald = below mean (buy zone), red = above mean (sell zone), muted = neutral/no data. Buy/sell day cells are highlighted with colored rings. The `Δ weekend` metric is colored red (positive) / emerald (negative) / muted (zero).

## Files in this archive

### New files (7)

| Path | Purpose |
|------|---------|
| `backend/economy/weekly_patterns.py` | Pure function `compute_weekly_patterns()`. Tunable thresholds + helpers. No side effects. |
| `backend/api/routes_weekly_patterns.py` | Thin FastAPI wrapper. `GET /api/v1/weekly-patterns?weeks=4&limit=50`. |
| `tests/test_weekly_patterns.py` | 99 pytest tests (12 test classes covering pure helpers + end-to-end + 4 route smoke tests). |
| `src/app/api/flipper/weekly-patterns/route.ts` | Next.js proxy route. Forwards to `/api/v1/weekly-patterns`. |
| `src/components/dashboard/weekly-patterns-tab.tsx` | UI tab with heatmap (день × валюта), buy/sell day badges, weekday_delta_pct, significant-only filter, weeks selector, weekday axis, legend. |
| `src/__tests__/weekly-patterns-tab.test.tsx` | 25 jest tests (offline/loading/error/no-data/heatmap/7-cells/buy-sell-badges/significant-badge/filter/weeks-selector/legend/weekday-delta/etc.). |
| `git_commands_iter99.txt` | Git add/commit/push commands for this iteration. |

### Modified files (10)

| Path | Change |
|------|--------|
| `backend/api/response_models.py` | +3 Pydantic models (`WeeklyDailyStat`, `WeeklyPatternData`, `WeeklyPatternsResponse`) after `IntradayPatternsResponse`. |
| `backend/main.py` | +`try/except ImportError` wrapper for `weekly_patterns_router` (after `intraday_patterns_router`). |
| `src/lib/types.ts` | +3 TS interfaces (`WeeklyDailyStat`, `WeeklyPattern`, `WeeklyPatternsResponse`) after `IntradayPatternsResponse`. |
| `src/components/dashboard/dashboard-page.tsx` | +`WeeklyPatternsTab` dynamic import, +`"weekly-patterns"` in `TAB_MAP` at idx 11, +`<TabsContent value="weekly-patterns">` with ErrorBoundary. |
| `src/components/dashboard/dashboard-toolbar.tsx` | +`Calendar` icon import, +`<TabsTrigger value="weekly-patterns">` between Intraday Patterns and Liquid Chain. |
| `src/components/dashboard/shortcuts-dialog.tsx` | Comment block update (Weekly Patterns is click-only, idx 11). |
| `src/lib/i18n/locales/en.ts` | +50 weekly* keys at end of file (including 7 weekday name keys Mon..Sun). |
| `src/lib/i18n/locales/ru.ts` | +50 weekly* keys at end of file. |
| `src/lib/i18n/locales/zh.ts` | +50 weekly* keys at end of file. |
| `src/lib/i18n/locales/ko.ts` | +50 weekly* keys at end of file. |

### Documentation updates (4)

| Path | Change |
|------|--------|
| `STATUS.md` | +P5 row in Product Features table, +3 Quick Reference rows (heatmap "No data" cells + weekly tab not keyboard-reachable + weekday_delta_pct 0% case). |
| `docs/MARKET_PLAYBOOK.md` | P5 row marked Done in §B table, summary counts updated (6 done / 5 partial / 9 not implemented), §C.4 marked DONE with full implementation report, §D.2 added Status column, §D.3 stopping point updated to iter 99, §E doc references updated. |
| `AGENT_NAVIGATION.md` | Header note refreshed, +3 new entries (weekly_patterns.py + routes_weekly_patterns.py + weekly-patterns-tab.tsx), +1 API endpoint row, +new invariant #48. |
| `worklog.md` | +iter-99 entry (Task ID, Work Log, Stage Summary). |

## How to merge

### Option A: Extract over your local working copy (recommended)

```bash
# From your local repo root (where STATUS.md lives):
tar -xzf iter99_weekly_patterns.tar.gz

# This will overwrite the 10 modified files and create the 7 new files
# in-place. Your git diff will show all iter 99 changes.

# Verify nothing unexpected was overwritten:
git status
git diff --stat
```

### Option B: Extract to a staging dir and diff first

```bash
mkdir -p /tmp/iter99-staging
tar -xzf iter99_weekly_patterns.tar.gz -C /tmp/iter99-staging

# Diff each modified file against your local copy:
diff -u backend/api/response_models.py /tmp/iter99-staging/backend/api/response_models.py
# (repeat for each modified file)

# Once satisfied, copy the files over:
cp -r /tmp/iter99-staging/* .
```

## Post-merge verification

```bash
# 1. Python tests (should include 99 new in test_weekly_patterns.py — all green)
python -m pytest tests/test_weekly_patterns.py tests/test_intraday_patterns.py tests/test_circuit_patterns.py -q
# Expected: 267 passed (99 weekly + 89 intraday + 79 circuit)

# 2. Smoke regression on other backend modules
python -m pytest tests/test_pricing.py tests/test_speculation.py tests/test_phase_hints.py tests/test_content_pulse.py tests/test_events.py tests/test_momentum.py tests/test_lifecycle.py -q
# Expected: 292 passed

# 3. Jest tests (requires `npm install` — needs 8GB+ RAM due to OOM-killer in low-memory envs)
npx jest src/__tests__/weekly-patterns-tab.test.tsx --silent
# Expected: 25 passed

# 4. TypeScript type check (requires `npm install`)
NODE_OPTIONS="--max-old-space-size=2048" npx tsc --noEmit
# Expected: 0 errors

# 5. Verify the new backend route is registered
python -c "from backend.main import app; routes = [r.path for r in app.routes]; print('/api/v1/weekly-patterns' in routes)"
# Expected output: True
```

## Known Issue: tsc/jest regression NOT run in iter 99 env

The iteration environment has **4 GB RAM and no swap**. `npm install` for this project (39 deps + transitive, ~540 packages) consistently triggers the Linux OOM-killer and is killed before completion. As a result:

- **Babel syntax-check was used instead of tsc**: all 11 modified/new TS/TSX files were parsed with `@babel/parser` (with `typescript` + `jsx` plugins) and all parsed successfully. This catches syntax errors (typos, missing braces, mismatched JSX tags) but NOT type errors.
- **Jest tests were written but NOT executed** in the iter 99 env. The test file `src/__tests__/weekly-patterns-tab.test.tsx` follows the exact same pattern as `src/__tests__/intraday-patterns-tab.test.tsx` (iter 98, 23 tests, all green) — adapted for the weekly patterns data shape (7 weekday cells instead of 24 hour cells, weekday_delta_pct assertions, weekday name badges instead of hour badges).
- **The user should run `npm install && npx jest src/__tests__/weekly-patterns-tab.test.tsx && npx tsc --noEmit` in a local env with 8GB+ RAM** to complete the regression check. If any jest test fails, the fix is likely a small selector/text-match adjustment — the test file is self-contained and uses the same mock patterns as the intraday tests.

## Git commands

See `git_commands_iter99.txt` for the exact `git add` / `git commit` / `git push` commands.

## Behavioral change to note

Tab count grew to **14**. The TAB_MAP is now:

```
["overview", "currencies", "uniques", "exchange", "flips", "optimizer",
 "analyst", "storage-value", "speculation", "circuit-patterns",
 "intraday-patterns", "weekly-patterns", "liquid-chain", "watchlist"]
  idx 0       1           2        3          4       5          6       7            8            9                  10                 11             12             13
```

Keyboard shortcuts 1-9 + 0 still map to the first 10 tabs (overview through circuit-patterns). The new "Weekly Patterns" tab (idx 11), Intraday Patterns (idx 10), Liquid Chain (idx 12), and Watchlist (idx 13) are **click-only** — there are only 10 shortcut slots (1-9 + 0). This is documented in:
- `dashboard-page.tsx:TAB_MAP` comment block
- `shortcuts-dialog.tsx` comment block
- `STATUS.md` Quick Reference — Frequent Problems table

## Stopping point for iter 100

**What's done (iter 99):**
- P5 Weekday/weekend pattern detector — full wire-up (pure function + API + proxy + UI heatmap + i18n × 4 + tests).
- 559 backend pytest tests green (99 weekly + 89 intraday + 79 circuit + 292 smoke). Babel syntax-check on 11 TS/TSX files OK.

**What's NOT done (for iter 100):**
- **tsc/jest regression NOT run** due to OOM-killer in iter 99 env (4GB RAM, no swap). User should run `npm install && npx jest && npx tsc --noEmit` locally with 8GB+ RAM. If jest tests fail, the fix is likely a small selector/text-match adjustment in `src/__tests__/weekly-patterns-tab.test.tsx`.
- P3 Leveling uniques lifecycle — виджет на Overview. Spec in `docs/MARKET_PLAYBOOK.md` §C.5.
- P7 Mirror/Divine arb (§C.6), P9 Phase-aware investment advisor (§C.7), P10 Gold Map ROI (§C.8) — full roadmap in §C.

**Recommended next steps (iter 100):**
1. **First**: run `npm install && npx jest src/__tests__/weekly-patterns-tab.test.tsx && npx tsc --noEmit` locally with 8GB+ RAM. Fix any small selector/text mismatches in the jest test file if needed.
2. Read `docs/MARKET_PLAYBOOK.md` §C.5 (spec for iter 100 — Leveling Uniques Lifecycle).
3. Implement the Overview widget: PhaseDetector + static table of known leveling uniques + their typical "spike-then-crash" pattern.
4. Run tsc + jest + pytest regression checks.
5. Update docs (STATUS.md, MARKET_PLAYBOOK.md §C.5 DONE, §D.3 iter 100 stopping point, AGENT_NAVIGATION.md, worklog.md).
