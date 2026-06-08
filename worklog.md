# PoE2 Market Dashboard — Worklog

> Current state only. Historical details are in git history.

---

## Current State (2026-06-08)

**Build:** `npm run build` passes, `npm run test` passes (Jest 260/260), `pytest tests/` passes (286/286)
**E2E:** Playwright 39/39 pass (Globe button i18n fix confirmed)
**Backend:** FastAPI 0.2.0, league "runes" (Runes of Aldur), gold_enabled: false
**CI/CD:** `.github/workflows/ci.yml` — frontend + backend tests, E2E, scheduled cache-snapshot refresh (every 6h)
**Documentation:** AGENT_NAVIGATION.md v1.3, docs/ structure (5 files), worklog.md

**Key Changes This Iteration:**
1. **Verified E2E Playwright tests** — 39/39 pass. Globe button i18n fix works correctly.
2. **Verified `league_start_date`** — May 29, 2026 1PM PDT = 20:00 UTC. Confirmed via poe2.com forum + game8.co.
3. **Removed accidental `.lnk` file** — Deleted `PROGRESS-NOTES.md — ярлык.lnk`, added `*.lnk` to `.gitignore`.
4. **Confirmed `historical.db` not in repo** — `*.db` already in `.gitignore`; no stale "vaal" league data present.
5. **Clarified Globe button behavior** — Doesn't close More menu by design (allows cycling locales). E2E tests depend on this.
6. **Clarified React 19 "script tag" warnings** — Upstream Next.js 16 bug (#72213). Monkey-patch in layout.tsx suppresses it; still appears in dev server logs but harmless.

**NOT YET DONE (next iteration):**
- ⬜ Report POE2Scout `default_league_value` bug upstream (draft below)
- ⬜ Regenerate `cache-snapshot.json` with fresh data (requires POE2Scout API access / VPN)

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

---

## Frequent Bugs

1. **`default_league_value` format mismatch** — POE2Scout returns displayName but code expects ShortName. Fix: DEFAULT_LEAGUE_OVERRIDES + dual matching.
2. **R_buy/R_sell swapped** — Must be bid/ask (market-maker model). If reversed, gross_profit_pct ≈ −3.5%.
3. **Correlation matrix 0 valid pairs** — min_overlap=10 impossible for young leagues. Fix: max(2, 0.3*min_len).
4. **`cache-snapshot.json` too large** — /SnapshotPairs ~2.6 MB. Fix: truncate to 30 entries.
5. **PriceLogs REVERSE chronological** — Always sort before charting.
6. **`IsCurrent` unreliable** — Prefer when any league has true, else fall back to default_league_value.
7. **scipy ConstantInputWarning** — Pre-check np.std() == 0 before spearmanr.
8. **Missing currency categories** — Keep config.yaml complete with all API-returned categories.
9. **gold_enabled: false** — Do NOT add fee calculations unless re-enabled.
10. **npm is the package manager** — Not pnpm/yarn.
11. **Types in src/lib/types.ts ONLY** — No duplicate type definitions.
12. **PascalCase aliases in backend schemas** — Python snake_case → serialized PascalCase.
13. **poe2api.ts PascalCase→camelCase** — Except /Realms (snake_case).
14. **/api/flipper/* routes are pure proxies** — No business logic in Next.js route handlers.
15. **Acceleration formula indexing** — Must use `log_returns[-1-m]`, NOT `log_returns[-m]`.

## Build & Run Commands

```bash
# Frontend
npm install
npm run dev              # Dev server (port 3000)
npm run build            # Production build
npm run test             # Jest unit tests
npm run test:e2e         # Playwright E2E tests
npm run lint             # Lint check

# Backend
pip install -r requirements.txt
uvicorn backend.main:app --reload --port 8000
pytest tests/ -v         # Backend tests

# Cache snapshot
npx tsx scripts/generate-cache-snapshot.ts

# Both (Windows)
start.bat
```
