# Worklog — PoE2 Market Dashboard

> Append-only shared multi-agent work log. Each section starts with `---`.
> Old task history is in `git log`.

---
Task ID: iter-77
Agent: main (Sonnet 4.5)
Task: iter 77 — Implement F5 (Speculation tab with z-score BUY/SELL/HOLD signals) per PRODUCT_VISION §3.2 + §4 architecture table "Z-score / percentile TODO".

Work Log:
- Read STATUS.md / PRODUCT_VISION.md / AGENT_NAVIGATION.md / worklog.md (iter 74/75/76 records) to understand state.
- Confirmed F1 still BLOCKED on live API access — skipped per the iter 76 recommendation.
- F5 was the recommended priority for iter 77 — implemented end-to-end (backend pure function + route handler + Pydantic models + tests + Next.js proxy + UI tab + i18n + jest tests).
- Verified baseline before changes: pytest 564 pass (after installing missing aiosqlite into the venv), jest 363 pass, tsc 0 errors.

- **Backend — `backend/economy/pricing.py`** (extended, F5 foundation):
  - Added two new pure helpers at the bottom of the module:
    - `compute_zscore(prices, current)` — population std (ddof=0) z-score. Skips None/NaN/non-finite entries. Returns None when <2 valid points OR std=0 (all prices identical) OR current is non-finite. Minimum 2 valid points for non-None result.
    - `compute_percentile(prices, current)` — linear-interpolation percentile (numpy default). Returns float in [0, 100]. Handles single-point distribution, duplicate prices, unsorted input.
  - Updated module docstring to document the new helpers.
  - Added `import math` and `Sequence` from typing.

- **Backend — `backend/economy/speculation.py`** (NEW, ~280 lines):
  - Pure function `compute_speculation_signals(snapshot, config, *, days=30, limit=50, signal_filter="ALL", now=None)`.
  - Module-level tunable constants (NOT in config.yaml — same convention as content_pulse.py):
    - `Z_BUY_THRESHOLD = -1.5`, `Z_SELL_THRESHOLD = 1.5`
    - `MAX_HISTORY_POINTS = 14` (mini-sparkline slice)
    - `MIN_SAMPLE_SIZE = 2`, `DEFAULT_DAYS = 30`, `DEFAULT_LIMIT = 50`
  - Internal helpers: `_extract_prices(price_logs, now, days)` (filters by time window, parses ISO strings + datetime objects, accepts both PascalCase and snake_case keys), `_signal_from_zscore(z)`, `_horizon_hint(z)` (short/medium/long/unknown based on |z|), `_build_signal_entry(...)` (assembles per-item signal dict).
  - Returns dict shape: `{league, signals: [...], data_available, fetched_at, days}`. Signals sorted by |z_score| desc. Items with std=0 or <2 valid points are excluded (no actionable signal).

- **Backend — `backend/api/routes_speculation.py`** (NEW, ~95 lines):
  - Route handler `GET /api/v1/speculation?days=30&limit=50&signal=ALL`.
  - FastAPI Query validation: `days: int = Query(30, ge=1, le=90)`, `limit: int = Query(50, ge=1, le=500)`, `signal: str = Query("ALL", pattern="^(ALL|BUY|SELL|HOLD)$")`.
  - Returns `data_available=false` + empty signals list when snapshot not loaded (same pattern as content_pulse route).
  - Try/except wraps `compute_speculation_signals` — on exception logs error + returns empty response (no 500).

- **Backend — `backend/api/response_models.py`** (extended):
  - Added 3 new Pydantic models: `SpeculationPriceHistoryPoint`, `SpeculationSignalData`, `SpeculationResponse`. All fields documented with `Field(description=...)` for OpenAPI generation.

- **Backend — `backend/main.py`** (extended):
  - Registered `routes_speculation.router` after `routes_content_pulse.router` (inside try/except for graceful degradation).

- **Backend — `tests/test_pricing.py`** (extended):
  - Added 22 new tests in 2 classes: `TestComputeZscore` (10 tests) + `TestComputePercentile` (12 tests). Coverage: empty input, single point, identical prices (std=0), current at mean/above/below, None/NaN filtering, non-finite current, two-point minimum, extreme z, percentile at min/max/median/interpolated, single-point distribution, unsorted input, duplicate prices.

- **Backend — `tests/test_speculation.py`** (NEW, ~580 lines, 43 tests):
  - 6 test classes: `TestExtractPrices` (6), `TestSignalFromZscore` (5), `TestHorizonHint` (4), `TestBuildSignalEntry` (8), `TestComputeSpeculationSignals` (16), `TestRouteHandler` (4 async smoke tests).
  - Tests use the same `SimpleNamespace`-based mock pattern as `tests/test_content_pulse.py` — no real DataSnapshot needed.
  - Coverage: empty snapshot, single currency BUY/SELL/HOLD, multi-currency sort by |z|, days window filtering, limit cap, signal filter (BUY/SELL/ALL/invalid), std=0 exclusion, insufficient history exclusion, snake_case key fallback, days/limit clamping, route handler smoke (no snapshot / with snapshot / query param forwarding / exception).
  - One test fix during dev: route handler tests needed explicit `days=30, limit=50, signal="ALL"` args because FastAPI `Query()` default values are Query objects (not the wrapped values) when the handler is called directly without going through FastAPI's dependency injection.

- **Frontend — `src/lib/types.ts`** (extended):
  - Added 5 new types: `SpeculationPriceHistoryPoint`, `SpeculationSignalType` (union "BUY"|"SELL"|"HOLD"), `SpeculationHorizonHint` (union "short"|"medium"|"long"|"unknown"), `SpeculationSignal`, `SpeculationResponse`. Mirror the Pydantic models after snake_case → camelCase transform by `flipper-proxy.ts:transformKeys`.

- **Frontend — `src/app/api/flipper/speculation/route.ts`** (NEW, ~45 lines):
  - Next.js proxy with `proxyWithFallback`. Forwards all query params (`days`, `limit`, `signal`) to `/api/v1/speculation`. Empty `signals: []` + `dataAvailable: false` + `days: <requested>` offline/insufficient-data fallback.

- **Frontend — `src/components/dashboard/speculation-tab.tsx`** (NEW, ~490 lines):
  - UI tab with:
    - Filter chips (ALL / BUY / SELL / HOLD) — click to re-fetch with new `signal` param.
    - Days selector (Select with 7 / 14 / 30 / 90 presets).
    - Refresh button.
    - Signal list — each row shows: signal badge (BUY/SELL/HOLD with icon + color), item text + category (title-cased), z-score (signed, colored by signal), percentile, sample size + mean ± std + current price + horizon hint, mini-sparkline (dependency-free SVG, last 14 price points, color-coded by signal).
    - Footer with `fetchedAt` timestamp + signal count.
  - `useQuery` bound to `["speculation", days, signalFilter]`, 30s staleTime, retry: 1.
  - Lazy-loaded via `next/dynamic` in `dashboard-page.tsx`.
  - Wrapped in `<ErrorBoundary fallbackTitle={t("fallbackSpeculation")}>` so a render error doesn't crash the whole dashboard.
  - Graceful degradation (5 branches): backendOffline → offline card + start-backend hint; loading → spinner text; error → error card + refresh; data_available=false → "no data yet" notice; empty signals → "no actionable signals" notice.
  - `Sparkline` is a dependency-free internal subcomponent — renders SVG `<path>` from price points. Empty-sparkline fallback (dashed horizontal line) when <2 points.

- **Frontend — `src/components/dashboard/dashboard-page.tsx`** (modified):
  - Added `SpeculationTab` lazy-load via `next/dynamic` (line 88-93, after `StorageValueTab`).
  - Added `<TabsContent value="speculation">` after the storage-value tab (line 1168-1173), wrapped in `<ErrorBoundary>`.
  - Added `"speculation"` to `TAB_MAP` at index 9 (between `storage-value` and `liquid-chain`) — keeps the analytics cluster together (storage-value → speculation).

- **Frontend — `src/components/dashboard/dashboard-toolbar.tsx`** (modified):
  - Imported `Sparkles` from lucide-react.
  - Added `<TabsTrigger value="speculation">` between the Storage Value and Liquid Chain triggers.

- **Frontend — i18n** (4 locales updated, +29 keys each):
  - Added `fallbackSpeculation` to the ErrorBoundary fallback titles block.
  - Added 28 new keys for the speculation tab: `tabSpeculation`, `speculationTitle`, `speculationSubtitle`, `speculationOffline`, `speculationOfflineHint`, `speculationLoading`, `speculationError`, `speculationNoData`, `speculationNoSignals`, `speculationRefresh`, `speculationFetchedAt`, `speculationSignalCount`, `speculationFilterLabel`, `speculationFilterAll`, `speculationFilterBuy`, `speculationFilterSell`, `speculationFilterHold`, `speculationDaysLabel`, `speculationDaysValue`, `speculationZScoreTitle`, `speculationPercentileTitle`, `speculationSampleSize`, `speculationMean`, `speculationStd`, `speculationCurrent`, `speculationHorizonShort`, `speculationHorizonMedium`, `speculationHorizonLong`, `speculationHorizonUnknown`.
  - Verified parity via ripgrep: 28/28/28/28 speculation keys per locale + 1 fallbackSpeculation = 29 in each of en/ru/zh/ko.

- **Frontend — `src/__tests__/speculation-tab.test.tsx`** (NEW, ~340 lines, 18 tests):
  - Coverage: backend offline / loading / error + refresh / no-data / mixed (BUY+SELL+HOLD) signals / BUY/SELL/HOLD badges / z-score + percentile values / filter chips / days selector / sparkline SVG / empty-sparkline fallback / signal count + fetched-at footer / proxy path / no-signals notice / BUY filter click → fetchApi with signal=BUY / category title-case / sample-size + mean + std + current stats / horizon hint localized.
  - Used `getAllByText` instead of `getByText` for tests where multiple signals share the same value (e.g. all three signals in `mixedResponse` have `category: "ritual"`, `sampleSize: 14`, etc.) — initial 5 test failures during dev were all of this kind.

- Verification:
  - `node node_modules/typescript/bin/tsc --noEmit` → 0 errors.
  - `node node_modules/jest/bin/jest.js` → 381 pass (363 baseline + 18 new speculation-tab tests). 0 fail.
  - `PYTHONPATH=. python -m pytest tests/ --ignore=tests/e2e` → 629 pass (564 baseline + 22 new pricing tests + 43 new speculation tests). 0 fail.
  - Confirmed new route registered: `GET /api/v1/speculation`.

- Documentation updates:
  - `STATUS.md`: bumped "Last updated" to iter 77. F5 row marked ✅ Done with iter 77 implementation details. Added 3 new Quick Reference entries (speculation endpoint "data_available=false", "no actionable signals", "z-score is null").
  - `PRODUCT_VISION.md`: bumped "Last updated" to iter 77. Updated §4 architecture table (Z-score / percentile row marked ✅ with `compute_zscore` + `compute_percentile` helpers; added `/api/v1/speculation` row; Speculation UI tab row marked ✅). Rewrote F5 section with iter 77 implementation details. Updated §6 Product DoD — point 4 (Speculation tab) marked ✅.
  - `AGENT_NAVIGATION.md`: bumped "Last updated" to iter 77. Updated `pricing.py` row (added `compute_zscore` + `compute_percentile`). Added 2 new rows to §1 (speculation.py + routes_speculation.py). Added speculation-tab.tsx row. Added invariant #31 (Speculation tab wiring). Added 3 new Quick Reference entries. Added `/api/v1/speculation` row to API table. Added `/api/flipper/speculation` row to frontend-only routes table.
  - `worklog.md`: appended this iter 77 record.

Stage Summary:
- **F5 (Speculation tab with z-score BUY/SELL/HOLD signals) — DONE.** Full backend + frontend implementation. New endpoint `GET /api/v1/speculation?days=30&limit=50&signal=ALL`. New UI tab at `src/components/dashboard/speculation-tab.tsx`. 43 pytest + 22 pricing + 18 jest tests. tsc 0 errors.
- **F1 (additional RU translations) — STILL BLOCKED.** No change from iter 76 — needs live poe2scout.com + poe2db.tw/ru/ access.
- **Baseline:** pytest 629 pass (+65), jest 381 pass (+18), tsc 0 errors.
- **Files changed/created (16 total):**
  - `backend/economy/pricing.py` (modified: +130 lines — `compute_zscore` + `compute_percentile` + docstring + `import math, Sequence`)
  - `backend/economy/speculation.py` (NEW, ~280 lines)
  - `backend/api/routes_speculation.py` (NEW, ~95 lines)
  - `backend/api/response_models.py` (modified: +40 lines — 3 Speculation models)
  - `backend/main.py` (modified: +6 lines — register speculation router)
  - `tests/test_pricing.py` (modified: +120 lines — 22 new tests in 2 classes)
  - `tests/test_speculation.py` (NEW, ~580 lines, 43 tests)
  - `src/app/api/flipper/speculation/route.ts` (NEW, ~45 lines)
  - `src/components/dashboard/speculation-tab.tsx` (NEW, ~490 lines)
  - `src/components/dashboard/dashboard-page.tsx` (modified: +12 lines — lazy-load + TabsContent + TAB_MAP)
  - `src/components/dashboard/dashboard-toolbar.tsx` (modified: +6 lines — Sparkles icon + tab trigger)
  - `src/lib/types.ts` (modified: +60 lines — 5 new Speculation types)
  - `src/lib/i18n/locales/en.ts` (modified: +30 lines — 28 speculation keys + fallbackSpeculation)
  - `src/lib/i18n/locales/ru.ts` (modified: +30 lines)
  - `src/lib/i18n/locales/zh.ts` (modified: +30 lines)
  - `src/lib/i18n/locales/ko.ts` (modified: +30 lines)
  - `src/__tests__/speculation-tab.test.tsx` (NEW, ~340 lines, 18 tests)
  - `next-env.d.ts` (NEW — Next.js auto-generated TypeScript reference file, normally created by `next dev`/`next build`; created manually here because the dev environment didn't have one yet. NOT a code change — this file is in `.gitignore` for many Next.js projects but is checked-in here per the existing repo state.)
  - `STATUS.md` (updated — F5 marked Done + 3 Quick Reference entries)
  - `PRODUCT_VISION.md` (updated — F5 marked Done + §4 architecture table + §6 DoD point 4)
  - `AGENT_NAVIGATION.md` (updated — iter 77 wiring + invariant #31 + 3 Quick Reference entries + 2 API rows)
  - `worklog.md` (this record)

Next iteration (iter 78) — recommended priorities:
1. **F6** — Phase-aware hints (Temporalis mid/late league, skill gems 18-20 lvl). Uses `PhaseDetector` from `backend/economy/lifecycle.py`. Could be a small widget below the Content Pulse widget on the Overview tab, or a banner inside the Speculation tab that highlights phase-relevant items (e.g. when phase=LATE, surface Temporalis-like items in the BUY list). Smallest viable scope: a static info banner that shows current phase + a bulleted list of phase-aware farming hints from a hardcoded table in `backend/economy/lifecycle.py` or a new `backend/economy/phase_hints.py` module.
2. **F1** — Still blocked on live API access. When available: write `scripts/sync_currency_names_from_poe2db.py` to enumerate all 625 POE2Scout api_ids + fetch RU names from poe2db.tw/ru/ for the ~276 missing. Update `currency_names.json` + bump assertion counts in `tests/test_currency_names_ru.py`.
3. **F5 backtest** — PRODUCT_VISION §3.2 mentions backtesting z-score signals on previous-league data to measure profitability. Could be a separate `/api/v1/speculation/backtest` endpoint or a CLI script. Not blocking — F5 ship is already useful without it.
4. **Full Content Pulse tab** — The F4 widget is the 1-glance MVP per §3.6. A full tab (all categories, sortable, filterable, with per-category drill-down) could be added if the widget proves useful.
5. **Optional tech debt** — `useDashboardData` hook extraction (~250 lines of useQuery/memo wiring from `dashboard-page.tsx`). Staged approach: (1) flipperBackend queries, (2) realms/leagues queries, (3) derived memos. Verify tsc + jest after each stage. Not blocking — file is now legitimate parent wiring.

NOT done in iter 77 (intentionally deferred):
- F1 (blocked on live API access)
- F6 (next logical step — uses PhaseDetector)
- F5 backtest (optional, deferred)
- Full Content Pulse tab (the F4 widget is the MVP; full tab deferred until product feedback)
- e2e tests not run (frontend changes are unit-tested via jest; e2e would require a running backend + browser)
- useDashboardData hook extraction (optional, deferred)
- Visual verification with real backend data (jest tests use mocked data; visual polish — colors, spacing, responsive layout on narrow screens — needs manual review against real /api/v1/speculation response)

---
---
Task ID: iter-78
Agent: main (Sonnet 4.5)
Task: iter 78 — Implement F6 (Phase-aware hints widget) — Temporalis mid/late league, skill gems 18-20 lvl, etc. Final product DoD point 5.

Work Log:
- Read STATUS.md / PRODUCT_VISION.md / AGENT_NAVIGATION.md / worklog.md iter 77 record to understand the state. Confirmed F5 (Speculation tab) shipped in iter 77 — F6 was the next logical step. PRODUCT_VISION §6 DoD: points 1-4 already ✅, point 5 (PhaseDetector hints) was the last remaining item.
- F6 design — minimum viable scope per iter 77 recommendations:
  - Pure-function module `backend/economy/phase_hints.py` with a hardcoded hint table for EARLY/MID/LATE phases (4 hints each = 12 total). Each hint has: stable slug id (e.g. `mid-skill-gems-18-20`), title, detail (one-sentence explanation), action (imperative), optional category slug for future cross-reference.
  - Uses existing `PhaseDetector` from `backend/economy/lifecycle.py` via the global `get_phase_detector()` singleton in `backend/api/shared.py` — does NOT depend on DataSnapshot.
  - The hint table is hardcoded (not in config.yaml) — same convention as `content_pulse.py` (analysis constants, not deployment parameters).
  - Mounted as a static info banner BELOW ContentPulseWidget on the Overview tab — the iter 77 worklog suggested two placement options (Overview widget OR Speculation tab banner); I chose Overview widget because (a) it's visible on first dashboard load alongside the live farming signals, (b) it doesn't require Speculation tab navigation, (c) it's the same pattern as F4 (Content Pulse widget).

- Backend — `backend/economy/phase_hints.py` (NEW, ~210 lines):
  - `_PHASE_HINTS` dict: keyed by `LeaguePhase` enum, value = list of hint dicts. Each hint has `id` / `title` / `detail` / `action` / `category` keys.
  - EARLY phase (4 hints): `early-quick-flips` (Chaos/Exalted volatility), `early-skill-gems-low-demand` (1-17 lvl cheap, stockpile 18-20), `early-vault-keys-cheap` (abundant, don't hoard), `early-temporalis-floor` (lowest prices, watch for sub-200c listings).
  - MID phase (4 hints): `mid-skill-gems-18-20` (demand rising, list at market), `mid-temporalis-rising` (price climbing, hold), `mid-triangular-arb` (deepest liquidity, check Arbitrage tab), `mid-breach-ritual-equilibrium` (balanced, watch for divergence).
  - LATE phase (4 hints): `late-temporalis-peak` (sell into strength), `late-catalyst-scarcity` (Ritual/Breach catalysts scarce if volume drops), `late-vault-keys-saturated` (market flooded, do not hoard), `late-portfolio-hold` (switch to portfolio holding via Storage Value tab).
  - `_PHASE_META` dict: phase_label (e.g. "Mid League") + phase_summary (1-2 sentence overview).
  - `get_phase_hints(phase, days_since_reference, *, reference_currency="", league_name="", now=None)` — pure function. Returns dict with: league, phase, phase_label, days_since_reference, reference_currency, phase_summary, hints (list), data_available (always True), fetched_at (ISO 8601).
  - Helpers exposed for tests: `list_phases_with_hints()` returns list of LeaguePhase enum values, `hint_count_for_phase(phase)` returns count.
  - Future extension noted in docstring: pull hints from config.yaml, add per-pattern metrics by cross-referencing snapshot, filter based on actual market state.

- Backend — `backend/api/routes_phase_hints.py` (NEW, ~70 lines):
  - Route handler `GET /api/v1/phase-hints` (no query params).
  - Thin wrapper: fetch `get_phase_detector()` singleton → call `detector.get_phase_info()` → forward to `get_phase_hints()` pure function.
  - Always returns `data_available=True` (hint table is hardcoded — does NOT depend on DataSnapshot).
  - On exception (e.g. config.league.league_start_date invalid → PhaseDetector construction fails) logs error + returns minimal response with `data_available=False` + empty hints list (no 500).

- Backend — `backend/api/response_models.py` (extended):
  - Added 2 new Pydantic models: `PhaseHintData` (id, title, detail, action, category) + `PhaseHintsResponse` (league, phase, phase_label, days_since_reference, reference_currency, phase_summary, hints, data_available, fetched_at). All fields documented with `Field(description=...)` for OpenAPI generation.

- Backend — `backend/main.py` (extended):
  - Registered `routes_phase_hints.router` after `routes_speculation.router` (inside try/except for graceful degradation). F6 comment block added.

- Backend — `tests/test_phase_hints.py` (NEW, ~370 lines, 61 tests):
  - 6 test classes: `TestPerPhase` (30 tests, parametrized over 3 phases × 10 assertions each), `TestPassthrough` (7), `TestMetadata` (4), `TestHelpers` (5), `TestContentSanity` (7), `TestRouteHandler` (5 async smoke tests).
  - Tests use the same `SimpleNamespace`-based mock pattern as `tests/test_content_pulse.py` and `tests/test_speculation.py` — no real DataSnapshot needed.
  - Coverage: per-phase smoke (phase value, label nonempty, summary nonempty, hints count = 4, required keys, slug format, title/detail/action nonempty, category is string, ids unique), pass-through (days_since_reference, reference_currency, league_name), metadata (data_available always True, fetched_at ISO 8601, now override, meta table parity), helpers (list_phases_with_hints, hint_count_for_phase, defensive zero count), content sanity (specific hint ids present, Temporalis mentioned in every phase, skill gems hint mentions 18-20), route handler (MID/EARLY/LATE smoke, exception → empty response, Pydantic validation).
  - One bug found during dev: the parametrized `test_hint_count_for_phase_zero_when_missing` originally used `hint_count_for_phase(FakePhase())` which mypy flagged — added `# type: ignore[arg-type]` since the helper is intentionally defensive.

- Frontend — `src/lib/types.ts` (extended):
  - Added 2 new types: `PhaseHint` (id, title, detail, action, category) + `PhaseHintsResponse` (league, phase, phaseLabel, daysSinceReference, referenceCurrency, phaseSummary, hints, dataAvailable, fetchedAt). Mirror the Pydantic models after snake_case → camelCase transform.

- Frontend — `src/app/api/flipper/phase-hints/route.ts` (NEW, ~40 lines):
  - Next.js proxy with `proxyWithFallback`. Empty `hints: []` + `dataAvailable: false` offline/insufficient-data fallback. No query params forwarded (endpoint takes none).

- Frontend — `src/components/dashboard/phase-hints-widget.tsx` (NEW, ~280 lines):
  - UI widget with:
    - Phase badge (emerald for EARLY, violet for MID, amber for LATE, muted for unknown) — color-coded to give at-a-glance phase context.
    - Day count with CalendarClock icon (e.g. "Day 25").
    - Reference currency (e.g. "ref: divine") — only rendered when non-empty.
    - Phase summary (1-2 sentence overview from `_PHASE_META`).
    - Bulleted hint list — each row: bullet character (•) + title + detail (one-sentence explanation) + action with "Action:" label.
    - Footer with `fetchedAt` timestamp + hint count.
    - Refresh button.
  - `useQuery` bound to `["phaseHints"]`, **5min staleTime** (phase only changes once per day at most), retry: 1.
  - Wrapped in `<ErrorBoundary fallbackTitle={t("fallbackPhaseHints")}>` in `overview-tab-content.tsx` — render failure doesn't blank out other widgets.
  - Graceful degradation (5 branches): backendOffline → compact amber notice; loading → spinner text; error → error card + refresh; data_available=false → "no data" notice (only on PhaseDetector exception); empty hints → "no hints" notice.
  - Phase label key mapping via `phaseLabelKey(phase)` helper → `phaseHintsLabelEarly` / `Mid` / `Late` / `Unknown`.
  - Phase badge color mapping via `phaseBadgeClass(phase)` helper.

- Frontend — `src/components/dashboard/overview-tab-content.tsx` (modified):
  - Imported `PhaseHintsWidget`.
  - Added `<ErrorBoundary fallbackTitle={t("fallbackPhaseHints")}>` + `<PhaseHintsWidget backendOnline={backendOnline} />` BETWEEN `ContentPulseWidget` and `MarketOverview`. Updated the docstring to mention the new widget (4 panels now, was 3).
  - Placement rationale (in comment): directly below Content Pulse widget so users see phase-aware advisory context alongside the live farming signals on first dashboard load. The hint table is hardcoded and does NOT depend on the DataSnapshot — it only uses the PhaseDetector (which is always available).

- Frontend — i18n (4 locales updated, +17 keys each):
  - Added `fallbackPhaseHints` to the ErrorBoundary fallback titles block.
  - Added 16 new keys for the phase hints widget: `phaseHintsTitle`, `phaseHintsLabelEarly` / `Mid` / `Late` / `Unknown`, `phaseHintsDayCount`, `phaseHintsReferenceCurrency`, `phaseHintsActionLabel`, `phaseHintsOffline`, `phaseHintsLoading`, `phaseHintsError`, `phaseHintsNoData`, `phaseHintsNoHints`, `phaseHintsRefresh`, `phaseHintsFetchedAt`, `phaseHintsHintCount`.
  - Verified parity via ripgrep: 17/17/17/17 phaseHints keys per locale (16 phaseHints + 1 fallbackPhaseHints).

- Frontend — `src/__tests__/phase-hints-widget.test.tsx` (NEW, ~330 lines, 26 tests):
  - Coverage: backend offline / loading / error+refresh / no-data / mixed hints (4 hints: skill gems, Temporalis rising, triangular arb, breach/ritual equilibrium) / phase badge variants (Early/Mid/Late/Unknown) / day count / reference currency (present + empty) / hint titles / hint details / hint actions with "Action:" label / bullet rendering / hint count footer / fetched-at footer / refresh button visible / refresh refetch / empty hints notice / proxy path / data-testids (phase-hints-widget, phase-hints-list, phase-hints-phase-badge, per-hint testids).
  - 4 tests needed fixing during dev:
    1. `findByText("ref: divine")` failed because the span textContent is "· ref: divine" (with leading `· `) — fixed with regex `/ref:\s*divine/` for substring match.
    2. `findByText("Action")` failed because the span textContent is "Action: " (with trailing `: `) and the action text is in a separate text node — fixed with regex `/Action/` for substring match.
    3. `findByText("4 hints")` failed because the hint count is in the same `<p>` as the fetched-at timestamp, so the textContent is "Fetched: <date> · 4 hints" — fixed with regex `/4 hints/` and waited for hints to render first via `findByText("Skill gems 18-20 lvl — demand rising")`.
    4. "re-fetches when refresh button is clicked after error" originally expected 1 call after error + 2 after refresh — but the widget has `retry: 1`, so the actual sequence is initial fetch + retry = 2 calls before the error state is shown, then refresh = 3 calls. Fixed the test to assert `toHaveBeenCalledTimes(2)` after error + `toHaveBeenCalledTimes(3)` after refresh.

- Verification:
  - `node node_modules/typescript/bin/tsc --noEmit` → 0 errors.
  - `node node_modules/jest/bin/jest.js` → 407 pass (381 baseline + 26 new phase-hints-widget tests). 0 fail.
  - `PYTHONPATH=. python -m pytest tests/ --ignore=tests/e2e --ignore=tests/test_scheduler.py` → 677 pass (616 baseline + 61 new phase_hints tests). 0 fail.
    - Note: `tests/test_scheduler.py` is excluded because `aiosqlite` is not installed in this dev env (documented in STATUS.md Quick Reference as a known issue — not a regression).
  - Smoke tested the route handler manually via Python REPL: `get_phase_hints_route()` returns `phase="mid"`, `phase_label="Mid League"`, `days_since_reference=26`, `hints` count = 4, `data_available=True` for the current league config (`league_start_date=2026-05-29T20:00:00Z` → MID phase at day 26).
  - Confirmed new route registered: `GET /api/v1/phase-hints`.

- Documentation updates:
  - `STATUS.md`: bumped "Last updated" to iter 78. F6 row marked ✅ Done with iter 78 implementation details. Added 2 new Quick Reference entries (phase-hints endpoint "data_available=false", "wrong phase").
  - `PRODUCT_VISION.md`: bumped "Last updated" to iter 78. Updated §4 architecture table (PhaseDetector row marked ✅ with `phase_hints.py`; added `/api/v1/phase-hints` row; added League Phase Hints widget row). Rewrote F6 section with iter 78 implementation details. Updated §6 Product DoD — point 5 (PhaseDetector hints) marked ✅. Added closing note: "Все 5 пунктов DoD выполнены (iter 78). Продукт перешёл из стадии «аналитический MVP» в стадию «аналитический помощник»."
  - `AGENT_NAVIGATION.md`: bumped "Last updated" to iter 78. Updated `lifecycle.py` row (mentions `phase_hints.py` usage). Added 2 new rows to §1 (`phase_hints.py` + `routes_phase_hints.py`). Added `phase-hints-widget.tsx` row. Updated `overview-tab-content.tsx` row (mentions F6 widget). Added invariant #32 (Phase-aware hints widget wiring). Added 2 new Quick Reference entries. Added `/api/v1/phase-hints` row to API table. Added `/api/flipper/phase-hints` row to frontend-only routes table.
  - `worklog.md`: appended this iter 78 record.

Stage Summary:
- **F6 (Phase-aware hints widget) — DONE.** Full backend + frontend implementation. New endpoint `GET /api/v1/phase-hints`. New UI widget at `src/components/dashboard/phase-hints-widget.tsx` mounted on Overview tab below Content Pulse. 61 pytest + 26 jest tests. tsc 0 errors.
- **Product DoD — ALL 5 POINTS COMPLETE.** PRODUCT_VISION §6 criteria all met (RU translations ✅, Storage Value tab ✅, Content Pulse widget ✅, Speculation tab ✅, Phase-aware hints ✅). Product transitioned from "analytical MVP" to "analytical assistant".
- **F1 (additional RU translations) — STILL BLOCKED.** No change from iter 77 — needs live poe2scout.com + poe2db.tw/ru/ access.
- **Baseline:** pytest 677 pass (+61), jest 407 pass (+26), tsc 0 errors.
- **Files changed/created (13 total):**
  - `backend/economy/phase_hints.py` (NEW, ~210 lines)
  - `backend/api/routes_phase_hints.py` (NEW, ~70 lines)
  - `backend/api/response_models.py` (modified: +25 lines — 2 PhaseHint models)
  - `backend/main.py` (modified: +7 lines — register phase_hints router)
  - `tests/test_phase_hints.py` (NEW, ~370 lines, 61 tests)
  - `src/app/api/flipper/phase-hints/route.ts` (NEW, ~40 lines)
  - `src/components/dashboard/phase-hints-widget.tsx` (NEW, ~280 lines)
  - `src/components/dashboard/overview-tab-content.tsx` (modified: +12 lines — widget wiring + docstring update)
  - `src/lib/types.ts` (modified: +40 lines — 2 new PhaseHint types)
  - `src/lib/i18n/locales/en.ts` (modified: +18 lines — 16 phaseHints keys + fallbackPhaseHints)
  - `src/lib/i18n/locales/ru.ts` (modified: +18 lines)
  - `src/lib/i18n/locales/zh.ts` (modified: +18 lines)
  - `src/lib/i18n/locales/ko.ts` (modified: +18 lines)
  - `src/__tests__/phase-hints-widget.test.tsx` (NEW, ~330 lines, 26 tests)
  - `STATUS.md` (updated — F6 marked Done + 2 Quick Reference entries)
  - `PRODUCT_VISION.md` (updated — F6 marked Done + §4 architecture table + §6 DoD point 5 + closing note)
  - `AGENT_NAVIGATION.md` (updated — iter 78 wiring + invariant #32 + 2 Quick Reference entries + 2 API rows + new component row)
  - `worklog.md` (this record)

Next iteration (iter 79) — recommended priorities:
1. **F5 backtest** — PRODUCT_VISION §3.2 mentions backtesting z-score signals on previous-league data to measure profitability. Could be a separate `/api/v1/speculation/backtest` endpoint or a CLI script. Not blocking — F5 ship is already useful without it. Now that all 5 DoD points are done, this is the most valuable next-step from a product-quality perspective.
2. **F1 (when live API available)** — `scripts/sync_currency_names_from_poe2db.py`: enumerate 625 api_ids, fetch poe2db.tw/ru/, update `currency_names.json`, bump assertion counters in `tests/test_currency_names_ru.py`.
3. **Full Content Pulse tab** — F4 widget is the MVP; full version with sorting/filters/drill-down if widget proves useful.
4. **Phase hints enhancements** (optional) — pull hints from `config.yaml` instead of hardcoding; add per-pattern metrics by cross-referencing the snapshot's `price_histories`; filter hints based on actual market state (e.g. only show "Temporalis near peak" if its 7d momentum is positive).
5. **useDashboardData hook extraction** (optional, tech debt) — `dashboard-page.tsx` is 1217 lines; ~250 lines of `useQuery`/memo wiring could move into a hook. Staged approach. Not blocking.

NOT done in iter 78 (intentionally deferred):
- F1 (blocked on live API access)
- F5 backtest (optional, deferred)
- Full Content Pulse tab (the F4 widget is the MVP; full tab deferred until product feedback)
- Phase hints enhancements (hardcoded MVP shipped — config-driven hints + per-pattern metrics deferred)
- e2e tests not run (frontend changes are unit-tested via jest; e2e would require running backend + browser)
- useDashboardData hook extraction (optional, deferred)
- Visual verification with real backend data (jest tests use mocked data; visual polish — colors, spacing, responsive layout on narrow screens — needs manual review against real /api/v1/phase-hints response)

---
---
Task ID: iter-79
Agent: main (Sonnet 4.5)
Task: iter 79 — Implement F5 backtest: measure profitability of z-score BUY/SELL/HOLD signals on historical price_logs. Backend + tests + docs. No frontend UI in this iter (deferred — backend-only is the safe minimum scope per "better underdo than break" rule).

Work Log:
- Read STATUS.md / PRODUCT_VISION.md / AGENT_NAVIGATION.md / worklog.md iter 78 record to understand the state. Confirmed all 5 DoD points already ✅ in iter 78 — F5 backtest was the recommended next priority per iter 78 worklog ("most valuable next-step from a product-quality perspective").
- F5 backtest design — minimum viable scope:
  - Pure-function module `backend/economy/speculation_backtest.py` with `backtest_speculation_signals(snapshot, config, eval_days_ago=14, holding_days=7, lookback_days=30, limit=50, signal_filter="ALL", now=None)`.
  - For each item: find entry_price (nearest price log to `now - eval_days_ago` within 24h tolerance), compute z-score of entry vs `[entry - lookback_days, entry)` window (strictly BEFORE entry — no signal leak), map to BUY/SELL/HOLD, find exit_price (nearest to `entry + holding_days` within 24h tolerance), compute realized return:
    - BUY:  `(exit - entry) / entry * 100` (profit when price rises — bought low, expect mean reversion up)
    - SELL: `(entry - exit) / entry * 100` (profit when price falls — short-sale equivalent)
    - HOLD: skip (no position taken; counted in `signal_breakdown.HOLD` but not in `trades`).
  - Reuses `compute_zscore` from `backend/economy/pricing.py` (same thresholds as live signals) + `_extract_prices` + `_signal_from_zscore` + `Z_BUY_THRESHOLD` / `Z_SELL_THRESHOLD` / `MIN_SAMPLE_SIZE` from `backend/economy/speculation.py` — guarantees backtest uses the same strategy as the live signal.
  - Returns per-trade results (`trades` list sorted by |return_pct| desc, capped by `limit`) + per-signal aggregates (`buy_stats` / `sell_stats` / `overall_stats` — each with count, win_rate, mean/median/best/worst return_pct) + `signal_breakdown` ({BUY, SELL, HOLD} counts) + `evaluated_count` / `unevaluated_count` (actionable signal but no exit price within tolerance) + `data_available` / `fetched_at` / `eval_days_ago` / `holding_days` / `lookback_days`.
  - Aggregates computed over ALL trades, not just the `limit`-capped list — `limit` only narrows the response payload.
  - Separate endpoint `GET /api/v1/speculation/backtest` — NOT a query-param mode on `/api/v1/speculation`. Rationale: backtest is significantly more expensive than the live signal (iterates every item with enough price history), keeping it as a separate route makes the cost opt-in.
  - No frontend UI in this iter — backend-only. A small "Backtest" panel below the Speculation list can be added in a follow-up iter without breaking anything.

- Backend — `backend/economy/speculation_backtest.py` (NEW, ~340 lines):
  - Tunable constants at module top: `DEFAULT_EVAL_DAYS_AGO=14`, `DEFAULT_HOLDING_DAYS=7`, `DEFAULT_LOOKBACK_DAYS=30`, `DEFAULT_LIMIT=50`, `TOLERANCE_HOURS=24` (matches `storage_value_history.py:_NEAREST_PRICE_TOLERANCE_HOURS`).
  - Helper `_find_price_at(history, target, tolerance_hours)` — nearest (timestamp, price) to target within tolerance. Returns None when no point within tolerance. Handles timezone-naive datetimes (treats as UTC).
  - Helper `_build_trade_entry(api_id, text, category, signal, entry_price, entry_ts, exit_price, exit_ts, z_score, sample_size)` — builds a single per-item trade dict. Implements the return sign convention (BUY: +exit-entry, SELL: +entry-exit). Edge case: entry_price=0 → return_pct=0.0 (avoids div-by-zero).
  - Helper `_stats_block(returns)` — computes count, win_rate (% of returns > 0), mean_return_pct, median_return_pct, best_return_pct, worst_return_pct. Returns zeroed block for empty list.
  - Main entry point `backtest_speculation_signals()` — clamps inputs (eval_days_ago [1,365], holding_days [1,90], lookback_days [1,90], limit [1,500]), defaults invalid signal_filter to "ALL". Iterates `snapshot.currencies.values()`, extracts price_logs in a wide enough window (eval_days_ago + lookback_days + 7 padding), finds entry, computes z-score baseline (strictly BEFORE entry_ts), finds exit, builds trade entry. Skips items with: no ApiId, no price_logs, no entry within tolerance, <MIN_SAMPLE_SIZE baseline points, std=0 baseline (z=None → HOLD), no exit within tolerance (incremented `unevaluated_count`).
  - Sorts trades by |return_pct| desc — most impactful (positive OR negative) trades first. Applies `limit` AFTER sort (so the most impactful trades are kept).
  - Aggregates computed over the FILTERED set (after signal_filter applied) — matches the live `/api/v1/speculation` behaviour.

- Backend — `backend/api/routes_speculation_backtest.py` (NEW, ~140 lines):
  - Route handler `GET /api/v1/speculation/backtest` (router prefix `/api/v1`, tag `speculation-backtest`).
  - Query params validated by FastAPI: `eval_days_ago` (ge=1, le=365), `holding_days` (ge=1, le=90), `lookback_days` (ge=1, le=90), `limit` (ge=1, le=500), `signal` (pattern=^(ALL|BUY|SELL|HOLD)$).
  - When snapshot manager has no snapshot → returns `data_available=False` + empty trades + zeroed stats blocks (no 500, no 503). Matches the pattern in `routes_speculation.py`.
  - On exception in `backtest_speculation_signals` → logs error + returns the same empty/zeroed response (no 500).

- Backend — `backend/api/response_models.py` (extended):
  - Added 3 new Pydantic models: `SpeculationBacktestTradeData` (per-trade record: api_id, text, category, signal, entry_price, entry_date, exit_price, exit_date, return_pct, z_score_at_entry, sample_size_at_entry) + `SpeculationBacktestStatsBlock` (count, win_rate, mean/median/best/worst return_pct) + `SpeculationBacktestResponse` (league, trades, signal_breakdown, evaluated_count, unevaluated_count, buy_stats, sell_stats, overall_stats, data_available, fetched_at, eval_days_ago, holding_days, lookback_days). All fields documented with `Field(description=...)` for OpenAPI generation.

- Backend — `backend/main.py` (extended):
  - Registered `routes_speculation_backtest.router` after `routes_speculation.router` (inside try/except for graceful degradation). F5 follow-up comment block added.

- Backend — `tests/test_speculation_backtest.py` (NEW, ~640 lines, 54 tests):
  - 5 test classes: `TestFindPriceAt` (6 tests), `TestStatsBlock` (5), `TestBuildTradeEntry` (6), `TestBacktest*` pure-function tests (33 in 6 subclasses: TestBacktestEmpty / TestBacktestBuyScenario / TestBacktestSellScenario / TestBacktestHoldScenario / TestBacktestEdgeCases / TestBacktestFiltersAndLimit / TestBacktestInputClamping / TestBacktestFieldNameDefence / TestBacktestResponseShape), `TestRouteHandler` (5 async smoke tests).
  - Tests use the same `SimpleNamespace`-based mock pattern as `tests/test_speculation.py` — no real DataSnapshot needed.
  - Coverage:
    - Helpers: empty history, exact match, nearest match within tolerance, beyond tolerance, naive datetime target/history, snake_case field name defence.
    - Pure function: empty snapshot, no price_logs, BUY scenario (positive return on reversion up + negative return when price keeps falling), SELL scenario (positive return on reversion down), HOLD scenario (not in trades but counted in breakdown), std=0 baseline (skipped → HOLD), insufficient baseline sample size (skipped), no entry within tolerance (skipped), no exit within tolerance (unevaluated_count incremented), signal_filter BUY/SELL/HOLD, limit caps trades list but aggregates over ALL, trades sorted by |return_pct| desc, input clamping (eval_days_ago / holding_days / lookback_days / limit / invalid signal_filter), snake_case field names accepted, non-dict currency skipped, missing api_id skipped, response shape (all required fields), stats block shape, trade entry shape, fetched_at ISO string, league name pass-through.
    - Route handler: no-snapshot returns empty + zeroed stats blocks, snapshot available returns trades, query params forwarded (eval_days_ago / holding_days / lookback_days / limit / signal all respected), exception returns data_available=False, no-snapshot returns zeroed stats blocks (not absent).

- Smoke tests (manual verification during dev):
  - `from backend.economy.speculation_backtest import backtest_speculation_signals` + `_find_price_at` + `_stats_block` + `_build_trade_entry` → imports OK.
  - `from backend.api.routes_speculation_backtest import router, get_speculation_backtest` → imports OK, route path `/api/v1/speculation/backtest`.
  - `from backend.main import app; [r.path for r in app.routes if 'speculation' in r.path]` → `['/api/v1/speculation', '/api/v1/speculation/backtest']` (both routes registered).
  - Empty snapshot: `data_available=False`, `evaluated_count=0`, `trades=[]`.
  - BUY scenario: baseline mean=100 std≈2.4, entry=80, exit=95 → BUY signal, return_pct=18.75%, win_rate=100%, z_score_at_entry≈-9.26.
  - SELL scenario: baseline mean=100, entry=130, exit=110 → SELL signal, return_pct=15.38%, win_rate=100%.
  - Route handler with no snapshot: returns `data_available=False`, zeroed stats blocks, `eval_days_ago=14`, `holding_days=7`, `lookback_days=30`.

- Verification:
  - `PYTHONPATH=. python -m pytest tests/test_speculation_backtest.py -v` → 54 pass / 0 fail (1.24s).
  - `PYTHONPATH=. python -m pytest tests/ --ignore=tests/e2e --ignore=tests/test_scheduler.py` → **731 pass** (677 baseline + 54 new backtest tests). 0 fail. (~29s.)
    - Note: `tests/test_scheduler.py` excluded because `aiosqlite` is not installed in this dev env (documented in STATUS.md Quick Reference as a known issue — not a regression).

- Documentation updates:
  - `STATUS.md`: bumped "Last updated" to iter 79. F5 row expanded with iter 79 backtest implementation details (endpoint, returns shape, test count). Added 3 new Quick Reference entries (backtest endpoint "data_available=false", "evaluated_count=0 but unevaluated_count>0", "trades list shorter than overall_stats.count").
  - `PRODUCT_VISION.md`: bumped "Last updated" to iter 79. §3.2 added "Бэктестить сигналы на исторических данных" bullet marked ✅ iter 79 with endpoint summary. §4 architecture table added `/api/v1/speculation/backtest` row. §5 F5 section: title updated to "iter 77 (live signals) + iter 79 (backtest)"; backtest bullet marked ✅ iter 79; added full "Реализовано в iter 79 (backtest)" subsection with all implementation details (pure function, route handler, response models, test count, reuse strategy, tolerance, baseline window, no frontend UI, aggregates over ALL trades).
  - `AGENT_NAVIGATION.md`: bumped "Last updated" to iter 79. Added `speculation_backtest.py` row to §1 (with reuse notes + tolerance + baseline window note). Added `routes_speculation_backtest.py` row to §1 (with query param validation rules). Added invariant #33 (Speculation backtest is a SEPARATE endpoint — rationale, reuse strategy, tolerance, aggregates over ALL trades, return sign convention, no frontend UI yet). Added 3 new Quick Reference entries (backtest data_available=false, evaluated_count=0 + unevaluated_count>0, trades list shorter than overall_stats.count). Added `/api/v1/speculation/backtest` row to API table.
  - `worklog.md`: appended this iter 79 record.

Stage Summary:
- **F5 backtest (z-score BUY/SELL/HOLD strategy profitability on historical price_logs) — DONE (backend + tests + docs).** New endpoint `GET /api/v1/speculation/backtest?eval_days_ago=14&holding_days=7&lookback_days=30&limit=50&signal=ALL`. New pure function `backtest_speculation_signals()` in `backend/economy/speculation_backtest.py`. 54 pytest tests. Backend-only — no frontend UI in this iter.
- **F1 (additional RU translations) — STILL BLOCKED.** No change from iter 78 — needs live poe2scout.com + poe2db.tw/ru/ access.
- **Baseline:** pytest 731 pass (+54), tsc/jest unchanged (no frontend changes in this iter).
- **Files changed/created (7 total):**
  - `backend/economy/speculation_backtest.py` (NEW, ~340 lines)
  - `backend/api/routes_speculation_backtest.py` (NEW, ~140 lines)
  - `backend/api/response_models.py` (modified: +60 lines — 3 Backtest models)
  - `backend/main.py` (modified: +8 lines — register backtest router)
  - `tests/test_speculation_backtest.py` (NEW, ~640 lines, 54 tests)
  - `STATUS.md` (updated — F5 row expanded + 3 Quick Reference entries)
  - `PRODUCT_VISION.md` (updated — §3.2 + §4 architecture table + §5 F5 section with iter 79 subsection)
  - `AGENT_NAVIGATION.md` (updated — iter 79 wiring + invariant #33 + 3 Quick Reference entries + 1 API row + 2 new module rows in §1)
  - `worklog.md` (this record)

Next iteration (iter 80) — recommended priorities:
1. **F5 backtest frontend UI** — small "Backtest" panel below the Speculation list showing aggregated metrics: overall win_rate + mean_return_pct + best/worst trade + per-signal (BUY/SELL) breakdown. Toggle button to fetch (doesn't auto-load — backtest is compute-heavy). Eval/holding/lookback day selectors. Lazy-loaded. This is a safe additive change — no existing UI is modified, just a new card below the existing list.
2. **F1 (when live API available)** — `scripts/sync_currency_names_from_poe2db.py`: enumerate 625 api_ids, fetch poe2db.tw/ru/, update `currency_names.json`, bump assertion counters in `tests/test_currency_names_ru.py`.
3. **Full Content Pulse tab** — F4 widget is the MVP; full version with sorting/filters/drill-down if widget proves useful.
4. **Phase hints enhancements** (optional) — pull hints from `config.yaml` instead of hardcoding; add per-pattern metrics by cross-referencing the snapshot's `price_histories`; filter hints based on actual market state (e.g. only show "Temporalis near peak" if its 7d momentum is positive).
5. **useDashboardData hook extraction** (optional, tech debt) — `dashboard-page.tsx` is 1217 lines; ~250 lines of `useQuery`/memo wiring could move into a hook. Staged approach. Not blocking.

NOT done in iter 79 (intentionally deferred):
- F5 backtest frontend UI (backend-only shipped — UI is a safe additive follow-up)
- F1 (blocked on live API access)
- Full Content Pulse tab (the F4 widget is the MVP; full tab deferred until product feedback)
- Phase hints enhancements (hardcoded MVP shipped — config-driven hints + per-pattern metrics deferred)
- e2e tests not run (frontend changes are unit-tested via jest; e2e would require running backend + browser)
- useDashboardData hook extraction (optional, deferred)
- Visual verification with real backend data (jest tests use mocked data; manual verification of the backtest endpoint against real snapshot data — e.g. confirming that `eval_days_ago=14` with `holding_days=7` produces sensible trade counts on a live league — needs a running backend with ≥21d of price_logs collected)

---
---
Task ID: iter-80
Agent: main (Sonnet 4.5)
Task: iter 80 — F5 backtest frontend UI (collapsible Backtest panel inside Speculation tab, toggle-driven not autoload).

Work Log:
- Read STATUS.md / PRODUCT_VISION.md / AGENT_NAVIGATION.md / worklog.md iter 79 record to understand the hand-off: F5 backtest backend shipped in iter 79 (pure function + route + 54 pytest), frontend UI was deferred to iter 80 as the recommended priority.
- Inspected existing `speculation-tab.tsx` (504 lines, 18 jest tests) to plan the additive change: a Backtest panel mounted BELOW the live signals list, inside the same `CardContent`, as an internal subcomponent (NOT a separate file) to keep the spec UI cohesive.
- Inspected backend backtest response shape (`SpeculationBacktestResponse` Pydantic model in `response_models.py` + `routes_speculation_backtest.py`) — confirmed: trades list (sorted by |return_pct| desc, capped by `limit`), signal_breakdown {BUY,SELL,HOLD}, evaluated/unevaluated counts, buy_stats/sell_stats/overall_stats blocks (count, win_rate, mean/median/best/worst return_pct), dataAvailable, fetchedAt, evalDaysAgo/holdingDays/lookbackDays.
- Inspected existing Next.js proxy routes (`/api/flipper/speculation/route.ts`, `/api/flipper/phase-hints/route.ts`) for the `proxyWithFallback` pattern — confirmed: returns empty fallback with zeroed stats + `dataAvailable: false` when backend offline (no 503).

- Frontend — `src/app/api/flipper/speculation/backtest/route.ts` (NEW, ~95 lines):
  - Next.js proxy route for `GET /api/v1/speculation/backtest`. Forwards all 5 query params (`eval_days_ago`, `holding_days`, `lookback_days`, `limit`, `signal`) to the backend via `proxyWithFallback`.
  - `emptyFallback` shape matches the camelCase-transformed backend response: empty `trades: []`, zeroed `buyStats`/`sellStats`/`overallStats` blocks (count=0, winRate=0, meanReturnPct=0, etc.), `signalBreakdown: {BUY:0, SELL:0, HOLD:0}`, `evaluatedCount: 0`, `unevaluatedCount: 0`, `dataAvailable: false`, plus passthrough of the requested `evalDaysAgo`/`holdingDays`/`lookbackDays` from query params (or backend defaults 14/7/30 if absent).
  - Uses the same `proxyWithFallback` pattern as the live `/api/flipper/speculation` route — 503 (backend offline / insufficient data) returns the empty fallback as 200, non-503 5xx passes through in dev / becomes 200+fallback in prod.

- Frontend — `src/lib/types.ts` (extended, +80 lines):
  - Added 3 new TS interfaces in a new "Speculation backtest (F5 follow-up, iter 80 — frontend UI)" section after `SpeculationResponse`:
    - `SpeculationBacktestTrade` — per-trade record: apiId, text, category, signal (SpeculationSignalType), entryPrice, entryDate, exitPrice, exitDate, returnPct, zScoreAtEntry (nullable), sampleSizeAtEntry.
    - `SpeculationBacktestStatsBlock` — count, winRate, meanReturnPct, medianReturnPct, bestReturnPct, worstReturnPct.
    - `SpeculationBacktestResponse` — league, trades, signalBreakdown (Record<"BUY"|"SELL"|"HOLD", number>), evaluatedCount, unevaluatedCount, buyStats, sellStats, overallStats, dataAvailable, fetchedAt, evalDaysAgo, holdingDays, lookbackDays.
  - All field names are camelCase (post `transformKeys` from flipper-proxy). Each field has a JSDoc comment matching the backend Pydantic description.

- Frontend — `src/lib/i18n/locales/{en,ru,zh,ko}.ts` (extended, +34 keys × 4 locales = +136 lines total):
  - Added 34 new i18n keys per locale in a new "F5 follow-up (iter 80) — Backtest panel inside Speculation tab" section (after `speculationHorizonUnknown`, before F6 phase hints keys).
  - Keys cover: title (`speculationBacktestTitle`), subtitle, run/hide toggle buttons (long + short), loading/error/no-data/no-trades notices, 3 day-selector labels (`speculationBacktestEvalDaysLabel` / `HoldingDaysLabel` / `LookbackDaysLabel` with `{0}` placeholder for current value), 3 short variants for compact display, 3 stats-block titles (Overall/BUY/SELL), 5 stats labels (winRate, meanReturn, medianReturn, bestReturn, worstReturn), tradesCount + evaluated + unevaluated, breakdownTitle, tradesTitle, 5 trade-table column headers, fetchedAt footer.
  - Verified parity via `grep -c "speculationBacktest"` → 34 keys in each of en/ru/zh/ko.

- Frontend — `src/components/dashboard/speculation-tab.tsx` (extended, ~980 lines total, +~470 lines):
  - Updated file header comment to document the new Backtest panel: toggle behavior, 3 day selectors, stats blocks, signal breakdown, top-trades list, graceful degradation states.
  - Added imports: `History`, `Play`, `ChevronDown`, `ChevronUp` from `lucide-react`; `SpeculationBacktestResponse`, `SpeculationBacktestStatsBlock`, `SpeculationBacktestTrade` from `@/lib/types`.
  - Added constants: `BACKTEST_EVAL_PRESETS` [7,14,30,90], `BACKTEST_HOLDING_PRESETS` [1,3,7,14,30], `BACKTEST_LOOKBACK_PRESETS` [7,14,30,90], `BACKTEST_DEFAULT_EVAL_DAYS=14`, `BACKTEST_DEFAULT_HOLDING_DAYS=7`, `BACKTEST_DEFAULT_LOOKBACK_DAYS=30`, `BACKTEST_LIMIT=50` — defaults match backend `DEFAULT_*` constants in `speculation_backtest.py`.
  - Wired `<BacktestPanel backendOnline={backendOnline} signalFilter={signalFilter} />` inside the main `CardContent`, after the fetched-at footer of the live signals list. Inline comment explains the NOT-autoload rationale.
  - Added `BacktestPanel` subcomponent (~230 lines):
    - Local state: `showBacktest` (default false), `evalDays` (14), `holdingDays` (7), `lookbackDays` (30).
    - `useQuery` with `queryKey: ["speculation-backtest", evalDays, holdingDays, lookbackDays, signalFilter]`, `queryFn: fetchApi("/api/flipper/speculation/backtest", {eval_days_ago, holding_days, lookback_days, limit:50, signal: signalFilter})`, `enabled: showBacktest && backendOnline`, `staleTime: 60_000`, `retry: 1`.
    - When `!showBacktest` → renders only the "Run backtest" toggle button (full-width outline button with Play icon + ChevronDown).
    - When `showBacktest` → renders the expanded panel: header (History icon + title + subtitle + Hide button with ChevronUp), 3 `DaySelector` instances + Refresh button, then conditional content based on query state.
    - Conditional states: `isLoading` → spinner text; `isError` → red notice with AlertTriangle icon; `!dataAvailable` → "no data yet" notice; `dataAvailable && trades.length===0` → "no trades produced" notice; `dataAvailable && trades.length>0` → full content (stats grid + breakdown + trades list + fetched-at footer).
  - Added `DaySelector` helper (~25 lines): label + Select bound to numeric presets.
  - Added `StatsBlock` helper (~60 lines): single card for Overall/BUY/SELL with accent color (emerald for BUY, red for SELL, neutral for Overall). Renders count + winRate (1 decimal) + mean/median/best/worst return_pct (2 decimals, signed, color-coded green/red/muted).
  - Added `TradeRow` helper (~50 lines): single trade row — signal badge (reuses `signalBadgeClass` + `signalIcon` from parent scope) + item name + category (title-cased) + entry price → exit price + return_pct (colored: emerald >0, red <0, muted =0).
  - All subcomponents use `data-testid` attributes for jest testing: `speculation-backtest-panel-collapsed`, `speculation-backtest-panel`, `speculation-backtest-toggle`, `speculation-backtest-eval-days`, `speculation-backtest-holding-days`, `speculation-backtest-lookback-days`, `speculation-backtest-refresh`, `speculation-backtest-loading`, `speculation-backtest-error`, `speculation-backtest-no-data`, `speculation-backtest-no-trades`, `speculation-backtest-content`, `speculation-backtest-stats-{overall,buy,sell}`, `speculation-backtest-breakdown`, `speculation-backtest-trades`, `speculation-backtest-trade-{apiId}`.

- Frontend — `src/__tests__/speculation-backtest-panel.test.tsx` (NEW, ~480 lines, 15 tests):
  - Uses the same `mockFetchApi` pattern as `speculation-tab.test.tsx` — mocks `@/lib/types` `fetchApi` so we can intercept both `/api/flipper/speculation` (live) and `/api/flipper/speculation/backtest` (backtest) calls.
  - Test data: `liveResponse` (1 BUY signal so the parent tab renders the main panel + collapsed Backtest toggle), `makeBacktestResponse()` factory (2 trades: 1 BUY +18.75% + 1 SELL +15.38%, signal_breakdown BUY:1/SELL:1/HOLD:3, evaluated=2, unevaluated=1, populated stats blocks).
  - 15 tests covering:
    1. Collapsed by default → toggle button visible, no expanded panel.
    2. Does NOT call fetchApi for backtest path when panel is collapsed (waits 100ms to confirm no async query fires).
    3. Toggle click → panel expands + backtest query fires.
    4. Default params forwarded correctly (eval_days_ago=14, holding_days=7, lookback_days=30, limit=50, signal=ALL).
    5. Loading state → spinner text visible.
    6. Error state → red error notice visible (uses ERROR_WAIT_OPTS 5s timeout because of `retry: 1`).
    7. dataAvailable=false → "no data" notice.
    8. dataAvailable=true + trades=[] → "no trades" notice.
    9. Stats blocks render with correct numbers (Overall count=2, winRate=100.0%, BUY mean=+18.75%, SELL mean=+15.38%).
    10. Signal breakdown shows BUY 1, SELL 1, HOLD 3, 2 evaluated, 1 unevaluated.
    11. Trade rows render with item name + signal + entry/exit + return_pct (signed: +18.75%, +15.38%).
    12. Fetched-at footer renders with trade count.
    13. Hide button collapses panel back (expanded → collapsed state transition).
    14. Parent signalFilter (BUY) forwarded as `signal` query param to backtest (clicks BUY filter chip on parent, then expands backtest, asserts last backtest call has signal=BUY).
    15. Day selectors render with default values (Eval 14 days ago / Hold 7 days / Lookback 30 days).

- Verification:
  - `npx tsc --noEmit` → 0 errors (clean type-check).
  - `npx jest src/__tests__/speculation-tab.test.tsx` → 18 pass / 0 fail (existing live-signal tests unaffected).
  - `npx jest src/__tests__/speculation-backtest-panel.test.tsx` → 15 pass / 0 fail (new backtest-panel tests).
  - `npx jest` (full frontend suite) → **422 pass** (407 baseline + 15 new) / 0 fail across 20 test suites (~6.6s).
  - Backend unchanged in iter 80 — `pytest tests/test_speculation_backtest.py tests/test_speculation.py` → 97 pass / 0 fail (54 backtest + 43 live, 1.3s). Backend baseline 731 pass preserved.

- Documentation updates:
  - `STATUS.md`: bumped "Last updated" to iter 80. F5 row updated to "iter 77 live + iter 79 backtest backend + iter 80 backtest UI" with iter 80 frontend UI subsection. Added 2 new Quick Reference entries (Speculation tab shows no "Run backtest" button / Backtest panel "Run backtest" click does nothing).
  - `PRODUCT_VISION.md`: bumped "Last updated" to iter 80. §3.2 added iter 80 bullet (toggle, 3 day selectors, 3 stats blocks, signal breakdown, top-trades list). §4 architecture table updated Speculation tab row to mention backtest panel. §5 F5 section title updated to include iter 80; removed the obsolete "No frontend UI yet — backend-only" line from iter 79 subsection; added full "Реализовано в iter 80 (frontend UI)" subsection with all implementation details (proxy route, TS types, i18n keys, BacktestPanel + DaySelector + StatsBlock + TradeRow subcomponents, NOT-autoload rationale, parent signalFilter forwarding, graceful degradation states, 15 jest tests). §6 DoD point 4 updated to mention all 3 iters (77 live + 79 backend + 80 UI). Final paragraph updated: "F5 backtest полностью закрыт в iter 80 (backend + frontend UI)".
  - `AGENT_NAVIGATION.md`: bumped "Last updated" to iter 80. §1 `speculation-tab.tsx` row expanded with iter 80 Backtest panel details (toggle, day selectors, stats blocks, breakdown, trades list, parent signalFilter forwarding, graceful degradation, test counts). Invariant #33 expanded with "Frontend UI (iter 80)" subsection documenting the toggle-driven pattern, query params, parent signalFilter forwarding, Next.js proxy path. Frontend routes table added `/api/flipper/speculation/backtest` row. Quick Reference added 2 new entries (no "Run backtest" button / Run backtest click does nothing).
  - `worklog.md`: appended this iter 80 record.

Stage Summary:
- **F5 backtest frontend UI — DONE (collapsible Backtest panel inside Speculation tab + Next.js proxy + TS types + 4-locale i18n + 15 jest tests).** Toggle button (NOT autoload — gates `useQuery` via `enabled: showBacktest && backendOnline`). 3 day selectors (eval/holding/lookback). 3 stats blocks (Overall/BUY/SELL). Signal breakdown. Top-trades list. Parent's `signalFilter` forwarded as `signal` query param. Full graceful degradation (collapsed/loading/error/no-data/no-trades/full-content).
- **F5 (Speculation tab) — fully closed in iter 80.** All three sub-features shipped: iter 77 live signals (43 pytest + 18 jest), iter 79 backtest backend (54 pytest), iter 80 backtest UI (15 jest). No remaining F5 work.
- **F1 (additional RU translations) — STILL BLOCKED.** No change from iter 79 — needs live poe2scout.com + poe2db.tw/ru/ access.
- **Baseline:** jest 422 pass (+15), pytest 731 pass (unchanged — backend not touched in iter 80), tsc 0 errors.
- **Files changed/created (8 total):**
  - `src/app/api/flipper/speculation/backtest/route.ts` (NEW, ~95 lines)
  - `src/lib/types.ts` (modified: +80 lines — 3 Backtest interfaces)
  - `src/lib/i18n/locales/en.ts` (modified: +34 lines)
  - `src/lib/i18n/locales/ru.ts` (modified: +34 lines)
  - `src/lib/i18n/locales/zh.ts` (modified: +34 lines)
  - `src/lib/i18n/locales/ko.ts` (modified: +34 lines)
  - `src/components/dashboard/speculation-tab.tsx` (modified: +~470 lines — BacktestPanel + DaySelector + StatsBlock + TradeRow subcomponents + wiring)
  - `src/__tests__/speculation-backtest-panel.test.tsx` (NEW, ~480 lines, 15 tests)
  - `STATUS.md` (updated — F5 row + 2 Quick Reference entries)
  - `PRODUCT_VISION.md` (updated — §3.2 + §4 + §5 F5 iter 80 subsection + §6 DoD)
  - `AGENT_NAVIGATION.md` (updated — §1 speculation-tab.tsx row + invariant #33 + frontend routes table + 2 Quick Reference entries)
  - `worklog.md` (this record)

Next iteration (iter 81) — recommended priorities:
1. **F1 (when live API available)** — `scripts/sync_currency_names_from_poe2db.py`: enumerate 625 api_ids, fetch poe2db.tw/ru/, update `currency_names.json`, bump assertion counters in `tests/test_currency_names_ru.py`. Still the only blocked feature.
2. **Full Content Pulse tab** — F4 widget is the MVP; full version with sorting/filters/drill-down if widget proves useful. The widget is mounted on Overview tab; a full tab would let users see ALL categories (not just top-2 rising + top-2 falling) with sortable columns.
3. **Phase hints enhancements** (optional) — pull hints from `config.yaml` instead of hardcoding; add per-pattern metrics by cross-referencing the snapshot's `price_histories`; filter hints based on actual market state (e.g. only show "Temporalis near peak" if its 7d momentum is positive).
4. **useDashboardData hook extraction** (optional, tech debt) — `dashboard-page.tsx` is 1217 lines; ~250 lines of `useQuery`/memo wiring could move into a hook. Staged approach. Not blocking.
5. **Visual verification with real backend data** — manual verification of the backtest panel against real snapshot data (e.g. confirming that `eval_days_ago=14` with `holding_days=7` produces sensible trade counts on a live league) needs a running backend with ≥21d of price_logs collected. Jest tests use mocked data.
6. **e2e tests** (optional) — frontend is covered by jest; e2e would require running backend + browser. Not blocking.

NOT done in iter 80 (intentionally deferred):
- F1 (blocked on live API access)
- Full Content Pulse tab (the F4 widget is the MVP; full tab deferred until product feedback)
- Phase hints enhancements (hardcoded MVP shipped — config-driven hints + per-pattern metrics deferred)
- e2e tests not run (frontend changes are unit-tested via jest; e2e would require running backend + browser)
- useDashboardData hook extraction (optional, deferred)
- Visual verification with real backend data (jest tests use mocked data; manual verification of the backtest panel against real snapshot data needs a running backend with ≥21d of price_logs collected)

---
---
Task ID: iter-81
Agent: main (Sonnet 4.5)
Task: iter 81 — Stage 1 of useDashboardData hook extraction: extract flipper backend health/phase/events queries from dashboard-page.tsx into a new useFlipperBackend hook. Safe additive refactor — no behavior change.

Work Log:
- Read STATUS.md / PRODUCT_VISION.md / AGENT_NAVIGATION.md / worklog.md iter 80 record to understand the hand-off. Confirmed iter 80 closed F5 (Speculation tab backtest UI). F1 still blocked on live poe2scout.com + poe2db.tw/ru/ API access (no change).
- Surveyed what's actually doable in iter 81 without external API access or product feedback:
  1. useDashboardData hook extraction (tech debt, safe, well-scoped, STATUS.md "Approach in stages: (1) flipperBackend queries, (2) realms/leagues queries, (3) derived memos. Verify tsc + jest after each stage.")
  2. Phase hints enhancements (optional, config-driven — needs design work, not pure refactor)
  3. Full Content Pulse tab (deferred until product feedback on F4 widget — would be premature)
  4. e2e tests (need running backend + browser — out of scope for code-only iter)
  5. Visual verification (need ≥21d price_logs in live league — environment-blocked)
- Picked option 1 (useDashboardData Stage 1) — lowest risk, highest certainty, exactly matches the staged plan documented in STATUS.md.

- Inspected dashboard-page.tsx (1232 lines) to identify the safest extraction target:
  - flipperBackend queries (health/phase/events, lines 240-290): 3 useQuery calls + 2 derived booleans (flipperBackendOnline, flipperUpstreamReachable) + 1 derived number (activeEventsCount). SELF-CONTAINED: no state setters, no effect hooks, no inter-dependencies with other parts of the component. Returns clean interface.
  - realms/leagues queries (lines 306-332): COUPLED to setRealm/setLeague/setLeagueLocal wrappers + auto-select useEffect + persistLeague from store. Higher risk.
  - Derived memos (exchangePairs, crossRates, optimalPayment, currencyCategories — lines 482-716): HIGHLY COUPLED to many local state setters and other derived values. Highest risk.
- Confirmed via grep that the extracted symbols (flipperBackendOnline, flipperUpstreamReachable, flipperPhaseData, activeEventsCount) are used in 12 places downstream in dashboard-page.tsx (Header, FlipperStickyBar, all tab ErrorBoundary wrappers, FlipsTab/LiquidChainTab/CurrencyGraphTab upstreamDegraded prop, DashboardDialogs). All consumers continue to work unchanged because the new hook returns the same names.

- Frontend — `src/hooks/use-flipper-backend.ts` (NEW, 132 lines):
  - Header comment explains: Stage 1 of useDashboardData extraction, lists all 3 endpoints wrapped, documents derived flags, points to STATUS.md for staged plan.
  - Exports `UseFlipperBackendResult` interface + `useFlipperBackend()` function.
  - Three `useQuery` calls, all keys via `QUERY_KEYS` (flipperHealth / flipperPhase / flipperEventsCount — UNCHANGED from prior inline calls).
  - Health probe: always on, 30s staleTime + 30s refetchInterval + retry:2 + retryDelay:3000 (matches prior P1-2 retry policy).
  - Phase query: `enabled: flipperBackendOnline`, 60s staleTime + 60s refetchInterval + retry:1.
  - Events query: `enabled: flipperBackendOnline`, 30s staleTime + 30s refetchInterval + retry:1. Uses `{ active_only: "true" }` query param.
  - Derived flags: `flipperBackendOnline = !flipperHealthError && (status === "ok" || "degraded")`, `flipperUpstreamReachable = flipperHealthData?.provider === "reachable"`, `activeEventsCount = flipperEventsData?.total ?? 0`.
  - Returns the raw health state (data/pending/error) + raw events data for future consumers even though dashboard-page.tsx doesn't use them yet (avoids forcing a future re-extraction if a loading indicator is added).

- Frontend — `src/components/dashboard/dashboard-page.tsx` (modified, 1232 → 1197 lines, −35 net):
  - Added `import { useFlipperBackend } from "@/hooks/use-flipper-backend";` (with iter-81 comment explaining the extraction).
  - Removed now-unused type imports: `FlipperHealthResponse`, `FlipperPhaseResponse`, `FlipperEventsSummary` (still used inside the new hook — imported there).
  - Replaced the inline 50-line block (3 useQuery calls + derived flags) with a single 6-line `const { flipperBackendOnline, flipperUpstreamReachable, flipperPhaseData, activeEventsCount } = useFlipperBackend();` destructure.
  - All downstream references (12 places) work unchanged — same variable names, same types.
  - `useQuery` import preserved (still used by realms/leagues/optimalCurrency queries).
  - `QUERY_KEYS` import preserved (still used by realms/leagues/optimalCurrency query keys).

- Verification:
  - `npx tsc --noEmit` → 0 errors (clean type-check).
  - `npx jest` (full suite) → **422 pass** / 0 fail across 20 test suites (~5.7s). Unchanged from iter 80 baseline — confirms zero behavior regression.
  - `npx next build` → "✓ Compiled successfully in 4.5s" (1 pre-existing Turbopack warning about `next.config.ts` NFT tracing — unrelated to this iter).
  - `wc -l src/components/dashboard/dashboard-page.tsx` → 1197 lines (was 1232).

- Documentation updates:
  - `STATUS.md`: bumped "Last updated" to iter 81. Rewrote the technical-debt backlog paragraph: updated line count (1232→1197), noted Stage 1 shipped iter 81, listed remaining stages 2-3 (realms/leagues + derived memos). Added 1 new Quick Reference entry (dashboard-level backend status → useFlipperBackend hook).
  - `PRODUCT_VISION.md`: bumped "Last updated" to iter 81. Updated final DoD paragraph to mention "useDashboardData hook extraction — Stage 1 выполнен в iter 81, осталось 2 stage".
  - `AGENT_NAVIGATION.md`: bumped "Last updated" to iter 81. Updated `dashboard-page.tsx` row in §1 (1216→1197 lines, "Stage 1 done iter 81"). Bumped `src/hooks/` count from 14 to 15. Added new §1 module row for `use-flipper-backend.ts` with full description (single source of truth, 3 endpoints, derived flags, inline useQuery forbidden). Updated "dashboard-page.tsx still 1197 lines" Quick Reference entry. Added invariant #34 (`useFlipperBackend` is the single source of truth for dashboard-level flipper status — documents the hook contract, what's exposed, what's NOT to be done inline, and notes stages 2-3 still pending). Fixed stale §6 note: `worklog.md` was deleted in iter 73 then re-created in iter 74 — old note incorrectly claimed it was deleted permanently. Added `worklog.md` row to the §6 documentation map table.
  - `worklog.md`: appended this iter 81 record.

Stage Summary:
- **useDashboardData Stage 1 (useFlipperBackend hook extraction) — DONE.** New hook `src/hooks/use-flipper-backend.ts` (132 lines) is the single source of truth for dashboard-level flipper backend status. `dashboard-page.tsx` is now 1197 lines (was 1232, was 1685 in iter 70). Zero behavior change — same query keys, same polling intervals, same derived flag logic, same downstream prop names.
- **F1 (additional RU translations) — STILL BLOCKED.** No change from iter 80 — needs live poe2scout.com + poe2db.tw/ru/ access.
- **Baseline:** jest 422 pass (unchanged from iter 80), tsc 0 errors, next build OK.
- **Files changed/created (5 total):**
  - `src/hooks/use-flipper-backend.ts` (NEW, 132 lines)
  - `src/components/dashboard/dashboard-page.tsx` (modified: −35 lines net — replaced inline block with hook call, removed 3 unused type imports)
  - `STATUS.md` (updated — iter 81 stamp, Stage 1 noted, 1 new Quick Reference)
  - `PRODUCT_VISION.md` (updated — iter 81 stamp, Stage 1 noted in DoD paragraph)
  - `AGENT_NAVIGATION.md` (updated — iter 81 stamp, dashboard-page.tsx row updated, hooks count 14→15, new use-flipper-backend.ts row, invariant #34 added, stale worklog note fixed, worklog added to doc map)
  - `worklog.md` (this record)

Next iteration (iter 82) — recommended priorities:
1. **F1 (when live API available)** — `scripts/sync_currency_names_from_poe2db.py`: enumerate 625 api_ids, fetch poe2db.tw/ru/, update `currency_names.json`, bump assertion counters in `tests/test_currency_names_ru.py`. Still the only blocked feature.
2. **useDashboardData Stage 2** (optional tech debt) — extract realms/leagues queries + `effectiveLeague` memo into `useRealmsAndLeagues()` hook. Riskier than Stage 1 because of the auto-select useEffect + persistLeague coupling. Verify tsc + jest after.
3. **useDashboardData Stage 3** (optional tech debt) — extract derived memos (exchangePairs filter, optimalPayment merge, optimalPaymentByDisplayName, currencyCategories, uniqueCategoriesList) into `useDerivedExchangeData()` hook. Highest interdependency risk — break into 2 sub-stages if needed.
4. **Full Content Pulse tab** — F4 widget is the MVP; full version with sorting/filters/drill-down if widget proves useful.
5. **Phase hints enhancements** (optional) — pull hints from `config.yaml` instead of hardcoding; add per-pattern metrics by cross-referencing the snapshot's `price_histories`; filter hints based on actual market state.
6. **Visual verification with real backend data** — manual verification of the backtest panel against real snapshot data needs a running backend with ≥21d of price_logs collected.
7. **e2e tests** (optional) — frontend is covered by jest; e2e would require running backend + browser.

NOT done in iter 81 (intentionally deferred):
- F1 (blocked on live API access)
- useDashboardData Stage 2 (realms/leagues extraction) — deferred to iter 82+ to keep this iter small and reviewable
- useDashboardData Stage 3 (derived memos extraction) — deferred to iter 83+ for the same reason
- Full Content Pulse tab (the F4 widget is the MVP; full tab deferred until product feedback)
- Phase hints enhancements (hardcoded MVP shipped — config-driven hints + per-pattern metrics deferred)
- e2e tests not run (frontend changes are unit-tested via jest; e2e would require running backend + browser)
- Visual verification with real backend data (jest tests use mocked data; manual verification needs a running backend with ≥21d of price_logs collected)
