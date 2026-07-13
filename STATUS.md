# STATUS.md — Known Issues & Quick Reference

> **Last updated:** 2026-07-13 (iter 149 — Gold Map ROI (P10) tab DELETED as unused per user request. Removed 3 components (`gold-map-roi-tab.tsx`, `gold-map-roi-calculator.tsx`, `gold-map-roi-trend-chart.tsx`), 3 test files, 1 design doc, 1 Next.js proxy route (`/api/flipper/triangular/history` — only consumer was the trend chart), 49 i18n keys × 4 locales (`tabGoldMapRoi` + `fallbackGoldMapRoi` + `goldMap*`), TAB_MAP entry, dashboard-toolbar `TabsTrigger`. Backend route `/api/v1/arbitrage/triangular/history` (TD-3 Phase 3 persistence) KEPT — has its own pytest suite. See KI-35. **1518 pytest green + Jest green + tsc clean + 0 new ESLint errors.**)
> Single source of truth for known bugs and frequent problems. Update BEFORE fixing any issue.

---

## Known Issues — open

### (none — all known issues are closed; see below for recovery recipes)

---

## Known Issues — closed (kept for recovery recipes)

### KI-35 — Gold Map ROI tab deleted as unused (P3, FIXED iter 149)

**Identified iter 149** per user request: «вкладку gold roi --- удали чисто, отовсюду упоминания и прочее, она бесполезная!» The P10 Gold Map ROI tab (Castaway run ROI calculator) shipped iter 127 (calculator) + iter 132 (trend chart) but was deemed not useful enough to keep.

**Fix (iter 149):** Deleted the entire feature surface:
- Components: `src/components/dashboard/gold-map-roi-tab.tsx`, `gold-map-roi-calculator.tsx`, `gold-map-roi-trend-chart.tsx`.
- Tests: `src/__tests__/gold-map-roi-tab.test.tsx`, `gold-map-roi-calculator.test.ts`, `gold-map-roi-trend-chart.test.tsx`.
- Design doc: `docs/design/P10-gold-map-roi-design.md`.
- Next.js proxy route: `src/app/api/flipper/triangular/history/route.ts` (only consumer was the trend chart).
- i18n: 49 keys × 4 locales removed from `src/lib/i18n/locales/{en,ru,ko,zh}.ts` (`tabGoldMapRoi`, `fallbackGoldMapRoi`, `goldMap*`).
- `TAB_MAP` in `dashboard-page.tsx`: removed `"gold-map-roi"` entry (now 15 tabs).
- `dashboard-toolbar.tsx`: removed `TabsTrigger value="gold-map-roi"` + `MapPin` lucide import.

**Kept (NOT deleted):** backend route `/api/v1/arbitrage/triangular/history` (TD-3 Phase 3 persistence — has its own pytest suite in `tests/test_triangular_cycles_route.py`). TS types `TriangularCycleHistoryPoint` / `TriangularCyclesHistoryResponse` in `src/lib/types.ts` also kept — they describe the backend response shape and may be reused. P10 entry in `MARKET_PLAYBOOK.md` §B/§C marked as «удалён iter 149» rather than fully stripped, to preserve the playbook's pattern inventory.

### KI-34 — PairComparisonDialog labels frozen at add-time (P3, FIXED iter 148)

**Identified iter 148** while auditing pair-comparison-dialog.tsx for the nameRu extension. The label WAS already locale-aware at add-time (`exchange-table.tsx:698` and `exchange-pair-card.tsx:81` both build it via `getCurrencyDisplayName(pair.currency1Id, locale)`), but the label was FROZEN in the zustand store. Switching locale after adding pairs to comparison didn't refresh the chip/legend/summary labels.

**Fix (iter 148):** Added a `liveLabel(pair)` helper inside `PairComparisonDialog` that re-derives the label from `pair.currency1Id` / `pair.currency2Id` via `getCurrencyDisplayName(..., locale)` on every render. Falls back to the stored `pair.label` only when `getCurrencyDisplayName` returns null for either currency. 2 regression tests added in `src/__tests__/unique-items-i18n.test.tsx:PairComparisonDialog`.

### KI-33 — Non-ASCII item names crash `--fetch-ru-by-item` and `--audit` (P3, FIXED iter 145)

**Identified iter 145.** The audit crashed at item #500+ with `UnicodeEncodeError: 'ascii' codec can't encode character '\xf3'`.

**Root cause:** `_en_name_to_poe2db_slug()` keeps non-ASCII chars intact. The resulting slug was inserted into a URL string that `urllib.request.urlopen` then tried to encode as ASCII. Two items triggered this: `mórrigans-insight` and `oisins-oath`.

**Fix (iter 145):** Extracted shared `_build_poe2db_url(base_url, slug)` helper that URL-encodes the slug via `urllib.parse.quote(slug, safe="/%'")`. Both `fetch_poe2db_ru_names_by_item` and `audit_translations` now use it. 6 regression tests in `tests/test_sync_currency_names.py:TestBuildPoe2dbUrl`.

### KI-32 — Existing RU translations drift from poe2db official (P2, FIXED iter 146)

**Identified iter 145, fixed iter 146 (TD-6 phase 1).** User report: «перевод корявый и не такой как в официальном клиенте игры!».

**Root cause:** The iter-137 F1 pipeline (`--fetch-ru-by-item`) only fetches RU translations for items that are NOT yet translated — it silently SKIPS items that already have a translation. As a result, legacy translations sourced from PoE1 community wikis were never refreshed against poe2db's current official Russian localization. Drift was concentrated in 4 patterns (32 items total): PoE1-style orb names (13 currency), «Ключ реликвария» → «Ключ от Реликвария» (7 vaultkeys), «Ядро души» → «Ядро душ» (6 ultimatum soul-cores), misc proper-noun translations (3 lineagesupportgems/ritual/runes).

**Fix (iter 146):** Added `--apply-audit` flag to `scripts/sync_currency_names_from_poe2db.py`. Reads `scripts/.cache/translation_audit.json`, overwrites every `mismatches` entry's value in `currency_names_ru` with the `poe2db_ru` value. Requires `--confirm`. Idempotent. Ran the apply: **32/32 applied**. Regenerated TS mirror. 12 new tests in `tests/test_sync_currency_names.py`.

---

## Technical-debt backlog

| ID | Priority | Notes |
|----|----------|-------|
| **TD-3** | P3 | Triangular arbitrage persistence. All phases SHIPPED iter 129–134. **Open:** runtime log verification on next prod deploy — confirm `"TD-3 cache: populated pipeline_cache key=%s"` appears in `_refresh` output. |
| **TD-4** | P3 | `market_spread` persistence. Phase 2 SHIPPED iter 128. **Open:** verify rows land in SQLite in prod logs. |
| **TD-5** | P3 | `DailyStatsHistory` OHLCV persistence. Phase 4 SHIPPED iter 131. **Open:** verify hourly `daily_stats_refresh` persists; run `scripts/backfill_daily_stats.py --dry-run` then `--top-n 50`. |
| **F1** | P3 | Russian translations for currency items. **Pipeline SHIPPED iter 137.** Iter 145 audit: 634/686 translated, 32 mismatches vs poe2db (FIXED iter 146 — see KI-32). **Open:** (1) re-run `--fetch-ru-by-item` monthly / after each patch to pick up the 9 untranslated items; (2) re-run `--audit` + `--apply-audit` monthly to catch new drift. |
| **TD-6** | P2 | Translation alignment with poe2db official + unique-items RU support. **Phase 1 SHIPPED iter 146** (`--apply-audit` + 32 KI-32 drift items). **Phase 2 SHIPPED iter 147:** `--fetch-unique-ru` + `--apply-unique` flags; 445 unique items added. **Phase 2 follow-up SHIPPED iter 148:** extended `nameRu` rendering to `comparison-dialog`, `comparative-chart`, `leveling-uniques-widget`, `fuzzy-search`; closed KI-34. **Phase 3:** re-audit cycle (monthly `--audit` + `--apply-audit` for currency; monthly `--fetch-unique-ru` + `--apply-unique` for unique items). |

---

## F1 — 9 currency items with no poe2db Russian page (deferred)

poe2db has the pages but no Russian translation — titles are English-only. Re-run the pipeline periodically to pick them up.

| api_id | poe2db URL |
|--------|------------|
| `aldurs-legacy` | https://poe2db.tw/ru/Aldurs_Legacy |
| `betrayal-of-aldur` | https://poe2db.tw/ru/Betrayal_of_Aldur |
| `vision-rune` | https://poe2db.tw/ru/Vision_Rune |
| `rebirth-rune` | https://poe2db.tw/ru/Rebirth_Rune |
| `ward-rune` | https://poe2db.tw/ru/Ward_Rune |
| `stone-rune` | https://poe2db.tw/ru/Stone_Rune |
| `breath-of-aldur` | https://poe2db.tw/ru/Breath_of_Aldur |
| `ire-of-aldur` | https://poe2db.tw/ru/Ire_of_Aldur |
| `passion-of-aldur` | https://poe2db.tw/ru/Passion_of_Aldur |

**Plus 1 no-Cyrillic item (iter 145 audit):** `aldurs-saga` — we have a RU translation (`Сага Альдура`) but poe2db has no RU page. Keep our translation until poe2db adds theirs.

**Plus 1 partial unique item (iter 147 Stage 7):** `Demigods_Virtue` — poe2db has RU (`Добродетель полубога`) but no EN in the index. Skipped by `--apply-unique`. Re-run `--fetch-unique-ru` after a poe2db update to pick it up.

---

## Design-docs

| Doc | Covers | Status |
|-----|--------|--------|
| `docs/design/TD-3-4-5-9-persistence-gaps-design.md` | TD-3 + TD-4 + TD-5 + TD-9 unified persistence-layer analysis. Four-phase plan. | **ALL PHASES SHIPPED.** Phase 1 iter 127. Phase 2 iter 128. Phase 3 iter 129. Phase 4 iter 131. |

---

## Quick Reference — Frequent Problems

| Symptom | Cause | Where to fix |
|---------|-------|--------------|
| `python scripts/sync_currency_names_from_poe2db.py --audit` crashes with `UnicodeEncodeError: 'ascii' codec can't encode character` | **KI-33** (FIXED iter 145) — non-ASCII item names need URL-encoding in the slug. Fix: `_build_poe2db_url()` helper uses `urllib.parse.quote(slug, safe="/%'")`. | `scripts/sync_currency_names_from_poe2db.py:_build_poe2db_url` |
| Existing RU translation differs from official poe2db Russian client (e.g. `exalted` shows «Благородная сфера» instead of «Сфера возвышения») | **KI-32** (FIXED iter 146) — iter-137 pipeline only fetched NEW translations, never refreshed existing ones. 32 items affected (now all corrected). To detect new drift: `--audit`. To apply: `--apply-audit --confirm` then `python scripts/sync_currency_names_ts.py`. | `backend/data/currency_names.json` + `scripts/sync_currency_names_from_poe2db.py --apply-audit` |
| Unique items (weapons, armour, accessories) show English names even when locale=ru | **TD-6 phase 2 + follow-up** (SHIPPED iter 147 + iter 148) — `unique_names_ru`/`unique_names_en` populated (445 items). `mapUniqueItem` in `poe2api.ts:1030` populates `nameRu`. ALL UI components that display unique-item names use `nameRu` when locale=ru: `unique-table.tsx`, `comparison-dialog.tsx`, `comparative-chart.tsx`, `leveling-uniques-widget.tsx` (via `getUniqueDisplayName` — partial coverage, see below), `fuzzy-search.tsx` (with EN kept as `nameAlt`). To refresh: `--fetch-unique-ru` + `--apply-unique --confirm` + `python scripts/sync_currency_names_ts.py`. Known limitation: `leveling-uniques-widget` has partial RU coverage (~1-2 of 10 items) because poe2db slugs don't always match the curated backend names. Full coverage would require a `nameRu` field on `LevelingUniqueData` — deferred. | `src/lib/poe2api.ts:mapUniqueItem`, `src/components/dashboard/{unique-table,comparison-dialog,comparative-chart,leveling-uniques-widget,fuzzy-search}.tsx`, `backend/data/currency_names.json:unique_names_ru/en` |
| PairComparisonDialog shows stale EN/RU labels after switching locale | **KI-34** (FIXED iter 148) — `pair.label` was frozen at add-time. Now re-derived from `pair.currency1Id`/`pair.currency2Id` via `getCurrencyDisplayName(..., locale)` on every render, with stored `label` as fallback. | `src/components/dashboard/pair-comparison-dialog.tsx:liveLabel` |
| After updating `currency_names.json`, the TS mirror is out of sync | Run `python scripts/sync_currency_names_ts.py` to regenerate `src/lib/currency-names.ts` from the JSON. | `scripts/sync_currency_names_ts.py` |
| All API calls return 404; dashboard empty | **KI-15** (open) — `.env.local` has dead `api.poe2scout.com`. Use `POE2_API_BASE_URL=https://poe2scout.com/api` | `.env.local`, `start.bat`, `start.sh` |
| 6 pytest modules fail on collection (`test_daily_stats_persistence`, `test_market_spreads*`, `test_scheduler`, `test_triangular_cycles*`) | Env-setup issue — `aiosqlite` missing from active venv. Run `pip install -r requirements.txt` (or `pip install aiosqlite`). With aiosqlite installed, the full suite is **1518 pytest green**. Does NOT indicate a regression. | env-only |
| `/optimizer/path` returns empty path with `data_available: true` | Profitable arbitrage cycle detected — fall back to `direct_rate` | `backend/api/routes_optimizer.py:_bellman_ford` |
| SQLite `near "LIMIT": syntax error` | Use `rowid IN (SELECT ... LIMIT ?)` pattern | `backend/data/historical.py:_prune_old_league_data` |
| FlipsTable "Trend" sparkline shows `—` instead of a line | By design (iter 135) — sparkline renders REAL `price_history_short` (≥ 2 points required). The synthetic `momentum × volatility` fallback was REMOVED as misleading. | `src/components/dashboard/flips-helpers.ts:getTrendSparklineData`, `sparkline.tsx:115-116` |
| `/api/v1/market-spreads/history` returns `data_available: false` | **TD-4** — table empty. Wait 5 min for snapshot refresh, or check `sqlite3 historical.db "SELECT COUNT(*) FROM market_spreads"`. | `backend/economy/market_spreads.py:compute_market_spreads` |
| `/api/v1/arbitrage/triangular/history` returns `data_available: false` | **TD-3** — table empty. Either (a) refresh hasn't run yet, (b) no profitable cycles detected (normal in stable markets), or (c) `find_triangular_arbitrage` timed out (90s — check logs for "TD-3: find_triangular_arbitrage failed"). | `backend/economy/triangular_cycles.py:compute_triangular_cycles` |
| `/api/v1/items/{item_id}/daily-stats` returns `data_available: false` | **TD-5** — table empty AND provider returned None. Either (a) item_id unknown to POE2Scout (404), (b) hourly `daily_stats_refresh` scheduler hasn't run yet, or (c) lazy-fetch provider call failed. | `backend/api/routes_daily_stats.py:get_daily_stats_history` |
| Mirror/Divine Arb tab shows "no price history yet" | By design (iter 109) — backend returns `data_available: false` when scheduler hasn't collected ≥ 4 Mirror + Divine snapshots. | `backend/economy/mirror_divine_arb.py`, `mirror-divine-arb-tab.tsx` |
| `/api/poe2/uniques` or `/api/poe2/currencies` returns 200 with empty `items: []` | KI-11 (closed iter 102) — verify `config.yaml:league.league_name` is valid | `src/lib/poe2api.ts` |

---

## Key technical insights for future agents

**Translation pipeline (iter 137 + iter 145 + iter 146 + iter 147).** Eight stages:
1. `--fetch-ids` — live poe2scout.com API, paginates all 17 currency categories, writes `scripts/.cache/poe2scout_items.json`.
2. `--fetch-ru-by-item` (KI-30 fix) — per-item poe2db page fetch + `<title>` tag extraction. Skips already-translated items (does NOT refresh — see KI-32).
3. `--diff` — computes patch of proposed NEW translations only.
4. `--apply --confirm` — writes patch to JSON, preserves RU/EN key parity, idempotent.
5. `--audit` (iter 145, KI-32 enabler) — READ-ONLY audit of all existing currency RU translations against poe2db current RU `<title>`. Writes `scripts/.cache/translation_audit.json`.
6. `--apply-audit --confirm` (iter 146, TD-6 phase 1, KI-32 fix) — applies audit corrections. Idempotent.
7. `--fetch-unique-ru` (iter 147, TD-6 phase 2) — fetches poe2db unique-item INDEX pages in both RU and EN, parses `<a class="UniqueItem">` anchors, joins on slug, writes `scripts/.cache/poe2db_unique_names.json`. Only 2 HTTP calls.
8. `--apply-unique --confirm` (iter 147, TD-6 phase 2) — applies unique-item cache to `unique_names_ru`/`unique_names_en` in `currency_names.json`. Idempotent.

After any JSON update, run `python scripts/sync_currency_names_ts.py` to regenerate the TS mirror. KI-33 fix: all URL construction goes through `_build_poe2db_url()` which percent-encodes non-ASCII chars. Unique items have NO ApiId in poe2scout — they're keyed by poe2db URL slug (e.g. `Brynhands_Mark`), derived from the EN name via `enNameToUniqueSlug()`.

**UI nameRu rendering pattern (iter 147 + iter 148).** All components that display a `PoeItem.name` for a unique item should use the locale-aware pattern: `locale === "ru" && item.nameRu ? item.nameRu : item.name`. The `nameRu` field is populated by `mapUniqueItem` (`poe2api.ts:1030`) via `getUniqueRuName(slug)`. Components covered: `unique-table.tsx`, `comparison-dialog.tsx`, `comparative-chart.tsx`, `leveling-uniques-widget.tsx` (via `getUniqueDisplayName` — partial coverage), `fuzzy-search.tsx` (EN kept as `nameAlt` fuse.js key, weight 0.25). For `PairComparisonDialog` (currency pairs), re-derive labels at render time via `getCurrencyDisplayName(pair.currency1Id, locale)` — do NOT trust stored `pair.label` (KI-34 lesson).

**FastAPI route matching is ORDER-DEPENDENT.** A `{param:path}` converter is greedy and matches slashes — it will shadow any literal sub-path registered AFTER it. Always register literal-path routers BEFORE greedy-path routers. (KI-13 lesson.)

**Frontend price formatting convention.** `fmtPrice`-style helpers should keep 2 decimals for prices `>= 1` and 4 decimals for `< 1`. Never truncate large prices to integers — this silently broke the iter-110 live-price test (KI-21).

**Naive datetime handling (KI-26 / KI-27).** When converting a naive `datetime` (no `tzinfo`) to UTC, use `dt.astimezone(timezone.utc)` — NOT `dt.replace(tzinfo=timezone.utc)`. `replace()` is ONLY correct when the input is already UTC but lacks `tzinfo` (SQLite, POE2Scout ISO strings without `Z`).

**Three-layer persistence pattern (iter 128–131).** (1) Pure helper in `backend/economy/<feature>.py` taking `(snapshot, config)` → `list[dict]` — no I/O. (2) Best-effort write in `SnapshotManager._refresh()` AFTER snapshot built, BEFORE `return snapshot` — `try/except` + `INSERT OR IGNORE`. (3) Read-only `GET /api/v1/<feature>/history` returning 200 with `data_available: false` on empty. **TD-5 adaptation:** daily-cadence metrics write in TWO places (route lazy-fetch + scheduler hourly), use `INSERT OR REPLACE`.

**Dependency-free SVG line chart pattern.** Prefer hand-rolled SVG over Recharts/Chart.js. Canonical template: `src/components/dashboard/storage-value-history-chart.tsx`. Always render "no history yet" notice when `points.length < 2`. Dedup to "best per timestamp" client-side for SQLite history tables.
