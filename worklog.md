# PoE2 Market Dashboard — Worklog

> Current state only. Historical details are in git history.

---

## Current State (2026-06-08)

**Build:** `npm run build` passes, `npm run test` passes (Jest 260/260), `pytest tests/` passes (286/286)
**E2E:** Playwright 39/39 pass (Globe button i18n fix confirmed)
**Backend:** FastAPI 0.2.0, league "runes" (Runes of Aldur), gold_enabled: false
**CI/CD:** `.github/workflows/ci.yml` — frontend + backend tests, E2E, scheduled cache-snapshot refresh (every 6h)
**Documentation:** AGENT_NAVIGATION.md v1.4, docs/ structure (5 files)

**Key Changes This Iteration (audit & cleanup):**
1. **Fixed `backend/config.py` default** — `league_start_date` was `2026-06-02T00:00:00Z` (wrong), now `2026-05-29T20:00:00Z` (matches config.yaml)
2. **Fixed `backend/economy/lifecycle.py` docstring** — Phase defaults were `7/35`, now `14/42` (matches code)
3. **Updated `PoE2_Flipper_Canonical_Formulas.md`** — Phase defaults corrected to 14/42, added DEPRECATED SECTIONS NOTICE
4. **Updated `docs/DATA_FLOW.md`** — Removed `routes_auth.py` references (file deleted), fixed `scoreColor` description, added `routes_scanner.py`
5. **Updated `docs/DATA_CONTRACTS.md`** — Added note about misleading `netValueAfterFees` field name
6. **Deleted `PROGRESS-NOTES.md`** — Was a dead stub redirecting to worklog and AGENT_NAVIGATION
7. **Trimmed `AGENT_NAVIGATION.md`** — Replaced duplicated architecture/API/config sections with links, removed DONE history, updated version to 1.4
8. **Trimmed `worklog.md`** — Removed duplicated Frequent Bugs and Build Commands (canonical in AGENT_NAVIGATION.md)

**NOT YET DONE (next iteration):**
- ⬜ Report POE2Scout `default_league_value` bug upstream (draft below)
- ⬜ Regenerate `cache-snapshot.json` with fresh data (requires POE2Scout API access / VPN)
- ⬜ Fix `OHLCVCandle` type location violation — defined in `poe2api.ts` and duplicated in 2 components, should be in `types.ts`
- ⬜ Rename `netValueAfterFees` → `netValue` in StorageValueResponse (gold fees disabled, name is misleading)
- ⬜ Add `NEXT_PUBLIC_FLIPPER_WS_ENABLED` to `start.sh` `.env.local` template (matches start.bat)
- ⬜ Document `routes_scanner.py` in `docs/BACKEND_GUIDE.md` analytics pipeline
- ⬜ Add `routes_scanner.py` endpoint to AGENT_NAVIGATION.md API tables (via DATA_FLOW.md §7)
- ⬜ Either set `noImplicitAny: true` in `tsconfig.json` or update AGENT_NAVIGATION.md pre-commit checklist
- ⬜ Add cross-links in `docs/ARCHITECTURE.md` to specialized docs (replace duplicated sections)

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
