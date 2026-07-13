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

Task ID: iter-148
Agent: main
Task: iter 148 — TD-6 phase 2 follow-up. Closes candidate (a) from iter 147 stop point: extend `nameRu` rendering to the remaining UI components that displayed unique-item names in EN only. The iter-147 worklog listed 5 candidates: `comparison-dialog.tsx`, `comparative-chart.tsx`, `pair-comparison-dialog.tsx`, `leveling-uniques-widget.tsx`, `fuzzy-search.tsx`. Inspection during iter 148 revealed `pair-comparison-dialog.tsx` was a mis-classification — it renders `pair.label` (currency pair string), not `item.name` (unique item). However, it had a separate pre-existing locale-staleness bug (KI-34) that was fixed in the same iter.

Work Log:
- Cloned repo. Read `STATUS.md` (iter 147 SHIPPED — 445 unique items translated, KI-32/KI-33 closed, KI-34 not yet discovered), `worklog.md` (iter 147 + iter 146), `AGENT_NAVIGATION.md` §1 + invariant #24.
- Inspected all 5 candidate files in parallel to understand the rendering surface:
  - `comparison-dialog.tsx` — renders `item.name` in chip (line 201) and via `seriesMeta.name` (line 134) for tooltip/legend/summary table.
  - `comparative-chart.tsx` — same pattern as comparison-dialog, plus correlation matrix `names` array (lines 278, 280) and chip rendering (line 395).
  - `pair-comparison-dialog.tsx` — renders `pair.label` (currency pair string, NOT unique-item name). The label IS locale-aware at add-time (built via `getCurrencyDisplayName(pair.currency1Id, locale)` in both `exchange-table.tsx:698` and `exchange-pair-card.tsx:81`), BUT frozen in the zustand store → switching locale doesn't refresh the dialog. This is **KI-34** (newly identified this iter).
  - `leveling-uniques-widget.tsx` — uses backend `LevelingUnique` type (NO `nameRu` field) instead of `PoeItem`. Needs `getUniqueDisplayName(unique.name, locale)` at render time.
  - `fuzzy-search.tsx` — builds a search index with `item.name` (EN). Needs locale-aware `name` + `nameAlt` for cross-locale search.
- Verified baseline: 1518 pytest green + 690 Jest green + tsc clean. Installed `aiosqlite` in venv (env-only — see Quick Reference).
- **Modified `src/components/dashboard/comparison-dialog.tsx`:**
  - In `seriesMeta` builder: replaced `name: item?.name || h.itemId` with locale-aware lookup `locale === "ru" && item?.nameRu ? item.nameRu : (item?.name || h.itemId)`. Added `locale` to useMemo deps.
  - In chip rendering: replaced `{item.name}` with the same locale-aware pattern.
- **Modified `src/components/dashboard/comparative-chart.tsx`:**
  - Same seriesMeta.name change as comparison-dialog.
  - In correlation matrix builder (backend branch): replaced `names.push(item.name)` and `itemsWithoutCorrelation.push(item.name)` with locale-aware `itemDisplayName` variable.
  - In chip rendering: replaced `{item.name}` with locale-aware pattern.
  - Added `locale` to both useMemo deps (seriesMeta + correlationMatrix).
- **Modified `src/components/dashboard/leveling-uniques-widget.tsx`:**
  - Imported `getUniqueDisplayName` from `@/lib/currency-names`.
  - Added `locale: string` to `UniqueRowProps` interface.
  - Pass `locale={locale}` from `LevelingUniquesWidget` to each `UniqueRow`.
  - In `UniqueRow` body: compute `displayName = locale === "ru" ? getUniqueDisplayName(unique.name, "ru") ?? unique.name : unique.name` and render `{displayName}` instead of `{unique.name}`.
  - Documented known coverage limitation in the import comment: of the 10 leveling uniques, ~1-2 currently have a poe2db RU match because poe2db slugs don't always match the curated backend names (e.g. "Polcirkeln Sapphire Ring" → slug `Polcirkeln_Sapphire_Ring` doesn't match poe2db slug `Polcirkeln`). Full coverage would require a curated `nameRu` field on the backend `LevelingUniqueData` model — deferred.
- **Modified `src/components/dashboard/fuzzy-search.tsx`:**
  - Imported `getCurrencyDisplayName` and `getUniqueDisplayName` from `@/lib/currency-names`.
  - Added `nameAlt: string | null` to `SearchItem` interface.
  - Destructured `locale` from `useI18n()`.
  - For exchange pairs: compute `enName` (upstream) and `ruName` (via `getCurrencyDisplayName`); set `name` = locale-appropriate, `nameAlt` = the OTHER language's name when it differs.
  - For PoeItem entries: compute `ruUnique = item.nameRu ?? getUniqueDisplayName(item.name, "ru")`; same primary/alt logic.
  - Updated fuse.js keys: `name` (weight 0.6) + `nameAlt` (weight 0.25) + `secondary` (weight 0.15). Previously: `name` (0.7) + `secondary` (0.3).
  - Added `locale` to useMemo deps for `searchItems`.
- **Documented KI-34 in `STATUS.md` BEFORE fixing it** (per user rule "Если найден новый баг — сначала документируй в STATUS.md как Known Issue, потом фиксись"). KI-34 = PairComparisonDialog labels frozen at add-time. Fix: `liveLabel(pair)` helper that re-derives from `pair.currency1Id` / `pair.currency2Id` via `getCurrencyDisplayName(..., locale)` on every render, with stored `pair.label` as fallback.
- **Modified `src/components/dashboard/pair-comparison-dialog.tsx` (KI-34 fix):**
  - Imported `getCurrencyDisplayName` from `@/lib/currency-names`.
  - Added `liveLabel(pair: PairComparisonId): string` helper at the top of the component. Uses `getCurrencyDisplayName` for both currencies in the current locale; falls back to `pair.label` if either lookup returns null.
  - Changed queryFn result: store `pair` object instead of `label` string (so `liveLabel` can re-derive on every render).
  - In seriesMeta builder: replaced `name: h.label || h.pairKey` with `name: h.pair ? liveLabel(h.pair) : h.pairKey`. Added `locale` to useMemo deps.
  - In chip rendering: replaced `{pair.label}` with `{liveLabel(pair)}`.
- **Added 14 new tests in `src/__tests__/unique-items-i18n.test.tsx`:**
  - ComparisonDialog (3 tests): RU name in chip when nameRu set; EN fallback when nameRu null; EN name when locale=en.
  - ComparativeChart (2 tests): RU name in chip; EN name when locale=en.
  - LevelingUniquesWidget (3 tests): RU name via `getUniqueDisplayName("Mind of the Council")` → "Разум Совета"; EN fallback for "Polcirkeln Sapphire Ring" (slug mismatch); EN name when locale=en.
  - FuzzySearch (4 tests): RU name in result list; cross-locale search (EN query finds RU-primary item via nameAlt); EN name when locale=en; EN fallback when item has no nameRu.
  - PairComparisonDialog (2 tests): KI-34 fix — re-derives RU label from `currency1Id`/`currency2Id` even when stored label is EN; re-derives EN label even when stored label is RU.
- **Iter 1 test run failure → fix:** 1 of 14 tests failed initially: I assumed divine's RU name was "Сфера божественности" but the actual translation in `currency-names.ts` is "Божественная сфера". Fixed the regex assertion to match the full label string `Сфера хаоса / Божественная сфера`.
- **Iter 2 test run:** all 14 tests green.
- **Iter 3 (cleanup):** ESLint flagged 3 unused vars in the test file: `within` import, `makeExchangePair` helper (never called), `itemId` parameter in `makeHistory`. Removed all 3. Re-ran ESLint → 0 warnings on the test file. Re-ran tests → still 14 green.
- **Final verification:**
  - `pytest tests/` → **1518 passed** (unchanged from iter 147 — no Python changes this iter). Zero regressions.
  - `npx tsc --noEmit` → clean (no type errors). The `nameAlt: string | null` field doesn't break any existing SearchItem consumers.
  - `npx jest --silent` → **704 passed** (was 690 in iter 147; +14 new tests). Zero regressions.
  - `npx eslint` on modified TS files → 0 errors, 10 warnings (all pre-existing: unused `useQueryClient`/`COLOR_NAMES`/`Table2`/`comparedApiIds`/`phase`/`activeTab`, `<img>` element, React Compiler warning). My changes added 0 new warnings.
- **Documentation updates:**
  - `STATUS.md` — header bump (iter 147 → iter 148); added KI-34 to closed section (with full root-cause + fix narrative); TD-6 row updated (Phase 2 follow-up SHIPPED iter 148); Quick Reference "unique items show English" row updated (now mentions ALL 5 components covered + leveling-uniques coverage limitation); added new Quick Reference row for KI-34; Key Technical Insights expanded with new "UI nameRu rendering pattern" section covering iter 147 + iter 148 lessons; open Known Issues section now empty (was KI-33 open).
  - `worklog.md` — added this iter-148 entry; removed iter-146 entry (rule: only last 2 iterations).
  - `AGENT_NAVIGATION.md` — header bump (iter 147 → iter 148); invariant #24 updated to mention all 5 components covered.

Stage Summary:
- **iter 148 SHIPPED — TD-6 phase 2 follow-up complete. 5 components now use nameRu when locale=ru, KI-34 closed, 14 new tests, 1518 pytest + 704 Jest green.**
- **Modified files (5 source + 1 test + 3 docs):**
  - `src/components/dashboard/comparison-dialog.tsx` — seriesMeta.name + chip rendering use locale-aware lookup; `locale` added to useMemo deps.
  - `src/components/dashboard/comparative-chart.tsx` — seriesMeta.name + correlation matrix names + chip rendering use locale-aware lookup; `locale` added to 2 useMemo deps.
  - `src/components/dashboard/leveling-uniques-widget.tsx` — imports `getUniqueDisplayName`; `UniqueRow` accepts `locale` prop; renders `getUniqueDisplayName(unique.name, "ru") ?? unique.name` when locale=ru.
  - `src/components/dashboard/fuzzy-search.tsx` — `SearchItem.nameAlt` field added; search index uses locale-aware `name` + cross-locale `nameAlt`; fuse.js keys updated to 3-key weighted search.
  - `src/components/dashboard/pair-comparison-dialog.tsx` — KI-34 fix: `liveLabel(pair)` helper re-derives label from `currency1Id`/`currency2Id` via `getCurrencyDisplayName`; queryFn stores `pair` object instead of `label`; chip + seriesMeta use `liveLabel`.
  - `src/__tests__/unique-items-i18n.test.tsx` — NEW test file with 14 tests covering all 5 components.
  - `STATUS.md` — header bump + KI-34 added to closed + TD-6 row updated + 2 Quick Reference rows updated + Key Technical Insights "UI nameRu rendering pattern" section added.
  - `worklog.md` — this iter-148 entry (removed iter-146).
  - `AGENT_NAVIGATION.md` — header bump + invariant #24 updated.
- **What was NOT done (intentionally deferred to iter 149+):**
  - **Per-tab UX/logic deep-audit** — still deferred since iter 139. iter 148 only extended nameRu rendering. Full per-tab audit (i18n coverage, error states, empty states, loading skeletons, accessibility) is candidate for iter 149+.
  - **Leveling-uniques-widget full RU coverage** — currently ~1-2 of 10 leveling uniques have a poe2db RU match (slug mismatch). Full coverage would require adding a `nameRu` field to the backend `LevelingUniqueData` model in `backend/economy/leveling_uniques.py` and manually populating it for the 10 curated items. Deferred to iter 149+.
  - **Re-run F1 pipeline** (`--fetch-ru-by-item`) — 9 currency items still untranslated + 1 no-Cyrillic (`aldurs-saga`). Re-run after a patch / monthly.
  - **TD-6 Phase 3 — re-audit cycle** — monthly `--audit` + `--apply-audit` (currency) + `--fetch-unique-ru` + `--apply-unique` (unique items) + `python scripts/sync_currency_names_ts.py`. Routine maintenance.
  - **TD-3 runtime log verification** — still deferred since iter 136 (requires prod access).
- **Stopping point:** iter 148 = TD-6 phase 2 follow-up complete (5 UI components use nameRu when locale=ru, KI-34 closed, 14 new tests, 1518 pytest + 704 Jest green). Next iter candidates: (a) per-tab UX/logic deep-audit (deferred since iter 139 — large scope); (b) leveling-uniques-widget full RU coverage via backend `nameRu` field (small scope, finishes the unique-items RU story); (c) re-run F1 pipeline (`--fetch-ru-by-item`) after a patch / monthly to pick up 9 untranslated items; (d) TD-3 runtime log verification (requires prod access); (e) any new bugs the user identifies.
