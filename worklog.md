# Worklog — PoE2 Market Dashboard

> Append-only shared multi-agent work log. Each section starts with `---`.
> Old task history is in `git log`. Trimmed to last 2 iterations.

---

Task ID: iter-138
Agent: main
Task: iter 138 — periodic re-run of the F1 translation pipeline. Per the iter-137 stop point: re-run `--fetch-ru-by-item` (or parallel-variant) → `--diff` → `--apply --confirm` (if new) → `sync_currency_names_ts.py` → bump tests. Goal: pick up the 9 items poe2db hadn't translated yet, and detect any new items poe2scout added.

Work Log:
- Cloned repo. Read `STATUS.md`, `worklog.md` (iter 137 + iter 136), `AGENT_NAVIGATION.md`. Confirmed iter 137 baseline: 643 poe2scout items, 686 RU + 686 EN entries in `backend/data/currency_names.json` (634 translated + 9 no-match + 43 legacy non-poe2scout ids), TS mirror in sync, 1289 pytest green.
- Verified network access: `curl https://poe2scout.com/api/Realms` → 200, `curl https://poe2db.tw/ru/Currency` → 200.
- Spot-checked the 9 untranslated items via curl — all poe2db titles are still English-only (no Cyrillic): `Aldurs_Legacy - PoE2DB, Path of Exile Wiki ru`, `Vision Rune - PoE2DB, Path of Exile Wiki ru`, etc. poe2db has NOT added Russian translations for these 9 items since iter 137.
- **Stage 1 (`--fetch-ids`):** 643 items written to `scripts/.cache/poe2scout_items.json` — IDENTICAL to iter 137. poe2scout has not added new items.
- **Stage 2 (`fetch_ru_by_item_parallel.py --workers 6 --delay 0.1`):** Only 9 items needed fetching (634 already translated). All 9 returned no-match in 0.7s. `scripts/.cache/poe2db_ru_names.json` written with 0 pairs.
- **Stage 3 (`--diff`):** 643 total, 634 already translated, 0 new candidates, 0 conflicts, 9 no-match. Nothing to apply.
- **Stage 4 (`--apply`):** SKIPPED — patch file is empty, no-op.
- **TS mirror sync:** Ran `python scripts/sync_currency_names_ts.py` — output is byte-identical to the existing `src/lib/currency-names.ts` (verified via `diff`). 686 RU + 686 EN entries preserved.
- **Tests:** `pytest tests/test_currency_names_ru.py tests/test_sync_currency_names.py` — 57/57 pass. Full `pytest` (excluding the 6 aiosqlite-dependent modules that fail on collection — pre-existing env issue documented in STATUS.md) — 1289/1289 pass. 0 regressions.
- **Documentation cleanup:** Per the user's rule "Убирай длинную историю изменений, мусор, устаревшие секции. Оставляй только ключевые баги и частые проблемы":
  - Rewrote `STATUS.md`: removed the verbose "Iter 137 — F1 translation pipeline (closed)" section (3 paragraphs about KI-29, KI-30, F1 implementation details — only the lesson learned remains in "Key technical insights"). Moved the 9-item list to a standalone "F1 — 9 items with no poe2db Russian page (deferred)" section with direct poe2db URLs. Added a new row to the "Quick Reference" table documenting the 6-aiosqlite-module collection-error pattern (was implicit in iter 137's "1289 green" footnote — now explicit so future agents don't get confused).
  - Bumped `AGENT_NAVIGATION.md` header from iter 137 → iter 138 with a one-line summary.
  - Trimmed `worklog.md` to last 2 iterations (iter 137 + iter 138) per the file's own header rule.

Stage Summary:
- **iter 138 SHIPPED — F1 periodic re-run complete, no data changes.** poe2scout item count unchanged (643). poe2db has not added Russian translations for the 9 previously-untranslated items. Data files (`backend/data/currency_names.json`, `src/lib/currency-names.ts`) unchanged — verified byte-identical. 1289 pytest green (0 regressions).
- **Modified files (3 docs only — no source/data changes):** `STATUS.md` (cleanup + iter 138 update), `AGENT_NAVIGATION.md` (header bump), `worklog.md` (this entry + trim iter 135/136).
- **What was NOT done (intentionally deferred):**
  - **9 items still untranslated** — poe2db has the pages but no Russian translation yet. Will be picked up automatically the next time poe2db adds translations and this pipeline is re-run.
  - **TD-3 runtime log verification** — still deferred since iter 136 (requires prod access to check `_refresh` debug log).
  - **Jest tests** not run in this env (no `npm install`) — but the TS file is byte-identical to iter 137 (already verified), so jest results would also be identical.
- **Stopping point:** iter 138 = F1 periodic re-run complete (no-op). Next iter candidates: (a) re-run this pipeline after a patch / monthly cadence; (b) TD-3 runtime log verification (requires prod access); (c) any new bugs the user identifies.

---

Task ID: iter-137
Agent: main
Task: iter 137 — F1 unblock: enumerate all PoE2 items available via poe2scout.com API and translate their names to Russian via poe2db.tw. User asked to "start by compiling a list of items available via API → then find their official Russian names in the poe2db game wiki". Other languages are not interesting — only Russian. Apply translations to `backend/data/currency_names.json`, mirror into `src/lib/currency-names.ts`, bump test count assertions, run tests. Archive changed files and provide git commands.

Work Log:
- Cloned repo. Read `STATUS.md` (iter 136 SHIPPED — KI-28 fix), `worklog.md` (iter 135 + iter 136), `backend/data/currency_names.json` (349 RU + 349 EN entries, 17 categories), `backend/data/currency_names_ru.py` (loader), `src/lib/currency-names.ts` (TS-side mirror, hand-maintained — no auto-sync), `scripts/sync_currency_names_from_poe2db.py` (1041 lines, the F1 enabler pipeline), `tests/test_currency_names_ru.py` (count assertions == 349), `tests/test_sync_currency_names.py` (unit tests for the pipeline).
- Verified network access: `curl https://poe2scout.com/api/Realms` → 200, `curl https://poe2db.tw/ru/Currency` → 200. Both endpoints reachable from this environment — F1 blocker (Russia IP block) does NOT apply here.
- Confirmed current PoE2 league is `"Runes of Aldur"` (was `"runes"` at iter 85). Listed all 10 leagues via `curl https://poe2scout.com/api/poe2/Leagues` — 2 marked `IsCurrent=true`: `Runes of Aldur` + `HC Runes of Aldur`.
- **Attempted Stage 1 (`--fetch-ids`):** crashed immediately with `http.client.InvalidURL: URL can't contain control characters` — the URL builder at `fetch_poe2scout_items` interpolated `league` raw into the URL, with only `category` URL-encoded. The iter-85 default `"runes"` had no spaces so the bug was latent.
- **KI-29 documentation + fix:** Added `urllib.parse.quote(league, safe="")` + `urllib.parse.quote(realm, safe="")` at the URL construction site. Updated `DEFAULT_LEAGUE` from `"runes"` to `"Runes of Aldur"`. Added regression test `TestKi29UrlEncoding::test_fetch_poe2scout_items_url_encodes_league`.
- **Stage 1 (retry):** `python scripts/sync_currency_names_from_poe2db.py --fetch-ids` succeeded — 643 items written to `scripts/.cache/poe2scout_items.json` across all 17 categories. 297 already translated, 346 untranslated.
- **Stage 2 (`--fetch-ru`):** Reported "165 EN→RU pairs" but ALL pairs were gibberish. Investigated — `parse_poe2db_category_html` uses a `<tr><td>EN</td><td>RU</td></tr>` regex that matches poe2db's infobox stat rows, not item-name tables.
- **KI-30 documentation + fix:** Added new `--fetch-ru-by-item` stage that bypasses the category-page parser. For each untranslated item, fetches its individual poe2db page `https://poe2db.tw/ru/<Item_Name_With_Underscores>` and extracts the Russian name from the page `<title>` tag (format: `"<Russian Name> - PoE2DB, Path of Exile Wiki ru"`). The new `_extract_ru_name_from_title` function rejects pages whose title contains no Cyrillic and "Search Results" pages. Slug generation strips apostrophes (URL-encoded `%27` returns 404 on poe2db). Old `--fetch-ru` stage left as-is for backward-compat with `TestParsePoe2dbCategoryHtml`. Added 4 new test classes (12 tests).
- **Parallel fetcher:** The serial `--fetch-ru-by-item` took >9 minutes (346 items × 0.5s delay). Wrote `scripts/fetch_ru_by_item_parallel.py` — same logic but with `ThreadPoolExecutor(max_workers=6)`. Runs in ~20s.
- **Stage 2b retry (parallel):** Matched 337 of 346 items in 19.8s. The 9 no-match items are: `aldurs-legacy`, `betrayal-of-aldur`, `vision-rune`, `rebirth-rune`, `ward-rune`, `stone-rune`, `breath-of-aldur`, `ire-of-aldur`, `passion-of-aldur` (verified via curl — poe2db has pages for these but the titles show English/slug names, meaning poe2db has no Russian translation for them yet).
- **Stage 3 (`--diff`):** 643 total items, 297 already translated, 337 new candidates (matched), 0 conflicts, 9 no-match.
- **Stage 4 (`--apply --confirm`):** Applied 337 new translations to `backend/data/currency_names.json` (both `currency_names_ru` and `currency_names_en`). New counts: 686 RU + 686 EN (was 349+349). RU/EN key parity preserved.
- **Test count bump:** Updated `tests/test_currency_names_ru.py::test_dicts_load_from_json_and_are_non_empty` from `== 349` to `== 686`.
- **TS mirror sync:** Created `scripts/sync_currency_names_ts.py` — auto-regenerates `src/lib/currency-names.ts` from `backend/data/currency_names.json`. Ran it — produced 686 RU + 686 EN entries.
- **Verification:** pytest 1289/1289 pass (excluding 6 aiosqlite-dependent modules — pre-existing env issue). `tests/test_currency_names_ru.py` 7/7. `tests/test_sync_currency_names.py` 50/50 (39 existing + 11 new).

Stage Summary:
- **iter 137 SHIPPED — F1 unblock complete.** 337 new Russian translations added to `backend/data/currency_names.json` (counts 349 → 686 RU + 686 EN), mirrored into `src/lib/currency-names.ts`. 9 items remain untranslated (poe2db has no Russian page for them yet — they fall back to English in the UI).
- **Modified files (3 source + 3 test + 3 docs + 1 new script = 10 total):** `scripts/sync_currency_names_from_poe2db.py`, `backend/data/currency_names.json`, `src/lib/currency-names.ts`, `scripts/fetch_ru_by_item_parallel.py` (new), `scripts/sync_currency_names_ts.py` (new), `tests/test_currency_names_ru.py`, `tests/test_sync_currency_names.py`, `STATUS.md`, `worklog.md`, `AGENT_NAVIGATION.md`.
- **Test counts:** pytest 1289 green. `tests/test_currency_names_ru.py` 7/7. `tests/test_sync_currency_names.py` 50/50. 0 regressions.
