# Worklog — PoE2 Market Dashboard

> Append-only shared multi-agent work log. Each section starts with `---`.
> Old task history is in `git log`.

Recent iterations kept (iter 88+). Older iter 77-87 records trimmed — those features are fully shipped and documented in PRODUCT_VISION.md / STATUS.md / AGENT_NAVIGATION.md.

---
Task ID: iter-88
Agent: main (Sonnet 4.5)
Task: iter 88 — Address all 5 Known Issues (KI-1 through KI-5) deferred from iter 87 + apply date formatting cleanup pattern across 8 chart components.

Stage Summary:
- iter 88 SHIPPED — all 5 Known Issues from iter 87 addressed + date formatting cleanup. KI-5 (analyst fact templates → frontend i18n) + KI-3 (Premium column tooltip) + KI-4 (Flips tab relabel to "Cross-rate Deviations") + KI-2 (7d Change column tooltip — investigation confirmed by-design null state) + KI-1 (Speculation tab joins /api/flipper/flips for synthetic bid/ask + spread + fair rate + deviation in expandable panel per signal row). 8 chart components migrated to shared `formatLocaleDate` / `formatLocaleDateTime` helpers.
- Tests: 768 pytest (757 + 11 e2e/analyst) + 412 jest pass.
- Files changed (24 total): backend (3: `response_models.py`, `routes_analyst.py`, `tests/e2e/test_analyst.py`), frontend components (10), frontend infrastructure (1: `src/lib/utils.ts`), frontend tests (1), API route (1: `analyst-fallback/route.ts`), TS types (1: `types.ts`), i18n locales (4 × 21 new keys each), docs (3: STATUS, AGENT_NAVIGATION, worklog).
- For full iter 88 detail, see git log (commit message + diff).

---
Task ID: iter-89
Agent: main (Sonnet 4.5)
Task: iter 89 — Dead i18n key cleanup (low priority task deferred from iter 88 hand-off) + opportunistic code health. Visual verification (P1) deferred — requires running backend + frontend locally (user action).

Work Log:
- Reviewed STATUS.md (iter 88 row + Quick Reference), AGENT_NAVIGATION.md (invariant #40), worklog.md (iter 88 Stage Summary). Identified iter 89 priorities: (1) dead `graphXxx` i18n key cleanup (~30 keys × 4 locales, low priority, harmless), (2) visual verification (P1, deferred — requires browser), (3) code health opportunistic.
- **Audit phase (grep `graphXxx` + `tabGraph` across `src/`):** confirmed all 24 `graphXxx` keys + `tabGraph` exist ONLY in the 4 locale files (no live references in `src/`). All dead — left over from iter 87 Currency Graph tab removal.
- **Audit extension (related dead keys):** discovered 3 more dead keys while auditing locale files:
  - `tabForecast` — Forecast tab was removed in an earlier iteration; key still in all 4 locale files.
  - `tabPortfolio` — Portfolio tab was removed in an earlier iteration; key still in all 4 locale files.
  - `fallbackForecasts` / `fallbackPortfolio` / `fallbackCurrencyGraph` — `ErrorBoundary` fallback titles for the 3 removed tabs. Only `fallbackFlips`, `fallbackTierDrift`, `fallbackWatchlist`, `fallbackItemDetails`, `fallbackPairDetails`, `fallbackArbitrageCalculator` are still referenced (in `dashboard-page.tsx` + `dashboard-dialogs.tsx`); the other 3 fallback keys are dead.
- **New bug discovered (KI-6):** while auditing `tabForecast` / `tabPortfolio`, found that `shortcuts-dialog.tsx` displays an OUTDATED tab mapping. The dialog shows: 7→Forecast, 8→Portfolio, 0→Watchlist. But the actual `TAB_MAP` in `dashboard-page.tsx` is: 7→Optimizer, 8→Analyst, 9→Storage Value, 0→Speculation. This is a real bug — the dialog has been misinforming users since iter 87 (or earlier). Per project rule "Если найден новый баг — сначала документируй в STATUS.md как Known Issue, потом фиксись", documented KI-6 first, then fixed it.
- **Fix KI-6:** `src/components/dashboard/shortcuts-dialog.tsx` — replaced the 3 outdated `<kbd>...</kbd> {t("tabForecast")}` / `{t("tabPortfolio")}` / `{t("tabWatchlist")}` rows with the correct mapping: 7→`t("tabOptimizer")`, 8→`t("tabAnalyst")`, 9→`t("tabStorageValue")`, 0→`t("tabSpeculation")`. Added an inline comment block explaining the pre-existing limitation: TAB_MAP has 13 entries but shortcuts only cover indices 0–9, so liquid-chain + watchlist are NOT keyboard-reachable (this was always the case — not a regression).
- **Dead i18n key cleanup script:** wrote `/home/z/my-project/scripts/cleanup_dead_i18n_keys.py` — a small Python script that removes the 30 dead keys (24 `graphXxx` + `tabGraph` + `tabForecast` + `tabPortfolio` + `fallbackForecasts` + `fallbackPortfolio` + `fallbackCurrencyGraph`) from all 4 locale files. The script also replaces the now-orphaned section headers (`// ---- Currency Graph Tab ----`, `// ---- Currency Graph — SVG labels ----`, `// ---- Portfolio Tab ----`) with `REMOVED iter 89` comment markers so future agents searching for the sections know they were intentionally deleted.
- **Script execution + bug fix:** ran the script — removed 30 dead keys × 4 locales = 120 dead lines. Discovered a bug in the script's `replace_section_headers` step: `str.replace(old, new, 1)` matches `old` as a SUBSTRING inside the already-replaced comment, causing the "REMOVED iter 89" suffix to be appended multiple times on each run. Wrote `/home/z/my-project/scripts/fix_duplicate_comments.py` to deduplicate the suffixes, then `/home/z/my-project/scripts/restore_blank_lines.py` to restore the blank lines between comment markers and the next section header (lost during the script's `collapse_blank_lines` step). All 4 locale files now have consistent structure.
- **Code health cleanup:** removed `"graph"` from `e2e/navigation.spec.ts:tabValues` list — was a dead leftover from iter 87 Currency Graph tab removal. Added an inline comment noting that `storage-value` + `speculation` are also missing from the list (separate test approach needed if added — leaving as-is to keep the test stable).
- **Verification:**
  - `./node_modules/.bin/tsc --noEmit` → clean (no errors).
  - `python3 -m pytest tests/ --ignore=tests/e2e --ignore=tests/test_scheduler.py` → **757 passed** (same as iter 88).
  - `python3 -m pytest tests/e2e/test_analyst.py` → **11 passed** (same as iter 88).
  - `./node_modules/.bin/jest --silent` → **412 passed, 19 suites passed** (same as iter 88).
  - Total: **768 pytest + 412 jest pass** — identical to iter 88 (no test count change because all changes were deletions of dead code + 1 small UI fix that doesn't add testable behavior).
- **Documentation:**
  - `STATUS.md`: rewrote entirely — bumped "Last updated" to iter 89. Replaced the KI table to include KI-6 (closed iter 89). Added iter 89 row in Product Features section. Added 2 new Quick Reference entries: "Keyboard shortcut 0 goes to Speculation, not Watchlist" + "Need to add a new tab to the dashboard" (3-place update checklist: TAB_MAP, store.ts:validTabs, shortcuts-dialog.tsx).
  - `AGENT_NAVIGATION.md`: bumped "Last updated" to iter 89. Added invariant #41 (iter 89 patterns — 3 sub-sections: shortcuts dialog TAB_MAP sync, dead i18n key cleanup workflow, store.ts:validTabs migration safety). Added 2 new symptom rows in §4 Quick Reference table.
  - `worklog.md`: trimmed iter 87 (now 2 iterations old — see git log). Trimmed iter 88 to Stage Summary only (was full detail). Added this iter 89 record.

Stage Summary:
- **iter 89 SHIPPED — dead i18n key cleanup + KI-6 shortcuts dialog mismatch fix.** 30 dead keys × 4 locales = 120 dead lines removed (~3.5KB per locale). KI-6 (shortcuts dialog showing outdated tab mapping for keys 7/8/9/0) fixed — now matches `TAB_MAP` in `dashboard-page.tsx`. Pre-existing limitation documented: liquid-chain + watchlist NOT reachable via keyboard (TAB_MAP has 13 entries but shortcuts only cover indices 0–9) — was always this way, not a regression. Code health: removed "graph" from `e2e/navigation.spec.ts` tabValues.
- **Tests: 768 pytest (757 + 11 e2e/analyst) + 412 jest pass — same as iter 88.** No test count change because all changes were deletions of dead code + 1 small UI fix.
- **Files changed (9 total):**
  - Frontend component (1): `src/components/dashboard/shortcuts-dialog.tsx` (KI-6 fix: updated tab mapping).
  - i18n locales (4): `src/lib/i18n/locales/en.ts`, `src/lib/i18n/locales/ru.ts`, `src/lib/i18n/locales/zh.ts`, `src/lib/i18n/locales/ko.ts` — removed 30 dead keys each, added `REMOVED iter 89` comment markers.
  - e2e test (1): `e2e/navigation.spec.ts` (removed "graph" from tabValues).
  - Docs (3): `STATUS.md`, `AGENT_NAVIGATION.md`, `worklog.md`.
  - Helper scripts (3, NEW — kept under `scripts/` for future reuse): `cleanup_dead_i18n_keys.py`, `fix_duplicate_comments.py`, `restore_blank_lines.py`.

Next iteration (iter 90) — recommended priorities:
1. **Visual verification (P1, deferred from iter 89)** — manual test of all iter 88 + iter 89 changes in browser (requires running backend + frontend). Check: Speculation spread details expand button (iter 88), Premium tooltip (iter 88), Flips tab relabel (iter 88), 7d Change tooltip (iter 88), Analyst facts localized in RU locale (iter 88), Shortcuts dialog now shows correct tab mapping for keys 7/8/9/0 (iter 89).
2. **Extend keyboard shortcuts to cover liquid-chain + watchlist** (low priority, deferred from iter 89). Either reorder `TAB_MAP` (place them earlier) or add `Shift+1`..`Shift+9` bindings in `use-keyboard-shortcuts.ts` for indices 10–18.
3. **Opportunistic refactoring** — no staged plan; per-file cleanup as opportunities arise.
4. **Dead `portfolio*` i18n key cleanup** (~30 keys × 4 locales, similar to iter 89's `graphXxx` cleanup). The `portfolioMethod`, `portfolioAnnualizedRisk`, `portfolioCorrelationStatus`, etc. keys are mostly dead (Portfolio tab was removed in an earlier iteration). Only `portfolioCurrency` is still referenced (in `tier-drift-tracker.tsx`). Requires careful audit before removal — some keys may have non-obvious references.

NOT done in iter 89 (intentionally deferred):
- Visual verification (manual browser test) — requires running backend + frontend locally (user action).
- Keyboard shortcut extension for liquid-chain + watchlist — pre-existing limitation, not introduced by iter 89.
- Dead `portfolio*` key cleanup — would expand iter 89 scope too much. Defer to iter 90.
