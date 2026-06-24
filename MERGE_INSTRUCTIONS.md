# Iter 73 — Merge Instructions

## Summary

Closes **2 backlog items** in one iteration:

- **P2-1 — `dashboard-page.tsx` god-component split** (closed). Step 4 of the multi-iter split: extracted two more presentational components:
  - `DashboardToolbar` (227 lines) — TabsList + 4 action buttons (keyboard shortcuts / price alerts / item comparison / pair comparison) + category-filter chip strip.
  - `DashboardDialogs` (168 lines) — 8 dialog/sheet/banner wrappers (DetailDialog, PairDetailDialog, ComparisonDialog, PairComparisonDialog, PriceAlertDialog, EventsSidebar, OfflineBanner, ShortcutsDialog).
  - `dashboard-page.tsx`: **1370 → 1201 lines** (-169). Cumulative iter 71-73: 1685 → 1201 (-484).
  - Cleanup: removed 14 unused imports (lucide icons, TabsList/TabsTrigger, Badge, Button, 6 dialog components, EventsSidebar, OfflineBanner).
  - `useDashboardData` hook extraction **deferred to iter 74** — the ~250 lines of `useQuery`/memo wiring have deep interdependencies with store state and would risk breakage in a single iter (per "Лучше недоделать, чем сломать" rule).
- **P3-7 — Delete `REFACTOR_PLAN.md` + `worklog.md`** (closed). All P2/P3 issues are now closed → these scratch-pad docs are no longer needed. Updated references in `README.md`, `PRODUCT_VISION.md`, `AGENT_NAVIGATION.md` §6.

After iter 73: **P0=0, P1=0, P2=0, P3=0, P4=0.** All technical-debt backlog items are closed. The project switches to product features (F1-F6 in `PRODUCT_VISION.md`).

- **2** files deleted (`REFACTOR_PLAN.md`, `worklog.md`)
- **2** new component files (`src/components/dashboard/dashboard-toolbar.tsx`, `src/components/dashboard/dashboard-dialogs.tsx`)
- **5** files modified (`src/components/dashboard/dashboard-page.tsx`, `STATUS.md`, `AGENT_NAVIGATION.md`, `README.md`, `PRODUCT_VISION.md`)
- **0** new Known Issues — all tests pass

## What's in this archive

```
iter73/
├── MERGE_INSTRUCTIONS.md                                          ← this file
├── STATUS.md                                                      ← updated (P2-1 + P3-7 moved to Fixed; iter 73 entry added; quick-ref table trimmed)
├── AGENT_NAVIGATION.md                                            ← updated (header date iter 73; §1 dashboard-page.tsx row updated to 1201 lines; 2 new rows for DashboardToolbar + DashboardDialogs; §6 doc map: REFACTOR_PLAN.md + worklog.md rows removed)
├── README.md                                                      ← updated (doc table trimmed; iter 73 state; baseline counts updated)
├── PRODUCT_VISION.md                                              ← updated (related-docs list: REFACTOR_PLAN.md line removed)
└── src/
    └── components/
        └── dashboard/
            ├── dashboard-page.tsx                                  ← modified (-169 lines; toolbar + dialogs JSX extracted; 14 unused imports removed)
            ├── dashboard-toolbar.tsx                               ← NEW (227 lines)
            └── dashboard-dialogs.tsx                               ← NEW (168 lines)
```

## How to apply

Run from the root of your local `poe2-market-dashboard` checkout (must be on `main` branch, up-to-date with `origin/main` after iter 72 was merged).

```bash
# 1. Extract this archive into a temp location
#    Example (if iter73.zip is in ~/Downloads):
unzip ~/Downloads/iter73.zip -d /tmp/iter73

# 2. Copy the modified docs into the repo root
cp /tmp/iter73/iter73/STATUS.md             ./STATUS.md
cp /tmp/iter73/iter73/AGENT_NAVIGATION.md   ./AGENT_NAVIGATION.md
cp /tmp/iter73/iter73/MERGE_INSTRUCTIONS.md ./MERGE_INSTRUCTIONS.md
cp /tmp/iter73/iter73/README.md             ./README.md
cp /tmp/iter73/iter73/PRODUCT_VISION.md     ./PRODUCT_VISION.md

# 3. Copy the modified dashboard component (preserving folder structure)
cp /tmp/iter73/iter73/src/components/dashboard/dashboard-page.tsx     ./src/components/dashboard/dashboard-page.tsx

# 4. Copy the new extracted components (preserving folder structure)
cp /tmp/iter73/iter73/src/components/dashboard/dashboard-toolbar.tsx  ./src/components/dashboard/dashboard-toolbar.tsx
cp /tmp/iter73/iter73/src/components/dashboard/dashboard-dialogs.tsx ./src/components/dashboard/dashboard-dialogs.tsx

# 5. DELETE the obsolete scratch-pad docs (P3-7)
git rm REFACTOR_PLAN.md worklog.md

# 6. Verify
npx tsc --noEmit                                       # should print nothing (0 errors)
npx jest                                               # should report 324 pass / 14 suites (unchanged)
git status                                             # should show 5 modified + 2 new + 2 deleted files

# 7. Commit + push (single commit)
git add -A
git commit -m "refactor(iter-73): P2-1 step 4 — extract DashboardToolbar + DashboardDialogs; close P2-1 + P3-7"
git push origin main
```

## Verification (already done in agent environment)

| Check | Before iter 73 | After iter 73 |
|------|----------------|---------------|
| `wc -l src/components/dashboard/dashboard-page.tsx` | 1370 lines | **1201 lines** (-169) ✓ |
| `ls src/components/dashboard/dashboard-toolbar.tsx` | file missing | **227 lines** ✓ |
| `ls src/components/dashboard/dashboard-dialogs.tsx` | file missing | **168 lines** ✓ |
| `ls REFACTOR_PLAN.md worklog.md` | both present | **both deleted** (P3-7) ✓ |
| `npx tsc --noEmit` | 0 errors | **0 errors** (unchanged) ✓ |
| `npx jest` | 324 pass / 14 suites | **324 pass / 14 suites** (unchanged) ✓ |

## Stop point — next iteration (iter 74)

After iter 73: **P0=0, P1=0, P2=0, P3=0, P4=0.** Technical-debt backlog is fully closed.

Recommended for iter 74+ — product features from `PRODUCT_VISION.md`:

1. **F1** — Translate remaining ~276 items (parse `poe2db.tw/ru/`).
2. **F2** — Storage Value UI tab (backend endpoint `/api/v1/storage-value/{currency}` already ready).
3. **F3-F6** — `content_pulse` module, "Что фармить сегодня" widget, speculation tab with z-score BUY/SELL/HOLD, phase-aware hints.

Optional technical follow-up (not blocking):
- **`useDashboardData` hook extraction** — pull the ~250 lines of `useQuery`/memo wiring out of `dashboard-page.tsx` into a custom hook. Would bring `dashboard-page.tsx` closer to the original ≤700-line target. Risk: medium — many interdependencies between queries, memos, and store state. Approach: extract in stages (1. flipperBackend queries, 2. realms/leagues queries, 3. derived memos), verify build+tests after each stage.

Suggested commit for iter 74: `feat(F1): translate <N> more items from poe2db.tw/ru/`

## Git commands (single commit)

```bash
git add -A
git commit -m "refactor(iter-73): P2-1 step 4 — extract DashboardToolbar + DashboardDialogs; close P2-1 + P3-7

P2-1 step 4a — DashboardToolbar extracted (227 lines):
  - TabsList (10 tabs) + action buttons (shortcuts, alerts, comparison, pair-comparison)
  - Category-filter chip strip for currencies/uniques tabs
  - Pure presentational — all state passed in as props
  - dashboard-page.tsx: 1370 → 1247 (-123)

P2-1 step 4b — DashboardDialogs extracted (168 lines):
  - 8 dialog/sheet/banner wrappers (DetailDialog, PairDetailDialog,
    ComparisonDialog, PairComparisonDialog, PriceAlertDialog,
    EventsSidebar, OfflineBanner, ShortcutsDialog)
  - Pure presentational — open/close flags + data passed in as props
  - dashboard-page.tsx: 1247 → 1201 (-46)

P2-1 step 4c — useDashboardData hook extraction DEFERRED to iter 74.
  The ~250 lines of useQuery/memo wiring have deep interdependencies
  with store state (exchangePairs memo, clientOptimalResult memo,
  optimalPaymentByPair memo) — extracting in a single iter would risk
  breakage. Per 'Лучше недоделать, чем сломать' rule, deferred.

Import cleanup — removed 14 unused imports from dashboard-page.tsx:
  - 13 lucide icons (Coins, Shield, ArrowLeftRight, Star, BarChart3,
    GitCompare, Bell, TrendingUp, Route, Network, Keyboard, LineChart,
    Droplets) — moved into dashboard-toolbar.tsx
  - TabsList, TabsTrigger — only used inside DashboardToolbar now
  - Badge — only used in category chips inside DashboardToolbar
  - Button — only used in toolbar action buttons
  - DetailDialog, PairDetailDialog, ComparisonDialog,
    PairComparisonDialog, PriceAlertDialog, ShortcutsDialog,
    EventsSidebar, OfflineBanner — moved into dashboard-dialogs.tsx

P2-1 closed. dashboard-page.tsx 1685 → 1201 lines over iter 71-73.
Cumulative extractions: ExchangeTabContent, CurrenciesTabContent,
UniquesTabContent, OverviewTabContent, DashboardToolbar, DashboardDialogs.

P3-7 closed. REFACTOR_PLAN.md + worklog.md deleted — all P2/P3 issues
are now closed so the scratch-pad docs are no longer needed. Updated
references in README.md, PRODUCT_VISION.md, AGENT_NAVIGATION.md §6.

Baseline: jest 324 pass (unchanged — pure presentational refactor +
doc cleanup), tsc 0 errors (unchanged). pytest + e2e not re-run
(frontend-only changes)."

git push origin main
```
