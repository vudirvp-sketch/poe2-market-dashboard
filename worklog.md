# Worklog — PoE2 Market Dashboard

> Append-only shared multi-agent work log. Each section starts with `---`.
> Old task history is in `git log`. Trimmed to last 2 iterations.

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
