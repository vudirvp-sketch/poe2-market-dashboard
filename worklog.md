# Worklog — PoE2 Market Dashboard

> Append-only shared multi-agent work log. Each section starts with `---`.
> Old task history is in `git log`. Trimmed to last 2 iterations.

---

Task ID: iter-139
Agent: main
Task: iter 139 — repo cleanup pass. Per the iter-138 stop point: "далее можно начать 'чистить' репозиторий от мусора, проверять каждую вкладку и систему на упущения и ошибки и шаг за шагом палировать проект." Goal: remove dead/legacy files, fix doc drift, audit dashboard tabs for omissions — without breaking anything.

Work Log:
- Cloned repo. Read `STATUS.md` (iter 138 SHIPPED — F1 periodic re-run no-op), `worklog.md` (iter 137 + iter 138), `AGENT_NAVIGATION.md` (243 lines, 74KB), `README.md`, `README_iter138.md`.
- Created `.venv` and installed `requirements.txt` (incl. `aiosqlite`). Ran full `pytest tests/ --ignore=tests/e2e` → **1466 passed** (vs the 1289 quoted in iter 138 docs — the 6 aiosqlite-dependent modules now also run, adding 164 + 13 from `test_scheduler.py`). This is the new baseline; iter 138's "skip `test_scheduler.py`" instruction in README.md was stale.
- **Audit — dead files:**
  - `README_iter138.md` — iter-specific README that duplicates the iter-138 entry already in `worklog.md`. Removed.
  - `scripts/cleanup_dead_i18n_keys.py` — iter-89 one-shot, `DEAD_KEY_NAMES` list hardcoded for the iter-87 Currency Graph tab removal. Already applied. Path `LOCALE_DIR = Path("/home/z/my-project/repo/...")` doesn't exist in any checkout. Removed.
  - `scripts/fix_duplicate_comments.py` — iter-89 one-shot bugfix for the above. Already applied. Removed.
  - `scripts/restore_blank_lines.py` — iter-89 one-shot bugfix for the above. Already applied. Removed.
- **Audit — doc drift in `AGENT_NAVIGATION.md` §5 API table:** Cross-referenced the table against the live FastAPI route surface (via `TestClient(app).get('/openapi.json')` → 38 `/api/v1/*` paths). Found 5 routes that shipped in recent iterations but were missing from the table:
  - `/api/v1/arbitrage/triangular/history` (TD-3 Phase 3, iter 129)
  - `/api/v1/market-spreads/history` (TD-4 Phase 2, iter 128)
  - `/api/v1/mirror-divine-arb` (P7, iter 109)
  - `/api/v1/leveling-uniques` (P9, iter 110)
  - `/api/v1/items/{item_id}/daily-stats` (TD-5 Phase 4, iter 131)
  Added all 5 with iter references + `data_available: false` semantics.
- **Audit — doc drift in `AGENT_NAVIGATION.md` §6 Documentation Map:** Design-docs entry said "Phase 1 SHIPPED iter 127, Phases 2/3/4 deferred" — but all 4 phases shipped (iter 127/128/129/131). P10 entry said "Phase 2 deferred" — but Phase 2 shipped iter 132. Updated both to reflect current state.
- **Audit — `AGENT_NAVIGATION.md` recipe drift:** The "Remove dead i18n keys" recipe said `Run scripts/cleanup_dead_i18n_keys.py` — but that script was a one-shot with hardcoded keys, now deleted. Replaced with a manual pattern: `grep -rn "t('keyName')" src/` — if zero hits in `.tsx`/`.ts`, the key is dead. Also fixed the F1 translation recipe to point at `--fetch-ru-by-item` (not the broken `--fetch-ru` per KI-30) and mention the parallel runner + TS-mirror regen step.
- **Audit — `README.md` test command:** Removed the stale `--ignore=tests/test_scheduler.py` flag. `test_scheduler.py` passes fine when `aiosqlite` is installed (which it is, via `requirements.txt`).
- **Audit — `STATUS.md` aiosqlite Quick Reference row:** Rephrased from "Pre-existing env issue — aiosqlite not installed. pip install aiosqlite." to "Env-setup issue — aiosqlite missing from active venv. Run `pip install -r requirements.txt` (or `pip install aiosqlite`). With aiosqlite installed, the full suite is 1466 pytest green." — makes it clear this is a setup omission, not a code bug.
- **Audit — dashboard tabs:** Verified `TAB_MAP` (16 entries in `dashboard-page.tsx:211`) matches the 16 `TabsTrigger` values in `dashboard-toolbar.tsx` matches the 16 `TabsContent` blocks. All wired. No TODO/FIXME/HACK markers in `src/` (only a single `TODO` in `poe2api.ts:1273` — a known temporary league-name override waiting for an upstream POE2Scout fix, not actionable).
- **Final verification:** `pytest tests/ --ignore=tests/e2e` → **1466 passed, 0 failed, 0 errors**. 0 regressions vs iter 138 baseline (the 164 + 13 new passes are the previously-skipped aiosqlite modules).

Stage Summary:
- **iter 139 SHIPPED — repo cleanup pass complete.** 4 dead files removed (`README_iter138.md` + 3 iter-89 one-shot scripts). 5 missing API routes added to AGENT_NAVIGATION.md §5. Design-docs status corrected in §6. i18n-cleanup recipe rewritten as a manual pattern. README test command fixed. STATUS.md aiosqlite row clarified. 1466 pytest green (0 regressions).
- **Modified files (3 docs only — no source/data changes):** `AGENT_NAVIGATION.md` (header bump + §5 + §6 + 2 recipes), `README.md` (test command), `STATUS.md` (last-updated + aiosqlite row).
- **Deleted files (4):** `README_iter138.md`, `scripts/cleanup_dead_i18n_keys.py`, `scripts/fix_duplicate_comments.py`, `scripts/restore_blank_lines.py`.
- **What was NOT done (intentionally deferred to iter 140+):**
  - **9 items still untranslated** (F1) — poe2db has the pages but no Russian translation yet. Re-run pipeline after a patch / monthly.
  - **TD-3 runtime log verification** — still deferred since iter 136 (requires prod access).
  - **Jest tests** not run in this env (no `npm install`) — but no `.ts`/`.tsx` files were modified, so jest results would be identical to iter 138.
  - **Dashboard tab deep-audit** — only a structural sanity check (TAB_MAP ↔ TabsTrigger ↔ TabsContent parity + TODO/FIXME scan) was done this iter. A full per-tab UX/logic audit (i18n coverage, error states, empty states, loading skeletons, accessibility) is a candidate for iter 140+.
  - **Docs deep-audit** — only AGENT_NAVIGATION.md §5/§6 drift was fixed. `docs/DATA_FLOW.md` (739 lines), `docs/BACKEND_GUIDE.md` (354 lines), `docs/DATA_CONTRACTS.md` (386 lines) not audited this iter.
- **Stopping point:** iter 139 = repo cleanup pass (4 deletions + 3 doc fixes). Next iter candidates: (a) re-run F1 pipeline after a patch / monthly; (b) TD-3 runtime log verification (requires prod access); (c) per-tab UX/logic deep-audit; (d) docs deep-audit of DATA_FLOW/BACKEND_GUIDE/DATA_CONTRACTS for further drift; (e) any new bugs the user identifies.

---

Task ID: iter-138
Agent: main
Task: iter 138 — periodic re-run of the F1 translation pipeline. Per the iter-137 stop point: re-run `--fetch-ru-by-item` (or parallel-variant) → `--diff` → `--apply --confirm` (if new) → `sync_currency_names_ts.py` → bump tests. Goal: pick up the 9 items poe2db hadn't translated yet, and detect any new items poe2scout added.

Work Log:
- Cloned repo. Read `STATUS.md`, `worklog.md` (iter 137 + iter 136), `AGENT_NAVIGATION.md`. Confirmed iter 137 baseline: 643 poe2scout items, 686 RU + 686 EN entries in `backend/data/currency_names.json` (634 translated + 9 no-match + 43 legacy non-poe2scout ids), TS mirror in sync, 1289 pytest green.
- Verified network access: `curl https://poe2scout.com/api/Realms` → 200, `curl https://poe2db.tw/ru/Currency` → 200.
- Spot-checked the 9 untranslated items via curl — all poe2db titles are still English-only (no Cyrillic). poe2db has NOT added Russian translations for these 9 items since iter 137.
- **Stage 1 (`--fetch-ids`):** 643 items written to `scripts/.cache/poe2scout_items.json` — IDENTICAL to iter 137. poe2scout has not added new items.
- **Stage 2 (`fetch_ru_by_item_parallel.py --workers 6 --delay 0.1`):** Only 9 items needed fetching. All 9 returned no-match in 0.7s.
- **Stage 3 (`--diff`):** 643 total, 634 already translated, 0 new candidates, 0 conflicts, 9 no-match. Nothing to apply.
- **Stage 4 (`--apply`):** SKIPPED — patch file is empty, no-op.
- **TS mirror sync:** Ran `python scripts/sync_currency_names_ts.py` — output is byte-identical to the existing `src/lib/currency-names.ts`.
- **Tests:** `pytest tests/test_currency_names_ru.py tests/test_sync_currency_names.py` — 57/57 pass. Full `pytest` (excluding the 6 aiosqlite-dependent modules) — 1289/1289 pass. 0 regressions.
- **Documentation cleanup:** Rewrote `STATUS.md` (removed verbose iter-137 history, moved 9-item list to standalone section). Bumped `AGENT_NAVIGATION.md` header iter 137 → iter 138. Trimmed `worklog.md` to last 2 iterations.

Stage Summary:
- **iter 138 SHIPPED — F1 periodic re-run complete, no data changes.** poe2scout item count unchanged (643). poe2db has not added Russian translations for the 9 previously-untranslated items. Data files unchanged — verified byte-identical. 1289 pytest green (0 regressions).
- **Modified files (3 docs only):** `STATUS.md`, `AGENT_NAVIGATION.md`, `worklog.md`.
- **Stopping point:** iter 138 = F1 periodic re-run complete (no-op). Next iter candidates: (a) re-run this pipeline after a patch / monthly cadence; (b) TD-3 runtime log verification (requires prod access); (c) any new bugs the user identifies.
