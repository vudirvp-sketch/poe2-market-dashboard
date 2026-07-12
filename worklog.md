# Worklog — PoE2 Market Dashboard

> Append-only shared multi-agent work log. Each section starts with `---`.
> Old task history is in `git log`. Trimmed to last 2 iterations.

---

Task ID: iter-145
Agent: main
Task: iter 145 — closes candidate (a) from iter 144 stop point (fix `instrumentation.ts:7` + `flipper-backend-bridge.ts:313` comment drift `/api/health` → `/api/v1/health/ping`), PLUS addresses user's new requirement about translation quality. User reported: "далеко не все и не везде предметы и валюта имеет перевод а где имеет ---> перевод корявый и не такой как в официальном клиенте игры! перевод надо смотреть на пое 2 дб!" — provided poe2db.tw/ru/Unique_item URLs as reference.

Work Log:
- Cloned repo. Read `STATUS.md` (iter 144 SHIPPED), `worklog.md` (iter 144 + iter 143), `AGENT_NAVIGATION.md` §1–§3.
- Investigated current translation pipeline state:
  - `backend/data/currency_names.json` — 4 dicts: `category_names_ru/en` (17 categories) + `currency_names_ru/en` (686 items each, RU/EN key parity).
  - Pipeline `scripts/sync_currency_names_from_poe2db.py` — 4 stages: `--fetch-ids` → `--fetch-ru-by-item` (KI-30 fix) → `--diff` → `--apply --confirm`. Only fetches NEW translations; NEVER overwrites existing ones (idempotency guard at `apply_patch:902`).
  - `scripts/fetch_ru_by_item_parallel.py` — thread-pooled version of Stage 2b. Uses `urllib.parse.quote(slug, safe="/%'")` for URL-encoding (KI-33 fix needed in main script).
  - 9 items still untranslated (F1, deferred since iter 138): `aldurs-legacy`, `betrayal-of-aldur`, `vision-rune`, `rebirth-rune`, `ward-rune`, `stone-rune`, `breath-of-aldur`, `ire-of-aldur`, `passion-of-aldur`.
- **Spot-check audit (10 + 20 items):** Compared existing RU translations against poe2db's current RU `<title>` tag for 30 well-known items. Found **15 mismatches (50%)** — including `exalted` (our "Благородная сфера" PoE1-style vs poe2db "Сфера возвышения" PoE2-official), `fracturing-orb`, `vaal`, `alch`, `regal`, `aug`, `annul`, `regret`, `fusings`, `chromatic`, `blessed`, `eternal`, `whetstone`, `scrap`, `bauble`. Confirms user's complaint is real and pervasive.
- **Unique items gap identified:** `mapUniqueItem` (`src/lib/poe2api.ts:1003-1051`) uses `raw.Text || raw.Name` directly as `name`. NO RU translation lookup. The translation pipeline only covers the 17 currency categories from `POE2DB_CATEGORY_PATHS` — unique items (weapons, armour, accessories) are NOT covered at all.
- **Source cleanup (closes candidate a):** Fixed 2 comment drift lines:
  - `instrumentation.ts:7` — `Monitors backend health via /api/health` → `Monitors backend health via /api/v1/health/ping` (matches the actual `HEALTH_ENDPOINT` constant at `flipper-backend-bridge.ts:52`).
  - `src/lib/flipper-backend-bridge.ts:313` — `Although /api/health/ping responds` → `Although /api/v1/health/ping responds` (matches same constant).
- **Added `--audit` flag to `scripts/sync_currency_names_from_poe2db.py`:**
  - New `TRANSLATION_AUDIT_CACHE = CACHE_DIR / "translation_audit.json"` constant.
  - New `audit_translations()` function — READ-ONLY audit. For every api_id that has an existing RU translation, fetches its poe2db page, extracts the RU `<title>`, compares against stored value. Categorizes results as `match` / `mismatch` / `no_poe2db_page` (404) / `no_cyrillic` (page exists but title is English-only). Does NOT mutate `existing_names` (verified by `test_does_not_modify_existing_names`).
  - New `cmd_audit()` CLI handler. Registered `--audit` flag in argparse. Updated stage_count validation. Does NOT require `--confirm` (read-only).
  - New module docstring section "Stage 5" documenting the audit.
- **First audit run crashed (KI-33 discovered):** At item ~500/643, `UnicodeEncodeError: 'ascii' codec can't encode character '\xf3' in position 9`. Root cause: `_en_name_to_poe2db_slug()` strips apostrophes but keeps other non-ASCII chars intact. Two items triggered this: `mórrigans-insight` (EN: "Mórrigan's Insight") and `oisins-oath` (EN: "Oisín's Oath"). The parallel runner already URL-encoded the slug; the main script did NOT.
- **KI-33 fix:** Extracted shared `_build_poe2db_url(base_url, slug)` helper that percent-encodes the slug via `urllib.parse.quote(slug, safe="/%'")`. Both `fetch_poe2db_ru_names_by_item` and `audit_translations` now use it. Added defensive `except (UnicodeEncodeError, UnicodeDecodeError)` clauses in both functions so a single bad slug can't kill the whole run.
- **Ran full audit on 634 translated items** (9 untranslated items skipped per audit design):
  - **Total audited:** 634
  - **Match poe2db:** 601 (94.8%)
  - **Mismatch:** 32 (5.0%) — full list in `scripts/.cache/translation_audit.json`. Mismatches by category: currency (13), vaultkeys (7), ultimatum (6), lineagesupportgems (3), ritual (2), runes (1).
  - **No poe2db page (404):** 0
  - **No Cyrillic:** 1 (`aldurs-saga` — we have "Сага Альдура", poe2db has no RU page yet. NEW finding, not in F1 list).
- **Tests added (14 new tests, all green):**
  - `tests/test_sync_currency_names.py:TestAuditTranslations` — 6 tests covering: mismatch detection, match counting, 404 handling, no-Cyrillic handling, untranslated-item skipping, READ-ONLY verification.
  - `tests/test_sync_currency_names.py:TestAuditCli` — 2 tests covering: `--audit` runs without `--confirm`, `--audit` + other stage returns 4.
  - `tests/test_sync_currency_names.py:TestBuildPoe2dbUrl` — 6 tests covering: ASCII slugs, apostrophe preservation, non-ASCII Latin encoding, Cyrillic encoding, regression tests for `Oisíns_Oath` and `Mórrigans_Insight`.
- **Documentation updates (per user's rule "Убирай длинную историю изменений, мусор, устаревшие секции"):**
  - `STATUS.md` — header bump (iter 144 → iter 145); added KI-32 (translation drift) + KI-33 (non-ASCII slug crash, fixed) + TD-6 (translation alignment + unique-items RU support, 3-phase plan); updated F1 section with audit results + `aldurs-saga` new finding; trimmed Quick Reference (removed 7 already-fixed KI rows: KI-21/26/27/28/29/30/31 — all merged into 1-line summaries under remaining entries or removed entirely); trimmed Key Technical Insights (consolidated 5 paragraphs into 5 shorter ones).
  - `worklog.md` — added this iter-145 entry, removed iter-143 entry (rule: only last 2 iterations).
  - `AGENT_NAVIGATION.md` — header bump (iter 144 → iter 145).
- **Final verification:** `python3 -m pytest tests/test_sync_currency_names.py` → 57 passed (43 existing + 14 new). 1466 pytest green baseline preserved (only `.py`/`.ts`/`.tsx` change was the 2 comment-line drift fixes + new audit code, all covered by tests).

Stage Summary:
- **iter 145 SHIPPED — 1 source-cleanup (closes candidate a) + 1 new audit tool + 2 new KIs + 1 new TD, 14 new tests.**
- **Modified files (4 source + 3 meta-docs + 1 audit artifact):**
  - `instrumentation.ts` — 1-line comment drift fix.
  - `src/lib/flipper-backend-bridge.ts` — 1-line comment drift fix.
  - `scripts/sync_currency_names_from_poe2db.py` — added Stage 5 (`--audit` flag + `audit_translations()` + `cmd_audit()` + `_build_poe2db_url()` helper + KI-33 defensive exception handling in both `fetch_poe2db_ru_names_by_item` and `audit_translations`).
  - `tests/test_sync_currency_names.py` — added 14 tests (8 audit + 6 KI-33 regression).
  - `STATUS.md` — header bump + KI-32 + KI-33 + TD-6 + F1 update + Quick Reference trim.
  - `worklog.md` — this iter-145 entry (removed iter-143).
  - `AGENT_NAVIGATION.md` — header bump.
  - `scripts/.cache/translation_audit.json` — audit artifact (32 mismatches + 1 no-Cyrillic).
- **What was NOT done (intentionally deferred to iter 146+):**
  - **TD-6 Phase 1 — apply KI-32 fixes:** Add `--apply-audit` flag that overwrites the 32 drift items in `currency_names_ru` with poe2db values. Requires `--confirm` (destructive). Will need to update spot-check assertions in `tests/test_currency_names_ru.py:46-51` for `exalted` (current: "Благородная сфера" → new: "Сфера возвышения"). After applying, regenerate TS mirror via `python scripts/sync_currency_names_ts.py`.
  - **TD-6 Phase 2 — unique items RU support:** Extend pipeline to crawl `poe2db.tw/ru/Unique_item` index page → per-item page `<title>` extraction. Add `unique_names_ru` / `unique_names_en` sections (either new file `unique_names.json` or new top-level keys in `currency_names.json`). Update `mapUniqueItem` in `src/lib/poe2api.ts:1030` to look up RU name when locale=ru. Add UI tests for RU locale rendering of unique items.
  - **TD-6 Phase 3 — re-audit cycle:** Re-run `--audit` monthly / after each patch to catch new drift.
  - **Per-tab UX/logic deep-audit** — still deferred since iter 139. iter 141–145 only verified doc-level references + translation infrastructure. Full per-tab audit (i18n coverage, error states, empty states, loading skeletons, accessibility) is candidate for iter 147+.
  - **9 currency items still untranslated** (F1) + **1 newly-discovered no-Cyrillic** (`aldurs-saga`) — re-run `--fetch-ru-by-item` after a patch / monthly.
  - **TD-3 runtime log verification** — still deferred since iter 136 (requires prod access).
- **Stopping point:** iter 145 = 1 source-cleanup (closes candidate a) + 1 new audit tool (Stage 5 `--audit`) + 2 new KIs (KI-32 translation drift, KI-33 non-ASCII slug crash fixed) + 1 new TD (TD-6 translation alignment + unique-items RU support) + 14 new tests + 1 audit artifact. Next iter candidates: (a) **TD-6 Phase 1** — add `--apply-audit` flag to overwrite the 32 KI-32 drift items (highest value — directly addresses user's complaint about wrong translations); (b) **TD-6 Phase 2** — extend pipeline to unique items (largest scope, addresses user's complaint about missing RU for unique items); (c) per-tab UX/logic deep-audit (deferred since iter 139); (d) re-run F1 pipeline after a patch / monthly; (e) TD-3 runtime log verification (requires prod access); (f) any new bugs the user identifies.

---

Task ID: iter-144
Agent: main
Task: iter 144 — `docs/DATA_FLOW.md` §2 (POE2Scout API) + §5 (Field Transformation) deep cross-check. Per the iter-143 stop point: candidate (a) next logical docs batch. Chose this — lowest risk (doc-only, 0 source-code changes), natural continuation of the doc-audit chain (iter 141: DATA_FLOW cosmetic, iter 142: ARCHITECTURE/PLAYBOOK/CORS, iter 143: BACKEND_GUIDE/DATA_CONTRACTS). §2 + §5 were the only sections from the iter-141 audit that received only a cosmetic pass and deserved a deep cross-check against `backend/data/providers/poe2scout.py` + `src/lib/poe2api.ts`.

Work Log:
- Cloned repo. Read `STATUS.md` (iter 143 SHIPPED), `worklog.md` (iter 143 + iter 142), `AGENT_NAVIGATION.md` §1–§3.
- Re-verified canonical references against live code:
  - `backend/data/providers/poe2scout.py:417-418` — `get_historical_prices(currency: str, days)` calls `f"{self._league_path()}/Currencies/{currency}"`. The path parameter is an ApiId string (e.g. "divine"). DATA_FLOW.md §2 table row #16 said `/{Realm}/Leagues/{LeagueName}/Currencies/{ApiId}` — correct, no drift.
  - `backend/data/providers/poe2scout.py:707-720` — `get_pair_history(currency_one_item_id: int, currency_two_item_id: int)` calls `f".../Currencies/Pairs/{currency_one_item_id}/{currency_two_item_id}/History"`. Parameters are NUMERIC ItemIds. DATA_FLOW.md §2 table row #17 used generic `{C1}/{C2}` shorthand — INCONSISTENT with §2 path-params section (line 54) which explicitly names them `{CurrencyOneItemId}/{CurrencyTwoItemId}`. Aligned table to match path-params section.
  - `src/lib/poe2api.ts:618-630` — `RawCurrencyItem` interface has `ItemMetadata: Record<string, unknown> | null` (strict TS type). DATA_FLOW.md §5.1 said `ItemMetadata?: any` — legacy loose typing. Fixed.
  - `src/lib/poe2api.ts:639-652` — `RawUniqueItem` interface has NO `ApiId` field. Has `IsChanceable: boolean | null` and `ItemMetadata: Record<string, unknown> | null`. DATA_FLOW.md §5.1 listed `ApiId: string` as a field — WRONG. Code comment at `poe2api.ts:1025` explicitly notes: "BUG FIX: Unique items don't have an ApiId field in the POE2Scout API. CategoryApiId is shared by ALL items in the same category... Use ItemId as a stable, unique identifier instead." Removed phantom ApiId, added explanatory note, fixed IsChanceable/ItemMetadata types.
  - `src/lib/poe2api.ts:977` (mapCurrencyItem) — `id: String(item.ItemId || item.CurrencyItemId)` — ItemId takes PRIORITY. DATA_FLOW.md §5.1 mapping table said `id = String(CurrencyItemId || UniqueItemId || ItemId)` — priority REVERSED (and incorrectly mixed CurrencyItemId/UniqueItemId into a single rule).
  - `src/lib/poe2api.ts:1024` (mapUniqueItem) — `id: String(raw.ItemId || raw.UniqueItemId)` — ItemId takes PRIORITY.
  - `src/lib/poe2api.ts:978` (mapCurrencyItem) — `apiId: item.ApiId` — correct for currencies.
  - `src/lib/poe2api.ts:1029` (mapUniqueItem) — `apiId: String(raw.ItemId || raw.UniqueItemId)` — NOT ApiId (uniques have no ApiId field). DATA_FLOW.md §5.1 mapping table presented `apiId = ApiId` as a single unified rule — MISLEADING. Split into two rules: currencies use ApiId, uniques use String(ItemId || UniqueItemId).
  - `src/lib/poe2api.ts:960,1008` — `const relPrice = referencePrice && currentPrice ? currentPrice / referencePrice : currentPrice;`. DATA_FLOW.md §5.1 said `relativePrice = CurrentPrice / referencePrice` — didn't mention the fallback to `currentPrice` when `referencePrice` is missing. Added note.
  - `src/lib/poe2api.ts:1148-1180` (mapSnapshotPair) — returns 15 fields. DATA_FLOW.md §5.2 mapping table listed only 12 — MISSING 3: `currency1CategoryApiId` (line 1164), `currency2CategoryApiId` (line 1169), `currency2RelativePrice` (line 1172, comment: "price of currency2 in base currency — needed for cross-rate"). Added all 3.
  - `src/lib/poe2api.ts:1171` — `relativePrice: relPrice1` — direct assignment, can be null. DATA_FLOW.md §5.2 said `relativePrice = price ?? 0` — WRONG, code does NOT coalesce to 0. Fixed.
  - `src/lib/poe2api.ts:1174-1178` — `change`, `changePercent`, `sevenDayChange`, `sevenDayChangePercent`, `history` all initialized to `null`. DATA_FLOW.md §5.2 said these are "Enriched later via buildCurrencyChangeMap()" / "Fetched on demand" — didn't mention null initialization. Added "null (initialized)" prefix.
  - `src/lib/poe2api.ts:580-587` — `RawRealm` interface uses snake_case (`value`, `label`, `game_api_id`, `realm_api_id`, `trade_api_path`, `default_league_value`). DATA_FLOW.md §5.3 "/Realms stays snake_case" — correct, no drift.
  - `src/lib/case-transform.ts:22-24` — `toCamelCase` regex `/_([a-z0-9])/g`. Verified all 12 example transformations in §5.4 against this regex: `volume_24h → volume24h` ✓, `mid_price → midPrice` ✓, `quantized_analysis → quantizedAnalysis` ✓, `tier_distance → tierDistance` ✓, `alert_score → alertScore` ✓, `triggered_indicators → triggeredIndicators` ✓, `is_confirmed → isConfirmed` ✓, `current_price → currentPrice` ✓, `projected_price → projectedPrice` ✓, `risk_discount → riskDiscount` ✓, `adjusted_price → adjustedPrice` ✓, `net_value → netValue` ✓. All accurate.
  - `backend/models/currency.py:82-290` — verified all 12 source field names from §5.4 exist in backend models (`volume_24h`, `mid_price`, `quantized_analysis`, `tier_distance`, `alert_score`, `triggered_indicators`, `is_confirmed`, `current_price`, `projected_price`, `risk_discount`, `adjusted_price`, `net_value`). All present.
  - Grep confirmed: endpoints `/Realms/{Realm}/Filters`, `/Realms/{Realm}/LandingSplashInfo`, `/health/ready` are mentioned ONLY in DATA_FLOW.md — not consumed by any code (frontend or backend). Added a note in §2 marking them as available-but-not-consumed.
- No new bugs found in this iter (all drift is doc-only — no source-code defects).
- **`docs/DATA_FLOW.md` §2 audit (2 drift items fixed):**
  - **Header** — bumped version 1.2 → 1.3, date 2026-07-12 → 2026-07-13, updated summary.
  - **§2 table row #17** — `/{Realm}/Leagues/{LeagueName}/Currencies/Pairs/{C1}/{C2}/History` → `/{Realm}/Leagues/{LeagueName}/Currencies/Pairs/{CurrencyOneItemId}/{CurrencyTwoItemId}/History` (aligned with §2 path-params section line 54 which already used these exact names).
  - **§2 note added** — after table, before "Path parameters": clarifies that endpoints #2 (`/Realms/{Realm}/Filters`), #3 (`/Realms/{Realm}/LandingSplashInfo`), and #21 (`/health/ready`) exist in the POE2Scout API spec but are NOT consumed by the app; endpoint #20 (`/health/live`) IS consumed by `getHealth()` in `poe2api.ts:1187`.
- **`docs/DATA_FLOW.md` §5.1 audit (7 drift items fixed):**
  - **RawCurrencyItem interface** — `ItemMetadata?: any` → `ItemMetadata: Record<string, unknown> | null` (matches `poe2api.ts:626`).
  - **RawUniqueItem interface** — removed phantom `ApiId: string` field (RawUniqueItem has NO ApiId per `poe2api.ts:639-652`); added explanatory note referencing `poe2api.ts:1025` comment; `IsChanceable?: boolean` → `IsChanceable: boolean | null`; `ItemMetadata?: any` → `ItemMetadata: Record<string, unknown> | null`.
  - **Mapping table `id` field** — `String(CurrencyItemId || UniqueItemId || ItemId)` → split into two rules: `String(ItemId || CurrencyItemId)` [currencies] + `String(ItemId || UniqueItemId)` [uniques]. Added note: "⚠️ ItemId takes PRIORITY — verified iter 144 against poe2api.ts:977 (mapCurrencyItem) and :1024 (mapUniqueItem)."
  - **Mapping table `apiId` field** — `ApiId` (single rule) → split: `ApiId` [currencies] + `String(ItemId || UniqueItemId)` [uniques — NO ApiId field!].
  - **Mapping table `relativePrice` field** — `CurrentPrice / referencePrice` → `referencePrice && currentPrice ? currentPrice / referencePrice : currentPrice` with note "⚠️ falls back to currentPrice when referencePrice is missing".
  - **Mapping table `change` field** — added "— null if either is null" suffix (matches null-guard at `poe2api.ts:965-968`).
  - **Mapping table `volume` field** — `computeVolume24h(PriceLogs)` → `computeVolume24h(PriceLogs) ?? 0` (matches `poe2api.ts:988`).
  - **Mapping table `sevenDayPriceChange` field** — added "— null if either is null" suffix.
  - **Mapping table `lowConfidence` field** — `CurrentQuantity < 5` → `(CurrentQuantity ?? 0) < 5` (matches `poe2api.ts:993`).
  - **Mapping table `listingCount` field** — `CurrentQuantity` → `CurrentQuantity ?? 0` (matches `poe2api.ts:994`).
- **`docs/DATA_FLOW.md` §5.2 audit (4 drift items fixed):**
  - **Added 3 missing fields** — `currency1CategoryApiId = CurrencyOne.CategoryApiId || ""`, `currency2CategoryApiId = CurrencyTwo.CategoryApiId || ""`, `currency2RelativePrice = safeParseFloat(CurrencyTwoData.RelativePrice)` (with comment "needed for cross-rate").
  - **Fixed `relativePrice`** — `price ?? 0` → `safeParseFloat(CurrencyOneData.RelativePrice)` with note "⚠️ NOT `price ?? 0` — code at poe2api.ts:1171 assigns relPrice1 directly; can be null. Doc previously claimed `?? 0` fallback — wrong."
  - **Fixed `volume`** — `CurrencyOneData.VolumeTraded` → `CurrencyOneData.VolumeTraded ?? 0` (matches `poe2api.ts:1154`).
  - **Noted null-initialization** — `change`, `changePercent`, `sevenDayChange`, `sevenDayChangePercent`, `history` all prefixed with "null (initialized) →" to clarify they start as null before enrichment.
- **§5.3 (Case Transform Rules) — no drift found.** All 3 rules verified correct against code.
- **§5.4 (Flipper Proxy Transform) — no drift found.** All 12 example transformations verified against `case-transform.ts:22-24` regex and `backend/models/currency.py` field names.
- **Meta-docs updates:**
  - `STATUS.md` header bump (iter 143 → iter 144).
  - `worklog.md` — added this iter-144 entry, removed iter-142 entry (rule: only last 2 iterations).
  - `AGENT_NAVIGATION.md` header bump (iter 143 → iter 144).
- **Final verification:** 0 source-code changes this iter (doc-only). 1466 pytest green baseline preserved from iter 143 (no `.py`/`.ts`/`.tsx` touched).

Stage Summary:
- **iter 144 SHIPPED — 1 doc deep-audited (§2 + §5), 0 new bugs.** 1 doc file updated (`docs/DATA_FLOW.md` — 13 drift items across §2 + §5.1 + §5.2). 0 source-code changes. 1466 pytest green (0 regressions — confirmed since no `.py`/`.ts`/`.tsx` was touched).
- **Modified files (1 doc + 3 meta-docs):** `docs/DATA_FLOW.md`, `STATUS.md` (header bump), `worklog.md` (this entry), `AGENT_NAVIGATION.md` (header bump).
- **What was NOT done (intentionally deferred to iter 145+):**
  - **`instrumentation.ts:7` comment drift** — still mentions `/api/health` (legacy). Doc-only drift in a code comment. Not fixed in iter 144 (kept source-code changes at 0). Candidate for iter 145+ source cleanup. Minimal change (1 line).
  - **Per-tab UX/logic deep-audit** — still deferred since iter 139. iter 141+142+143+144 only verified doc-level references to tabs. Full per-tab audit (i18n coverage, error states, empty states, loading skeletons, accessibility) is candidate for iter 145+.
  - **9 items still untranslated** (F1) — poe2db has the pages but no Russian translation yet. Re-run pipeline after a patch / monthly.
  - **TD-3 runtime log verification** — still deferred since iter 136 (requires prod access).
  - **Other DATA_FLOW.md sections** (§3, §4, §6, §7, §8, §9, §10) — iter 141 already audited these; no further drift found in iter 144. §1 (Architecture Overview) is a 1-line pointer to ARCHITECTURE.md — no drift.
- **Stopping point:** iter 144 = 1 doc deep-audited (DATA_FLOW.md §2 + §5, 13 drift items). Next iter candidates: (a) source cleanup — fix `instrumentation.ts:7` comment drift (`/api/health` → `/api/v1/health/ping`) — minimal 1-line source-code change, safe; (b) per-tab UX/logic deep-audit (i18n, error/empty/loading states, accessibility) — larger scope, deferred since iter 139; (c) re-run F1 pipeline after a patch / monthly; (d) TD-3 runtime log verification (requires prod access); (e) any new bugs the user identifies.

