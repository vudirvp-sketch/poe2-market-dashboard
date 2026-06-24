# Iter 70 — Merge Instructions

## Summary

Closes **1 P2 issue** + adds **1 new product-direction document** in one iteration:

- **P2-3 — `currency_names_ru.py` 966 → 63 lines (move hardcoded dict to JSON).** The four dicts (`CATEGORY_NAMES_RU`, `CATEGORY_NAMES_EN`, `CURRENCY_NAMES_RU`, `CURRENCY_NAMES_EN`) and the four helper functions (`get_ru_name`, `get_en_name`, `get_category_ru`, `get_category_en`) keep the same public API. The existing `routes_arbitrage.py` import (`from backend.data.currency_names_ru import get_ru_name, get_en_name`) is unchanged. Data now lives in `backend/data/currency_names.json` (742 lines, 45 KB — 349 RU + 349 EN entries + 17 category labels per language). +7 pytest regression tests in `tests/test_currency_names_ru.py` cover: dict sizes, helper None-handling, spot-checks on `exalted`/`divine`/`mirror`/`hinekoras-lock`, RU↔EN key parity (so the Python and TS mirrors can't drift silently), category helpers.
- **New file `PRODUCT_VISION.md`** at repo root — captures the user's product vision: analytics helper (NOT a poe2scout / poe2ninja clone), full Russian localization, speculation helper (buy low / sell high), "investment" advice via storage-value vs Mirror of Kalandra / Hinekora's Lock, phase-aware historical patterns (Temporalis cheap at league start → expensive at end, skill stones mid/late league, Ritual omens / Breach catalysts when mechanic turnover drops), content-pulse analytics ("what to farm today" widget). Lists 6 product features (F1-F6) tracked SEPARATELY from the technical-debt backlog in STATUS.md.
- **README.md refreshed** — was stale iter 58 content, now a real project README pointing at PRODUCT_VISION.md / STATUS.md / AGENT_NAVIGATION.md.

After iter 70, **P2 drops 2 → 1** (only P2-1 — `dashboard-page.tsx` god-component split — remains, multi-iter). P0=0, P1=0, P2=1, P3=4.

- **0** files deleted
- **1** new data file (`backend/data/currency_names.json`)
- **1** new test file (`tests/test_currency_names_ru.py`)
- **1** new product-direction doc (`PRODUCT_VISION.md`)
- **6** files modified (`backend/data/currency_names_ru.py`, `STATUS.md`, `REFACTOR_PLAN.md`, `AGENT_NAVIGATION.md`, `worklog.md`, `README.md`)
- **0** new Known Issues — all tests pass

## What's in this archive

```
iter70/
├── MERGE_INSTRUCTIONS.md                                          ← this file
├── STATUS.md                                                      ← updated (P2-3 → Fixed with iter 70 entry; Quick Reference gained "Adding a new Russian translation" row)
├── REFACTOR_PLAN.md                                               ← updated (v33 → v34; iter 70 marked DONE; new principle #7 about data files next to loader; DoD gained data-file regression rule; estimation 1-3 → 2-4 iterations)
├── AGENT_NAVIGATION.md                                            ← updated (header date iter 70 + PRODUCT_VISION.md link; §1 row for currency_names_ru.py → "thin loader"; §3 invariant #24 added for P2-3; §4 P2 count 2 → 1; §4 Quick Reference row updated; §6 doc map gained PRODUCT_VISION.md row)
├── worklog.md                                                     ← updated (Task 70 entry; trimmed to ≤3 latest — Task 67 dropped)
├── README.md                                                      ← refreshed (was stale iter 58 content; now real project README in Russian pointing at PRODUCT_VISION.md / STATUS.md)
├── PRODUCT_VISION.md                                              ← NEW — product direction: analytics helper, NOT a poe2scout/ninja clone; RU localization, speculation, storage-value vs Mirror/Hinekora, content-pulse; lists F1-F6 product features
├── backend/
│   └── data/
│       ├── currency_names.json                                    ← NEW — 349 RU + 349 EN entries + 17 category labels per language (742 lines, 45 KB)
│       └── currency_names_ru.py                                   ← REWRITTEN — 966 → 63 lines, thin loader for the JSON
└── tests/
    └── test_currency_names_ru.py                                  ← NEW — 7 pytest regression tests for P2-3
```

## How to apply

Run from the root of your local `poe2-market-dashboard` checkout (must be on `main` branch, up-to-date with `origin/main` after iter 69 was merged).

```bash
# 1. Extract this archive into a temp location
#    Example (if iter70.zip is in ~/Downloads):
unzip ~/Downloads/iter70.zip -d /tmp/iter70

# 2. Copy the modified docs into the repo root
cp /tmp/iter70/iter70/STATUS.md             ./STATUS.md
cp /tmp/iter70/iter70/REFACTOR_PLAN.md      ./REFACTOR_PLAN.md
cp /tmp/iter70/iter70/AGENT_NAVIGATION.md   ./AGENT_NAVIGATION.md
cp /tmp/iter70/iter70/worklog.md            ./worklog.md
cp /tmp/iter70/iter70/MERGE_INSTRUCTIONS.md ./MERGE_INSTRUCTIONS.md
cp /tmp/iter70/iter70/README.md             ./README.md
cp /tmp/iter70/iter70/PRODUCT_VISION.md     ./PRODUCT_VISION.md

# 3. Copy the modified backend data files (preserving folder structure)
cp /tmp/iter70/iter70/backend/data/currency_names.json   ./backend/data/currency_names.json
cp /tmp/iter70/iter70/backend/data/currency_names_ru.py  ./backend/data/currency_names_ru.py

# 4. Copy the new regression test file (preserving folder structure)
cp /tmp/iter70/iter70/tests/test_currency_names_ru.py    ./tests/test_currency_names_ru.py

# 5. Verify (with aiosqlite + lightgbm installed)
pip install aiosqlite lightgbm                                          # if not already installed
npx tsc --noEmit                                                        # should print nothing (0 errors)
npx jest                                                                # should report 324 pass / 14 suites (unchanged — Python-only change)
PYTHONPATH=. pytest tests/ -q --ignore=tests/e2e                       # should report 466 pass (+7 P2-3 regression tests)
PYTHONPATH=. pytest tests/e2e/ -q -m "not flaky"                       # should report 30 pass
git status                                                              # should show 8 modified + 3 new files

# 6. Commit + push (single commit)
git add -A
git commit -m "refactor(P2-3): move currency_names_ru.py to JSON + add PRODUCT_VISION.md"
git push origin main
```

## Verification (already done in agent environment)

| Check | Before iter 70 | After iter 70 |
|------|----------------|---------------|
| `wc -l backend/data/currency_names_ru.py` | 966 lines | **63 lines** ✓ |
| `ls backend/data/currency_names.json` | file missing | **742 lines, 45 KB** ✓ |
| `PYTHONPATH=. pytest tests/ -q --ignore=tests/e2e` | 459 pass | **466 pass** (+7 P2-3 regression tests) ✓ |
| `PYTHONPATH=. pytest tests/e2e/ -q -m "not flaky"` | 30 pass | **30 pass** (unchanged) ✓ |
| `npx tsc --noEmit` | 0 errors | **0 errors** (unchanged — Python-only change) ✓ |
| `npx jest` | 324 pass / 14 suites | **324 pass / 14 suites** (unchanged — Python-only change) ✓ |
| `grep -c 'CURRENCY_NAMES_RU' backend/data/currency_names_ru.py` | 1 dict literal (442 lines) | **1 import reference** (loader reads from JSON) ✓ |
| `ls PRODUCT_VISION.md` | file missing | **file present** (product direction doc) ✓ |
| `python -c "from backend.data.currency_names_ru import get_ru_name; print(get_ru_name('exalted'))"` | `'Благородная сфера'` | **`'Благородная сфера'`** (unchanged) ✓ |

## Stop point — next iteration (iter 71)

After iter 70: **P0=0, P1=0, P2=1, P3=4.** ~2-4 iterations remaining (P2-1 alone is multi-iter).

Recommended candidates (per REFACTOR_PLAN.md v34):

1. **P2-1** (`dashboard-page.tsx` 1705-line god-component → split) — large, multi-iter. Suggested approach: extract tab-specific subcomponents one at a time, keep tests green at each step.
2. P3-3 (`EventManager` thread-safety for multi-worker uvicorn)
3. P3-4 (`SnapshotManager._snapshot` atomic swap)
4. P3-5 (full `/flips` integration test — partially covered by `test_flips_filters.py`)
5. P3-7 (delete `REFACTOR_PLAN.md` + `worklog.md` after all closed)

After all P2/P3 closed → switch focus to product features (F1-F6 in `PRODUCT_VISION.md`), starting with:
- **F1** — translate remaining ~276 items (parse from `poe2db.tw/ru/`)
- **F2** — Storage Value tab vs Mirror of Kalandra / Hinekora's Lock (endpoint already exists at `/api/v1/storage-value/{currency}` — needs UI)
- **F3** — content-pulse analytics (per-mechanic turnover, 7d/30d rolling average, rising/falling signals)
- **F4** — "What to farm today" widget on the main dashboard
- **F5** — Speculation tab with z-score BUY/SELL/HOLD signals
- **F6** — Phase-aware hints (Temporalis mid/late league etc.)

Suggested commit for iter 71: `refactor(P2-1): extract <tab-name> from dashboard-page.tsx (step 1/N)`

**Issue counts after iter 70:** P0=0, P1=0, P2=1, P3=4. ~2-4 iterations remaining.

## Git commands (single commit)

```bash
# After copying all files from the archive (steps 2-4 above):

git add -A
git commit -m "refactor(P2-3): move currency_names_ru.py to JSON + add PRODUCT_VISION.md

P2-3: backend/data/currency_names_ru.py shrank from 966 → 63 lines.
The four dicts (CATEGORY_NAMES_RU, CATEGORY_NAMES_EN, CURRENCY_NAMES_RU,
CURRENCY_NAMES_EN) and the four helper functions (get_ru_name, get_en_name,
get_category_ru, get_category_en) keep the same public API — the existing
routes_arbitrage.py import is unchanged.

Data now lives in backend/data/currency_names.json (742 lines, 45 KB —
349 RU + 349 EN entries + 17 category labels per language).

+7 pytest regression tests in tests/test_currency_names_ru.py:
  - dict sizes (locks the data shape)
  - helper None-handling for unknown ids
  - spot-checks on exalted / divine / mirror / hinekoras-lock
  - RU<->EN key parity (so the Python and TS mirrors can't drift silently)
  - category helpers

Also adds PRODUCT_VISION.md at the repo root — captures the user's product
direction: analytics helper (NOT a poe2scout/poe2ninja clone), full Russian
localization, speculation helper (buy low / sell high), 'investment' advice
via storage-value vs Mirror of Kalandra / Hinekora's Lock, phase-aware
historical patterns (Temporalis cheap at league start -> expensive at end,
Ritual omens / Breach catalysts when mechanic turnover drops), content-pulse
analytics ('what to farm today' widget). Lists 6 product features (F1-F6)
tracked SEPARATELY from the technical-debt backlog in STATUS.md.

README.md refreshed — was stale iter 58 content; now a real project README
pointing at PRODUCT_VISION.md / STATUS.md / AGENT_NAVIGATION.md.

Baseline: pytest 466 pass (+7 P2-3 regression tests), jest 324 pass
(unchanged — Python-only change), tsc 0 errors (unchanged), e2e 30 pass
(unchanged)."

git push origin main
```
