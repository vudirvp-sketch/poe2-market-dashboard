# STATUS.md — Known Issues & Refactoring Backlog

> **Last updated:** 2026-06-25 (iter 71 — closed P3-3, P3-4, P3-5, P4-1; P2-1 step 1)
> Single source of truth for known bugs and refactoring priorities.
> Update BEFORE fixing any issue. Cross-reference issue IDs in commits.

---

## P0 — Critical (correctness, stability) — 0 active

All P0 issues resolved in iter 54-58.

---

## P1 — Serious (performance, maintainability) — 0 active

All P1 issues resolved in iter 54-66.

---

## P2 — Medium (clean code, dev experience) — 1 item (in progress)

- **P2-1.** `dashboard-page.tsx` — god-component. Split into tab-specific subcomponents. **Iter 71 step 1 DONE**: extracted `ExchangeTabContent` (256 lines moved out, dashboard-page.tsx 1685 → 1466). Next iter (72): extract `CurrenciesTabContent`, then `UniquesTabContent`, then `OverviewTabContent`.

> **P2-3 (closed iter 70):** `currency_names_ru.py` was a 966-line hardcoded Python dict. Now a 63-line thin loader reading from `currency_names.json`.

> **P2-8 (closed iter 69):** `proxyWithFallback` is mode-aware — non-503 5xx pass through unchanged in dev, return 200+`X-Flipper-Fallback` header in prod.

---

## P3 — Low priority (nice-to-have) — 1 item remaining

- **P3-7.** `REFACTOR_PLAN.md` and `worklog.md` — delete after closing all P2/P3 issues.

> **P3-3 (closed iter 71):** `EventManager` now uses `threading.RLock` for all in-memory `_events` access. The lock is never held across an `await` — SQLite writes happen outside the lock. +4 regression tests in `tests/test_events.py::TestThreadSafety` cover concurrent creates, concurrent reads-during-writes, concurrent delete-same-id (no KeyError), and atomic deactivate-then-read.

> **P3-4 (closed iter 71):** `SnapshotManager` now stores `(snapshot, ts)` in an immutable `_SnapshotState` dataclass swapped atomically via single attribute assignment. The fast-path `get_snapshot()` read can no longer pair a stale snapshot with a fresh ts. `_history_cache` and `_active_currencies` are guarded by a separate `_cache_lock`. +8 regression tests in `tests/test_snapshot_atomic_swap.py`.

> **P3-5 (closed iter 71):** Full `/flips` integration test added: `tests/test_flips_integration.py` (+18 tests). Covers `data_available: false` path, response schema completeness, event_status block, data_freshness block, localized name enrichment (incl. unknown-currency None handling), `_build_flip_opportunities` raises → empty list, `limit` semantics (total = post-limit count, clamped by Query(ge=1, le=200)), combined filter+sort+limit+enrichment.

---

## P4 — Documentation / minor cosmetic — 0 remaining

> **P4-1 (closed iter 71):** `FlipsResponse` (Pydantic response_model) was missing the `message` field that the `/flips` route sets when `data_available=false`. Added `message: str | None = None` to `FlipsResponse` — clients can now read `data["message"]` without `KeyError`. Regenerated `openapi_schema.json` + `src/lib/api-types.ts`.

---

## Fixed (recent — older history in git log)

### iter 71 — closed P3-3, P3-4, P3-5, P4-1 + P2-1 step 1

- **P3-3** — `EventManager` thread-safety: `threading.RLock` guards all in-memory `_events` dict access (CRUD + read-side query interfaces). Lock is never held across `await` — SQLite writes run outside the lock so other readers aren't blocked. +4 regression tests in `tests/test_events.py::TestThreadSafety`.
- **P3-4** — `SnapshotManager` atomic swap: `(snapshot, ts)` pair wrapped in immutable `_SnapshotState` dataclass, stored as single `self._state` reference. Replacement is a single Python attribute assignment (atomic under GIL). Fast-path `get_snapshot()` reads `_state` ONCE — can no longer pair stale snapshot with fresh ts. `invalidate()` swaps to a fresh `_SnapshotState(snapshot=existing, ts=0)`. `_history_cache` and `_active_currencies` guarded by separate `_cache_lock`. +8 regression tests in `tests/test_snapshot_atomic_swap.py`.
- **P3-5** — Full `/flips` integration tests added in `tests/test_flips_integration.py` (+18 tests). Covers `data_available: false` path, response schema completeness, event_status / data_freshness blocks, localized name enrichment (incl. unknown-currency None handling), pipeline-failure → empty list, `limit` semantics (total=post-limit count, ge=1 le=200 validation), and a combined filter+sort+limit+enrichment test.
- **P4-1** — `FlipsResponse.message` field added (`str | None = None`) so the route's `data_available=false` message is no longer stripped by Pydantic. Regenerated `openapi_schema.json` + `src/lib/api-types.ts`.
- **P2-1 step 1** — Extracted `ExchangeTabContent` from `dashboard-page.tsx` (256 lines of inline JSX → new `src/components/dashboard/exchange-tab-content.tsx`, 411 lines incl. props interface). dashboard-page.tsx: 1685 → 1466 lines. Multi-iter; steps 2-3 (Currencies/Uniques/Overview extraction) deferred to iter 72+.
- Baseline: pytest **496 pass** (+30), jest **324 pass** (unchanged — Python+types only), tsc **0 errors** (unchanged), e2e 30 pass (unchanged).

### iter 70 — P2-3 closed (currency_names_ru → JSON)

- **P2-3.** `currency_names_ru.py` shrank **966 → 63 lines**. Data lives in `currency_names.json`. +7 regression tests.
- New `PRODUCT_VISION.md` at repo root.

### iter 69 — P2-8 closed + iter 68 scanner residual cleaned

- **P2-8** — `proxyWithFallback` 5xx mode-aware. Dev: real 5xx; Prod: 200+fallback+`X-Flipper-Fallback` header.
- Iter 68 scanner residual: `routes_scanner.py` deleted for real.

### iter 67 — P2-9, P2-6, P2-4 closed

- P2-9 — LightGBM adaptive fallback from `floor=5`.
- P2-6 — `/api/flipper/health/circuit-breakers` endpoint.
- P2-4 — `/flips` filter/sort params.

### Earlier fixes

P0-1..P0-6, P1-1/2/4/7/8/11, P2-7/10/11/12/13/14, P2-2/5, P3-8 (iter 54-67). See git log.

---

## Quick Reference — Frequent Problems

| Symptom | Cause | Where to fix |
|---------|-------|--------------|
| `test_scheduler.py` collection fails | `aiosqlite` not installed in env | `pip install aiosqlite` |
| `/optimizer/path` returns empty path with `data_available: true` | Profitable arbitrage cycle detected — fall back to `direct_rate` (P1-8) | `backend/api/routes_optimizer.py:_bellman_ford` |
| SQLite `near "LIMIT": syntax error` | Use `rowid IN (SELECT ... LIMIT ?)` pattern, not `DELETE ... LIMIT ?` | `backend/data/historical.py:_prune_old_league_data` |
| LightGBM skips training for new currency | Below `lightgbm_min_data_points` (15) — adaptive fallback now trains from `floor` (5) with minimal features (P2-9) | `backend/predictors/time_series.py:train` |
| Need to inspect circuit breaker state | `GET /api/flipper/health/circuit-breakers` returns JSON snapshot (P2-6) | `src/app/api/flipper/health/circuit-breakers/route.ts` |
| Want advanced `/flips` filters | All scanner params are on `/api/v1/arbitrage/flips` (P2-4). The `message` field is now exposed on `FlipsResponse` when `data_available=false` (P4-1, iter 71). | `backend/api/routes_arbitrage.py:get_flip_opportunities` |
| Adding a new Russian translation | Edit `backend/data/currency_names.json` (NOT the `.py` loader). Run `pytest tests/test_currency_names_ru.py`. | `backend/data/currency_names.json` |
| Concurrent EventManager access raises `KeyError` / `dict changed size during iteration` | (Fixed iter 71 — was P3-3) All in-memory access now guarded by `threading.RLock` | `backend/economy/events.py` |
| `SnapshotManager.get_snapshot` fast-path returns stale snapshot paired with fresh ts | (Fixed iter 71 — was P3-4) `(snapshot, ts)` now wrapped in immutable `_SnapshotState` swapped atomically | `backend/api/data_snapshot.py` |
