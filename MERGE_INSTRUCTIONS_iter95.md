# MERGE INSTRUCTIONS — iter 95

> **Archive:** `iter95-changes.tar.gz`
> **Source:** https://github.com/vudirvp-sketch/poe2-market-dashboard
> **Created:** 2026-06-26 (iter 95 — TD-2 fix + Overheat Index Q13)
> **Files in archive:** 13 (10 source/test + 3 docs)

## What this iter does

1. **Closes TD-2** — `content_pulse._category_today_volume()` now uses `volume_traded` (24h trade activity from `snapshot.exchange_rates`) instead of `current_quantity` (listings snapshot count). The new metric is semantically consistent with `rolling_7d` / `rolling_30d` (which already use `price_logs[].Quantity` — also an activity metric). Previously `delta_7d_pct` compared SUPPLY to ACTIVITY — meaningless for overheat detection.

2. **Implements Q13 Overheat Index** — composite signal for the post-streamer pattern (streamer showcases category → volume spikes → prices drop as spike fades). New backend fields per category: `overheat_index` (0-100), `overheat_signal` (`hot`/`warm`/`cool`), `volume_spike_ratio`, `price_change_pct`. New UI: orange "Overheated" / amber "Warming up" badge on Content Pulse categories (only when signal ≠ "cool"), with tooltip showing the breakdown.

## How to merge

The archive preserves the directory structure of the repo. Extract over your local copy:

```bash
# From the root of your local poe2-market-dashboard clone:
tar -xzf /path/to/iter95-changes.tar.gz
```

This will overwrite the 13 files listed below. No new files are created. No deletions required.

## Files changed (13 total)

### Backend (2 source + 1 test)
- `backend/economy/content_pulse.py` — TD-2 fix (`_build_currency_volume_map` + `_category_today_volume(items, volume_map)` signature) + 4 new Overheat Index helpers + Overheat fields in `compute_content_pulse` response
- `backend/api/response_models.py` — 4 new fields on `ContentPulseCategoryData` (`overheat_index`, `overheat_signal`, `volume_spike_ratio`, `price_change_pct`)
- `tests/test_content_pulse.py` — 38 new tests + updated helpers + updated 5 existing tests for new `volume_traded` semantics

### Frontend (6 source + 1 test)
- `src/lib/types.ts` — 4 new fields on `ContentPulseCategory` (`overheatIndex`, `overheatSignal`, `volumeSpikeRatio`, `priceChangePct`)
- `src/lib/i18n/locales/en.ts` — 4 new keys (`contentPulseOverheatBadge`, `contentPulseOverheatTooltip`, `contentPulseOverheatWarmBadge`, `contentPulseOverheatWarmTooltip`)
- `src/lib/i18n/locales/ru.ts` — same 4 keys (Russian)
- `src/lib/i18n/locales/zh.ts` — same 4 keys (Chinese)
- `src/lib/i18n/locales/ko.ts` — same 4 keys (Korean)
- `src/components/dashboard/content-pulse-widget.tsx` — Overheat badge in `CategoryBlock` + `Flame` import from lucide-react
- `src/__tests__/content-pulse-widget.test.tsx` — `COOL_OVERHEAT` spread helper + 4 new tests + updated fixtures

### Docs (3)
- `STATUS.md` — closed TD-2, added iter 95 row, 2 new Quick Reference rows
- `AGENT_NAVIGATION.md` — invariant #45, updated `content_pulse.py` row in §1, updated §4 Known Issues, 2 new Quick Reference rows
- `worklog.md` — iter 95 entry (trimmed iter 93 — its feature is fully shipped)

## Verification (run after merge)

```bash
# Backend tests (content_pulse specifically + full suite)
python -m pytest tests/test_content_pulse.py -q          # 82/82 expected
python -m pytest tests/ --ignore=tests/e2e --ignore=tests/test_scheduler.py -q
# Expected: 795 passed
# (test_scheduler.py is skipped — requires `pip install aiosqlite`, pre-existing env issue documented in STATUS.md)

# Frontend
npx tsc --noEmit                                          # 0 errors expected
npx jest --no-coverage                                    # 432/432 expected
```

## Git commands

```bash
git add AGENT_NAVIGATION.md STATUS.md worklog.md \
        backend/api/response_models.py \
        backend/economy/content_pulse.py \
        src/__tests__/content-pulse-widget.test.tsx \
        src/components/dashboard/content-pulse-widget.tsx \
        src/lib/i18n/locales/en.ts \
        src/lib/i18n/locales/ko.ts \
        src/lib/i18n/locales/ru.ts \
        src/lib/i18n/locales/zh.ts \
        src/lib/types.ts \
        tests/test_content_pulse.py

git commit -m "iter 95: TD-2 fix + Overheat Index (Q13)

TD-2 (closed): content_pulse._category_today_volume() now uses
volume_traded (24h activity from snapshot.exchange_rates) instead
of current_quantity (listings snapshot count, a SUPPLY metric).
Semantically consistent with rolling_7d/30d (also activity metrics).
Previously delta_7d_pct compared SUPPLY to ACTIVITY — meaningless
for overheat detection.

Q13 Overheat Index (new):
- _build_currency_volume_map(snapshot) — per-currency volume_traded
  aggregated from snapshot.exchange_rates (attributed to BOTH sides
  of each pair).
- _category_price_change_pct(items) — mean per-item % price change.
- _overheat_signal(ratio, pct) → 'hot' | 'warm' | 'cool'.
  Thresholds: OVERHEAT_VOLUME_SPIKE_THRESHOLD=2.0,
              OVERHEAT_PRICE_DROP_THRESHOLD=-5.0 (both strict).
- _overheat_index_score(ratio, pct) → 0-100 composite.
  vol_component = clamp((ratio-1)*25, 0, 100)
  price_component = clamp(-pct*4, 0, 100)
  score = (vol + price) / 2.
- 4 new fields on ContentPulseCategoryData (Pydantic) and
  ContentPulseCategory (TypeScript, camelCase via transformKeys).
- UI: orange 'Overheated' / amber 'Warming up' badge on Content
  Pulse categories when overheat_signal != 'cool'. Tooltip shows
  overheat_index / volume_spike_ratio / price_change_pct breakdown.
- 4 new i18n keys × 4 locales = 16 lines.

Tests:
- tests/test_content_pulse.py: 44 → 82 (38 new). Updated helpers
  (_make_currency + volume_traded, _make_snapshot + exchange_rates
  auto-build, _make_rate). Updated 5 existing integration tests
  for new volume_traded semantics. Added TestBuildCurrencyVolumeMap,
  TestCategoryPriceChangePct, TestOverheatSignal, TestOverheatIndexScore,
  TestComputeContentPulseOverheat (incl. TD-2 regression test).
- src/__tests__/content-pulse-widget.test.tsx: 428 → 432 (4 new).
  COOL_OVERHEAT spread helper for existing fixtures + 4 new tests
  for hot/warm/cool badge rendering + coexistence with delta badge.

Verification:
- pytest tests/ (excl e2e + test_scheduler): 795/795 green.
- npx tsc --noEmit: 0 errors.
- npx jest: 432/432 green.

Docs:
- STATUS.md: closed TD-2, iter 95 row, 2 Quick Reference rows.
- AGENT_NAVIGATION.md: invariant #45, updated content_pulse.py row,
  updated Known Issues section, 2 Quick Reference rows.
- worklog.md: iter 95 entry, trimmed iter 93 (shipped)."

git push origin main
```

## Stopping point for next iter (iter 96)

**iter 95 SHIPPED — TD-2 closed + Overheat Index (Q13) backend + UI all addressed.**

**Next iteration (iter 96) — Triangular persistence (TD-3 + TD-4):**
1. Add SQLite persistence for triangular arbitrage cycles: `(cycle_hash, timestamp, profit_pct, snapshot_id)`. Add 30-min-later re-check so we can backtest `executable_estimate` (fast/medium/slow formula). This is a PREREQUISITE for executable_estimate (iter 90 ERROR #4).
2. Persist `market_spread` to HistoricalStore (TD-4) — enables spread-over-time analysis.
3. See AGENT_NAVIGATION.md invariant #42(d) + invariant #45(i) for full context.

**iter 97+ — Proposal F-J exposition** (data already collected, just need UI):
- F = Wall detection (`highest_stock/current_quantity > 0.3`) — TD-6
- G = OHLCV from `DailyStatsHistory` (endpoint exists, not used) — TD-5
- H = Cross-pair volume correlation (from `price_logs`)
- I = Spread persistence (covered by TD-4 in iter 96)
- J = Liquidity-tier UI (`tiers.py` already computes T1-T5 per currency) — TD-8
- Plus TD-9 (real FlipsTable sparkline when backend adds `priceHistoryShort`)

**Optional iter 95b (polish, low priority):**
- If real-world data shows the overheat thresholds (2.0x spike / -5% drop) need tuning, promote `OVERHEAT_VOLUME_SPIKE_THRESHOLD` + `OVERHEAT_PRICE_DROP_THRESHOLD` to `config.yaml`.
- Consider weighting `price_change_pct` by `volume_traded` (currently unweighted mean).
