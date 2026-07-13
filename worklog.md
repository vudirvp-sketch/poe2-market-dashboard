# Worklog — PoE2 Market Dashboard

> Append-only shared multi-agent work log. Each section starts with `---`.
> Old task history is in `git log`. Trimmed to last 2 iterations.

---

Task ID: iter-149
Agent: main
Task: iter 149 — delete the Gold Map ROI (P10) tab completely per user request: «вкладку gold roi --- удали чисто, отовсюду упоминания и прочее, она бесполезная!» The tab shipped iter 127 (calculator) + iter 132 (trend chart) but was deemed not useful enough to keep.

Work Log:
- Cloned repo. Read `STATUS.md` (iter 148 SHIPPED), `worklog.md` (iter 148 + iter 147).
- Audited all mentions of `gold-map-roi` / `GoldMapRoi` / `goldMap*` / `P10` / `tabGoldMapRoi` / `fallbackGoldMapRoi` / `poe2-gold-map-roi-inputs` across the codebase. Found 21 files referencing the feature.
- **Deleted files (8 total):**
  - `src/components/dashboard/gold-map-roi-tab.tsx` — top-level tab content.
  - `src/components/dashboard/gold-map-roi-calculator.tsx` — ROI calculator (gold → Div via best 3-way chain, minus map cost).
  - `src/components/dashboard/gold-map-roi-trend-chart.tsx` — historical best-cycle profit % SVG line chart.
  - `src/__tests__/gold-map-roi-tab.test.tsx` — tab integration tests.
  - `src/__tests__/gold-map-roi-calculator.test.ts` — calculator unit tests.
  - `src/__tests__/gold-map-roi-trend-chart.test.tsx` — trend chart tests.
  - `docs/design/P10-gold-map-roi-design.md` — design doc.
  - `src/app/api/flipper/triangular/history/route.ts` — Next.js proxy route (only consumer was the trend chart).
- **Kept (NOT deleted):**
  - Backend route `/api/v1/arbitrage/triangular/history` (TD-3 Phase 3 persistence — has its own pytest suite in `tests/test_triangular_cycles_route.py`, 13 tests).
  - TS types `TriangularCycleHistoryPoint` / `TriangularCyclesHistoryResponse` in `src/lib/types.ts` — describe the backend response shape; updated comments to reference the backend route directly (was: `/api/flipper/triangular/history`).
- **Modified source files:**
  - `src/components/dashboard/dashboard-toolbar.tsx` — removed `MapPin` from lucide imports + removed the `TabsTrigger value="gold-map-roi"` block (4 lines).
  - `src/components/dashboard/dashboard-page.tsx` — removed `GoldMapRoiTab` dynamic import (8 lines); removed `"gold-map-roi"` from `TAB_MAP` (now 15 entries, was 16); removed the `TabsContent value="gold-map-roi"` block (5 lines); updated TAB_MAP comment block (removed P10 references, added iter-149 removal note).
  - `src/lib/i18n/locales/en.ts` — removed 49 keys (`tabGoldMapRoi`, `fallbackGoldMapRoi`, 47 `goldMap*` keys).
  - `src/lib/i18n/locales/ru.ts` — same 49 keys removed.
  - `src/lib/i18n/locales/ko.ts` — same 49 keys removed.
  - `src/lib/i18n/locales/zh.ts` — same 49 keys removed (Python script used to handle non-ASCII chars reliably).
  - `src/lib/types.ts` — updated 2 docstring URLs from `/api/flipper/triangular/history` to `/api/v1/arbitrage/triangular/history` (since the proxy route is gone).
- **Documentation updates:**
  - `STATUS.md` — header bump (iter 148 → iter 149); added KI-35 (Gold Map ROI tab deleted) to closed section with full inventory of what was removed vs kept; removed the P10 design-doc row from Design-docs table; removed the "Gold Map ROI trend chart shows No cycle history yet" row from Quick Reference; removed the "iter 132" reference from "Dependency-free SVG line chart pattern" insight (kept the insight itself — pattern is generic, canonical template `storage-value-history-chart.tsx` still exists).
  - `AGENT_NAVIGATION.md` — removed `P10-gold-map-roi-design.md` from the `docs/design/` row.
  - `docs/ARCHITECTURE.md` — header version bump (1.1 → 1.2); updated layer diagram (16 → 15 tabs, removed Gold Map ROI line); removed the Gold Map ROI row from the tabs table; updated "Removed tabs" note (added Gold Map ROI iter 149 KI-35).
  - `docs/DATA_FLOW.md` — header version bump (1.3 → 1.4); removed `/api/flipper/triangular/history` line from §6 proxy-route listing; removed `triangular/history/route.ts` line from §6 file-mapping; removed the "Gold Map ROI" row from §9 tabs table (renumbered 14-15-16 → 13-14-15); added `Gold Map ROI` to "Removed tabs" list.
  - `docs/DATA_CONTRACTS.md` — header version bump (1.2 → 1.3); removed `/api/flipper/triangular/history` row from the proxy-route mapping table.
  - `docs/MARKET_PLAYBOOK.md` — header bump (iter 142 → iter 149); §B P10 row marked «Удалён iter 149 (KI-35)»; §C P10 row marked «удалён iter 149»; §D.2 P10 row marked «Удалён iter 149 (KI-35)»; §E removed `P10-gold-map-roi-design.md` from related docs; §A P10 pattern entry KEPT (it's the market-pattern inventory from the video guide, not a code reference); §B summary updated (10 ready → 9 ready + 1 deleted).
  - `docs/design/TD-3-4-5-9-persistence-gaps-design.md` — removed the §C.8 P10 cross-reference from the related-docs list.
- **Final verification:**
  - `npx tsc --noEmit` → clean (0 errors).
  - `npx eslint .` → 0 errors, 110 warnings (all pre-existing; 0 new warnings from my changes — verified by running ESLint on the 7 modified TS files individually).
  - `npx jest --silent` → **640 passed** (was 704 in iter 148; -64 = 3 deleted gold-map-roi test files).
  - `pytest tests/ --ignore=tests/e2e` → **1518 passed** (unchanged from iter 148 — no Python changes this iter).
- **Worklog trim:** removed iter-147 section (rule: last 2 iterations only). Kept iter-148 + iter-149.

Stage Summary:
- **iter 149 SHIPPED — Gold Map ROI (P10) tab fully removed. 8 files deleted, 11 files modified, 49 i18n keys × 4 locales stripped, TAB_MAP 16 → 15 entries. 1518 pytest + 640 Jest green + tsc clean + 0 new ESLint warnings.**
- **What was NOT done (intentionally deferred to iter 150+):**
  - **Per-tab UX/logic deep-audit** — still deferred since iter 139. iter 149 was a tab DELETION, not a per-tab audit. Candidate for iter 150+.
  - **Leveling-uniques-widget full RU coverage** — still deferred since iter 148. Add `nameRu` field to backend `LevelingUniqueData` model + manually populate for 10 curated items.
  - **Re-run F1 pipeline** (`--fetch-ru-by-item`) — 9 currency items still untranslated + 1 no-Cyrillic (`aldurs-saga`). Re-run after a patch / monthly.
  - **TD-6 Phase 3 — re-audit cycle** — monthly `--audit` + `--apply-audit` (currency) + `--fetch-unique-ru` + `--apply-unique` (unique items) + `python scripts/sync_currency_names_ts.py`. Routine maintenance.
  - **TD-3 runtime log verification** — still deferred since iter 136 (requires prod access).
- **Stopping point:** iter 149 = Gold Map ROI (P10) tab fully deleted (8 files deleted, 11 modified, 49 i18n keys × 4 locales stripped, 1518 pytest + 640 Jest green + tsc clean + 0 new ESLint warnings). Next iter candidates: (a) per-tab UX/logic deep-audit (deferred since iter 139 — large scope); (b) leveling-uniques-widget full RU coverage via backend `nameRu` field (small scope, finishes the unique-items RU story); (c) re-run F1 pipeline (`--fetch-ru-by-item`) after a patch / monthly to pick up 9 untranslated items; (d) TD-3 runtime log verification (requires prod access); (e) any new bugs the user identifies.

---

Task ID: iter-150
Agent: main
Task: iter 150 — Leveling-uniques-widget full RU coverage. Closes candidate (b) from iter 149 stop point: add `nameRu` field to the backend `LevelingUniqueData` model and populate curated poe2db RU translations, removing the widget's dependency on the fragile `getUniqueDisplayName(name, "ru")` slug-lookup (which had ~1/10 coverage due to slug mismatch — see iter-148 worklog). Per principle «лучше недоделать, чем сломать»: only populate confirmed poe2db translations, leave the rest as `None` with a documented extension path.

Work Log:
- Cloned repo. Read `STATUS.md` (iter 149 SHIPPED), `worklog.md` (iter 149 + iter 148), `AGENT_NAVIGATION.md` §1 + invariant #24.
- Inspected the 4 candidate files for the change:
  - `backend/economy/leveling_uniques.py` — `_LEVELING_UNIQUES` static table (10 entries), `_LEVELING_UNIQUES_NOTES_RU` parallel notes dict, `compute_leveling_uniques_lifecycle` returns dict per unique.
  - `backend/api/response_models.py:LevelingUniqueData` — Pydantic model with id/name/category/peak_day/.../notes (no nameRu).
  - `src/components/dashboard/leveling-uniques-widget.tsx:UniqueRow` — uses `getUniqueDisplayName(unique.name, "ru") ?? unique.name` (iter 148 impl).
  - `src/lib/types.ts:LevelingUnique` — TS interface (no nameRu).
- **Coverage analysis (4/10 confirmed):** queried `scripts/.cache/poe2db_unique_names.json` for the 10 leveling-unique EN names. Found poe2db RU matches for 4:
  - `polcirkeln-sapphire-ring` → "Полярный круг" (poe2db slug `Polcirkeln`)
  - `megalomaniac-diamond` → "Мания величия" (poe2db slug `Megalomaniac`)
  - `mind-of-the-council` → "Разум Совета" (poe2db slug `Mind_of_the_Council` — confirmed iter 147)
  - `soul-tether-amulet` → "Оковы души" (poe2db slug `Soul_Tether`)
  - Other 6 (Wall of Brambles / Mana Leech Support / Feeding Frenzy Support / Echoes of Worldstone / Boots of Momentum / Wings of Entropy) NOT in poe2db cache — left as `None` with documented extension path. This avoids inventing translations.
- **Modified `backend/economy/leveling_uniques.py`:**
  - Module docstring i18n section rewritten: explains `name_ru` field (curated, locale-independent) + the 4/10 coverage + extension path (re-run `--fetch-unique-ru` after poe2db update).
  - Static-table comment block: added `name_ru` field documentation.
  - Each of the 10 entries in `_LEVELING_UNIQUES` got a `"name_ru": <value>` field — 4 strings + 6 `None`.
  - `_LEVELING_UNIQUES_NOTES_RU` comment block: updated to mention `name_ru` is now on the main table.
  - `compute_leveling_uniques_lifecycle` lang param docstring: updated to mention `name_ru` is identical across locales.
  - `compute_leveling_uniques_lifecycle` return-shape docstring: added `name_ru: str | None` to the uniques dict schema.
  - The `uniques_out.append({...})` block: added `"name_ru": entry.get("name_ru")` (defensive .get() in case future entries miss the field).
- **Modified `backend/api/response_models.py:LevelingUniqueData`:**
  - Added `name_ru: str | None = Field(default=None, description=...)` with full docstring explaining the 4/10 coverage + extension path.
- **Modified `backend/api/routes_leveling_uniques.py`:**
  - Top docstring: added iter-150 paragraph explaining the curated `name_ru` field + the 4/10 coverage + that the widget no longer depends on `getUniqueDisplayName` slug-lookup.
  - `lang` Query description: added `name_ru` to the list of locale-independent fields.
  - Route function docstring: added `name_ru` to the per-item bullet list + added "name_ru is returned for all locales" note.
- **Modified `src/lib/types.ts:LevelingUnique`:**
  - Added `nameRu?: string | null` field with full JSDoc.
- **Modified `src/components/dashboard/leveling-uniques-widget.tsx`:**
  - Replaced the iter-148 `getUniqueDisplayName` import + comment with an iter-150 comment explaining the curated backend field.
  - `UniqueRow` displayName logic: `locale === "ru" && unique.nameRu ? unique.nameRu : unique.name` (was `locale === "ru" ? getUniqueDisplayName(unique.name, "ru") ?? unique.name : unique.name`).
  - `UniqueRowProps.locale` JSDoc updated to "iter 150".
- **Modified `tests/test_leveling_uniques.py` (+9 tests):**
  - `TestStaticTableIntegrity.test_all_entries_have_required_fields`: added `name_ru` to required_fields.
  - `TestStaticTableIntegrity.test_name_ru_is_str_or_none` (NEW): verifies `name_ru` is None or non-empty str (empty string would render as blank cell).
  - `TestComputeLevelingUniquesLifecycle.test_each_unique_has_all_required_fields`: added `name_ru` to required_fields.
  - `TestRussianLocalization.test_ru_keeps_non_notes_fields_identical_to_en`: added `name_ru` to non_notes_fields list (it's a curated static field, locale-independent).
  - `TestNameRuCuratedField` (NEW class, 5 tests):
    - `test_all_expected_ru_names_are_present` — verifies 4 expected RU names.
    - `test_other_items_have_none_name_ru` — verifies the 6 None items match the expected set.
    - `test_name_ru_returned_for_all_locales` — verifies name_ru is identical for lang=en and lang=ru.
    - `test_name_ru_count_is_4_of_10` — guards against accidental regression (count check).
    - `test_name_ru_differs_from_name_when_set` — defensive against bad curation (name_ru == name would suggest a copy-paste).
  - `TestRouteHandler` (3 new tests):
    - `test_route_returns_name_ru_field` — first unique (Polcirkeln) has name_ru="Полярный круг".
    - `test_route_returns_name_ru_for_ru_lang_too` — name_ru returned for lang=ru as well.
    - `test_route_response_model_validates_name_ru_none` — Pydantic model accepts name_ru=None (validates wall-of-brambles case).
- **Modified `src/__tests__/unique-items-i18n.test.tsx` (+1 net test):**
  - `makeLevelingResponse(name, nameRu=null)` — added `nameRu` parameter and `nameRu` field to the unique object.
  - `LevelingUniquesWidget` describe block — replaced 3 iter-148 tests with 4 iter-150 tests:
    - "renders backend nameRu when locale=ru and nameRu is set" (uses Polcirkeln → "Полярный круг").
    - "falls back to EN name when locale=ru but nameRu is null" (uses Wall of Brambles, nameRu=null).
    - "renders EN name when locale=en (ignores nameRu)".
    - "renders all 4 confirmed poe2db RU names when locale=ru (iter 150 baseline)" — loops over all 4 curated translations, unmounts between cases.
- **Final verification:**
  - `pytest tests/test_leveling_uniques.py -q` → **95 passed** (was 86; +9 new tests). Zero regressions.
  - `pytest tests/ --ignore=tests/e2e -q` → **1527 passed** (was 1518 in iter 149; +9 new tests). Zero regressions.
  - `npx tsc --noEmit` → clean (0 errors).
  - `npx eslint .` → 0 errors, 110 warnings (all pre-existing; 0 new warnings — verified by running ESLint on the 4 modified TS files individually).
  - `npx jest --silent` → **641 passed** (was 640 in iter 149; +1 net new test, since I replaced 3 iter-148 tests with 4 iter-150 tests). Zero regressions.
- **Documentation updates:**
  - `STATUS.md` — header bump (iter 149 → iter 150) with full change summary; TD-6 row updated (added iter-150 phase 2 follow-up); Quick Reference "unique items show English" row updated (removed "Known limitation" caveat, added leveling-uniques extension recipe); Quick Reference pytest count updated (1518 → 1527); Key Technical Insights "UI nameRu rendering pattern" section updated (iter 150 lesson added).
  - `worklog.md` — this iter-150 entry; removed iter-148 section (rule: last 2 iterations only). Kept iter-149 + iter-150.
  - `AGENT_NAVIGATION.md` — header bump (iter 149 → iter 150); invariant #24 caveat updated (leveling-uniques-widget now uses backend nameRu field — no longer "partial coverage").

Stage Summary:
- **iter 150 SHIPPED — Leveling-uniques-widget full RU coverage. Backend `nameRu` field added to `LevelingUniqueData` model with 4/10 confirmed poe2db RU translations curated; 6/10 `None` with documented extension path. Frontend widget switched from fragile `getUniqueDisplayName(name, "ru")` slug-lookup (~1/10 coverage) to direct `unique.nameRu` field. +9 pytest + +1 net jest, 1527 pytest + 641 Jest + tsc clean + 0 new ESLint warnings.**
- **Modified files (3 backend + 2 frontend + 2 tests + 3 docs = 10 total):**
  - `backend/economy/leveling_uniques.py` — added `name_ru` field to 10 entries in `_LEVELING_UNIQUES`; updated docstrings (module / lang param / return shape / static-table comment / `_LEVELING_UNIQUES_NOTES_RU` comment); `compute_leveling_uniques_lifecycle` now emits `name_ru` in each unique dict.
  - `backend/api/response_models.py` — `LevelingUniqueData.name_ru: str | None = None` field added with full docstring.
  - `backend/api/routes_leveling_uniques.py` — top docstring + lang Query description + route function docstring all updated to mention `name_ru`.
  - `src/lib/types.ts` — `LevelingUnique.nameRu?: string | null` field added with full JSDoc.
  - `src/components/dashboard/leveling-uniques-widget.tsx` — `UniqueRow.displayName` now uses `unique.nameRu` directly; removed `getUniqueDisplayName` import; iter-150 comment replaces iter-148 comment.
  - `tests/test_leveling_uniques.py` — +9 new tests (1 in `TestStaticTableIntegrity`, 5 in new `TestNameRuCuratedField` class, 3 in `TestRouteHandler`); 3 existing tests updated to include `name_ru` in required_fields lists.
  - `src/__tests__/unique-items-i18n.test.tsx` — `makeLevelingResponse` accepts nameRu param; `LevelingUniquesWidget` describe block replaced (3 → 4 tests).
  - `STATUS.md` — header bump + TD-6 row + 2 Quick Reference rows + Key Technical Insights section.
  - `worklog.md` — this iter-150 entry (removed iter-148).
  - `AGENT_NAVIGATION.md` — header bump + invariant #24 caveat.
- **What was NOT done (intentionally deferred to iter 151+):**
  - **6/10 leveling uniques still have `name_ru=None`** — Wall of Brambles / Mana Leech Support / Feeding Frenzy Support / Echoes of Worldstone / Boots of Momentum / Wings of Entropy. These items have no poe2db RU page under the matching slug. To extend: (1) re-run `scripts/sync_currency_names_from_poe2db.py --fetch-unique-ru` after a poe2db update (the cache file is `scripts/.cache/poe2db_unique_names.json`); (2) search the cache for new slug matches against the leveling-uniques EN names; (3) manually edit `_LEVELING_UNIQUES` in `backend/economy/leveling_uniques.py` for any new matches. Do NOT invent translations.
  - **Per-tab UX/logic deep-audit** — still deferred since iter 139. iter 150 was a backend/frontend nameRu extension, not a per-tab audit. Candidate for iter 151+.
  - **Re-run F1 pipeline** (`--fetch-ru-by-item`) — 9 currency items still untranslated + 1 no-Cyrillic (`aldurs-saga`). Re-run after a patch / monthly.
  - **TD-6 Phase 3 — re-audit cycle** — monthly `--audit` + `--apply-audit` (currency) + `--fetch-unique-ru` + `--apply-unique` (unique items) + `python scripts/sync_currency_names_ts.py`. Routine maintenance. Periodic re-check of leveling-uniques table for new poe2db RU matches.
  - **TD-3 runtime log verification** — still deferred since iter 136 (requires prod access).
- **Stopping point:** iter 150 = Leveling-uniques-widget full RU coverage (backend `nameRu` field added with 4/10 confirmed poe2db RU translations; frontend widget uses `unique.nameRu` directly; +9 pytest + +1 jest, 1527 pytest + 641 Jest + tsc clean + 0 new ESLint warnings). Next iter candidates: (a) per-tab UX/logic deep-audit (deferred since iter 139 — large scope); (b) extend leveling-uniques `nameRu` coverage — re-run `--fetch-unique-ru` after a poe2db update, manually curate new matches in `_LEVELING_UNIQUES` (small scope, requires poe2db to add new RU pages); (c) re-run F1 pipeline (`--fetch-ru-by-item`) after a patch / monthly to pick up 9 untranslated items; (d) TD-6 Phase 3 routine re-audit cycle; (e) TD-3 runtime log verification (requires prod access); (f) any new bugs the user identifies.
