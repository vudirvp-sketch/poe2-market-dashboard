# PoE2 Market Dashboard — Worklog

> Current state only. Historical details are in git history.

---

## Current State (2026-06-08)

**Build:** `npm run build` passes, `npm run test` passes (Jest 260/260), `pytest tests/` passes (286/286)
**E2E:** Playwright 39/39 pass
**Backend:** FastAPI 0.2.0, league "runes" (Runes of Aldur), gold_enabled: false
**CI/CD:** `.github/workflows/ci.yml` — frontend + backend tests, E2E, scheduled cache-snapshot refresh (every 6h)
**Documentation:** AGENT_NAVIGATION.md v1.6, docs/ structure (5 files)

**Changes This Iteration:**
1. **Fixed TypeScript build error in `exchange-table.tsx`** — `uiState.baseCurrencyText` is `string | null` but `RateCellProps.baseCurrencyText` expects `string`. Added `?? ""` fallback.
2. **Synced `start.sh` .env.local logic with `start.bat`** — Conditional `NEXT_PUBLIC_FLIPPER_WS_ENABLED` (true when uvicorn found, false otherwise), auto-add to existing .env.local if missing, verify `POE2_API_BASE_URL` subdomain. Matches start.bat behavior exactly.

**NOT YET DONE (next iteration):**
- ⬜ Report POE2Scout `default_league_value` bug upstream — draft ready below, needs manual submission
- ⬜ Regenerate `cache-snapshot.json` with fresh data (requires POE2Scout API access / VPN)
- ⬜ Fix pre-existing TS errors in `src/__tests__/poe2api-realms.test.ts` (Property 'active' missing on TestLeague type) — non-blocking, tests pass at runtime

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

**Status:** Ready for submission to POE2Scout (GitHub issue or Discord). Requires manual action.
