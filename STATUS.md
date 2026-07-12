# STATUS.md — Known Issues & Quick Reference

> **Last updated:** 2026-07-13 (iter 145 — closes candidate (a) from iter 144 stop point: fixed `instrumentation.ts:7` + `flipper-backend-bridge.ts:313` comment drift (`/api/health` → `/api/v1/health/ping`). Added `--audit` flag to `scripts/sync_currency_names_from_poe2db.py` (READ-ONLY audit of all 686 existing RU translations vs poe2db current RU `<title>`). Ran full audit on 634 translated items: **601 match (94.8%)**, **32 mismatch (5.0%)**, 1 no-Cyrillic (`aldurs-saga`). Opened **KI-32** (translation drift) + **KI-33** (non-ASCII slug crash, fixed same iter) + **TD-6** (translation alignment + unique-items RU support). 8 new audit tests + 6 KI-33 regression tests added to `tests/test_sync_currency_names.py` (57 total, all green). 1466 pytest green baseline preserved.)
> Single source of truth for known bugs and frequent problems. Update BEFORE fixing any issue.

---

## Known Issues — open

### KI-32 — Existing RU translations drift from poe2db official (P2)

**Identified iter 145.** User report: "перевод корявый и не такой как в официальном клиенте игры!".

**Root cause:** The iter-137 F1 pipeline (`--fetch-ru-by-item`) only fetches RU translations for items that are NOT yet translated — it silently SKIPS items that already have a translation. As a result, legacy translations sourced from PoE1 community wikis / early manual entries were never refreshed against poe2db's current official Russian localization. The drift is concentrated in 4 patterns:
1. **PoE1-style orb names** (13 currency items): `exalted → Благородная сфера` (PoE1) vs `Сфера возвышения` (PoE2 official). Also `alch`, `regal`, `aug`, `annul`, `vaal`, `whetstone`, `scrap`, `bauble`, `gcp`, `fracturing-orb`, `transmutation-shard`, `regal-shard`.
2. **"Ключ реликвария" vs "Ключ от Реликвария"** (7 vaultkeys items): poe2db uses "Ключ от Реликвария X" pattern; our JSON uses "Ключ реликвария X". Affected: `the-trialmasters-reliquary-key`, `xeshts-reliquary-key`, `the-arbiters-reliquary-key`, `tangmazus-reliquary-key`, `olroths-reliquary-key`, `ritualistic-reliquary-key`, `twilight-reliquary-key`.
3. **"Ядро души" vs "Ядро душ"** (6 ultimatum/soul-core items): grammatical case difference. Affected: `xopecs-soul-core-of-power`, `soul-core-of-azcapa`, `soul-core-of-quipolatl`, `soul-core-of-zalatl`, `opilotis-soul-core-of-assault`, `soul-core-of-opiloti`.
4. **Misc proper-noun translations** (3 items in lineagesupportgems/ritual/runes): `astrids-creativity`, `raven-touched-shard`, `head-of-the-king`.

**Audit report:** `scripts/.cache/translation_audit.json` (full list of 32 mismatches with `our_ru` + `poe2db_ru` + `poe2db_url` for each). Re-run with `python scripts/sync_currency_names_from_poe2db.py --audit`.

**Fix plan (TD-6 phase 1):** Add `--apply-audit` flag that overwrites `currency_names_ru` entries with poe2db values from the audit report. Requires `--confirm` (destructive — overwrites existing translations). Update `tests/test_currency_names_ru.py:46-51` spot-check assertions for `exalted`, `divine`, `mirror` after applying.

### KI-33 — Non-ASCII item names crash `--fetch-ru-by-item` and `--audit` (P3, FIXED iter 145)

**Identified iter 145** while running the first `--audit` pass. The audit crashed at item #500+ with `UnicodeEncodeError: 'ascii' codec can't encode character '\xf3' in position 9`.

**Root cause:** `_en_name_to_poe2db_slug()` strips apostrophes but keeps other non-ASCII chars (accented Latin, Cyrillic, etc.) intact. The resulting slug was inserted into a URL string that `urllib.request.urlopen` then tried to encode as ASCII, raising `UnicodeEncodeError`. Two items in `currency_names.json` triggered this: `mórrigans-insight` (EN: "Mórrigan's Insight") and `oisins-oath` (EN: "Oisín's Oath"). The parallel runner `scripts/fetch_ru_by_item_parallel.py:53` already URL-encoded the slug via `urllib.parse.quote(slug, safe="/%'")` — but the main `sync_currency_names_from_poe2db.py` script (used by both `--fetch-ru-by-item` and the new `--audit`) did NOT.

**Fix (iter 145):** Extracted a shared `_build_poe2db_url(base_url, slug)` helper that URL-encodes the slug. Both `fetch_poe2db_ru_names_by_item` and `audit_translations` now use it. Also added defensive `except (UnicodeEncodeError, UnicodeDecodeError)` clauses in both functions so a single bad slug can't kill the whole run. 6 regression tests added in `tests/test_sync_currency_names.py:TestBuildPoe2dbUrl`.

---

## Technical-debt backlog

| ID | Priority | Notes |
|----|----------|-------|
| **TD-3** | P3 | Triangular arbitrage persistence. All phases SHIPPED iter 129–134. **Open:** runtime log verification on next prod deploy — confirm `"TD-3 cache: populated pipeline_cache key=%s"` appears in `_refresh` output. |
| **TD-4** | P3 | `market_spread` persistence. Phase 2 SHIPPED iter 128. **Open:** verify rows land in SQLite in prod logs. |
| **TD-5** | P3 | `DailyStatsHistory` OHLCV persistence. Phase 4 SHIPPED iter 131. **Open:** verify hourly `daily_stats_refresh` persists; run `scripts/backfill_daily_stats.py --dry-run` then `--top-n 50`; verify lazy-fetch fallback fires. |
| **F1** | P3 | Russian translations for currency items. **Pipeline SHIPPED iter 137.** Iter 145 audit: 634/686 translated, 32 mismatches vs poe2db (see KI-32), 1 newly-discovered no-Cyrillic item (`aldurs-saga`). **Open:** (1) re-run `--fetch-ru-by-item` monthly / after each patch; (2) apply KI-32 fixes via TD-6 phase 1. |
| **TD-6** | P2 | Translation alignment with poe2db official + unique-items RU support. **Phase 1 (planned iter 146+):** add `--apply-audit` flag to overwrite KI-32 drift items (32 items). **Phase 2 (iter 147+):** extend pipeline to unique items — `poe2db.tw/ru/Unique_item` index → per-item page `<title>` extraction → new `unique_names_ru` / `unique_names_en` sections in `currency_names.json` (or new `unique_names.json`) → `mapUniqueItem` in `src/lib/poe2api.ts:1030` looks up RU name when locale=ru. **Phase 3:** re-audit cycle (monthly). |

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

**Plus 1 newly-discovered item (iter 145 audit):** `aldurs-saga` — we have a RU translation (`Сага Альдура`) but poe2db has no RU page. This is the only `no_cyrillic` audit finding. Keep our translation until poe2db adds theirs.

---

## Design-docs

| Doc | Covers | Status |
|-----|--------|--------|
| `docs/design/TD-3-4-5-9-persistence-gaps-design.md` | TD-3 + TD-4 + TD-5 + TD-9 unified persistence-layer analysis. Four-phase plan. | **ALL PHASES SHIPPED.** Phase 1 iter 127. Phase 2 iter 128. Phase 3 iter 129. Phase 4 iter 131. |
| `docs/design/P10-gold-map-roi-design.md` | P10 Gold Map ROI — UX + ROI formula. | DESIGN COMPLETE — Phase 1 (MVP) SHIPPED iter 127. Phase 2 (trend chart) SHIPPED iter 132. Phase 3 (SQLite promotion) optional. |

---

## Quick Reference — Frequent Problems

| Symptom | Cause | Where to fix |
|---------|-------|--------------|
| `python scripts/sync_currency_names_from_poe2db.py --audit` crashes with `UnicodeEncodeError: 'ascii' codec can't encode character` | **KI-33** (fixed iter 145) — non-ASCII item names (e.g. `Mórrigan's Insight`, `Oisín's Oath`) need URL-encoding in the slug. Fix: `_build_poe2db_url()` helper now uses `urllib.parse.quote(slug, safe="/%'")`. | `scripts/sync_currency_names_from_poe2db.py:_build_poe2db_url` |
| Existing RU translation differs from official poe2db Russian client (e.g. `exalted` shows "Благородная сфера" instead of "Сфера возвышения") | **KI-32** (open) — iter-137 pipeline only fetches NEW translations, never refreshes existing ones. 32 items affected. Run `--audit` to see full list. Fix planned in TD-6 phase 1. | `backend/data/currency_names.json` + future `--apply-audit` flag |
| Unique items (weapons, armour, accessories) show English names even when locale=ru | **TD-6 phase 2** (deferred) — `mapUniqueItem` in `poe2api.ts:1030` uses `raw.Text || raw.Name` directly; no RU lookup. Pipeline doesn't cover unique items yet (only the 17 currency categories). | `src/lib/poe2api.ts:1030`, future `unique_names_ru` section in `currency_names.json` |
| After updating `currency_names.json`, the TS mirror is out of sync | Run `python scripts/sync_currency_names_ts.py` to regenerate `src/lib/currency-names.ts` from the JSON. | `scripts/sync_currency_names_ts.py` |
| All API calls return 404; dashboard empty | **KI-15** (open) — `.env.local` has dead `api.poe2scout.com`. Use `POE2_API_BASE_URL=https://poe2scout.com/api` | `.env.local`, `start.bat`, `start.sh` |
| 6 pytest modules fail on collection (`test_daily_stats_persistence`, `test_market_spreads*`, `test_scheduler`, `test_triangular_cycles*`) | Env-setup issue — `aiosqlite` missing from active venv. Run `pip install -r requirements.txt` (or `pip install aiosqlite`). With aiosqlite installed, the full suite is **1466 pytest green** (vs 1289 with the 6 modules skipped). Does NOT indicate a regression. | env-only |
| `/optimizer/path` returns empty path with `data_available: true` | Profitable arbitrage cycle detected — fall back to `direct_rate` | `backend/api/routes_optimizer.py:_bellman_ford` |
| SQLite `near "LIMIT": syntax error` | Use `rowid IN (SELECT ... LIMIT ?)` pattern | `backend/data/historical.py:_prune_old_league_data` |
| FlipsTable "Trend" sparkline shows `—` instead of a line | By design (iter 135) — sparkline renders REAL `price_history_short` (≥ 2 points required). The synthetic `momentum × volatility` fallback was REMOVED as misleading. | `src/components/dashboard/flips-helpers.ts:getTrendSparklineData`, `sparkline.tsx:115-116` |
| `/api/v1/market-spreads/history` returns `data_available: false` | **TD-4** — table empty. Wait 5 min for snapshot refresh, or check `sqlite3 historical.db "SELECT COUNT(*) FROM market_spreads"`. | `backend/economy/market_spreads.py:compute_market_spreads` |
| `/api/v1/arbitrage/triangular/history` returns `data_available: false` | **TD-3** — table empty. Either (a) refresh hasn't run yet, (b) no profitable cycles detected (normal in stable markets), or (c) `find_triangular_arbitrage` timed out (90s — check logs for "TD-3: find_triangular_arbitrage failed"). | `backend/economy/triangular_cycles.py:compute_triangular_cycles` |
| `/api/v1/items/{item_id}/daily-stats` returns `data_available: false` | **TD-5** — table empty AND provider returned None. Either (a) item_id unknown to POE2Scout (404), (b) hourly `daily_stats_refresh` scheduler hasn't run yet, or (c) lazy-fetch provider call failed. | `backend/api/routes_daily_stats.py:get_daily_stats_history` |
| Gold Map ROI trend chart shows "No cycle history yet" | **P10 Phase 2** — same root cause as `/api/v1/arbitrage/triangular/history` row above. The chart needs ≥ 2 deduped points to draw a line. | `src/components/dashboard/gold-map-roi-trend-chart.tsx` |
| Mirror/Divine Arb tab shows "no price history yet" | By design (iter 109) — backend returns `data_available: false` when scheduler hasn't collected ≥ 4 Mirror + Divine snapshots. | `backend/economy/mirror_divine_arb.py`, `mirror-divine-arb-tab.tsx` |
| `/api/poe2/uniques` or `/api/poe2/currencies` returns 200 with empty `items: []` | KI-11 (closed iter 102) — verify `config.yaml:league.league_name` is valid | `src/lib/poe2api.ts` |

---

## Key technical insights for future agents

**Translation pipeline (iter 137 + iter 145).** Five stages:
1. `--fetch-ids` — live poe2scout.com API, paginates all 17 categories, writes `scripts/.cache/poe2scout_items.json`.
2. `--fetch-ru-by-item` (KI-30 fix) — per-item poe2db page fetch + `<title>` tag extraction. Skips already-translated items (does NOT refresh — see KI-32).
3. `--diff` — computes patch of proposed NEW translations only.
4. `--apply --confirm` — writes patch to JSON, preserves RU/EN key parity, idempotent.
5. `--audit` (iter 145, KI-32 enabler) — READ-ONLY audit of all existing RU translations against poe2db current RU `<title>`. Writes `scripts/.cache/translation_audit.json`. Does NOT modify `currency_names.json`.

After any JSON update, run `python scripts/sync_currency_names_ts.py` to regenerate the TS mirror. Bump count assertions in `tests/test_currency_names_ru.py:30-34` to match. The legacy `--fetch-ru` (category-page parser) is BROKEN per KI-30 — do not use it. For speed, use `scripts/fetch_ru_by_item_parallel.py` (thread-pooled version). KI-33 fix (iter 145): all URL construction goes through `_build_poe2db_url()` which percent-encodes non-ASCII chars (needed for items like `Mórrigan's Insight`, `Oisín's Oath`).

**FastAPI route matching is ORDER-DEPENDENT.** A `{param:path}` converter is greedy and matches slashes — it will shadow any literal sub-path registered AFTER it. Always register literal-path routers BEFORE greedy-path routers. (KI-13 lesson.)

**Frontend price formatting convention.** `fmtPrice`-style helpers should keep 2 decimals for prices `>= 1` and 4 decimals for `< 1`. Never truncate large prices to integers — this silently broke the iter-110 live-price test (KI-21).

**Naive datetime handling (KI-26 / KI-27).** When converting a naive `datetime` (no `tzinfo`) to UTC, use `dt.astimezone(timezone.utc)` — NOT `dt.replace(tzinfo=timezone.utc)`. `replace()` is ONLY correct when the input is already UTC but lacks `tzinfo` (SQLite, POE2Scout ISO strings without `Z`).

**Three-layer persistence pattern (iter 128–131).** (1) Pure helper in `backend/economy/<feature>.py` taking `(snapshot, config)` → `list[dict]` — no I/O. (2) Best-effort write in `SnapshotManager._refresh()` AFTER snapshot built, BEFORE `return snapshot` — `try/except` + `INSERT OR IGNORE`. (3) Read-only `GET /api/v1/<feature>/history` returning 200 with `data_available: false` on empty. **TD-5 adaptation:** daily-cadence metrics write in TWO places (route lazy-fetch + scheduler hourly), use `INSERT OR REPLACE`.

**Dependency-free SVG line chart pattern (iter 75 + iter 132).** Prefer hand-rolled SVG over Recharts/Chart.js. Canonical template: `src/components/dashboard/storage-value-history-chart.tsx`. Always render "no history yet" notice when `points.length < 2`. Dedup to "best per timestamp" client-side for SQLite history tables.
