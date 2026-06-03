# PoE2 Market Dashboard — Fix Progress Notes

## Session 2 — 2026-06-04

### ✅ 1. CRITICAL: Fix getLeagues() active league detection (POE2Scout default_league_value bug)
**File:** `src/lib/poe2api.ts`
**Root Cause:** POE2Scout API `/Realms` endpoint returns outdated `default_league_value: "Fate of the Vaal"` for the poe2 realm, even though `/Leagues` now correctly sets `IsCurrent: true` for "Runes of Aldur". The old code used `l.IsCurrent || (defaultLeagueValue ? l.Value === defaultLeagueValue : false)` which marked BOTH leagues as active via the `||` operator.
**Fix:** Changed the logic to check if ANY league has `IsCurrent=true` first. When any league has `IsCurrent=true`, use ONLY `IsCurrent` to determine active status (ignore outdated `default_league_value`). Only fall back to `defaultLeagueValue` matching when no league has `IsCurrent=true` (the historical case where the API always returned false).
**Impact:** Now correctly marks only "Runes of Aldur" as active, not both "Runes of Aldur" and "Fate of the Vaal".

### ✅ 2. Update E2E Test Fixtures for Current Leagues
**File:** `e2e/fixtures.ts`
**What:** Updated MOCK_REALMS and MOCK_LEAGUES to reflect the current PoE2 state:
- `MOCK_REALMS`: `defaultLeague: "Standard"` → `"Runes of Aldur"` for poe2 realm
- `MOCK_LEAGUES`: Replaced "Standard"/"Hardcore" with "runes"/"runeshc"/"standard" matching current PoE2 leagues
- This ensures E2E tests simulate realistic data and the league selector shows the correct active league

---

## Session 1 — 2026-06-03

### ✅ 1. E2E Smoke Test Fix — Heatmap Section Not Found
**File:** `e2e/smoke.spec.ts`
**Root Cause:** After selecting realm+league, the default activeTab is "exchange" (not "overview"). The MarketHeatmap component lives on the "Overview" tab. The test was looking for heatmap text on the Exchange tab.
**Fix:** Added a step to click the "Overview" tab (with i18n-aware selector: Обзор|Overview|概览|개요) before looking for the heatmap title. Also added `await page.waitForLoadState("networkidle")` after tab switch to ensure the tab panel mounts before asserting.

### ✅ 2. Default League Updated from "vaal" to "runes"
**Files changed:**
- `src/app/api/poe2/overview/route.ts` — Comment updated (Fate of the Vaal → Runes of Aldur)
- `src/__tests__/cors-proxy-fallback.test.ts` — All URL test strings: `vaal` → `runes`
- `src/__tests__/integration.test.tsx` — Mock data: `league: "runes"`
- `src/__tests__/currency-graph-tab.test.tsx` — Mock data: `league: "runes"` (3 instances)
- `src/__tests__/overview-route.test.ts` — Test cases: `"Vaal"` → `"Runes"`

### ✅ 3. Cache Snapshot Regenerated for "runes" League
**File:** `src/data/cache-snapshot.json`
**What:** Ran `npx tsx scripts/generate-cache-snapshot.ts` — fetched fresh data from the POE2Scout API for the "runes" (Runes of Aldur) league. All 9 endpoints fetched successfully.

### ✅ 4. Cache Snapshot Generator Improved — SnapshotPairs Truncation
**File:** `scripts/generate-cache-snapshot.ts`
**What:** The /SnapshotPairs endpoint returned 2250 pairs (~2.6 MB), causing the snapshot to exceed 500 KB. Added a post-processing step to truncate SnapshotPairs to 30 entries (same approach as the existing /Items truncation). Result: snapshot is now 168.6 KB.

### ✅ 5. Backend Python Tests Updated — "vaal" → "runes"
**Files changed:**
- `tests/test_scheduler.py` — `league_name="runes"`, all `"vaal"` → `"runes"` (6 instances)
- `tests/test_pipeline_cache_degraded.py` — All `"vaal"` → `"runes"` (5 instances)
- `tests/test_daily_stats_history.py` — All `"vaal"` → `"runes"` (5 instances)
- `tests/e2e/conftest.py` — Docstring examples: `"vaal"` → `"runes"` (2 instances)
- `tests/e2e/test_degraded_mode.py` — All `"vaal"` → `"runes"` (12 instances)

### ✅ 6. Data Flow Reference Doc Updated
**File:** `poe2-market-dashboard_PoE2_Data_Flow_Reference.md`
**What:** All 5 instances of `league=vaal` in example API URLs updated to `league=runes`.

### ✅ 7. React 19 "script tag while rendering" Warning
**Status:** Already properly handled — no changes needed.
- The E2E smoke test already filters this out (line 58 in smoke.spec.ts)
- The next.config.ts already has a comment documenting this (lines 17-20)
- `suppressHydrationWarning` is a per-element React prop, not a global config option

---

## What Was NOT Done (Next Session)

### 🔲 Report POE2Scout default_league_value Bug to Maintainers
The `/Realms` endpoint still returns `default_league_value: "Fate of the Vaal"` for the poe2 realm, even though `IsCurrent` is now `true` for "Runes of Aldur". The dashboard now works around this bug (see Session 2 fix #1), but the upstream data should be corrected. Report at: https://github.com/poe2scout/poe2scout

### 🔲 E2E Playwright Tests — Run Locally
The test fixtures were updated but not run locally (needs dev server). You should verify:
```bash
npx playwright install
npx next dev &
sleep 5
npx playwright test e2e/
```

### 🔲 Backend Tests — Run Locally
```bash
pip install -r requirements.txt
pytest tests/ -v
```

### 🔲 Frontend Jest Tests — Run Locally
```bash
npx jest --testPathPattern="src/__tests__"
```

### 🔲 Regenerate cache-snapshot.json
Run the cache snapshot generator to get fresh data:
```bash
npx tsx scripts/generate-cache-snapshot.ts
```

### 🔲 CI/CD: Add cache-snapshot.json Auto-Refresh
Add `scripts/generate-cache-snapshot.ts` to the CI/CD pipeline so the cache is automatically updated on each deploy. Example GitHub Actions step:
```yaml
- name: Generate cache snapshot
  run: npx tsx scripts/generate-cache-snapshot.ts
  env:
    POE2_SNAPSHOT_REALM: poe2
    POE2_SNAPSHOT_LEAGUE: runes
```

### 🔲 New League Checklist (when next league launches after "Runes of Aldur")
When a new league starts, update these files:
1. `src/lib/poe2api.ts` — `FALLBACK_LEAGUES`: add new league with `active: true`, set runes to `active: false`
2. `src/lib/poe2api.ts` — `FALLBACK_REALMS`: update `defaultLeague` for poe2
3. `config.yaml` → `league_name` and `league_start_date`
4. `src/lib/store.ts` → `DEFAULT_UI_STATE.league`
5. Regenerate `src/data/cache-snapshot.json` via `npx tsx scripts/generate-cache-snapshot.ts`
6. `backend/data/providers/official.py` → `_poe2scout_to_ggg_league` mapping
7. Update `e2e/fixtures.ts` MOCK_LEAGUES

### 🔲 config.yaml — "vaal" as Currency Category
In `config.yaml` line 47, there's `- vaal  # Runes of Aldur league` under `currency_categories`. This refers to the Vaal Orb as a currency CATEGORY, not the league. This is CORRECT and should NOT be changed. Same for `backend/config.py` line 57 which has `"vaal"` in `currency_categories` — this is the Vaal Orb category, not the league.

### 🔲 backend/data/providers/official.py League Mapping
The `_poe2scout_to_ggg_league` mapping currently has `"runes": "Runes of Aldur"`. This is correct for the current league. When a new league launches, add the new mapping here.

### 🔲 Store Default activeTab
Currently `activeTab: "overview"` in `store.ts` (updated in a previous session). This is a UX preference — the E2E test handles it correctly regardless.

---

## Files Modified (Summary)

| File | Change | Session |
|------|--------|---------|
| `src/lib/poe2api.ts` | Fix getLeagues() active detection: IsCurrent priority over outdated default_league_value | 2 |
| `e2e/fixtures.ts` | Update MOCK_REALMS/MOCK_LEAGUES to current PoE2 state | 2 |
| `PROGRESS-NOTES.md` | Document Session 2 changes and updated next-steps | 2 |
| `e2e/smoke.spec.ts` | Click Overview tab before checking heatmap | 1 |
| `scripts/generate-cache-snapshot.ts` | Add SnapshotPairs truncation | 1 |
| `src/data/cache-snapshot.json` | Regenerated for "runes" league | 1 |
| `src/app/api/poe2/overview/route.ts` | Comment: Fate of the Vaal → Runes of Aldur | 1 |
| `src/__tests__/cors-proxy-fallback.test.ts` | URL strings: vaal → runes | 1 |
| `src/__tests__/integration.test.tsx` | Mock league: vaal → runes | 1 |
| `src/__tests__/currency-graph-tab.test.tsx` | Mock league: vaal → runes | 1 |
| `src/__tests__/overview-route.test.ts` | Test params: Vaal → Runes | 1 |
| `tests/test_scheduler.py` | League: vaal → runes | 1 |
| `tests/test_pipeline_cache_degraded.py` | League: vaal → runes | 1 |
| `tests/test_daily_stats_history.py` | League: vaal → runes | 1 |
| `tests/e2e/conftest.py` | Docstring: vaal → runes | 1 |
| `tests/e2e/test_degraded_mode.py` | League: vaal → runes | 1 |
| `poe2-market-dashboard_PoE2_Data_Flow_Reference.md` | Example URLs: league=vaal → league=runes | 1 |
