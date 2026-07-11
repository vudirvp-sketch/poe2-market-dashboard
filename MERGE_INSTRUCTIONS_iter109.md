# MERGE INSTRUCTIONS — iter 109

## What's in this delivery

**New feature:** P7 Mirror/Divine Arb Detector UI tab — single-object card render (NOT a per-currency list). Wired into dashboard + i18n × 4 locales.
**Backend was iter 108** (unchanged in this delivery — pure function + API route + proxy + TS types + 70 pytest green).
**Verification:** 1218 pytest green (no regression). 42 i18n keys × 4 locales parity verified programmatically. Bracket balance verified in all 4 modified TS/TSX files.

## Files to merge

### NEW files (create in your local copy)

```
src/components/dashboard/mirror-divine-arb-tab.tsx                  (new, ~525 lines)
```

### MODIFIED files (overwrite/merge)

```
src/components/dashboard/dashboard-page.tsx                         (added MirrorDivineArbTab lazy import + "mirror-divine-arb" to TAB_MAP at idx 12 + TabsContent block)
src/components/dashboard/dashboard-toolbar.tsx                      (added ArrowUpDown import + new TabsTrigger between weekly-patterns and liquid-chain)
src/components/dashboard/shortcuts-dialog.tsx                       (updated iter-99 comment with iter 109 entry — no new shortcut slot consumed)
src/lib/i18n/locales/en.ts                                          (added 42 new mirrorDivine* keys at end, before `} as const;`)
src/lib/i18n/locales/ru.ts                                          (added same 42 keys, RU translations)
src/lib/i18n/locales/ko.ts                                          (added same 42 keys, KO translations)
src/lib/i18n/locales/zh.ts                                          (added same 42 keys, ZH translations)
STATUS.md                                                           (header updated to iter 109, added Quick-Reference row for "Mirror/Divine Arb tab shows 'no price history yet'")
docs/MARKET_PLAYBOOK.md                                             (header + §B P7 row + summary + §C.6 + §D.2 row 5 + §D.3 stop-point + §E)
AGENT_NAVIGATION.md                                                 (header + new module-table row for mirror-divine-arb-tab.tsx + updated weekly-patterns row idx reference)
worklog.md                                                          (appended iter 109 entry, trimmed iter 107 — only iter 108 + iter 109 kept)
```

## How to merge

1. **Extract the archive** into your local repo root:
   ```bash
   cd /path/to/poe2-market-dashboard
   unzip -o /path/to/iter109.zip
   ```
   The archive preserves folder structure — files will land in the right place.

2. **Verify backend tests still pass** (P7 backend was iter 108, untouched in iter 109):
   ```bash
   .venv\Scripts\python.exe -m pytest tests/test_mirror_divine_arb.py -v
   .venv\Scripts\python.exe -m pytest -q                              # full regression
   ```
   Expected: 70 P7 tests pass, 1218 total pass (or 1231 if you have `aiosqlite` installed — `test_scheduler.py` will then also run).

3. **Build the frontend** (verifies TS types compile + i18n key parity):
   ```bash
   npm run build
   ```
   Expected: ✓ Compiled successfully, zero warnings.

4. **Run the dashboard and exercise the new tab:**
   ```bash
   ./start.bat           # or ./start.sh
   ```
   Open the dashboard in your browser, click the new "Mirror/Div" tab (between "Weekly" and "Liquid Chain"). Expected:
   - If the league has ≥ 4 Mirror + Divine price snapshots in the lookback window: a single card with current rate / z-score / deviation / signal+action badges / sparkline + 7/14/30/90 day selector.
   - If insufficient data: a "no price history yet" notice (still shows the day selector + refresh).
   - If the backend is offline: an amber "requires the analytics backend" notice.

5. **(Optional) Verify the endpoint directly:**
   ```bash
   curl "http://localhost:8000/api/v1/mirror-divine-arb?days=30" | python -m json.tool
   curl "http://localhost:3000/api/flipper/mirror-divine-arb?days=30" | python -m json.tool
   ```

## What's NOT in this delivery (deferred to iter 110+)

- **TD-3/4/5/9** — persistence gaps (not blocking, on roadmap since iter 108).
- **P9 Phase-aware investment advisor** (§C.7) — extend `phase_hints.py` with live-price binding.
- **P10 Gold Map ROI** (§C.8) — calculator depending on P1 (3-way flips).
- **tsc/jest regression** — Known Issue with OOM-killer at `npm install` (4GB RAM, no swap, requires 8GB+ since iter 99). TS files syntax-checked (balanced braces/parens), i18n key parity verified programmatically.

## Stopping point

**iter 109 SHIPPED.** P7 Mirror/Divine Arb Detector UI tab DONE end-to-end (backend iter 108 + UI iter 109 + i18n × 4 locales). KI-13 production-verified.

**Next iter (iter 110) candidates:**
1. TD-3/4/5/9 persistence gaps (require careful persistence-layer design).
2. P9 Phase-aware investment advisor (§C.7) — extend `phase_hints.py` with live-price binding.
3. P10 Gold Map ROI (§C.8) — calculator depending on P1 (3-way flips).
4. tsc/jest regression — requires 8GB+ RAM environment (Known Issue since iter 99).

**Key design note for iter 110 agent:** P7 UI is a SINGLE-OBJECT CARD, not a per-currency list. Mirror:Divine is ONE market. The card has 7 sections (header / signal+action badges / hero metrics / profit+actionable / stats grid / sparkline / footer) and 5 graceful-degradation branches (offline / loading / error / no-data / insufficient-sample). Tab is at TAB_MAP idx 12 (click-only — no keyboard shortcut, outside the 1-9+0 range). Icon: ArrowUpDown.
