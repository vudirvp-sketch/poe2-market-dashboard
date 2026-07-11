# MERGE INSTRUCTIONS — iter 108

## What's in this delivery

**New feature:** P7 Mirror/Divine Arb Detector (backend + proxy + TS types).
**Verification:** KI-13 production-verified via backend log.
**Tests:** 70 new pytest (all green). Regression: 1218 pytest green.

## Files to merge

### NEW files (create in your local copy)

```
backend/economy/mirror_divine_arb.py                                    (new, ~350 lines)
backend/api/routes_mirror_divine_arb.py                                 (new, ~105 lines)
src/app/api/flipper/mirror-divine-arb/route.ts                          (new, ~58 lines)
tests/test_mirror_divine_arb.py                                         (new, ~745 lines, 70 tests)
```

### MODIFIED files (overwrite/merge)

```
backend/api/response_models.py                                          (added 2 pydantic models at end)
backend/main.py                                                         (registered new router after leveling_uniques_router)
src/lib/types.ts                                                        (added 4 TS types after LiquidChainOpportunitiesResponse)
STATUS.md                                                               (KI-13 verified, iter 108 update, key insight footer)
docs/MARKET_PLAYBOOK.md                                                 (§C.6 DONE, §B P7 row, §D.2/D.3, header, §E)
AGENT_NAVIGATION.md                                                     (header + 2 new rows in module table)
worklog.md                                                              (appended iter 108, trimmed iter 105)
```

## How to merge

1. **Extract the archive** into your local repo root:
   ```bash
   cd /path/to/poe2-market-dashboard
   unzip -o /path/to/iter108.zip
   ```
   The archive preserves folder structure — files will land in the right place.

2. **Verify backend tests pass:**
   ```bash
   .venv\Scripts\python.exe -m pytest tests/test_mirror_divine_arb.py -v
   .venv\Scripts\python.exe -m pytest -q                              # full regression
   ```
   Expected: 70 new tests pass, 1218 total pass (or 1231 if you have `aiosqlite` installed — `test_scheduler.py` will then also run).

3. **Verify the new endpoint is registered:**
   ```bash
   .venv\Scripts\python.exe -c "from backend.main import app; print([r.path for r in app.routes if 'mirror-divine' in getattr(r,'path','')])"
   ```
   Expected: `['/api/v1/mirror-divine-arb']`

4. **Build the frontend** (verifies TS types compile):
   ```bash
   npm run build
   ```
   Expected: ✓ Compiled successfully, zero warnings.

5. **Run the dashboard and exercise the new endpoint:**
   ```bash
   ./start.bat           # or ./start.sh
   ```
   In another terminal:
   ```bash
   curl "http://localhost:8000/api/v1/mirror-divine-arb?days=30" | python -m json.tool
   curl "http://localhost:3000/api/flipper/mirror-divine-arb?days=30" | python -m json.tool
   ```
   Expected: JSON with `current_rate`, `mean_rate`, `z_score`, `signal`, `recommended_action`, `price_history_short`, etc. If the league has no mirror or divine price history yet, returns `data_available: false` with null fields.

## What's NOT in this delivery (deferred to iter 109)

- **UI tab for P7** — `mirror-divine-arb-tab.tsx` (single-object render with sparkline + signal/action badges) + wiring in `dashboard-page.tsx` + `dashboard-toolbar.tsx` + `shortcuts-dialog.tsx` + i18n × 4 locales (~25-30 keys × 4).
- **TD-3/4/5/9** — persistence gaps (not blocking, on roadmap).
- **P9 Phase-aware investment advisor** (§C.7), **P10 Gold Map ROI** (§C.8).

## Stopping point

**iter 108 SHIPPED.** P7 backend + proxy + TS types + 70 pytest green. KI-13 production-verified.

**Next iter (iter 109) candidates:**
1. P7 UI tab (highest priority — completes the P7 feature end-to-end)
2. TD-3/4/5/9 persistence gaps
3. P9 Phase-aware investment advisor (§C.7)

**Key design note for iter 109 agent:** P7 returns a SINGLE-OBJECT response, not a per-currency list. Mirror:Divine is ONE market. The UI tab should render ONE record (current rate / z-score / signal / action / sparkline), NOT a table of rows. Follow the `speculation-tab.tsx` pattern but with single-object shape — use `useQuery(["mirrorDivineArb", days], ...)` and render the response fields directly.
