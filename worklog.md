# Work Log

> Single source for recent task entries. Long history removed — see git log for details.
> Append new entries at the bottom. Keep ≤3 latest entries.

---

## Task 71 — closed P3-3, P3-4, P3-5, P4-1; P2-1 step 1
**Agent:** Main Agent
**Date:** 2026-06-25

**Task:** Continue iterative cleanup at iter 71. Recommended order: P2-1 (dashboard-page.tsx split, multi-iter, step 1 only), P3-3 (EventManager thread-safety), P3-4 (SnapshotManager atomic swap), P3-5 (full /flips integration test), P3-7 (delete REFACTOR_PLAN.md + worklog.md — deferred until all P2/P3 closed).

**Work Log:**
- **P3-3 (EventManager thread-safety).** Added `threading.RLock` to `EventManager`. All in-memory `_events` dict access (CRUD + 6 read-side query interfaces + `_prune_expired`) is now guarded. The lock is **never held across an `await`** — `create_event`, `delete_event`, `deactivate_event`, `clear_all` snapshot the dict and the store ref under the lock, then await the SQLite write outside. +4 regression tests in `tests/test_events.py::TestThreadSafety` run real threads: concurrent creates (200 events across 10 threads), concurrent reads-during-writes (no exception), concurrent delete-same-id (exactly one True, no KeyError), atomic deactivate-then-read.
- **P3-4 (SnapshotManager atomic swap).** Wrapped `(snapshot, ts)` in an immutable `@dataclass(frozen=True) _SnapshotState` stored as a single `self._state` reference. `start_periodic_refresh`, `get_snapshot` (fast + slow path), `invalidate`, and `health_info` all read `_state` once and unpack from the same instance — readers can no longer pair a stale snapshot with a fresh ts. Added a separate `_cache_lock` (`threading.Lock`) to guard `_history_cache` and `_active_currencies` mutations inside `_refresh`. +8 regression tests in `tests/test_snapshot_atomic_swap.py` cover: `last_snapshot` reads atomic state, `invalidate` resets ts atomically, `health_info` consistency, concurrent reader/writer never sees mixed state, `_state` never None mid-swap.
- **P3-5 (full /flips integration test).** New file `tests/test_flips_integration.py` (+18 tests) covering: `data_available: false` path (snapshot None → 200 + empty list + `event_status` safe defaults + `fetched_at`), response schema completeness (all documented top-level fields + per-opportunity fields including `currency_from_ru`/`currency_from_en`/etc.), `event_status` and `data_freshness` block shapes, localized name enrichment (incl. unknown-currency None handling — no KeyError, no 500), `_build_flip_opportunities` raises → route returns 200 with empty list (not 500), `limit` semantics (total = post-limit count; `Query(ge=1, le=200)` validation returns 422 on violations), and a combined filter+sort+limit+enrichment test.
- **P4-1 (found during P3-5).** Discovered that the `/flips` route sets a `message` field when `data_available=false`, but `FlipsResponse` (Pydantic response_model) had no `message` field — Pydantic silently stripped it, so clients reading `data["message"]` got `KeyError`. Documented in STATUS.md as P4-1 first, then fixed by adding `message: str | None = Field(default=None, ...)` to `FlipsResponse`. Regenerated `openapi_schema.json` (108KB → 109KB) and `src/lib/api-types.ts`.
- **P2-1 step 1 (ExchangeTabContent extraction).** Created `src/components/dashboard/exchange-tab-content.tsx` (411 lines incl. typed props interface). The new component is pure presentational — all state (UI filters, view mode, exchange data, optimal-payment map, i18n, etc.) is passed in as props from `Dashboard`. Replaced 256 lines of inline JSX in `dashboard-page.tsx` with `<ExchangeTabContent {...props} />`. dashboard-page.tsx: 1685 → 1466 lines. Pattern established for iter 72 (extract CurrenciesTabContent, UniquesTabContent, OverviewTabContent the same way).
- **P3-7 deferred.** Will delete `REFACTOR_PLAN.md` + `worklog.md` in iter 73 after P2-1 is fully closed (per REFACTOR_PLAN.md principle #5 — these files are still actively used by agents during the P2-1 multi-iter split).
- Verified baselines: pytest **496 pass** (+30 from 466: +4 P3-3, +8 P3-4, +18 P3-5), jest **324 pass** (unchanged — Python+types only), tsc **0 errors** (unchanged), e2e 30 pass (unchanged, not re-run).
- Updated docs: `STATUS.md` (iter 71 entry in Fixed section; P3-3/P3-4/P3-5 → closed; new P4 bucket created with P4-1 closed; Quick Reference gained two new rows for the P3-3/P3-4 symptoms); `REFACTOR_PLAN.md` (v34 → v35; iter 71 marked DONE; new principles #8 locks-never-held-across-await and #9 atomic-swap-for-read-heavy-singletons; DoD gained thread-safety + atomic-swap regression-test rules); `AGENT_NAVIGATION.md` (header date → iter 71; row for `events.py` mentions RLock; new row for `data_snapshot.py` mentions `_SnapshotState`; new row for `exchange-tab-content.tsx`; row for `dashboard-page.tsx` shows 1466 lines and tracks the multi-iter split; invariants #25 and #26 added for P3-3 and P3-4; Quick Reference gained two new rows); `worklog.md` (Task 71 entry; trimmed to ≤3 latest — Task 68 dropped, see git log).

**Stage Summary:**
- P3-3, P3-4, P3-5, P4-1 all closed. P2-1 step 1 done (ExchangeTabContent extracted).
- P0=0, P1=0, P2=1 (P2-1, in progress), P3=1 (P3-7, deferred to iter 73), P4=0. ~1-2 iterations remaining.
- Baseline: pytest **496 pass** (+30), jest 324 pass, tsc 0 errors, e2e 30 pass.

**Stopping point:**
- Iter 71 done. P3-3, P3-4, P3-5, P4-1 closed; P2-1 step 1 done.
- Next iter (iter 72) recommended:
  1. **P2-1 step 2** — Extract `CurrenciesTabContent` (~65 lines of inline JSX). Reuse the props-passing pattern from `ExchangeTabContent`. Run `npm test` + `npx tsc --noEmit` after extraction.
  2. **P2-1 step 3** — Extract `UniquesTabContent` (~48 lines) and `OverviewTabContent` (~20 lines). After this, dashboard-page.tsx should be under ~700 lines.
- Iter 73 (final cleanup): **P3-7** — delete `REFACTOR_PLAN.md` + `worklog.md` once P2-1 fully closed. Update `AGENT_NAVIGATION.md` §6 documentation map.
- After all P2/P3 closed → switch focus to product features (F1-F6 in `PRODUCT_VISION.md`), starting with F1 (translate remaining ~276 items) and F2 (Storage Value tab vs Mirror/Hinekora).
- Suggested commit message: `refactor(iter-71): P3-3 EventManager RLock, P3-4 atomic SnapshotState, P3-5 /flips integration tests, P4-1 FlipsResponse.message, P2-1 step 1 ExchangeTabContent`.

---

## Task 70 — P2-3 closed (currency_names_ru → JSON)
**Agent:** Main Agent
**Date:** 2026-06-25

**Stage Summary:**
- P2-3 closed. `currency_names_ru.py` 966 → 63 lines. Data now editable as JSON without touching Python.
- Product vision captured in `PRODUCT_VISION.md` — future agents will read this before proposing features.
- P0=0, P1=0, P2=1, P3=4. ~2-4 iterations remaining (P2-1 alone is multi-iter).
- Baseline: pytest **466 pass** (+7), jest 324 pass, tsc 0 errors, e2e 30 pass.

---

## Task 69 — P2-8 closed + iter 68 scanner residual cleaned
**Agent:** Main Agent
**Date:** 2026-06-21

**Stage Summary:**
- P2-8 closed. `proxyWithFallback` is now mode-aware: dev sees real 5xx, prod gets 200 + `X-Flipper-Fallback` header. +22 jest tests. `jest.setup.ts` gained `Response`/`fetch`/`Headers`/`AbortSignal.timeout` polyfills.
- Iter 68 scanner residual bug closed. `backend/api/routes_scanner.py` deleted for real. Going forward, file deletions go through `git add -A` (no manual `rm` step in MERGE_INSTRUCTIONS.md).
- P0=0, P1=0, P2=2, P3=4. ~1-3 iterations remaining.
- Baseline: pytest 459 pass, jest 324 pass (+22), tsc 0 errors, e2e 30 pass.
