# iter 133 — Merge Instructions

## Summary

iter 133 closes **KI-26-audit** (P4 follow-up from iter 130) and ships **KI-27** as a result of the audit findings.

- Audited all 17 `replace(tzinfo=timezone.utc)` call sites in `backend/`.
- **3 UNSAFE** → fixed with `astimezone(timezone.utc)` (same fix pattern as KI-26 in `triangular_cycles._safe_snapshot_age_sec`):
  - `backend/economy/lifecycle.py:115, 117` — `days_since_reference` (`current` + `reference` params).
  - `backend/arbitrage/triangular.py:146` — `_compute_confidence` (`snapshot_time` param).
- **14 SAFE** — input is naive UTC from SQLite or POE2Scout (no fix needed). Full per-site classification in `STATUS.md` § "KI-26-audit".
- 4 new pytest regression tests (2 in `test_lifecycle.py`, 2 in `test_triangular.py`).
- 1436 pytest green in both UTC and UTC+5, 0 regressions. Backend-only — no frontend changes.

## Files in this archive (MODIFIED — overwrite local copies)

```
backend/economy/lifecycle.py
backend/arbitrage/triangular.py
tests/test_lifecycle.py
tests/test_triangular.py
STATUS.md
AGENT_NAVIGATION.md
worklog.md
```

## Files to DELETE from your local repo (NOT in this archive)

```
README_iter124.md   # stale merge instructions from iter 124
```

Use `git rm README_iter124.md` (see git commands in chat).

## Verification (run after merge)

```bash
# Backend pytest — should be 1436 passed in both UTC and UTC+5
python -m pytest -q
TZ=Asia/Yekaterinburg python -m pytest -q

# Frontend (no changes, but verify no regression)
npx tsc --noEmit
npx jest
npx eslint
```

## Detailed changes

See `STATUS.md` § "KI-26-audit — `replace(tzinfo=utc)` call-site classification (iter 133)" for the full per-site audit table.
See `worklog.md` Task ID `iter-133` for the full work log.
