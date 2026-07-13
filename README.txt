iter-149 — Gold Map ROI (P10) tab deletion patch
=================================================

This archive contains MODIFIED files only. Apply by copying over your local
repository (preserves folder structure). The following files must be DELETED
manually (they are not in this archive because they no longer exist in the
upstream commit):

DELETED FILES (8 total) — run these in your local repo root before `git add`:

  git rm src/components/dashboard/gold-map-roi-tab.tsx
  git rm src/components/dashboard/gold-map-roi-calculator.tsx
  git rm src/components/dashboard/gold-map-roi-trend-chart.tsx
  git rm src/__tests__/gold-map-roi-tab.test.tsx
  git rm src/__tests__/gold-map-roi-calculator.test.ts
  git rm src/__tests__/gold-map-roi-trend-chart.test.tsx
  git rm docs/design/P10-gold-map-roi-design.md
  git rm src/app/api/flipper/triangular/history/route.ts

  # then remove the empty directory:
  rmdir src/app/api/flipper/triangular/history 2>/dev/null || true
  rmdir src/app/api/flipper/triangular 2>/dev/null || true

MODIFIED FILES (15 total) — copied to this archive, apply by overlaying:

  AGENT_NAVIGATION.md
  STATUS.md
  docs/ARCHITECTURE.md
  docs/DATA_CONTRACTS.md
  docs/DATA_FLOW.md
  docs/MARKET_PLAYBOOK.md
  docs/design/TD-3-4-5-9-persistence-gaps-design.md
  src/components/dashboard/dashboard-page.tsx
  src/components/dashboard/dashboard-toolbar.tsx
  src/lib/i18n/locales/en.ts
  src/lib/i18n/locales/ko.ts
  src/lib/i18n/locales/ru.ts
  src/lib/i18n/locales/zh.ts
  src/lib/types.ts
  worklog.md

WHAT WAS KEPT (NOT deleted — has independent value):
  - Backend route /api/v1/arbitrage/triangular/history (TD-3 Phase 3 persistence)
    + its pytest suite in tests/test_triangular_cycles_route.py (13 tests).
  - TS types TriangularCycleHistoryPoint / TriangularCyclesHistoryResponse
    in src/lib/types.ts (describe the backend response shape; comments
    updated to reference the backend route directly).

VERIFICATION (run after applying the patch):
  npx tsc --noEmit                   # → 0 errors
  npx eslint .                       # → 0 errors, 110 warnings (all pre-existing)
  npx jest --silent                  # → 640 passed (was 704; -64 from 3 deleted test files)
  PYTHONPATH=. .venv/bin/python -m pytest tests/ --ignore=tests/e2e
                                     # → 1518 passed (unchanged — no Python changes)
