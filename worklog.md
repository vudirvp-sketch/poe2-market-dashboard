# Work Log

> Single source for recent task entries. Long history removed — see git log for details.
> Append new entries at the bottom. Keep ≤3 latest entries.

---

## Task 70 — P2-3 closed (currency_names_ru → JSON)
**Agent:** Main Agent
**Date:** 2026-06-25

**Task:** Close the last mechanical P2 issue (P2-3): `backend/data/currency_names_ru.py` was a 966-line hardcoded Python dict — move the data to JSON and leave a thin loader behind, without changing the public API. Also: capture the user's product vision (analytics dashboard, NOT a poe2scout/poe2ninja clone; full RU localization; speculation helper; storage-value vs Mirror/Hinekora; content-pulse analytics for "what to farm today") in a new `PRODUCT_VISION.md`.

**Work Log:**
- Wrote `scripts/extract_currency_names_to_json.py` (outside the repo) — imports the existing module, dumps the 4 dicts to `backend/data/currency_names.json`, rewrites `currency_names_ru.py` as a 63-line loader, then re-imports and verifies the data + helpers are bit-for-bit identical.
- Ran the script: produced `currency_names.json` (742 lines, 45 KB — 349 RU + 349 EN entries + 17 category labels per language) and shrank `currency_names_ru.py` from 966 → 63 lines. Public API unchanged: `CATEGORY_NAMES_RU` / `CATEGORY_NAMES_EN` / `CURRENCY_NAMES_RU` / `CURRENCY_NAMES_EN` + `get_ru_name` / `get_en_name` / `get_category_ru` / `get_category_en`. The existing `routes_arbitrage.py` import (`from backend.data.currency_names_ru import get_ru_name, get_en_name`) works without changes.
- Added 7 regression tests in `tests/test_currency_names_ru.py`: dict sizes (17/17/349/349 — locks the data shape), helper None-handling, spot-checks on `exalted`/`divine`/`mirror`/`hinekoras-lock`, RU↔EN key parity (so the Python and TS mirrors can't drift silently), category helpers.
- Verified baselines: pytest **466 pass** (was 459 → +7 P2-3 regression tests), jest **324 pass** (unchanged — Python-only change), tsc **0 errors** (unchanged), e2e **30 pass** (unchanged).
- Created `PRODUCT_VISION.md` at repo root: 7 sections covering (1) one-liner "not another poe2scout/ninja", (2) antipatterns we avoid, (3) the 6 core value pillars (RU localization, speculation helper, storage-value vs Mirror/Hinekora, phase-aware patterns like Temporalis mid/late league, content-pulse analytics, "what to farm today" widget), (4) architecture alignment table, (5) 6 product features (F1-F6) tracked SEPARATELY from this technical-debt backlog, (6) product DoD, (7) related docs.
- Updated docs: `STATUS.md` (P2-3 → Fixed with iter 70 entry; Quick Reference gained "Adding a new Russian translation" row pointing to `currency_names.json`); `REFACTOR_PLAN.md` (v33 → v34; iter 70 marked DONE; new principle #7 about data files living next to their loader; DoD gained data-file regression-test rule; estimation 1-3 → 2-4 iterations because P2-1 alone is multi-iter); `AGENT_NAVIGATION.md` (header date updated to iter 70 + added PRODUCT_VISION.md link; §1 row for `currency_names_ru.py` updated to "thin loader"; §3 invariant #24 added for P2-3; §4 P2 count 2 → 1; §4 Quick Reference row for currency_names_ru.py replaced with "Adding a new Russian translation" row; §6 documentation map gained PRODUCT_VISION.md row); `worklog.md` (Task 70 entry; trimmed to ≤3 latest — Task 67 dropped, see git log).

**Stage Summary:**
- P2-3 closed. `currency_names_ru.py` 966 → 63 lines. Data now editable as JSON without touching Python.
- Product vision captured in `PRODUCT_VISION.md` — future agents will read this before proposing features.
- P0=0, P1=0, P2=1, P3=4. ~2-4 iterations remaining (P2-1 alone is multi-iter).
- Baseline: pytest **466 pass** (+7), jest 324 pass, tsc 0 errors, e2e 30 pass.

**Stopping point:**
- Iter 70 done. P2-3 closed + PRODUCT_VISION.md added.
- Next iter (iter 71) recommended:
  1. **P2-1** (`dashboard-page.tsx` 1705-line god-component → split) — large, multi-iter. Suggested approach: extract tab-specific subcomponents one at a time, keep tests green at each step.
  2. P3-3 (EventManager thread-safety), P3-4 (SnapshotManager atomic swap), P3-5 (full /flips integration test), P3-7 (delete REFACTOR_PLAN.md + worklog.md after all closed).
- After all P2/P3 closed → switch focus to product features (F1-F6 in PRODUCT_VISION.md), starting with F1 (translate remaining ~276 items) and F2 (Storage Value tab vs Mirror/Hinekora).
- Suggested commit message: `refactor(P2-3): move currency_names_ru.py to JSON + add PRODUCT_VISION.md`.

---

## Task 69 — P2-8 closed + iter 68 scanner residual cleaned
**Agent:** Main Agent
**Date:** 2026-06-21

**Stage Summary:**
- P2-8 closed. `proxyWithFallback` is now mode-aware: dev sees real 5xx, prod gets 200 + `X-Flipper-Fallback` header. +22 jest tests. `jest.setup.ts` gained `Response`/`fetch`/`Headers`/`AbortSignal.timeout` polyfills.
- Iter 68 scanner residual bug closed. `backend/api/routes_scanner.py` deleted for real. Going forward, file deletions go through `git add -A` (no manual `rm` step in MERGE_INSTRUCTIONS.md).
- P0=0, P1=0, P2=2, P3=4. ~1-3 iterations remaining.
- Baseline: pytest 459 pass, jest 324 pass (+22), tsc 0 errors, e2e 30 pass.

---

## Task 68 — P2-4 follow-up (scanner deleted)
**Agent:** Main Agent
**Date:** 2026-06-21

**Stage Summary:**
- P2-4 follow-up closed at the code level (main.py / response_models.py / routes_batch.py / tests / openapi / api-types all updated).
- The actual `routes_scanner.py` file deletion was missed — see iter 69 entry above.
- See git commit `cca86d7` for details.
