# iter 81 — Merge Instructions

## What's inside this archive

Stage 1 of the useDashboardData hook extraction — extract flipper backend
health/phase/events queries from dashboard-page.tsx into a new
useFlipperBackend hook. Pure refactor — zero behavior change.

## Files (6 total)

| File | Status | Notes |
|------|--------|-------|
| src/hooks/use-flipper-backend.ts | NEW (132 lines) | Single source of truth for dashboard-level flipper backend status. Returns flipperBackendOnline, flipperUpstreamReachable, flipperPhaseData, activeEventsCount, raw health/events state. |
| src/components/dashboard/dashboard-page.tsx | MODIFIED (1232 to 1197 lines, -35) | Replaced 50-line inline query block with single hook call. Removed 3 now-unused type imports. All downstream references unchanged. |
| STATUS.md | MODIFIED | iter 81 stamp. Tech-debt backlog paragraph updated (line count 1232->1197, Stage 1 noted, stages 2-3 listed). 1 new Quick Reference entry. |
| PRODUCT_VISION.md | MODIFIED | iter 81 stamp. Final DoD paragraph mentions Stage 1 done. |
| AGENT_NAVIGATION.md | MODIFIED | iter 81 stamp. dashboard-page.tsx row updated. hooks count 14->15. New use-flipper-backend.ts row. Invariant #34 added. Stale worklog note fixed. worklog added to doc map. |
| worklog.md | MODIFIED + TRIMMED | iter 81 record appended. Older iter 74-76 records dropped (stable features fully documented in PRODUCT_VISION.md). 778 -> 576 lines. Iter 77-81 records preserved. |

## How to merge

These paths are repo-relative. Copy them over your local checkout:

    cp -r path/to/extracted/* ./

## Verification

    npx tsc --noEmit          # 0 errors
    npx jest                  # 422 pass / 0 fail (unchanged from iter 80 baseline)
    npx next build            # Compiled successfully (1 pre-existing Turbopack warning, unrelated)

## No backend changes

This iter is frontend-only. No Python files modified. No pytest rerun needed.
