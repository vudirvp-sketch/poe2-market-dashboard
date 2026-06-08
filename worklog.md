# PoE2 Market Dashboard — Worklog

> Current state only. Historical details are in git history.

---

## Current State (2026-06-08)

**Build:** `npm run build` passes, `npm run test` passes (Jest 260/260), `pytest tests/` passes (286/286)
**E2E:** Playwright 39/39 pass (Globe button i18n fix confirmed)
**Backend:** FastAPI 0.2.0, league "runes" (Runes of Aldur), gold_enabled: false
**CI/CD:** `.github/workflows/ci.yml` — frontend + backend tests, E2E, scheduled cache-snapshot refresh (every 6h)
**Documentation:** AGENT_NAVIGATION.md v1.5, docs/ structure (5 files)

**Key Changes This Iteration (cleanup & renames):**
1. **Fixed `OHLCVCandle` type location (I4 violation)** — moved from `poe2api.ts` to `types.ts`, removed duplicates from `pair-detail-dialog.tsx` and `detail-dialog.tsx`
2. **Renamed `netValueAfterFees` → `netValue`** — across `types.ts`, `StorageValueResult` (backend model), `storage_value.py` (predictor), `routes_storage_value.py`, `routes_ws.py`, flipper proxy route, `flips-detail-dialog.tsx`, and `test_storage_value.py`. Gold fees disabled, old name was misleading.
3. **Documented `routes_scanner.py`** — added to `DATA_CONTRACTS.md` §4.2 (backend-only table) and `AGENT_NAVIGATION.md` §7 (API references)
4. **Updated pre-commit checklist** — `noImplicitAny: false` is intentional (documented in checklist)
5. **Added aggressive cross-links in `ARCHITECTURE.md`** — §6 (Scheduler) and §7 (Cache) now have prominent links to `BACKEND_GUIDE.md` §4 and §5

**NOT YET DONE (next iteration):**
- ⬜ Report POE2Scout `default_league_value` bug upstream (draft below)
- ⬜ Regenerate `cache-snapshot.json` with fresh data (requires POE2Scout API access / VPN)
- ⬜ Add `NEXT_PUBLIC_FLIPPER_WS_ENABLED` to `start.sh` `.env.local` template (matches start.bat)

---

## POE2Scout Bug Report Draft

**Title:** `/Realms` endpoint returns `displayName` instead of `ShortName` in `default_league_value`

**Description:**
The `/Realms` endpoint's `default_league_value` field returns the league's `displayName` (e.g. "Runes of Aldur") instead of its `ShortName` (e.g. "runes"). This is inconsistent with the `/Leagues` endpoint, where the `ShortName` field is the standard identifier used in all other API paths (e.g. `/Items/{realm}/{league}`).

**Current behavior:**
```json
{
  "default_league_value": "Runes of Aldur",
  "realm_api_id": "poe2"
}
```

**Expected behavior:**
```json
{
  "default_league_value": "runes",
  "realm_api_id": "poe2"
}
```

**Impact:** Consumers must implement workarounds (`DEFAULT_LEAGUE_OVERRIDES` mapping) to resolve `default_league_value` to the correct `ShortName` for API path construction. Additionally, `default_league_value` is not updated promptly when a new league launches — it retained "Fate of the Vaal" for days after Runes of Aldur launched.

**Workaround in our code:** `src/lib/poe2api.ts` → `DEFAULT_LEAGUE_OVERRIDES` + `getRealms()` override logic.
