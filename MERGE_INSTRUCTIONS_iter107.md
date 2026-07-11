# Merge Instructions — iter 107

> **Iteration:** 107
> **Date:** 2026-07-11
> **Goal:** Fix KI-13 (SSE 400 error) + document/fix KI-19 (DELETE_*.ts build break).

---

## What Changed

### KI-13 — SSE `/api/v1/prices/stream?threshold_pct=1` returns 400 (FIXED)

**Root cause:** Route-registration order in `backend/main.py`. The greedy route
`/api/v1/prices/{pair:path}` (in `routes_prices.py`) was registered BEFORE the
SSE route `/api/v1/prices/stream` (in `routes_sse.py`). FastAPI matches routes
in registration order, so `{pair:path}` captured `/stream` as a pair name →
`get_price_for_pair(pair="stream")` → `HTTPException(400, "Invalid pair format:
stream. Expected 'from/to'.")`.

**Fix:** Moved SSE router registration ABOVE `prices_router` registration in
`backend/main.py`. Added a detailed comment explaining why the order matters.

**Also added (per user request):**
- Explicit logging in `_sse_event_generator` (generator start, per-cycle event
  count, no-snapshot status, cancellation, errors with exc_info).
- Explicit logging in `sse_price_stream` handler (request entry with threshold).
- Two regression tests in `tests/e2e/test_sse.py`:
  1. `test_sse_route_registered_before_pair_path_route` — inspects `app.routes`
     to verify SSE route index < `{pair:path}` route index.
  2. `test_sse_http_endpoint_returns_text_event_stream` — hits the actual HTTP
     endpoint; timeout = pass (stream live), fast 400 = fail (regression).

### KI-19 — `scripts/DELETE_*.ts` placeholder files break `next build` (FIXED)

**Root cause:** A previous iteration created
`scripts/DELETE_flipper-backend-bridge.ts` as a "note to delete this file"
placeholder. Next.js type-checks ALL `.ts` files; `DELETE` (uppercase) is
parsed as identifier, not the `delete` keyword.

**Fix:**
1. `DELETE_obsolete_files.sh` now deletes `scripts/DELETE_*.ts` and
   `scripts/DELETE_*.tsx` glob patterns.
2. `tsconfig.json` `exclude` now includes `"**/DELETE_*"` — even if a DELETE_*
   file slips in, tsc won't type-check it.

---

## Files Modified (8)

| File | Change |
|------|--------|
| `backend/main.py` | SSE router moved before prices router + KI-13 comment |
| `backend/api/routes_sse.py` | Explicit logging in generator + handler |
| `tests/e2e/test_sse.py` | +2 regression tests (route order + HTTP endpoint) |
| `DELETE_obsolete_files.sh` | Updated for iter 107 + DELETE_* glob |
| `tsconfig.json` | Exclude `**/DELETE_*` |
| `STATUS.md` | KI-13 closed, KI-19 added, Quick Reference updated |
| `AGENT_NAVIGATION.md` | Header + routes_sse.py entry updated |
| `worklog.md` | iter 107 entry, trimmed history |

---

## Merge Steps

### 1. Run cleanup script (removes obsolete files from previous iterations)

```bash
cd poe2-market-dashboard
bash DELETE_obsolete_files.sh
```

This deletes:
- `scripts/flipper-backend-bridge.ts` (stale duplicate from iter 105)
- `scripts/DELETE_*.ts` / `scripts/DELETE_*.tsx` (KI-19 placeholder files)
- Old `MERGE_INSTRUCTIONS_iter*.md` and `git_commands_iter*.txt` files
- `flipper-bridge.log`, `DELETIONS.sh`, `DELETIONS.txt`, `README.txt`

### 2. Extract the archive over your working directory

```bash
# From the directory containing iter107_archive.zip:
unzip -o iter107_archive.zip -d poe2-market-dashboard/
```

### 3. Install Python dependency (if not already installed)

```bash
pip install aiosqlite
```

### 4. Verify

```bash
cd poe2-market-dashboard

# TypeScript check
npx tsc --noEmit

# Build (should compile with ZERO warnings)
npx next build

# Jest tests (should be 569 passed)
npx jest

# Pytest (should be 1161 passed, including 2 new SSE regression tests)
python -m pytest -q
```

### 5. Commit and push

See `git_commands_iter107.txt` for the exact git commands.

---

## Verification Results (from iter 107)

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | 0 errors |
| `npx next build` | ✓ Compiled successfully in 9.0s, ZERO warnings |
| `npx jest` | 25 suites / 569 tests passed (26s) |
| `python -m pytest -q` | 1161 passed (8.9s) |
| NFT warning | None (still fixed from iter 106) |

---

## Stopping Point

**iter 107 COMPLETE.** KI-13 and KI-19 both fixed. All tests green.

### Next iteration (iter 108) candidates:

1. **P7 Mirror/Divine Arb Detector** (§C.6 of `docs/MARKET_PLAYBOOK.md`) — new feature.
2. **TD-3/4/5/9** — technical debt (persistence gaps).
3. **Verify KI-13 in production** — check backend log for
   `"SSE /stream request received (threshold_pct=1.0000) — route matched correctly"`
   info message after dashboard loads.

### Key technical insight for future agents:

FastAPI route matching is ORDER-DEPENDENT. A `{param:path}` converter is greedy
and matches slashes — it will shadow any literal sub-path registered AFTER it.
When registering routers that have both greedy path params and literal
sub-paths, ALWAYS register the literal-path router first.
