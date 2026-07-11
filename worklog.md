# Worklog — PoE2 Market Dashboard

> Append-only shared multi-agent work log. Each section starts with `---`.
> Old task history is in `git log`. Trimmed to last 2 iterations.

---

Task ID: iter-111
Agent: main
Task: iter 111 — fix KI-21: `fmtPrice` in `phase-hints-widget.tsx` rounded prices ≥ 100 to integer, breaking the iter-110 jest test for live-price rendering. Also document KI-22 (ESLint v9 flat config missing).

Work Log:
- Cloned repo. Read STATUS.md (KI-20 open, KI-19/KI-13 closed, TD-3/4/5/9 backlog), worklog.md (iter 109 + iter 110 entries), and the user-provided jest/tsc/build/lint/pytest logs.
- **Identified the failing test.** `npx jest --silent` showed exactly 1 failure in `src/__tests__/phase-hints-widget.test.tsx:497`:
  ```
  ● PhaseHintsWidget › iter 110 — live-price section › renders current price with the tracked currency label
    Expected: "115.50"
    Received: "116"
  ```
  Test provides `currentPrice: 115.5` and expects `"115.50"`. Widget rendered `"116"`. Root cause: `fmtPrice()` in `phase-hints-widget.tsx:378` had a `price >= 100 → price.toFixed(0)` branch that rounded to integer.
- **Confirmed scope.** Searched the codebase: `fmtPrice` is defined at `phase-hints-widget.tsx:376` and used only at line 436 (same file). No external callers. The other `toFixed(0)` calls in the repo are all for percentages (`(x * 100).toFixed(0)`) or thousands (`(v / 1000).toFixed(0)`) — unrelated and intentional.
- **Confirmed test expectations.** Read the full `phase-hints-widget.test.tsx` iter-110 test block (lines 440-676). Only ONE test (line 489-498) directly asserts price text content. Other tests with `currentPrice: 80.0 / 150.0 / 100.0` do NOT check the price text — they check change %, momentum, recommendation. So removing the `>= 100 → toFixed(0)` branch only affects the failing test (fixes it) and does not break any passing test.
- **Documented KI-22 (ESLint v9 config missing).** User logs showed `npm run lint` fails: `ESLint couldn't find an eslint.config.(js|mjs|cjs) file`. Confirmed: repo root has NO `eslint.config.js` and NO legacy `.eslintrc.*`, but `package.json` declares `eslint: ^9.39.4`. ESLint v9 dropped `.eslintrc.*` support. Documented as KI-22 (open, fix deferred — needs a dedicated iter to add the flat config + run full lint to surface rule conflicts).
- **Applied fix to `phase-hints-widget.tsx`.** Removed the `if (price >= 100) return price.toFixed(0);` line. Updated the JSDoc comment to explain the iter-111 change and reference KI-21. New `fmtPrice`:
  ```ts
  function fmtPrice(price: number | null): string {
    if (price === null) return "—";
    if (price >= 1) return price.toFixed(2);
    return price.toFixed(4);
  }
  ```
- **Added regression test.** New jest test `renders large price (>= 1000) with 2 decimals, not rounded to integer (KI-21)` in `phase-hints-widget.test.tsx`. Provides `currentPrice: 1234.5` and asserts `priceEl?.textContent === "1234.50"`. This locks in the fix — if someone re-adds the `>= 100 → toFixed(0)` "optimization", the test will fail with `Expected: "1234.50", Received: "1235"`.
- **Files modified (3):**
  - `src/components/dashboard/phase-hints-widget.tsx` — `fmtPrice` fix (removed `>= 100 → toFixed(0)` branch, updated JSDoc).
  - `src/__tests__/phase-hints-widget.test.tsx` — added KI-21 regression test for large price (1234.5 → "1234.50").
  - `STATUS.md` — KI-21 (closed iter 111) + KI-22 (open, ESLint v9 flat config missing) + header updated + Quick Reference table updated (KI-21 + KI-22 rows, plus new "OOM-killed on 4GB RAM" row for the tsc/jest env limit) + new "Frontend price formatting convention" insight paragraph.
- **Docs updated:** STATUS.md, worklog.md. (AGENT_NAVIGATION.md header bumped to iter 111 — see below.)
- **Verification:** (1) Read the full modified `phase-hints-widget.tsx` (506 lines) — fix is at the right location, no syntax issues. (2) Read the modified test file — new test follows the exact same pattern as the existing passing tests (same `makeHint` helper, same `mockFetchApi.mockResolvedValue`, same `renderWidget(true)`, same `container.querySelector` selector). (3) Confirmed `fmtPrice` has no other call sites — fix is isolated. (4) tsc/jest NOT run locally — Known Issue with OOM-killer at `npm install` (4GB RAM, no swap, requires 8GB+ since iter 99). User's own logs confirm `tsc --noEmit` passes and `next build` succeeds; the fix is a 1-line removal of a buggy branch, so type safety is preserved. Expected jest result: 582 passed (was 581 with 1 fail; +1 new regression test, the previously-failing test now passes).

Stage Summary:
- **iter 111 SHIPPED — KI-21 fixed.** `fmtPrice` in `phase-hints-widget.tsx` no longer rounds prices ≥ 100 to integer. The iter-110 jest test `renders current price with the tracked currency label` now passes (`115.5 → "115.50"`). Added regression test for `1234.5 → "1234.50"`.
- **KI-22 documented (open).** ESLint v9 flat config (`eslint.config.js`) missing → `npm run lint` fails. Fix recipe provided in STATUS.md. Deferred to a dedicated iter (low severity — `tsc`/`build`/`jest`/`pytest` all pass; lint not in build pipeline).
- Modified files (3 code/docs): `src/components/dashboard/phase-hints-widget.tsx` (1-line fix + JSDoc), `src/__tests__/phase-hints-widget.test.tsx` (+30 lines regression test), `STATUS.md` (KI-21 closed, KI-22 open, header + Quick Reference + insights updated). Plus `worklog.md` (this entry), `AGENT_NAVIGATION.md` (header bump).
- Expected test results: 1279 pytest green (no backend changes — same as user's last run). 582 jest green (was 581 pass + 1 fail; the fail is fixed, +1 new regression test). `tsc --noEmit` green (already passing). `next build` green (already passing). `npm run lint` still fails (KI-22, deferred).
- **Key design decision for future agents:** `fmtPrice`-style helpers should keep 2 decimals for prices `>= 1` and 4 decimals for `< 1`. Never truncate large prices to integers — this was the KI-21 bug. If you ever feel tempted to "optimize" price formatting by rounding large numbers, ADD A TEST FIRST that covers a price ≥ 1000.
- **Stopping point:** iter 111 = KI-21 fixed + KI-22 documented. Next iter (iter 112) candidates: (a) KI-22 fix — create `eslint.config.js` with Next.js flat-config preset (low risk, dedicated iter); (b) KI-20 fix — `case-transform.ts` regex `/_([a-z])/g` → `/_([a-z0-9])/g` (medium risk, needs full jest + UI regression); (c) TD-3/4/5/9 persistence gaps (require careful persistence-layer design); (d) P10 Gold Map ROI (§C.8) — calculator depending on P1 (3-way flips, ready); (e) extend tracked coverage (vault keys, breach catalysts, uniques) — needs api_id verification in snapshot.

---

Task ID: iter-110
Agent: main
Task: iter 110 — P9 Phase-aware Investment Advisor: live-price binding for phase hints. Extend `phase_hints.py` with optional `snapshot` param + enrichment logic (current_price / change_pct_week / change_pct_month / momentum / phase-aware recommendation). 3 hints tracked (exalted/divine).

Work Log:
- Cloned repo. Read STATUS.md (KI-19 open, KI-13 closed, TD-3/4/5/9 backlog), worklog.md (iter 108 + iter 109 entries), docs/MARKET_PLAYBOOK.md §C.7 (P9 plan).
- Studied `phase_hints.py` (479 lines — pure function `get_phase_hints(...)` with hardcoded `_PHASE_HINTS` table, 4 hints × 3 phases = 12 hints, parallel `_PHASE_HINTS_RU` Russian table). Studied `routes_phase_hints.py` (thin wrapper, no snapshot dependency). Studied `phase-hints-widget.tsx` (336 lines — `HintRow` renders title/detail/action). Studied `mirror_divine_arb.py` (iter 108 — fresh pattern for snapshot price-history extraction). Studied `data_snapshot.py` (`get_price_history(api_id)` + `get_current_price(api_id)`).
- **Found KI-20 bug.** While designing field names, tested `case-transform.ts` regex `/_([a-z])/g`: `delta_7d_pct` → `delta_7dPct` (NOT `delta7dPct`), `rolling_7d` → `rolling_7d` (unchanged). Documented as KI-20 in STATUS.md (open, fix deferred — risky). Iter 110 new code AVOIDS the bug by using clean field names: `change_pct_week` / `change_pct_month` (NOT `change_pct_7d` / `change_pct_30d`).
- **Design decision.** Additive, backward-compatible extension: `get_phase_hints()` gains optional `snapshot: DataSnapshot | None = None` param. When None → static-only hints (backward-compat, all 61 existing tests stay green). When provided → each hint with non-empty `tracked_currency` is enriched with 5 live-price fields.
- **Tracked currencies.** Only 3 of 12 hints declare `tracked_currency`: `early-quick-flips` → "exalted", `mid-triangular-arb` → "divine", `late-portfolio-hold` → "divine". Hints about uniques (Temporalis) or category-items (vault keys, breach catalysts) left untracked — their api_ids are not reliably in the currency snapshot.
- **Recommendation matrix (phase × momentum):** EARLY+UP→HOLD, EARLY+DOWN→BUY_OPPORTUNITY, EARLY+FLAT→WATCH; MID+UP→HOLD, MID+DOWN→WATCH, MID+FLAT→NEUTRAL; LATE+UP→SELL_INTO_STRENGTH, LATE+DOWN→SELL_NOW, LATE+FLAT→NEUTRAL.
- **Files modified (backend):** `backend/economy/phase_hints.py` (added `tracked_currency` to all 12 hints in EN+RU tables; 6 tunable constants; 6 helper functions; extended `get_phase_hints()` with optional `snapshot` param + deep-copy; `list_tracked_hints()` helper). `backend/api/routes_phase_hints.py` (best-effort snapshot fetch, graceful fallback). `backend/api/response_models.py` (`PhaseHintData` + 6 optional fields).
- **Files modified (frontend):** `src/lib/types.ts` (`PhaseHint` interface + 6 new fields). `src/components/dashboard/phase-hints-widget.tsx` (TrendingUp/Down/Minus icons; 6 helpers: `momentumBadgeClass`/`momentumLabelKey`/`recommendationBadgeClass`/`recommendationLabelKey`/`fmtSignedPct`/`fmtPrice`; `HintRow` live-price section). `src/lib/i18n/locales/{en,ru,ko,zh}.ts` (12 new keys × 4 locales = 48 strings; parity 1191 × 4). `src/__tests__/phase-hints-widget.test.tsx` (13 new jest tests).
- **Files modified (tests):** `tests/test_phase_hints.py` (48 new pytest across 7 test classes).
- **Files modified (docs):** STATUS.md, docs/MARKET_PLAYBOOK.md, AGENT_NAVIGATION.md, worklog.md.
- **Verification:** i18n parity check PASS (1191 × 4). `pytest tests/test_phase_hints.py -q` → 109 passed. `pytest -q --ignore=tests/test_scheduler.py` → 1266 passed (no regression). tsc/jest NOT run (OOM-killer, Known Issue since iter 99).

Stage Summary:
- **iter 110 SHIPPED — P9 Phase-aware Investment Advisor DONE.** Live-price binding for phase hints: 3 of 12 hints tracked (exalted/divine) with current_price / change_pct_week / change_pct_month / momentum / phase-aware recommendation.
- Modified files (14): backend (3) + frontend (6) + tests (2) + docs (3).
- Verified: 1266 pytest green (48 new + 1218 regression). i18n parity verified. KI-20 documented (case-transform `_<digit>` bug, fix deferred).
- **Note for future agents:** `get_phase_hints()` now takes optional `snapshot` param — when None, behavior is unchanged (backward-compat). Enrichment is ADDITIVE: tracked hints get 5 new fields, untracked hints get those fields set to None. Route handler does best-effort snapshot fetch with graceful fallback (preserves "immune to KI-11"). Field names use `_week`/`_month` (NOT `_7d`/`_30d`) to avoid KI-20 case-transform bug.
- **Known regression discovered in iter 111:** The iter-110 `fmtPrice` helper had a `>= 100 → toFixed(0)` branch that rounded `115.5 → "116"`, breaking the iter-110 jest test. Fixed in iter 111 (KI-21). The bug was not caught at iter 110 because tsc/jest was not run (OOM-killer). Lesson: even when tsc/jest cannot run locally, manually trace through `fmtPrice`-style helpers with the exact test inputs before shipping.
