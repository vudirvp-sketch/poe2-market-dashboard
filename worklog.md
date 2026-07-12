# Worklog — PoE2 Market Dashboard

> Append-only shared multi-agent work log. Each section starts with `---`.
> Old task history is in `git log`. Trimmed to last 2 iterations.

---

Task ID: iter-147
Agent: main
Task: iter 147 — TD-6 phase 2. Extends translation pipeline to unique items (weapons, armour, accessories). User complaint (iter 145): "перевод корявый и не такой как в официальном клиенте игры!" — iter 146 fixed 32 currency drift items; iter 147 closes the 2nd half of the complaint: unique items had NO Russian translation at all (only the 17 currency categories were covered).

Work Log:
- Cloned repo. Read `STATUS.md` (iter 146 SHIPPED — KI-32 closed, 32 currency drift items fixed), `worklog.md` (iter 146 + iter 145), `AGENT_NAVIGATION.md` §1 + invariant #24.
- Inspected current state:
  - `backend/data/currency_names.json` — 4 top-level keys: `category_names_ru/en` (17) + `currency_names_ru/en` (686 each). NO unique-item translations.
  - `src/lib/poe2api.ts:1003-1051` — `mapUniqueItem` sets `name: raw.Text || raw.Name` (English only, no RU lookup).
  - `src/components/dashboard/unique-table.tsx:131` — displays `item.name` directly (no locale awareness).
  - Pipeline `scripts/sync_currency_names_from_poe2db.py` — 6 stages (1/2/2b/3/4/5/6) covering currency only.
- Verified poe2db unique-item index is reachable: `curl https://poe2db.tw/ru/Unique_item` → HTTP 200, 1.2 MB HTML. Found 446 `<span class="uniqueName">` entries. Each item is wrapped in `<a class="UniqueItem" href="/ru/SLUG"><span class="uniqueName">RU_NAME</span><span class="uniqueTypeLine">BASE_TYPE</span></a>`. Also fetched `/us/Unique_item` for EN names — same structure.
- **Designed keying strategy:** Unique items have NO ApiId in poe2scout (see `mapUniqueItem` comment at `poe2api.ts:1025-1029`). Keyed by poe2db URL slug (e.g. `Brynhands_Mark`). Slug derived from EN name via the existing `_en_name_to_poe2db_slug` logic (strip apostrophes + spaces→underscores). This makes the lookup `O(1)` and matches the poe2db href exactly.
- **Added Stage 7 `--fetch-unique-ru`** to `scripts/sync_currency_names_from_poe2db.py`:
  - New constants `UNIQUE_NAMES_CACHE = CACHE_DIR / "poe2db_unique_names.json"`, `POE2DB_UNIQUE_INDEX_PATH_RU = "/ru/Unique_item"`, `POE2DB_UNIQUE_INDEX_PATH_EN = "/us/Unique_item"`.
  - New regex `_POE2DB_UNIQUE_LINK_RE` matching `<a class="UniqueItem" href="..."> <span class="uniqueName">NAME</span>`.
  - New `parse_poe2db_unique_index_html(html_text)` → list of `{slug, name}` dicts. Slug = last path segment of href, URL-decoded (`urllib.parse.unquote`), deduped.
  - New `fetch_poe2db_unique_names(base_url)` — fetches RU + EN index pages, joins on slug, returns `{summary, items: [{slug, en_name, ru_name}]}`. Items present in only one language have the other set to None.
  - New `cmd_fetch_unique_ru(args)` CLI handler. Defensive `try/except ValueError` around `UNIQUE_NAMES_CACHE.relative_to(REPO_ROOT)` (same pattern as iter 146 `cmd_apply_audit`).
- **Added Stage 8 `--apply-unique --confirm`**:
  - New `apply_unique(unique_data, existing_names) -> (added, updated, skipped_no_change, skipped_partial)`. Mutates `existing_names["unique_names_ru"]` and `["unique_names_en"]` (creates them if absent). For each entry: ADD if slug is new + both names present; SKIP if idempotent match; UPDATE if values differ (drift refresh); SKIP if partial (only one name).
  - New `cmd_apply_unique(args)` CLI handler. Pre-flight: validate existing `currency_names_ru/en` key parity. Post-flight: validate `unique_names_ru/en` parity. Atomic write via `.json.tmp` + rename.
- **Updated module docstring** with Stage 7 + Stage 8 sections. Added usage examples for the unique-items pipeline + the monthly drift-refresh workflow.
- **Registered `--fetch-unique-ru` + `--apply-unique` flags** in argparse; added to `stage_count` sum; added dispatch branches. Updated `--confirm` help text to mention all three destructive flags (`--apply` / `--apply-audit` / `--apply-unique`).
- **Ran the pipeline:**
  - `python scripts/sync_currency_names_from_poe2db.py --fetch-unique-ru` → "Stage 7 COMPLETE — joined 446 unique items" (RU 446 entries, EN 445 entries, 1 EN-only: `Demigods_Virtue` — RU name present, EN missing in poe2db index).
  - `python scripts/sync_currency_names_from_poe2db.py --apply-unique --confirm` → "Stage 8 COMPLETE — 445 added, 0 updated, 0 skipped (no change), 1 skipped (partial)." The 1 partial skip is `Demigods_Virtue` (we want both names or neither — defensive).
  - Verified `currency_names.json` now has `unique_names_ru` (445 entries) and `unique_names_en` (445 entries), key parity preserved.
- **Updated `scripts/sync_currency_names_ts.py`** to emit `UNIQUE_NAMES_RU`/`UNIQUE_NAMES_EN` records + 4 new helper functions:
  - `enNameToUniqueSlug(enName)` — mirrors Python `_en_name_to_poe2db_slug` exactly (strip apostrophes + curly variants, replace spaces with underscores, preserve other chars including non-ASCII Latin).
  - `getUniqueRuName(slug)` / `getUniqueEnName(slug)` — direct slug → name lookup.
  - `getUniqueDisplayName(enName, locale)` — convenience: convert EN name → slug → look up localized name. Returns null when no mapping exists.
  - Added unique_names_ru/en key parity check (parallel to the existing currency/category checks).
  - Updated `print()` summary line to include "+ N unique items".
- **Ran `python scripts/sync_currency_names_ts.py`** → "Wrote src/lib/currency-names.ts — 686 RU + 686 EN + 17 categories + 445 unique items". Verified `UNIQUE_NAMES_RU` map at line 1462, `enNameToUniqueSlug` at line 2468, `getUniqueDisplayName` at line 2504.
- **Updated `src/lib/types.ts`** — added `nameRu?: string | null` field to `PoeItem` interface (optional, backward-compat — existing PoeItem literals don't need updating). Documented that this field is for unique items only (currencies use `getCurrencyDisplayName(apiId, locale)` at render time instead).
- **Updated `src/lib/poe2api.ts`:**
  - Added import: `import { enNameToUniqueSlug, getUniqueRuName } from "./currency-names";`
  - `mapUniqueItem` now computes `enName = raw.Text || raw.Name`, derives `uniqueSlug = enNameToUniqueSlug(enName)`, looks up `nameRu = getUniqueRuName(uniqueSlug)`, and sets `name: enName, nameRu` in the returned PoeItem.
- **Updated `src/components/dashboard/unique-table.tsx`:**
  - Changed `const { t } = useI18n()` → `const { t, locale } = useI18n()` (need locale to decide RU vs EN).
  - Changed `<span className="font-medium">{item.name}</span>` → `<span>{locale === "ru" && item.nameRu ? item.nameRu : item.name}</span>` with explanatory comment.
- **Added 26 new tests:**
  - `tests/test_sync_currency_names.py:TestParsePoe2dbUniqueIndexHtml` (7 tests): basic anchor, multiple anchors, dedupes duplicate slugs, unescapes HTML entities, URL-decodes %27 in slugs, ignores non-UniqueItem anchors, empty HTML.
  - `tests/test_sync_currency_names.py:TestFetchPoe2dbUniqueNames` (2 tests): joins RU+EN on slug, partial items tracked in summary.
  - `tests/test_sync_currency_names.py:TestApplyUnique` (8 tests): adds new entries, creates unique_names keys if absent, idempotent rerun, updates on drift, skips partial entries, preserves RU/EN parity, doesn't touch currency_names, empty items.
  - `tests/test_sync_currency_names.py:TestApplyUniqueCli` (4 tests): without --confirm returns 4, with other stage returns 4, missing cache returns 4, full pipeline on synthetic data.
  - `tests/test_sync_currency_names.py:TestFetchUniqueRuCli` (2 tests): with other stage returns 4, full pipeline with monkeypatched `_http_get_html`.
  - `tests/test_currency_names_ru.py` (3 new tests): `test_unique_names_dicts_load_and_are_non_empty`, `test_unique_names_ru_and_en_keys_match`, `test_unique_names_spot_check` (verifies `Brynhands_Mark` → `Клеймо Бринханда`).
- **Iter 1 test run failure → fix:** 2 tests failed initially:
  1. `test_handles_relative_href` — my regex requires href starting with `/`, but the test used relative href `Brynhands_Mark`. Inspected actual poe2db HTML — hrefs are always absolute (`/ru/...`). Removed the test (wrong assumption).
  2. `test_fetch_unique_ru_runs_full_pipeline` — `UNIQUE_NAMES_CACHE.relative_to(REPO_ROOT)` raised `ValueError` when cache is in `tmp_path`. Applied the same fix as iter 146's `cmd_apply_audit`: `try/except ValueError` around `.relative_to()` in `cmd_fetch_unique_ru`.
- **Iter 2 test run:** 102 tests in `test_currency_names_ru.py` + `test_sync_currency_names.py` all green.
- **Final verification:**
  - `pytest tests/` (full suite) → **1518 passed** (was 1492 in iter 146; +26 new tests). Zero regressions.
  - `npx tsc --noEmit` → clean (no type errors). The optional `nameRu?: string | null` field doesn't break existing PoeItem literals.
  - `npx jest --silent` → 690 passed (was 690 in iter 146). Zero regressions.
  - `npx eslint` on modified TS files → 0 errors, 6 pre-existing warnings (all unrelated to this iter: unused `useRef`/`fmt`, missing dep, `<img>` element, React Compiler incompatible-library warning).
- **Documentation updates:**
  - `STATUS.md` — header bump (iter 146 → iter 147); TD-6 row updated (Phase 2 SHIPPED iter 147); F1 row updated to mention `Demigods_Virtue` partial unique item; Quick Reference "unique items show English" row updated (was "deferred", now "SHIPPED iter 147"); Key Technical Insights "Translation pipeline" section expanded from 6 stages to 8 stages + added `enNameToUniqueSlug` mention; pytest baseline bumped 1492 → 1518.
  - `worklog.md` — added this iter-147 entry; removed iter-145 entry (rule: only last 2 iterations).
  - `AGENT_NAVIGATION.md` — header bump (iter 146 → iter 147); invariant #24 updated (mention unique-items support + Stage 7/8); workflow recipe for "Add a new Russian currency/item translation" updated (6-stage → 8-stage pipeline description).

Stage Summary:
- **iter 147 SHIPPED — TD-6 phase 2 complete. 445 unique items translated, 26 new tests, 1518 pytest + 690 Jest green.**
- **Modified files (5 source + 2 tests + 3 docs + 1 cache artifact):**
  - `scripts/sync_currency_names_from_poe2db.py` — added Stage 7 (`--fetch-unique-ru` + `parse_poe2db_unique_index_html` + `fetch_poe2db_unique_names` + `cmd_fetch_unique_ru`) + Stage 8 (`--apply-unique` + `apply_unique` + `cmd_apply_unique`) + module docstring update + argparse registration + dispatch + usage examples.
  - `scripts/sync_currency_names_ts.py` — emit `UNIQUE_NAMES_RU`/`UNIQUE_NAMES_EN` records + 4 new helper functions (`enNameToUniqueSlug`, `getUniqueRuName`, `getUniqueEnName`, `getUniqueDisplayName`) + unique_names key parity check + updated print summary.
  - `backend/data/currency_names.json` — added `unique_names_ru` (445 entries) + `unique_names_en` (445 entries) sections. Existing `currency_names_ru/en` and `category_names_ru/en` untouched.
  - `src/lib/currency-names.ts` — regenerated from JSON (auto-generated file). New `UNIQUE_NAMES_RU` map (line 1462) + `UNIQUE_NAMES_EN` map (line 1914) + 4 helper functions.
  - `src/lib/poe2api.ts` — added import from `./currency-names`; `mapUniqueItem` now populates `nameRu` via slug lookup.
  - `src/lib/types.ts` — added `nameRu?: string | null` field to `PoeItem` interface (optional, backward-compat).
  - `src/components/dashboard/unique-table.tsx` — uses `locale` from `useI18n()`; renders `item.nameRu ?? item.name` when `locale === "ru"`.
  - `tests/test_sync_currency_names.py` — added 23 new tests (7 parser + 2 fetch join + 8 apply_unique + 4 apply-unique CLI + 2 fetch-unique-ru CLI).
  - `tests/test_currency_names_ru.py` — added 3 new tests (unique_names load + key parity + spot-check).
  - `STATUS.md` — header bump + TD-6 phase 2 SHIPPED + F1 partial unique item note + Quick Reference updated + Key Technical Insights expanded (6 stages → 8 stages) + pytest baseline 1492 → 1518.
  - `worklog.md` — this iter-147 entry (removed iter-145).
  - `AGENT_NAVIGATION.md` — header bump + invariant #24 + workflow recipe updated.
  - `scripts/.cache/poe2db_unique_names.json` — Stage 7 cache artifact (445 joined items + 1 partial).
- **What was NOT done (intentionally deferred to iter 148+):**
  - **Other UI components still show EN for unique items** — only `unique-table.tsx` was updated to use `item.nameRu`. The following still render `item.name` directly: `comparison-dialog.tsx`, `comparative-chart.tsx`, `pair-comparison-dialog.tsx`, `leveling-uniques-widget.tsx`, `fuzzy-search.tsx` (search index uses EN). Future iter can extend `nameRu` usage to these components. No regression — they show EN, same as before iter 147.
  - **`Demigods_Virtue` partial unique item** — poe2db has RU (`Добродетель полубога`) but no EN in the index. Skipped by Stage 8 (we want both names or neither). Re-run `--fetch-unique-ru` after a poe2db update to pick it up.
  - **TD-6 Phase 3 — re-audit cycle** — re-run `--fetch-unique-ru` + `--apply-unique --confirm` monthly / after each patch to pick up new unique items. With iter 147's pipeline, this is now a 3-command workflow: `--fetch-unique-ru` → review cache → `--apply-unique --confirm` → `python scripts/sync_currency_names_ts.py`.
  - **Per-tab UX/logic deep-audit** — still deferred since iter 139. iter 141–147 only verified doc-level references + translation infrastructure. Full per-tab audit (i18n coverage, error states, empty states, loading skeletons, accessibility) is candidate for iter 148+.
  - **9 currency items still untranslated** (F1) + **1 no-Cyrillic** (`aldurs-saga`) — re-run `--fetch-ru-by-item` after a patch / monthly.
  - **TD-3 runtime log verification** — still deferred since iter 136 (requires prod access).
- **Stopping point:** iter 147 = TD-6 phase 2 complete (445 unique items translated via new `--fetch-unique-ru` + `--apply-unique` pipeline, 26 new tests, 1518 pytest + 690 Jest green). Next iter candidates: (a) extend `nameRu` usage to other UI components (comparison-dialog, comparative-chart, leveling-uniques-widget) — small scope, finishes the unique-items RU story; (b) per-tab UX/logic deep-audit (deferred since iter 139); (c) re-run F1 pipeline (`--fetch-ru-by-item`) after a patch / monthly to pick up 9 untranslated items; (d) TD-3 runtime log verification (requires prod access); (e) any new bugs the user identifies.

---

Task ID: iter-146
Agent: main
Task: iter 146 — TD-6 phase 1 / KI-32 fix. Closes candidate (a) from iter 145 stop point: add `--apply-audit` flag to `scripts/sync_currency_names_from_poe2db.py` (Stage 6 of the translation pipeline). Reads `scripts/.cache/translation_audit.json` (iter-145 Stage 5 output, 32 mismatches), overwrites every mismatch entry's value in `currency_names_ru` with the `poe2db_ru` value from the report. Requires `--confirm`. Does NOT touch `currency_names_en`. Then regenerate TS mirror + update spot-check assertions + add tests + update docs.

Work Log:
- Cloned repo. Read `STATUS.md` (iter 145 SHIPPED, KI-32 open, KI-33 fixed, TD-6 phase 1 planned), `worklog.md` (iter 145 + iter 144), `AGENT_NAVIGATION.md` §1 + invariant #24.
- Inspected audit artifact `scripts/.cache/translation_audit.json`: 32 mismatches confirmed (13 currency + 7 vaultkeys + 6 ultimatum + 3 lineagesupportgems/ritual/runes + 1 lineagesupportgems `uul-netols-embrace` actually). Fields per entry: `api_id` / `en_name` / `category_api_id` / `our_ru` / `poe2db_ru` / `poe2db_url`. Plus 1 `no_cyrillic` (`aldurs-saga`) and 0 `no_poe2db_page`.
- Inspected `scripts/sync_currency_names_from_poe2db.py` (1509 lines): 5 existing stages, module docstring, `apply_patch()` pattern at line 902 (good template for `apply_audit()`), `cmd_audit()` at line 1456 (good template for `cmd_apply_audit()`), argparse + stage_count + dispatch at `main()`.
- Inspected `tests/test_currency_names_ru.py:46-51` spot-check: only `exalted` needs to change (in audit mismatch list with `our_ru="Благородная сфера"`, `poe2db_ru="Сфера возвышения"`). `divine` and `mirror` are NOT in the mismatch list → their spot-check assertions stay unchanged.
- **Added Stage 6 `apply_audit()` function** to `scripts/sync_currency_names_from_poe2db.py:apply_audit` (after `audit_translations`, before Main CLI section):
  - Takes `(audit_report, existing_names)` → `(applied, skipped_no_change, skipped_not_in_json)`.
  - Iterates ONLY `audit_report["mismatches"]` (not `no_poe2db_page` / `no_cyrillic` — those are not actionable).
  - For each entry: if `current == poe2db_ru` → idempotent skip; if `current != our_ru` → stale audit skip (preserve manual edits); else → overwrite with `poe2db_ru`.
  - Mutates ONLY `currency_names_ru` values — does NOT touch `currency_names_en`, does NOT add/remove keys (RU/EN key parity preserved by construction).
- **Added `cmd_apply_audit(args)` CLI handler**: requires `--confirm` (returns 4 without it); reads `TRANSLATION_AUDIT_CACHE` (returns 4 if missing — "run --audit first"); reads `CURRENCY_NAMES_PATH`; pre-flight RU/EN key parity check; calls `apply_audit()`; post-flight parity check; atomic write via `.json.tmp` + rename. Display path uses `try/except ValueError` around `.relative_to(REPO_ROOT)` for robustness under symlinked / tmp_path-based invocation (helps tests + real-world weird layouts).
- **Registered `--apply-audit` flag** in argparse (between `--audit` and `--confirm`); added to `stage_count` sum; added dispatch branch `if args.apply_audit: return cmd_apply_audit(args)`. Updated `--confirm` help text to mention both `--apply` and `--apply-audit`. Updated `cmd_audit()` "Next steps" log to point at the new `--apply-audit --confirm` flag (was "future: --apply-audit flag").
- **Updated module docstring** with Stage 5 + Stage 6 sections (Stage 5 was previously only mentioned in passing; now formalized).
- **Updated `tests/test_currency_names_ru.py:46-51`**: `exalted` RU assertion changed from `"Благородная сфера"` to `"Сфера возвышения"`. Added explanatory comment citing iter 146 / TD-6 phase 1 / KI-32 fix. `divine` and `mirror` assertions unchanged (already match poe2db per audit).
- **Updated `scripts/sync_currency_names_ts.py:67`**: stale docstring example comment `// "Благородная сфера"` → `// "Сфера возвышения"` (auto-emitted into the TS file header).
- **Added 12 new tests to `tests/test_sync_currency_names.py`**:
  - `TestApplyAudit` (8 tests): `test_overwrites_mismatch_entries_with_poe2db_value`, `test_does_not_touch_currency_names_en`, `test_preserves_ru_en_key_parity`, `test_idempotent_rerun_is_noop`, `test_skips_when_current_differs_from_audit_our_ru` (stale-audit guard), `test_skips_when_api_id_not_in_json` (defensive), `test_ignores_no_poe2db_page_and_no_cyrillic_entries`, `test_empty_mismatches_returns_zero`.
  - `TestApplyAuditCli` (4 tests): `test_apply_audit_without_confirm_returns_4` (uses `caplog` not `capsys.err` — pytest captures logging separately), `test_apply_audit_with_other_stage_returns_4`, `test_apply_audit_missing_audit_cache_returns_4` (monkeypatches `TRANSLATION_AUDIT_CACHE` to a non-existent path), `test_apply_audit_runs_full_pipeline_on_synthetic_data` (full end-to-end: synthetic audit cache + synthetic currency_names.json in `tmp_path` + monkeypatched `CURRENCY_NAMES_PATH` → verify file is written with corrected value, EN untouched, parity preserved, log output contains "Stage 6 COMPLETE" + "1 applied").
- **Iter 1 test run failure → fix:** 3 CLI tests failed because (a) `capsys.readouterr().err` returns empty for `logging.error()` output — pytest captures log separately via `caplog` fixture; (b) `CURRENCY_NAMES_PATH.relative_to(REPO_ROOT)` raises `ValueError` when the path is in `tmp_path` (not under `REPO_ROOT`). Fixed by switching the 2 affected tests to use `caplog` fixture + adding a `try/except ValueError` around the `.relative_to()` call in `cmd_apply_audit` (more robust production code, helps both tests and real-world symlinked invocation).
- **Iter 2 test run:** 69 tests in `test_sync_currency_names.py` all green (57 existing + 12 new).
- **Applied the audit:** `python scripts/sync_currency_names_from_poe2db.py --apply-audit --confirm` → "Stage 6 COMPLETE — 32 applied, 0 skipped (no change / idempotent), 0 skipped (not in JSON)." Verified `exalted` now `"Сфера возвышения"`, `fracturing-orb` now `"Раскалывающая сфера"`, `vaal` now `"Сфера ваал"`, `alch` now `"Сфера алхимии"`, `regal` now `"Сфера царей"`, `the-trialmasters-reliquary-key` now `"Ключ от Реликвария Мастера испытаний"`, `xopecs-soul-core-of-power` now `"Ядро душ могущества Шопека"`. Counts unchanged: 686 RU + 686 EN (values only mutated). RU/EN key parity preserved.
- **Regenerated TS mirror:** `python scripts/sync_currency_names_ts.py` → "Wrote src/lib/currency-names.ts — 686 RU + 686 EN + 17 categories". Verified line 14 docstring example now reads `// "Сфера возвышения"` and line 29 reads `"exalted": "Сфера возвышения",`.
- **Final test verification:**
  - `pytest tests/test_currency_names_ru.py tests/test_sync_currency_names.py -v` → 76 passed (8 + 69 - 1 shared = 76).
  - `pytest tests/` (full suite) → **1492 passed** (was 1466 in iter 145; +26 = 12 new TestApplyAudit/TestApplyAuditCli + 14 from aiosqlite install enabling previously-skipped modules to load). Zero regressions.
- **Documentation updates:**
  - `STATUS.md` — header bump (iter 145 → iter 146); KI-32 moved from "open" to new "closed (kept for recovery recipes)" section with full root-cause + fix narrative; TD-6 row updated (Phase 1 SHIPPED iter 146); F1 row updated (mismatches FIXED iter 146); Quick Reference "translation drift" row updated (KI-32 → FIXED iter 146 with `--apply-audit` recipe); Key Technical Insights "Translation pipeline" section expanded from 5 stages to 6 stages; pytest baseline bumped 1466 → 1492.
  - `worklog.md` — added this iter-146 entry; removed iter-144 entry (rule: only last 2 iterations).
  - `AGENT_NAVIGATION.md` — header bump (iter 145 → iter 146); invariant #24 updated (mention `--apply-audit` flag); workflow recipe for "Add a new Russian currency/item translation" updated (5-stage → 6-stage pipeline description).

Stage Summary:
- **iter 146 SHIPPED — TD-6 phase 1 complete, KI-32 CLOSED. 32 drift items fixed, 12 new tests, 1492 pytest green.**
- **Modified files (4 source + 3 tests/docs):**
  - `scripts/sync_currency_names_from_poe2db.py` — added Stage 6 (`--apply-audit` flag + `apply_audit()` + `cmd_apply_audit()` + module docstring update + `--audit` "Next steps" pointer + `cmd_apply_audit` defensive `relative_to` handling).
  - `scripts/sync_currency_names_ts.py` — 1-line docstring example comment fix (`Благородная сфера` → `Сфера возвышения`).
  - `backend/data/currency_names.json` — 32 RU values overwritten with poe2db official (idempotent, RU/EN parity preserved, count unchanged at 686).
  - `src/lib/currency-names.ts` — regenerated from JSON (auto-generated file, 32 RU values changed, docstring example comment updated).
  - `tests/test_currency_names_ru.py` — 1 spot-check assertion updated (`exalted` RU name) + explanatory comment.
  - `tests/test_sync_currency_names.py` — added 12 tests (TestApplyAudit 8 + TestApplyAuditCli 4).
  - `STATUS.md` — header bump + KI-32 moved to closed + TD-6 phase 1 SHIPPED + F1 updated + Quick Reference updated + Key Technical Insights expanded (5 stages → 6 stages) + pytest baseline 1466 → 1492.
  - `worklog.md` — this iter-146 entry (removed iter-144).
  - `AGENT_NAVIGATION.md` — header bump + invariant #24 + workflow recipe updated.
- **What was NOT done (intentionally deferred to iter 147+):**
  - **TD-6 Phase 2 — unique items RU support:** Extend pipeline to crawl `poe2db.tw/ru/Unique_item` index page → per-item page `<title>` extraction. Add `unique_names_ru` / `unique_names_en` sections (either new file `unique_names.json` or new top-level keys in `currency_names.json`). Update `mapUniqueItem` in `src/lib/poe2api.ts:1030` to look up RU name when locale=ru. Add UI tests for RU locale rendering of unique items. Largest scope, addresses the 2nd half of user's complaint about missing RU for unique items.
  - **TD-6 Phase 3 — re-audit cycle:** Re-run `--audit` monthly / after each patch to catch new drift. With iter 146's `--apply-audit` flag, this is now a 2-command workflow: `--audit` → review → `--apply-audit --confirm` → `python scripts/sync_currency_names_ts.py`.
  - **Per-tab UX/logic deep-audit** — still deferred since iter 139. iter 141–146 only verified doc-level references + translation infrastructure. Full per-tab audit (i18n coverage, error states, empty states, loading skeletons, accessibility) is candidate for iter 147+.
  - **9 currency items still untranslated** (F1) + **1 no-Cyrillic** (`aldurs-saga`) — re-run `--fetch-ru-by-item` after a patch / monthly.
  - **TD-3 runtime log verification** — still deferred since iter 136 (requires prod access).
- **Stopping point:** iter 146 = TD-6 phase 1 complete + KI-32 closed (32 drift items fixed via new `--apply-audit` flag, 12 new tests, 1492 pytest green). Next iter candidates: (a) **TD-6 Phase 2** — extend pipeline to unique items (largest scope, addresses user's 2nd complaint about missing RU for unique items); (b) per-tab UX/logic deep-audit (deferred since iter 139); (c) re-run F1 pipeline (`--fetch-ru-by-item`) after a patch / monthly to pick up 9 untranslated items; (d) TD-3 runtime log verification (requires prod access); (e) any new bugs the user identifies.
