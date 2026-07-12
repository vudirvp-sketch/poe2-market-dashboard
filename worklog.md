# Worklog — PoE2 Market Dashboard

> Append-only shared multi-agent work log. Each section starts with `---`.
> Old task history is in `git log`. Trimmed to last 2 iterations.

---

Task ID: iter-140
Agent: main
Task: iter 140 — docs deep-audit. Per the iter-139 stop point: candidates were (c) per-tab UX/logic deep-audit OR (d) docs deep-audit of DATA_FLOW/BACKEND_GUIDE/DATA_CONTRACTS. Chose (d) — lower risk (no source-code changes) and well-decomposable.

Work Log:
- Cloned repo. Read `STATUS.md` (iter 139 SHIPPED — repo cleanup), `worklog.md` (iter 138 + iter 139), `AGENT_NAVIGATION.md` §1–§3 + §5–§6 (247 lines).
- Set up `.venv` + installed `requirements.txt` (incl. `aiosqlite`). Confirmed pytest baseline: **1466 passed** (matches iter 139).
- Captured live API surface via `TestClient(app).get('/openapi.json')` → 39 `/api/v1/*` paths. This is the canonical reference for route-prefix audit.
- **`docs/BACKEND_GUIDE.md` audit (5 drift items fixed):**
  - §3 HistoricalStore tables — listed `prices_history` (does NOT exist — confused with the in-memory `price_logs` field), `events`, `price_snapshots`. Actual: 5 tables — `price_snapshots`, `events`, `market_spreads` (TD-4 iter 128), `triangular_cycles` (TD-3 iter 129), `daily_stats` (TD-5 iter 131). Updated list + added the corresponding `read_*` / `write_*_batch` methods.
  - §4 DataScheduler — claimed "3 jobs". Actual: 4 jobs (added `daily_stats_refresh` in iter 131, hourly). Updated table + config-key references.
  - §6.11 Optimizer endpoints — `/api/optimizer/*` (missing `/v1`). Fixed to `/api/v1/optimizer/*`.
  - §6.12 Analyst endpoint — `/api/analyst/summary` (missing `/v1`). Fixed to `/api/v1/analyst/summary`.
  - §7 Unit Tests — claimed "14 files". Actual: 42 test files (verified via `ls tests/*.py`). Rewrote the file tree + added note about the 1466 vs 1289 pytest count (aiosqlite-dependent).
- **`docs/DATA_CONTRACTS.md` audit (3 drift items fixed):**
  - §4.2 backend routes column — ALL 19 entries used `/api/*` (missing `/v1`). Fixed all to `/api/v1/*`. Also fixed two wrong paths: `/api/prices/tiers` → `/api/v1/tiers` (no `/prices` prefix), `/api/prices/benchmarks/{c}` → `/api/v1/benchmarks/{currency_api_id}`.
  - §4.2 missing endpoints — added 16 newer endpoints shipped iter 75–131: `health/ping`, `health/circuit-breakers`, `prices/stream` (SSE), `triangular/history` (TD-3), `storage-value/{c}/history`, `events/summary`, `content-pulse` (F3), `speculation` + `speculation/backtest` (F5), `phase-hints` (F6), `circuit-patterns` (F7/P8), `intraday-patterns` (P4), `weekly-patterns` (P5), `mirror-divine-arb` (P7), `leveling-uniques` (P9), `market-spreads/history` (TD-4), `liquid-chain/{analysis,opportunities}`, `batch`. Documented `/api/v1/items/{item_id}/daily-stats` (TD-5) as backend-only (no current frontend consumer — candidate for a future iter).
  - §5 DataSnapshot dataclass — fields were drastically outdated. Doc claimed `league, fetched_at, rates: dict[str, SnapshotPair], currencies: list[CurrencyItem], price_histories: dict[str, list[PriceLogEntry]], bfs_pricing, snapshot_age_seconds`. Actual (verified against `backend/api/data_snapshot.py`): `exchange_rates, currencies: dict[str, dict], currency_metadata, price_histories: dict[str, list[PricePoint]], current_prices, prices_in_base, tiers, fetched_at, valid`. Rewrote the block + added note that `snapshot_age_seconds` is computed by `SnapshotManager`, not stored on the dataclass.
- **`docs/DATA_FLOW.md` audit (scoped to §7 only — 2 drift items fixed):**
  - §7.1 flipper proxy map — all 19 entries used `/api/*` (missing `/v1`). Fixed all + added 16 missing newer proxies. Total 35 entries now (matches actual `src/app/api/flipper/**/route.ts` count of 34, plus the SSE entry which lives at `prices/stream/route.ts`).
  - §7.2 backend routes map — all entries used `/api/*` (missing `/v1`). Fixed all + added 13 missing newer `routes_*.py` files (`routes_sse.py`, `routes_content_pulse.py`, `routes_speculation*.py`, `routes_phase_hints.py`, `routes_circuit_patterns.py`, `routes_intraday_patterns.py`, `routes_weekly_patterns.py`, `routes_mirror_divine_arb.py`, `routes_leveling_uniques.py`, `routes_market_spreads.py`, `routes_daily_stats.py`, `routes_liquid_chain.py`, `routes_batch.py`). Added KI-13 SSE-registration-order note.
- **`docs/DATA_FLOW.md` §1–§6, §8–§10 NOT audited this iter** — these sections cover POE2Scout API shape (§2), frontend flows (§3), backend pipeline (§4–§6), gotchas (§8), component mapping (§9), common mistakes (§10). They may contain similar drift (especially §9 Data→Component Mapping which lists 10 tabs vs the actual 16 — confirmed via iter 139's TAB_MAP audit). Deferred to iter 141.
- **Final verification:** `pytest tests/ --ignore=tests/e2e -q` → **1466 passed, 0 failed, 0 errors**. 0 source-code changes this iter — only docs.

Stage Summary:
- **iter 140 SHIPPED — docs deep-audit pass complete.** 3 doc files updated: `docs/BACKEND_GUIDE.md` (5 fixes), `docs/DATA_CONTRACTS.md` (3 fixes), `docs/DATA_FLOW.md` §7 (2 fixes). 26 individual drift items resolved. 0 source-code changes. 1466 pytest green (0 regressions — confirmed since no `.py`/`.ts`/`.tsx` was touched).
- **Modified files (3 docs + 3 meta-docs):** `docs/BACKEND_GUIDE.md`, `docs/DATA_CONTRACTS.md`, `docs/DATA_FLOW.md`, `STATUS.md` (header bump), `worklog.md` (this entry), `AGENT_NAVIGATION.md` (header bump).
- **What was NOT done (intentionally deferred to iter 141+):**
  - **`docs/DATA_FLOW.md` §1–§6, §8–§10** — not audited. §9 Data→Component Mapping lists 10 tabs vs the actual 16 — confirmed drift, candidate for iter 141.
  - **`docs/ARCHITECTURE.md` (303 lines)** — not audited this iter.
  - **`docs/MARKET_PLAYBOOK.md` (355 lines)** — not audited this iter.
  - **`docs/CORS_PROXY_GUIDE.md` (181 lines)** — not audited this iter.
  - **Per-tab UX/logic deep-audit** — still deferred since iter 139. Iter 139 only did structural TAB_MAP ↔ TabsTrigger ↔ TabsContent parity + TODO/FIXME scan. Full per-tab audit (i18n coverage, error states, empty states, loading skeletons, accessibility) is candidate for iter 142+.
  - **9 items still untranslated** (F1) — poe2db has the pages but no Russian translation yet. Re-run pipeline after a patch / monthly.
  - **TD-3 runtime log verification** — still deferred since iter 136 (requires prod access).
- **Stopping point:** iter 140 = docs deep-audit pass (3 doc files, 26 drift items). Next iter candidates: (a) `docs/DATA_FLOW.md` §1–§6, §8–§10 audit (especially §9 tab list drift); (b) `docs/ARCHITECTURE.md` + `docs/MARKET_PLAYBOOK.md` + `docs/CORS_PROXY_GUIDE.md` audit; (c) per-tab UX/logic deep-audit; (d) re-run F1 pipeline after a patch / monthly; (e) TD-3 runtime log verification (requires prod access); (f) any new bugs the user identifies.

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
