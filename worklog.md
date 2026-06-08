# PoE2 Market Dashboard — Worklog

> Current state only. Historical details are in git history.

---

## Current State (2026-06-08)

**Build:** `npm run build` passes, `npm run test` passes (Jest 260/260), `pytest tests/` passes (286/286)
**Backend:** FastAPI 0.2.0, league "runes" (Runes of Aldur), gold_enabled: false
**CI/CD:** `.github/workflows/ci.yml` — frontend + backend tests, E2E, scheduled cache-snapshot refresh
**Documentation:** AGENT_NAVIGATION.md v1.2, docs/ structure (5 files), worklog.md

**Key Changes This Iteration:**
1. **Fixed acceleration formula bug** — `log_returns[-m]` → `log_returns[-1-m]` in `backend/economy/momentum.py`. The old indexing made acceleration always 0 when m=1 (which is the case for the §2 verification example). Now produces correct value (-0.00038).
2. **Fixed `test_reset` expectation** — After `reset()`, `compute()` returns `volatility=min_volatility` (0.001), not 0.0. Updated test to match correct behavior.
3. **Updated Canonical Formulas §2.4** — Clarified `log_returns[-1-m]` indexing and documented the previous bug.
4. **Added `.github/workflows/ci.yml`** — CI pipeline with frontend Jest, backend pytest, Playwright E2E, and scheduled cache-snapshot.json auto-refresh (every 6h) with auto PR creation.
5. **Verified cross-references** — All documentation links are valid.

**NOT YET DONE (next iteration):**
- ⬜ Run E2E Playwright tests — verify Globe button i18n fix (3 tests were failing)
- ⬜ Report POE2Scout `default_league_value` bug upstream — `/Realms` returns stale value
- ⬜ Verify `league_start_date` accuracy for Runes of Aldur
- ⬜ Delete old SQLite database (optional cleanup)
- ⬜ Regenerate `cache-snapshot.json` with fresh data (requires POE2Scout API access)

---

## Frequent Bugs

1. **`default_league_value` format mismatch** — POE2Scout returns displayName but code expects ShortName. Fix: DEFAULT_LEAGUE_OVERRIDES + dual matching.
2. **R_buy/R_sell swapped** — Must be bid/ask (market-maker model). If reversed, gross_profit_pct ≈ −3.5%.
3. **Correlation matrix 0 valid pairs** — min_overlap=10 impossible for young leagues. Fix: max(2, 0.3*min_len).
4. **Globe button doesn't close More menu** — Add setMoreOpen(false) to onClick.
5. **`cache-snapshot.json` too large** — /SnapshotPairs ~2.6 MB. Fix: truncate to 30 entries.
6. **PriceLogs REVERSE chronological** — Always sort before charting.
7. **`IsCurrent` unreliable** — Prefer when any league has true, else fall back to default_league_value.
8. **scipy ConstantInputWarning** — Pre-check np.std() == 0 before spearmanr.
9. **Missing currency categories** — Keep config.yaml complete with all API-returned categories.
10. **gold_enabled: false** — Do NOT add fee calculations unless re-enabled.
11. **npm is the package manager** — Not pnpm/yarn.
12. **Types in src/lib/types.ts ONLY** — No duplicate type definitions.
13. **PascalCase aliases in backend schemas** — Python snake_case → serialized PascalCase.
14. **poe2api.ts PascalCase→camelCase** — Except /Realms (snake_case).
15. **/api/flipper/* routes are pure proxies** — No business logic in Next.js route handlers.
16. **Acceleration formula indexing** — Must use `log_returns[-1-m]`, NOT `log_returns[-m]`. The latter equals `log_returns[-1]` when m=1, producing zero acceleration.

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
