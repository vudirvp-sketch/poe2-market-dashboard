# PoE2 Market Dashboard — Worklog

> Current state only. Historical details are in git history.

---

## Current State (2026-06-08)

**Build:** `npm run build` passes, `npm run test` passes (Jest), `pytest tests/` passes
**Backend:** FastAPI 0.2.0, league "runes" (Runes of Aldur), gold_enabled: false
**CI/CD:** GitHub Actions (frontend, backend, cache-snapshot, e2e jobs)
**Documentation:** AGENT_NAVIGATION.md v1.0 created, docs/ structure created

**Key Changes This Iteration:**

1. **Created documentation suite** — AGENT_NAVIGATION.md, docs/ARCHITECTURE.md, docs/DATA_CONTRACTS.md, docs/BACKEND_GUIDE.md, docs/CORS_PROXY_GUIDE.md, worklog.md
2. **Replaced PROGRESS-NOTES.md** — Historical session notes migrated to worklog.md (current state only)
3. **Updated README.md** — Removed duplication with docs/, added agent reference link

**NOT YET DONE (next iteration):**
- ⬜ Run E2E Playwright tests — verify Globe button i18n fix
- ⬜ Report POE2Scout `default_league_value` bug upstream
- ⬜ Verify `league_start_date` accuracy for Runes of Aldur
- ⬜ CI/CD: add `cache-snapshot.json` auto-refresh to workflow
- ⬜ Delete old SQLite database (optional cleanup)
- ⬜ Update `backend/data/providers/official.py` league mapping for next league
- ⬜ Run full backend pytest suite locally and confirm all pass
- ⬜ Run full frontend Jest suite locally and confirm all pass
- ⬜ Regenerate `cache-snapshot.json` with fresh data

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
