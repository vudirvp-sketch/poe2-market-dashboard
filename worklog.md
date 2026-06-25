# Worklog — PoE2 Market Dashboard

> Append-only shared multi-agent work log. Each section starts with `---`.
> Old task history is in `git log`.


Recent iterations kept (iter 84+). Older iter 77-83 records trimmed — those features (F5 live, F6 phase hints, F5 backtest UI, useDashboardData Stages 1-2 + 3a-3b) are fully shipped and documented in PRODUCT_VISION.md / STATUS.md / AGENT_NAVIGATION.md.

---
Task ID: iter-84
Agent: main (Sonnet 4.5)
Task: iter 84 — Stage 3b of useDashboardData hook extraction (optimalPayment cluster → useOptimalPayment hook). Extraction COMPLETE.

Stage Summary:
- **useDashboardData Stage 3b (useOptimalPayment hook extraction) — DONE.** New hook `src/hooks/use-optimal-payment.ts` (315 lines) owns the §11 optimal-payment cluster. `dashboard-page.tsx` is now 995 lines (was 1128, was 1685 in iter 70 — total −41%). Zero behavior change. jest 422 pass, tsc 0 errors, next build OK.
- **useDashboardData extraction COMPLETE** — Stages 1-2 + 3a-3b all shipped iter 81-84. No further staged refactors planned.
- F1 still blocked on live poe2scout.com + poe2db.tw/ru/ access (no change since iter 80).
- Full details in `git log` for iter 84. Documentation: STATUS.md (technical-debt paragraph updated, 1 new Quick Reference entry), AGENT_NAVIGATION.md (invariant #37 + 1 new §1 module row + hooks count 18→19), PRODUCT_VISION.md (DoD paragraph).

---
Task ID: iter-85
Agent: main (Sonnet 4.5)
Task: iter 85 — F1 sync script: ship `scripts/sync_currency_names_from_poe2db.py` so the maintainer (with live poe2scout.com + poe2db.tw/ru/ access) can run the pipeline locally and close the "remaining ~276 untranslated api_ids" gap. Per iter 84 hand-off: "Если у тебя есть к ним доступ, могу написать скрипт scripts/sync_currency_names_from_poe2db.py — ты выполнишь его локально и пришлёшь результаты." Maintainer confirmed access; this iter ships the script + tests + documentation.

Work Log:
- Read STATUS.md / PRODUCT_VISION.md / AGENT_NAVIGATION.md / worklog.md iter 84 record. Confirmed iter 84 shipped useDashboardData Stage 3b (extraction COMPLETE; dashboard-page.tsx 995 lines). F1 is the only blocked feature — needs live poe2scout.com (enumerate all 625 api_ids) + poe2db.tw/ru/ (RU name source). Maintainer has access.
- Surveyed the existing F1 infrastructure:
  - `backend/data/currency_names.json` (742 lines) holds 4 dicts: `category_names_ru` (17 keys), `category_names_en` (17 keys), `currency_names_ru` (349 keys), `currency_names_en` (349 keys). Keys use HYPHENS (315 of 349), not underscores.
  - `backend/data/currency_names_ru.py` (63 lines) is a thin JSON loader. Iter 70 (P2-3) closed the hardcoded-dict → JSON migration.
  - `tests/test_currency_names_ru.py` (87 lines) has count assertions on lines 30-33: `len(CURRENCY_NAMES_RU) == 349` and `len(CURRENCY_NAMES_EN) == 349`. These MUST be bumped after any successful --apply.
  - `src/data/cache-snapshot.json` (11360 lines) has 138 unique api_ids across 6 categories (currency/ritual/ultimatum/idol/vaultkeys/delirium) — all 138 already translated.
  - `backend/data/providers/poe2scout.py:542-619` shows the live ByCategory pagination pattern: `/{realm}/Leagues/{league}/Items/Categories` → enumerate → `/{realm}/Leagues/{league}/Currencies/ByCategory?Category=...&Page=N&PerPage=250` → paginate.
  - `config.yaml` lists 17 currency_categories.
- Designed the script as a 4-stage pipeline with each stage a separate subcommand:
  - **Stage 1 `--fetch-ids`**: hits poe2scout.com ByCategory, paginates through all 17 categories, writes `scripts/.cache/poe2scout_items.json` (flat list of `{api_id, en_name, category_api_id}`).
  - **Stage 2 `--fetch-ru`**: hits poe2db.tw/ru/<Category> for each category, parses HTML tables (lenient regex-based parser with fallback), writes `scripts/.cache/poe2db_ru_names.json` (EN→RU map per category).
  - **Stage 3 `--diff`**: reads both caches + existing `currency_names.json`, computes patch with 3 entry types (`add` / `conflict` / `skip`), writes `scripts/.cache/currency_names_patch.json`.
  - **Stage 4 `--apply --confirm`**: applies patch atomically (tmp+rename). NEVER overwrites existing — conflicts are skipped with a warning. After apply, prints exact lines to bump in `tests/test_currency_names_ru.py`.
  - **Fallback `--from-cache-snapshot`**: extracts 138 api_ids from bundled cache-snapshot.json — no network needed. Useful when only poe2db.tw is reachable.
- Wrote `scripts/sync_currency_names_from_poe2db.py` (~600 lines, stdlib only — no extra deps beyond `requirements.txt`). Includes 15s timeout, 3 retries with exponential backoff (1s/2s/4s), 5s cooldown on 429, env-var overrides (`POE2_API_BASE_URL`, `POE2DB_BASE_URL`, `POE2_SNAPSHOT_REALM`, `POE2_SNAPSHOT_LEAGUE`), `HTTP_PROXY`/`HTTPS_PROXY` respected by urllib.
- **Bug caught during self-test**: initial `normalize_api_id` implementation mirrored the backend's `_normalize_api_id` (poe2scout.py:58) which replaces hyphens with underscores. This broke the lookup against `currency_names.json` (which stores keys with hyphens). Verified: 315 of 349 keys use hyphens, 0 use underscores. Fixed `normalize_api_id` to PRESERVE hyphens (only lowercase + strip whitespace + strip apostrophes). Re-ran Stage 1 fallback + Stage 3 diff: all 138 cache-snapshot items now correctly recognized as "already translated" (was 18 before fix). Documented the distinction in the script docstring + AGENT_NAVIGATION.md invariant #38.
- Wrote `tests/test_sync_currency_names.py` (~370 lines, 32 tests across 6 classes):
  - `TestNormalizeForMatch` (6 tests) — lowercasing, apostrophe stripping (ASCII + curly \u2018/\u2019/\u201b/\u2032), HTML entity decoding, whitespace collapse.
  - `TestNormalizeApiId` (5 tests) — **regression test for the iter 85 hyphen-preservation bug**: `hinekoras-lock` stays `hinekoras-lock` (NOT `hinekoras_lock`).
  - `TestParsePoe2dbCategoryHtml` (5 tests) — 2-column table parse, 3-column table limitation (documented), empty HTML, header-row skip, dedup.
  - `TestBuildTranslationPatch` (5 tests) — already_translated, new candidate with proposed_ru, no_match skip, conflict detection (EN name drift), fuzzy matching via normalized EN name.
  - `TestApplyPatch` (5 tests) — adds new entries to BOTH ru + en, idempotent (doesn't overwrite), conflicts skipped, skip entries no-op, preserves RU/EN key parity.
  - `TestExtractItemsFromCacheSnapshot` (2 tests) — extracts 138 items, mirror + exalted + hinekoras-lock present, no api_ids with underscores (regression check).
  - `TestCli` (4 tests) — no args / multiple stages / --apply without --confirm / --fetch-ids + --from-cache-snapshot mutually exclusive all return exit code 4.
- Verification:
  - `python3 -m pytest tests/test_sync_currency_names.py -v` → 32 pass / 0 fail (~0.1s).
  - `python3 -m pytest tests/ --ignore=tests/e2e --ignore=tests/test_scheduler.py -q` → 763 pass / 0 fail (~28s). Pre-existing `test_scheduler.py` skip documented in STATUS.md (aiosqlite not installed in env).
  - `python3 scripts/sync_currency_names_from_poe2db.py --help` → usage printed correctly.
  - `python3 scripts/sync_currency_names_from_poe2db.py --from-cache-snapshot` → 138 items extracted, written to `scripts/.cache/poe2scout_items.json`.
  - `python3 scripts/sync_currency_names_from_poe2db.py --diff` (with test poe2db cache) → 1 conflict correctly detected (api_id `against-the-darkness` — poe2scout now reports `"Zarokh's Reliquary Key: Against the Darkness"` vs JSON's `"Against the Darkness"`).
  - `python3 scripts/sync_currency_names_from_poe2db.py --apply --confirm` → 0 added (no add entries), 1 conflict skipped, file byte-identical (idempotency confirmed).
  - `python3 scripts/sync_currency_names_from_poe2db.py --apply` (without --confirm) → exit code 4 with clear error message.
- Documentation updates:
  - `STATUS.md`: bumped "Last updated" to iter 85. Rewrote F1 row: "Script shipped, awaiting live-API run" with full pipeline description + maintainer-action-required note. Added 1 new Quick Reference entry (RU translations → script with 4-stage pipeline description + idempotency + conflict-handling + --from-cache-snapshot fallback).
  - `PRODUCT_VISION.md`: bumped "Last updated" to iter 85. Rewrote F1 section: "SCRIPT SHIPPED (iter 85), AWAITING MAINTAINER RUN" with pipeline description + test counts + status. Updated DoD paragraph: F1 sync script shipped iter 85.
  - `AGENT_NAVIGATION.md`: bumped "Last updated" to iter 85. Added 1 new §1 module row for `scripts/sync_currency_names_from_poe2db.py` with full description (4 stages, idempotency, --from-cache-snapshot fallback, normalize_api_id NOTE about hyphen preservation). Added invariant #38 (script is the ONLY sanctioned path for bulk RU translation imports; documents the 4-stage pipeline, the non-RU IP requirement, the idempotency contract, the conflict-handling policy, the post-apply test-bump requirement, and the CRITICAL normalize_api_id hyphen-preservation distinction from the backend's `_normalize_api_id`). Updated Quick Reference entry for "Adding a new Russian translation" to point to the script (manual edits still allowed for one-off fixes).
  - `worklog.md`: trimmed iter 83 record (full iter 83 detail removed; Stage Summary only — iter 83 is 2 iterations old, fully shipped). Trimmed iter 84 record (full iter 84 detail removed; Stage Summary only — iter 84 is 1 iteration old, fully shipped, use git log for detail). Added this iter 85 record (full detail).

Stage Summary:
- **F1 sync script SHIPPED (iter 85).** `scripts/sync_currency_names_from_poe2db.py` (~600 lines, stdlib only) implements the full 4-stage pipeline (fetch-ids / fetch-ru / diff / apply). Idempotent, never overwrites, atomic writes, RU/EN key parity validation pre+post apply. Plus `--from-cache-snapshot` fallback for maintainers without poe2scout access. 32 pytest tests pass; existing 763 pytest pass (test_scheduler skipped — pre-existing aiosqlite env issue).
- **MAINTAINER ACTION REQUIRED to close F1:** run `python scripts/sync_currency_names_from_poe2db.py --fetch-ids` + `--fetch-ru` from a non-RU IP, review `scripts/.cache/currency_names_patch.json`, then `--apply --confirm`, then bump count assertions in `tests/test_currency_names_ru.py` (lines 30-33), then `pytest tests/test_currency_names_ru.py`. Until the maintainer runs the pipeline, F1 stays effectively blocked on live API access — the script just makes the unblock trivial.
- **Self-caught bug fixed inline**: `normalize_api_id` was initially mirroring the backend's hyphen→underscore substitution, which broke lookups against `currency_names.json` (hyphen-keys). Fixed before any external release; documented as a regression test in `tests/test_sync_currency_names.py::TestNormalizeApiId::test_preserves_hyphens` and as invariant #38 in AGENT_NAVIGATION.md.
- **Baseline:** pytest 763 pass (was 731 pre-iter-85 + 32 new sync_currency_names tests = 763), jest 422 pass (unchanged — no frontend changes), tsc 0 errors, next build OK (no frontend changes — only Python + docs).
- **Files changed/created (5 total):**
  - `scripts/sync_currency_names_from_poe2db.py` (NEW, ~600 lines)
  - `tests/test_sync_currency_names.py` (NEW, ~370 lines, 32 tests)
  - `STATUS.md` (updated — iter 85 stamp, F1 row rewritten, 1 new Quick Reference entry)
  - `PRODUCT_VISION.md` (updated — iter 85 stamp, F1 section rewritten, DoD paragraph updated)
  - `AGENT_NAVIGATION.md` (updated — iter 85 stamp, 1 new §1 module row, invariant #38 added, Quick Reference entry updated)
  - `worklog.md` (iter 83 + iter 84 trimmed to Stage Summary only; this iter 85 record full detail)

Next iteration (iter 86) — recommended priorities:
1. **F1 closure** — once maintainer runs the pipeline and sends back the results, apply the patch upstream (or commit the new `currency_names.json` directly if maintainer sends the file). Bump test count assertions. This closes F1.
2. **Full Content Pulse tab** — F4 widget is the MVP; full version with sorting/filters/drill-down if widget proves useful.
3. **Phase hints enhancements** (optional) — pull hints from `config.yaml` instead of hardcoding; add per-pattern metrics by cross-referencing the snapshot's `price_histories`; filter hints based on actual market state.
4. **Visual verification with real backend data** — manual verification of the backtest panel against real snapshot data needs a running backend with ≥21d of price_logs collected.
5. **e2e tests** (optional) — frontend is covered by jest; e2e would require running backend + browser.
6. **Opportunistic code-health** (no staged plan) — now that the useDashboardData extraction is COMPLETE, future code-health work should be per-file. Candidates: (a) flipper-sticky-bar.tsx — still has inline `useState` for the dismiss flag that could move to the Zustand store's `uiState` slice; (b) dashboard-dialogs.tsx — could be split into 8 separate files (one per dialog) for lazy-loading; (c) the `useMemo` for `navigableList` + `keyboardActions` in dashboard-page.tsx (~25 lines combined) could move into `use-keyboard-shortcuts.ts` as a pure derivation. None are blocking — opportunistic only.

NOT done in iter 85 (intentionally deferred):
- Actually running --fetch-ids / --fetch-ru (no live poe2scout.com + poe2db.tw access in this env)
- Bumping `tests/test_currency_names_ru.py` count assertions (depends on --apply output)
- Full Content Pulse tab / phase hints enhancements / e2e tests / visual verification (per iter 84 hand-off — these are post-F1 priorities)
