# MERGE INSTRUCTIONS — iter 94

> Archive: `iter94-poe2-market-dashboard.zip`
> Generated: 2026-06-26
> Iteration: 94 (KI-10 fix + Spread Capture view — Q4/Q5/Q6)

## What's inside

11 files preserving the repository folder structure. Extract into your local clone of `vudirvp-sketch/poe2-market-dashboard` (overwrite existing files):

```
poe2-market-dashboard/
├── AGENT_NAVIGATION.md                                   # modified — added invariant #44, updated §4
├── STATUS.md                                             # modified — closed KI-10, added iter 94 row + TD-9
├── worklog.md                                            # modified — added iter 94 entry, trimmed iter 92
└── src/
    ├── __tests__/
    │   └── flips-helpers.test.ts                         # NEW — 16 unit tests (Q4 + Q5 helpers)
    ├── components/dashboard/
    │   ├── flips-helpers.ts                              # modified — SpreadTier type + classifySpreadTier + spreadTierColor + deriveTrendSparklineData + 3 constants
    │   ├── flips-tab.tsx                                 # modified — spreadTierFilter state + Select UI + filter logic
    │   └── flips-table.tsx                               # modified — GRID_COLS 18→19, color-coded Spread cell, Trend sparkline column, tooltips on Spread + Profit headers
    └── lib/i18n/locales/
        ├── en.ts                                         # modified — deleted 2 old keys (KI-10), added 7 new (iter 94)
        ├── ru.ts                                         # modified — same
        ├── zh.ts                                         # modified — same
        └── ko.ts                                         # modified — same
```

## How to merge

### Option A — Extract-and-overwrite (recommended)

```bash
# From your local clone root:
unzip -o iter94-poe2-market-dashboard.zip -d /tmp/iter94
cp -r /tmp/iter94/poe2-market-dashboard/* .
```

### Option B — Use git to apply changes

See `git_commands.txt` (or the chat message) for the full add/commit/push sequence.

## Verification after merge

```bash
npx tsc --noEmit           # Should exit 0 (no errors)
npx jest                   # Should pass 428/428 (was 412/412 before iter 94)
```

If `tsc --noEmit` fails with TS1117 on `flipsBid` / `flipsAsk`, the merge was incomplete — re-check that the old "Bid"/"Ask" entries (lines ~379-380) were deleted from all 4 locale files.

## What this iteration does NOT include

- **iter 95 (Overheat Index)** — deferred. Needs TD-2 fix first (`content_pulse._category_today_volume` must use `volume_traded` not `current_quantity`).
- **iter 96 (Triangular persistence)** — deferred. Adds SQLite for executable_estimate backtesting (TD-3 + TD-4).
- **TD-9 (real FlipsTable sparkline data)** — opened as tech debt. Backend must add `priceHistoryShort?: { timestamp: string; price: number }[]` to `FlipOpportunity` for the Trend column to switch from derived indicator to real recent prices. UI is already wired — only `flips-helpers.ts:deriveTrendSparklineData` needs to be replaced with a passthrough.

## Stop point — what was done in iter 94

- ✅ KI-10 closed (duplicate i18n keys deleted from 4 locale files, `tsc --noEmit` now green)
- ✅ Q4 (Spread tier colors + filter) — color-coded Spread cell + Spread tier Select dropdown
- ✅ Q5 (Trend sparkline) — derived from momentum × volatility, HONESTLY labeled, TD-9 opened for real data
- ✅ Q6 (Intuitive labels) — spread-capture-intent tooltips on Spread + Profit columns
- ✅ 16 new jest tests, 428/428 total green
- ✅ 7 new i18n keys × 4 locales = 28 new lines
- ✅ Documentation updated (STATUS.md + AGENT_NAVIGATION.md + worklog.md)

## Next iteration (iter 95) — recommended priorities

1. **iter 95 = Overheat Index** (Q13 — indirect signals: streamer influence → volume spike → price drop). Uses `volume_traded` not `current_quantity` (TD-2 fix). Backend `content_pulse._category_today_volume()` needs to switch metric.
2. **iter 96 = Triangular persistence** (TD-3 + TD-4 — SQLite for executable_estimate backtesting + market_spread persistence).
3. **iter 97+ = Proposal F-J exposition** (Wall detection UI, OHLCV candlestick, cross-pair correlation, liquidity-tier UI, real FlipsTable sparkline via TD-9).
