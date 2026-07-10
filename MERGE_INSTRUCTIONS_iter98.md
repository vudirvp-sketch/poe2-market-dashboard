# MERGE_INSTRUCTIONS_iter98.md — Intraday Patterns API + UI wire-up (P4)

> **Archive:** `iter98_intraday_patterns.tar.gz`
> **Iteration:** 98
> **Feature:** P4 — Time-of-day pattern detector (UTC hour × currency heatmap)
> **Status:** ✅ Complete. All tests green (963 pytest + 475 jest + tsc).

## Quick summary

This iteration adds a new "Intraday Patterns" tab to the dashboard. For each currency, it aggregates `price_logs` by UTC hour (0..23) over a configurable lookback window (default 14 days), then identifies:
- **Buy window** = hour with the lowest mean price (canonical: Asia-wake hours, when farmers dump loot → supply spike → prices fall).
- **Sell window** = hour with the highest mean price (canonical: US/EU-wake hours, when demand spikes → prices rise).
- **Significance flag** = `intraday_range_pct >= 10%` (|sell_mean − buy_mean| / overall_mean × 100).

The UI renders a **heatmap** (rows = currencies, columns = UTC hours 0..23) using dependency-free CSS divs (no recharts — keeps the bundle lean). Cell color encodes deviation from the currency's overall mean: emerald = below mean (buy zone), red = above mean (sell zone), muted = neutral/no data. Buy/sell window cells are highlighted with colored rings.

## Files in this archive

### New files (7)

| Path | Purpose |
|------|---------|
| `backend/economy/intraday_patterns.py` | Pure function `compute_intraday_patterns()`. 89 tunable thresholds + helpers. No side effects. |
| `backend/api/routes_intraday_patterns.py` | Thin FastAPI wrapper. `GET /api/v1/intraday-patterns?days=14&limit=50`. |
| `tests/test_intraday_patterns.py` | 89 pytest tests (10 test classes covering pure helpers + end-to-end + 4 route smoke tests). |
| `src/app/api/flipper/intraday-patterns/route.ts` | Next.js proxy route. Forwards to `/api/v1/intraday-patterns`. |
| `src/components/dashboard/intraday-patterns-tab.tsx` | UI tab with heatmap (час × валюта), buy/sell badges, significant-only filter, days selector, hour axis, legend. |
| `src/__tests__/intraday-patterns-tab.test.tsx` | 23 jest tests (offline/loading/error/no-data/heatmap/24-cells/buy-sell-badges/significant-badge/filter/days-selector/legend/etc.). |
| `git_commands_iter98.txt` | Git add/commit/push commands for this iteration. |

### Modified files (10)

| Path | Change |
|------|--------|
| `backend/api/response_models.py` | +3 Pydantic models (`IntradayHourlyStat`, `IntradayPatternData`, `IntradayPatternsResponse`) after `CircuitPatternsResponse`. |
| `backend/main.py` | +`try/except ImportError` wrapper for `intraday_patterns_router` (after `circuit_patterns_router`). |
| `src/lib/types.ts` | +3 TS interfaces (`IntradayHourlyStat`, `IntradayPattern`, `IntradayPatternsResponse`) after `CircuitPatternsResponse`. |
| `src/components/dashboard/dashboard-page.tsx` | +`IntradayPatternsTab` dynamic import, +`"intraday-patterns"` in `TAB_MAP` at idx 10, +`<TabsContent value="intraday-patterns">` with ErrorBoundary. |
| `src/components/dashboard/dashboard-toolbar.tsx` | +`Clock` icon import, +`<TabsTrigger value="intraday-patterns">` between Circuit Patterns and Liquid Chain. |
| `src/components/dashboard/shortcuts-dialog.tsx` | Comment block update (Intraday Patterns is click-only, idx 10). |
| `src/lib/i18n/locales/en.ts` | +43 intraday* keys at end of file. |
| `src/lib/i18n/locales/ru.ts` | +43 intraday* keys at end of file. |
| `src/lib/i18n/locales/zh.ts` | +43 intraday* keys at end of file. |
| `src/lib/i18n/locales/ko.ts` | +43 intraday* keys at end of file. |

### Documentation updates (4)

| Path | Change |
|------|--------|
| `STATUS.md` | +P4 row in Product Features table, +2 Quick Reference rows (heatmap "No data" cells + intraday tab not keyboard-reachable). |
| `docs/MARKET_PLAYBOOK.md` | P4 row marked Done in §B table, summary counts updated, §C.3 marked DONE with full implementation report, §D.2 added Status column, §D.3 stopping point updated to iter 98, §E doc references updated. |
| `AGENT_NAVIGATION.md` | Header note refreshed, +3 new entries (intraday_patterns.py + routes_intraday_patterns.py + intraday-patterns-tab.tsx), +1 API endpoint row, trimmed iter 97 invariant #46 to lean summary, +new invariant #47. |
| `worklog.md` | +iter-98 entry (Task ID, Work Log, Stage Summary). |

## How to merge

### Option A: Extract over your local working copy (recommended)

```bash
# From your local repo root (where STATUS.md lives):
tar -xzf iter98_intraday_patterns.tar.gz

# This will overwrite the 10 modified files and create the 7 new files
# in-place. Your git diff will show all iter 98 changes.

# Verify nothing unexpected was overwritten:
git status
git diff --stat
```

### Option B: Extract to a staging dir and diff first

```bash
mkdir -p /tmp/iter98-staging
tar -xzf iter98_intraday_patterns.tar.gz -C /tmp/iter98-staging

# Diff each modified file against your local copy:
diff -u backend/api/response_models.py /tmp/iter98-staging/backend/api/response_models.py
# (repeat for each modified file)

# Once satisfied, copy the files over:
cp -r /tmp/iter98-staging/* .
```

## Post-merge verification

```bash
# 1. Python tests (should be 963 passed, including 89 new in test_intraday_patterns.py)
python -m pytest tests/ --ignore=tests/test_scheduler.py -q

# 2. Jest tests (should be 475 passed, including 23 new in intraday-patterns-tab.test.tsx)
npx jest --silent

# 3. TypeScript type check (should be 0 errors)
NODE_OPTIONS="--max-old-space-size=2048" npx tsc --noEmit

# 4. (Optional) Verify the new backend route is registered
python -c "from backend.main import app; routes = [r.path for r in app.routes]; print('/api/v1/intraday-patterns' in routes)"
# Expected output: True
```

## Git commands

See `git_commands_iter98.txt` for the exact `git add` / `git commit` / `git push` commands.

## Behavioral change to note

Tab count grew to **13**. The TAB_MAP is now:

```
["overview", "currencies", "uniques", "exchange", "flips", "optimizer",
 "analyst", "storage-value", "speculation", "circuit-patterns",
 "intraday-patterns", "liquid-chain", "watchlist"]
  idx 0       1           2        3          4       5          6       7            8            9                  10                 11             12
```

Keyboard shortcuts 1-9 + 0 still map to the first 10 tabs (overview through circuit-patterns). The new "Intraday Patterns" tab (idx 10), Liquid Chain (idx 11), and Watchlist (idx 12) are **click-only** — there are only 10 shortcut slots (1-9 + 0). This is documented in:
- `dashboard-page.tsx:TAB_MAP` comment block
- `shortcuts-dialog.tsx` comment block
- `STATUS.md` Quick Reference — Frequent Problems table

## Stopping point for iter 99

**What's done (iter 98):**
- P4 Time-of-day pattern detector — full wire-up (pure function + API + proxy + UI heatmap + i18n × 4 + tests).
- 963 pytest + 475 jest + tsc — all green.

**What's NOT done (for iter 99):**
- P5 Weekday/weekend pattern detector — pure function `compute_weekly_patterns(snapshot, config, weeks=4)` + UI (день недели × валюта). Spec in `docs/MARKET_PLAYBOOK.md` §C.4. Same wire-up pattern as iter 98 (routes_weekly_patterns.py + response models + Next.js proxy + TS types + UI tab + i18n × 4 + jest + pytest).
- P3 Leveling uniques lifecycle — виджет на Overview. Spec in §C.5.

**Recommended next steps (iter 99):**
1. Read `docs/MARKET_PLAYBOOK.md` §C.4 (spec for iter 99).
2. Follow the iter 98 pattern: create `weekly_patterns.py` + `routes_weekly_patterns.py` + `weekly-patterns-tab.tsx` by analogy with the intraday files.
3. For UI: reuse the heatmap component pattern (rows = currencies, cols = 7 weekdays Mon-Sun instead of 24 hours). Cell color logic stays the same (deviation from overall mean).
4. Run tsc + jest + pytest regression checks.
5. Update docs (STATUS.md, MARKET_PLAYBOOK.md §C.4 DONE, §D.3 iter 99 stopping point, AGENT_NAVIGATION.md, worklog.md).
