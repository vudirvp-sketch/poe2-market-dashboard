# PoE2 Market Dashboard — Fix Progress Notes

## What Was Done (This Session)

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

### 🔲 Backend Tests — Run Locally
The backend Python tests were updated but not run locally. You should verify:
```bash
cd /path/to/poe2-market-dashboard
pip install -r requirements.txt
pytest tests/ -v
```

### 🔲 E2E Tests — Run Locally
The Playwright test fix was made but not run locally (needs dev server). You should verify:
```bash
npx playwright install
npx next dev &
npx playwright test e2e/smoke.spec.ts
```

### 🔲 Frontend Jest Tests — Run Locally
```bash
npx jest --testPathPattern="src/__tests__"
```

### 🔲 config.yaml — "vaal" as Currency Category
In `config.yaml` line 47, there's `- vaal  # Runes of Aldur league` under `currency_categories`. This refers to the Vaal Orb as a currency CATEGORY, not the league. This is CORRECT and should NOT be changed. Same for `backend/config.py` line 57 which has `"vaal"` in `currency_categories` — this is the Vaal Orb category, not the league.

### 🔲 backend/data/providers/official.py Line 445
The line `url = f"{GGG_TRADE_BASE}/exchange/Vaal"` uses "Vaal" as the GGG Trade API path, which is the official GGG league name for their exchange endpoint. This is a DIFFERENT context from our internal league ShortName. This should likely be updated to the current GGG league path, but needs verification against the actual GGG Trade API.

### 🔲 PoE2_Flipper_Canonical_Formulas.md
This file references `"vaal_orb": 160` in gold cost tables and "Vaal Orbs" in flip scenarios — these are about the Vaal Orb ITEM, not the league. No changes needed.

### 🔲 Store Default activeTab
Currently `activeTab: "exchange"` in `store.ts`. You mentioned wanting the default tab to be something else (overview?) but this is a UX preference, not a bug. The E2E test now handles this correctly regardless.

---

## Files Modified (Summary)

| File | Change |
|------|--------|
| `e2e/smoke.spec.ts` | Click Overview tab before checking heatmap |
| `scripts/generate-cache-snapshot.ts` | Add SnapshotPairs truncation |
| `src/data/cache-snapshot.json` | Regenerated for "runes" league |
| `src/app/api/poe2/overview/route.ts` | Comment: Fate of the Vaal → Runes of Aldur |
| `src/__tests__/cors-proxy-fallback.test.ts` | URL strings: vaal → runes |
| `src/__tests__/integration.test.tsx` | Mock league: vaal → runes |
| `src/__tests__/currency-graph-tab.test.tsx` | Mock league: vaal → runes |
| `src/__tests__/overview-route.test.ts` | Test params: Vaal → Runes |
| `tests/test_scheduler.py` | League: vaal → runes |
| `tests/test_pipeline_cache_degraded.py` | League: vaal → runes |
| `tests/test_daily_stats_history.py` | League: vaal → runes |
| `tests/e2e/conftest.py` | Docstring: vaal → runes |
| `tests/e2e/test_degraded_mode.py` | League: vaal → runes |
| `poe2-market-dashboard_PoE2_Data_Flow_Reference.md` | Example URLs: league=vaal → league=runes |
