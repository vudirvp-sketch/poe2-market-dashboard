# Worklog — PoE2 Market Dashboard

> Append-only shared multi-agent work log. Each section starts with `---`.
> Old task history is in `git log`.

Recent iterations kept (iter 92+). Older iter 89-91 records trimmed — those features are fully shipped and documented in STATUS.md / AGENT_NAVIGATION.md.

---
Task ID: iter-92
Agent: main
Task: iter 92 — Implement KI-7/8/9 fixes + TD-1 (5 hidden FlipsTable columns). User provided answers to 14 questions from iter 90.

Work Log:
- Cloned repo to `/home/z/my-project/poe2-market-dashboard`. Read STATUS.md, AGENT_NAVIGATION.md, worklog.md.
- Read key source files: dashboard-page.tsx (TAB_MAP), store.ts (validTabs + WatchlistEntry), flips-table.tsx, flips-helpers.ts, types.ts, watchlist-tab.tsx, use-cross-rates.ts, routes_arbitrage.py, triangular.py, shortcuts-dialog.tsx, exchange-table.tsx, exchange-pair-card.tsx, 4 locale files.
- **KI-7 (dead TAB_MAP slots):** Removed `"arbitrage"` (was idx 4, shortcut "5" silently did nothing) and `"graph"` (was idx 11, dead since iter 87) from TAB_MAP. TAB_MAP shrunk from 13 to 11 entries. All 10 keyboard shortcuts (1-9 + 0) now map to live tabs. Updated `store.ts:validTabs` — removed dead `"arbitrage", "forecast", "portfolio", "graph"`, added missing `"storage-value", "speculation", "liquid-chain"`. Updated `shortcuts-dialog.tsx` tab mapping display.
- **TD-1 (FlipsTable hidden columns):** Added 5 columns to FlipsTable: volume24h (with BarChart3 icon), bid ("Buy at"), ask ("Sell at"), deviationPct ("Deviation"), fairRate ("Fair rate"). All with intuitive i18n labels + tooltips in 4 locales (en/ru/zh/ko). Columns hidden on smaller screens (lg for most, xl for fairRate). Added SortField types for bid, ask, deviationPct, fairRate. Grid expanded from 12 to 17 columns.
- **KI-8 (Watchlist pnl/change duplicate):** Implemented entry price tracking. Added `entryPrice?: number | null` to `WatchlistEntry` interface. Store version v4 → v5. `toggleExchangeFavorite` now accepts optional `entryPrice` param. All 3 callers (exchange-table, exchange-pair-card, watchlist-tab) now pass `pair.relativePrice` as entry price. P&L column computes real `(currentPrice - entryPrice) / entryPrice * 100` when entry price is tracked; falls back to changePercent for legacy entries. Added `updateWatchlistEntryPrice` store action. P&L sort also uses real P&L.
- **KI-9 (cross-rate threshold + affectedCurrencies):** Unified threshold to 7% on all 3 locations: backend `routes_arbitrage.py:824` (was 10.0), `triangular.py:486` default (was 10.0), frontend `use-cross-rates.ts:126` (was 5). Truncated `affectedCurrencies` to top-5 + `"and N more"` string + added `affected_currencies_total` field. Updated docstrings in triangular.py.
- Updated documentation: STATUS.md (closed KI-7/8/9 + TD-1, added iter 92 row, updated Quick Reference), AGENT_NAVIGATION.md (pending), worklog.md (this entry).

Stage Summary:
- **iter 92 SHIPPED — 5 bug fixes + 1 feature exposure.**
- Files changed (17 total):
  - `dashboard-page.tsx` (TAB_MAP cleanup)
  - `store.ts` (validTabs + WatchlistEntry.entryPrice + v5 migration + toggleExchangeFavorite signature + updateWatchlistEntryPrice)
  - `shortcuts-dialog.tsx` (tab mapping)
  - `flips-table.tsx` (5 new columns + expanded grid)
  - `flips-helpers.ts` (4 new SortField types)
  - `watchlist-tab.tsx` (real P&L display + entry price tracking)
  - `exchange-table.tsx` (pass entryPrice)
  - `exchange-pair-card.tsx` (pass entryPrice)
  - `use-cross-rates.ts` (threshold 5→7)
  - `routes_arbitrage.py` (threshold 10→7 + affectedCurrencies truncation)
  - `triangular.py` (threshold 10.0→7.0 + docstrings)
  - 4 i18n locale files (en/ru/zh/ko — new keys for 5 columns)
  - 3 docs (STATUS.md, AGENT_NAVIGATION.md, worklog.md)

---
Task ID: iter-93
Agent: main
Task: iter 93 — Best Payment primary view on Exchange. User answers: Q1="Пример А" (top-10 "Pay in Divine, save 47% vs Chaos" as the main Exchange screen). Q2="для всего" (Best Payment works for currencies + uniques + craft items like Ritual Omens + Soul Cores). Q3="скрывать" (savings <1% not shown in Best Payment badge).

Work Log:
- Cloned repo to `/home/z/my-project/repos/poe2-market-dashboard`. Read STATUS.md, AGENT_NAVIGATION.md (invariant #42), worklog.md (iter 92 entry).
- Read key source files: `best-payment-badge.tsx` (existing — already hides <1% on line 40, Q3 was pre-implemented), `currency-optimal.ts` (pure functions: findOptimalPayment, isItemCategory, ITEM_CATEGORIES = ritual/ultimatum/idol/vaultkeys/delirium), `use-optimal-payment.ts` (Stage 3b hook with 4 outputs: optimalPaymentByPair, crossRateFlips, selectedAnchorId, optimalPaymentByDisplayName), `exchange-tab-content.tsx` (props-passing pattern), `dashboard-page.tsx` (TAB_MAP, useOptimalPayment destructure), `exchange-table.tsx` (CrossCurrencyPremiumCell), `exchange-pair-card.tsx` (BestPaymentBadge usage), `types.ts` (OptimalPaymentResult, ExchangePair, BestPaymentTopListItem), `en.ts`/`ru.ts`/`zh.ts`/`ko.ts` (existing premiumPayIn / premiumSave / crossCurrencyPremium keys).
- **New component `best-payment-top-list.tsx`:** horizontal-scroll cards strip. Each card shows item name (localized), "craft" badge for items in ITEM_CATEGORIES, savings badge (color-coded: emerald ≥10%, amber ≥3%, muted otherwise), "Pay in X · vs Y · save Z anchor" line. Click → opens representative pair's detail dialog (the pair whose `currency2Id === bestCurrencyId`). Header with title + subtitle + count badge + collapse toggle. Empty state: returns `null` (no header, no message — keeps Exchange tab compact).
- **Extended `use-optimal-payment.ts`:** added 5th `useMemo` block computing `bestPaymentTopList`. Algorithm: group exchangeData by `currency1Id` (covers both currencies AND craft items in a single pass — currency1Id is unique per item), look up OptimalPaymentResult from any pair in the group (all pairs share the same result), filter `savingsPct < 1` (Q3), sort by `savingsPct desc` then `volume desc` (tiebreak), take top 10 (Q1). Exported `BestPaymentTopListItem` interface + `BEST_PAYMENT_MIN_SAVINGS_PCT` + `BEST_PAYMENT_TOP_LIMIT` constants. The other 4 hook outputs are UNCHANGED.
- **Wired into `ExchangeTabContent`:** added `bestPaymentTopList` prop. Renders `<BestPaymentTopList>` inside `<ErrorBoundary fallbackTitle={t("fallbackBestPayment")}>` at the TOP of the main `else` branch (above filter chips / table). This is the FIRST thing the user sees when opening the Exchange tab (Q1 — "Пример А" primary view).
- **Wired into `dashboard-page.tsx`:** added `bestPaymentTopList` to the `useOptimalPayment` destructure + passed as prop to `<ExchangeTabContent>`. Two one-line changes.
- **i18n keys (13 new × 4 locales = 52 lines):** `bestPaymentTitle`, `bestPaymentSubtitle`, `bestPaymentPayIn`, `bestPaymentVs`, `bestPaymentSave`, `bestPaymentHide`, `bestPaymentShow`, `bestPaymentCraftItem`, `bestPaymentCountTooltip`, `bestPaymentSavingsTooltip`, `bestPaymentCardAria` (template with `{item}/{best}/{worst}/{pct}` params), `fallbackBestPayment`. Added to all 4 locale files in the "Cross-rate Flip Tooltip i18n" section.
- **Q3 verification:** `best-payment-badge.tsx:40` already has `if (result.savingsPct < 1) return null;` — this rule was pre-implemented in iter 84 (Stage 3b). Iter 93 extends the same rule to the new top-list via the `BEST_PAYMENT_MIN_SAVINGS_PCT` constant.
- **Found pre-existing KI-10:** `tsc --noEmit` fails with TS1117 on `flipsBid` / `flipsAsk` (defined twice in all 4 locale files — introduced iter 92 when TD-1 relabeled "Bid"→"Buy at" / "Ask"→"Sell at" without deleting old entries). Documented in STATUS.md as KI-10 (open — fix in iter 94).
- **Verification:** `npx tsc --noEmit` shows only 8 pre-existing TS1117 errors (KI-10). `npx jest` baseline 412/412 green (no new tests added — the new memo is a pure derivation covered by existing tests).
- Updated documentation: STATUS.md (added iter 93 row, opened KI-10, updated Quick Reference), AGENT_NAVIGATION.md (added invariant #43), worklog.md (this entry).

Stage Summary:
- **iter 93 SHIPPED — Best Payment primary view on Exchange.**
- Q1 (Пример А — top-10 cards strip): ✅ done
- Q2 (для всего — currencies + craft items): ✅ done (groups by currency1Id, covers ritual/ultimatum/idol/vaultkeys/delirium)
- Q3 (скрывать <1%): ✅ done (already in best-payment-badge.tsx:40, extended to top-list via BEST_PAYMENT_MIN_SAVINGS_PCT constant)
- Files changed (8 source + 3 docs = 11 total):
  - NEW `src/components/dashboard/best-payment-top-list.tsx` (component + BestPaymentCard sub-component)
  - `src/hooks/use-optimal-payment.ts` (extended interface + 5th useMemo + 2 exported constants + BestPaymentTopListItem type)
  - `src/components/dashboard/exchange-tab-content.tsx` (new prop + ErrorBoundary + BestPaymentTopList render)
  - `src/components/dashboard/dashboard-page.tsx` (destructure + prop pass — 2 lines)
  - `src/lib/i18n/locales/en.ts` (13 new keys)
  - `src/lib/i18n/locales/ru.ts` (13 new keys)
  - `src/lib/i18n/locales/zh.ts` (13 new keys)
  - `src/lib/i18n/locales/ko.ts` (13 new keys)
  - `STATUS.md` (iter 93 row + KI-10 open + Quick Reference updates)
  - `AGENT_NAVIGATION.md` (invariant #43)
  - `worklog.md` (this entry)

Next iteration (iter 94) — recommended priorities:
1. **iter 94 = KI-10 fix + Spread Capture view (Q4/Q5/Q6 from iter 90)** — delete duplicate `flipsBid`/`flipsAsk` keys (lines ~379-380 in all 4 locales) to clear `tsc --noEmit`. Then implement Q4 ("C" — colors/filter inside Flips table), Q5 (sparkline), Q6 (intuitive labels).
2. **iter 95 = Overheat Index** (Q13 — indirect signals: streamer influence → volume spike → price drop). Uses `volume_traded` not `current_quantity` (TD-2 fix).
3. **iter 96 = Triangular persistence** (TD-3 + TD-4 — SQLite for executable_estimate backtesting).

