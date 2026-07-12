# iter 135 — TD-9 fallback removal

## What this archive contains

Modified files for iter 135 (TD-9 fallback removal SHIPPED). Extract
this archive at the root of your local clone of
`https://github.com/vudirvp-sketch/poe2-market-dashboard` to overwrite
the existing files with the iter 135 versions.

## Files modified (15)

- `AGENT_NAVIGATION.md` — header updated to iter 135
- `STATUS.md` — iter 135 header + TD-9 fallback removal closed entry +
  TD-9 backlog row marked CLOSED + Quick Reference row updated
- `worklog.md` — iter 135 entry prepended, trimmed to last 2 iters
  (iter 134 + iter 135)
- `backend/api/response_models.py` — comment-only update (TD-9 fallback
  reference removed)
- `backend/api/routes_arbitrage.py` — 2 comment-only updates (TD-9
  fallback references removed)
- `backend/models/currency.py` — comment-only update (TD-9 fallback
  reference removed)
- `docs/design/TD-3-4-5-9-persistence-gaps-design.md` — §10 Q5 marked
  RESOLVED iter 135 + §11 References entry updated
- `src/__tests__/flips-helpers.test.ts` — 8 deriveTrendSparklineData
  tests removed + 4 getTrendSparklineData fallback tests rewritten as
  empty-array tests
- `src/components/dashboard/flips-helpers.ts` — deriveTrendSparklineData
  function + FLIPS_TREND_SPARKLINE_POINTS constant removed;
  TrendSparklineInput interface dropped momentum/volatility fields;
  getTrendSparklineData returns [] when no real history
- `src/components/dashboard/flips-table.tsx` — getTrendSparklineData
  call simplified (momentum/volatility args dropped) + inline comment
  updated
- `src/lib/i18n/locales/en.ts` — flipsTrendTooltip text repurposed
- `src/lib/i18n/locales/ko.ts` — flipsTrendTooltip text repurposed
- `src/lib/i18n/locales/ru.ts` — flipsTrendTooltip text repurposed
- `src/lib/i18n/locales/zh.ts` — flipsTrendTooltip text repurposed
- `src/lib/types.ts` — JSDoc on priceHistoryShort updated

## Files deleted (4)

See `DELETIONS.txt` for the list. Run `git rm <file>` for each, OR
just `git add -A` after extracting — git auto-stages deletions when
the files are gone from the working tree.

## Verification (run after extracting)

```bash
npx tsc --noEmit                                # clean
npx jest --no-coverage --maxWorkers=2           # 690/690 pass
pytest -q                                       # 1455/1455 pass (UTC)
TZ=Asia/Yekaterinburg pytest -q                 # 1455/1455 pass (UTC+5)
```

## Stopping point

iter 135 = TD-9 fallback removal SHIPPED. All baselines preserved
(690 jest green, 1455 pytest green in both UTC and UTC+5, 0 regressions,
`tsc --noEmit` clean). Closes one of the two oldest deferred items per
iter 134 stopping-point brief. Next iter (iter 136+) candidate:
production verification P10 Phase 2 + TD-3 (verify end-to-end on a
real backend — both items naturally pair since they exercise the same
`/triangular` + `triangular_cycles` persistence path).
