# Worklog — PoE2 Market Dashboard

> Append-only shared multi-agent work log. Each section starts with `---`.
> Old task history is in `git log`.

Recent iterations kept (iter 89+). Older iter 77-88 records trimmed — those features are fully shipped and documented in PRODUCT_VISION.md / STATUS.md / AGENT_NAVIGATION.md. For full iter 88/89 detail see git log.

---
Task ID: iter-89
Agent: main (Sonnet 4.5)
Task: iter 89 — Dead i18n key cleanup + KI-6 shortcuts dialog mismatch fix.

Stage Summary:
- 30 dead i18n keys × 4 locales = 120 dead lines removed. KI-6 fixed (shortcuts dialog now matches TAB_MAP). Pre-existing limitation documented: liquid-chain + watchlist NOT keyboard-reachable. Tests: 768 pytest + 412 jest pass — same as iter 88 (no new testable behavior).
- Files changed (9 total): `shortcuts-dialog.tsx`, 4 i18n locale files, `e2e/navigation.spec.ts`, 3 docs (STATUS / AGENT_NAVIGATION / worklog), 3 helper scripts under `scripts/`.

---
Task ID: iter-90
Agent: main (Sonnet 4.5)
Task: iter 90 — Pure recon & planning iteration (NO code changes, NO archive, NO git commits — per user instruction "ПРОСТО анализ проведи и планирование").

Stage Summary:
- Audited 11 live tabs + 1 sub-component (ArbitrageFlipperTriangular inside Flips). Described both flip scenarios (cross-currency optimal purchase + spread capture). Explained cross-rate inconsistency (2 thresholds: 10% backend / 5% frontend) and triangular arbitrage (Bellman-Ford + integer simulation + cross-rate filter). Proposed 5 overheat analytics features (Proposal A-E). Asked 14 clarifying questions (Q1-Q14). Drafted iter 91-96 plan.
- **No code changes, no archive, no git commits** — by design. Pure chat output.

---
Task ID: iter-91
Agent: main (Sonnet 4.5)
Task: iter 91 — Recon refinement: critique iter 90 + deep-dive POE2Scout API + refine iter 91+ plan. User asked "Со всем согласен? Дополнить нечем? Улучшить, ошибки исправить?" and "ясно уясни для себя что ты можешь извлекать по api из данных и в каком виде". Then asked for: archive + upload to tmpfiles.org + git commands + stop point.

Work Log:
- Cloned repo to `/home/z/my-project/work/poe2-market-dashboard`. Read: `STATUS.md`, `AGENT_NAVIGATION.md` (invariant #41), `worklog.md` (iter 89 stage summary).
- **POE2Scout API deep-dive:** read full `backend/data/providers/poe2scout.py` (934 lines) + `backend/data/schemas.py` (293 lines) + `backend/api/data_snapshot.py` (DataSnapshot pattern, ~16 API calls per 5-min cycle) + `backend/economy/content_pulse.py` (352 lines) + `backend/api/routes_arbitrage.py` (lines 1-200 + 700-1000). Catalogued **12 POE2Scout endpoints** + **8 free-data fields** (already collected by DataSnapshot) + **5 not-available data points** (real trade count, order book depth, individual bid/ask per order, seller identifiers, real-time push).
- **Frontend verification of iter 90 claims:** read `dashboard-page.tsx:536` (TAB_MAP confirmed 13 entries incl. 2 dead), `store.ts:148-152` (validTabs confirmed stale: arbitrage/forecast/portfolio/graph), `flips-table.tsx:120-375` (confirmed 12 columns, missing volume24h/bid/ask/deviationPct/fairRate), `watchlist-tab.tsx:148-150` (confirmed pnl sorts by changePercent — duplicate of change column), `speculation-tab.tsx:195-255` (confirmed Sparkline exists, both local + shared `./sparkline` versions), `lib/types.ts:160-220` (confirmed FlipOpportunity type has all 5 hidden fields).
- **iter 90 critique — confirmed 6 findings:** (1) dead TAB_MAP slots, (2) hidden backend fields in FlipsTable, (3) pnl/change duplicate in Watchlist, (4) two cross-rate thresholds (10% backend / 5% frontend), (5) Sparkline already exists, (6) `relative_price` semantics described.
- **iter 90 critique — found 5 ERRORS:**
  - **E1:** iter 90 described `relative_price` as per-pair. REALITY: per-currency vs BASE (Exalted). Cross-rate = `from_rel / to_rel`, NOT `from_pair.relative_price / to_pair.relative_price`.
  - **E2:** iter 90 mixed `current_quantity` (listings count = supply snapshot) with `volume_traded` (24h trade volume = activity). `content_pulse._category_today_volume` uses `current_quantity` — wrong metric for "overheat" detection.
  - **E3:** iter 90 said "no `delta_24h_pct`". REALITY: `find_price_24h_ago` already exists in `pricing.py`, used by `routes_analyst.py`. Adding `volume_24h_delta_pct` to `/content-pulse` is a 10-line change, not a new endpoint.
  - **E4:** iter 90 proposed `executable_estimate: fast/medium/slow` for triangular arbitrage. REALITY: cannot build formula without backtesting data. Must add SQLite persistence first (TD-3, iter 96).
  - **E5:** iter 90 flagged `CURRENCY_DISPLAY_NAMES` hardcode in `optimizer-tab.tsx` as duplication. REALITY: intentional fallback — `getCurrencyDisplayName` returns `null` for unmapped currencies; hardcode prevents UI from showing raw `api_id`.
- **5 new Proposals F-J** (all use data already collected by DataSnapshot, just need exposition):
  - **F:** Wall detection (`highest_stock / current_quantity > 0.3` = one seller holds >30% of listings)
  - **G:** OHLCV from `DailyStatsHistory` (POE2Scout endpoint exists, project doesn't use it — `pair-detail-dialog.tsx` candlestick is synthetic)
  - **H:** Cross-pair volume correlation (from existing `price_logs`, 90-day retention)
  - **I:** Spread persistence (add `market_spread` to HistoricalStore, 5-min bucket, 30 days)
  - **J:** Liquidity-tier UI (`tiers.py` already computes T1-T5 per currency, never shown)
- **Refined iter 91-97 plan** — key changes vs iter 90:
  - **iter 91** adds `validTabs` cleanup in `store.ts` (iter 90 forgot)
  - **iter 95** Overheat Index uses `volume_traded` (NOT `current_quantity` — iter 90 had wrong formula)
  - **iter 96** triangular persistence is PREREQUISITE for executable_estimate (iter 90 wanted to skip)
  - **iter 97+** adds Proposal F-J (iter 90 didn't see these opportunities)
- **3 new Known Issues documented:**
  - **KI-7:** TAB_MAP has 2 dead slots (`"arbitrage"` idx 4, `"graph"` idx 11). Shortcut "5" silently does nothing.
  - **KI-8:** `watchlist-tab.tsx:148-150` `pnl` column sorts identically to `change` column.
  - **KI-9:** Cross-rate inconsistency uses 2 thresholds (10% backend / 5% frontend) + `affectedCurrencies` not truncated.
- **8 new Tech Debt items documented:**
  - **TD-1:** FlipsTable hides 5 backend-computed fields (volume24h, bid, ask, fairRate, deviationPct).
  - **TD-2:** `content_pulse._category_today_volume` uses `current_quantity` (listings) instead of `volume_traded` (24h trades).
  - **TD-3:** Triangular arbitrage has no persistence — cannot backtest executable_estimate.
  - **TD-4:** `market_spread` not persisted in HistoricalStore.
  - **TD-5:** `DailyStatsHistory` POE2Scout endpoint (ready OHLCV) not used.
  - **TD-6:** `highest_stock` + `current_quantity` not used for Wall detection.
  - **TD-7:** `PriceMomentumTracker` momentum + volatility computed but not shown in UI.
  - **TD-8:** Tier classification (T1-T5 from `tiers.py`) not shown anywhere.
- **Documentation updated (3 files):**
  - `STATUS.md`: bumped "Last updated" to iter 91. Added KI-7/8/9 + TD-1 through TD-8. Added iter 90 + iter 91 rows in Product Features table. Added 7 new Quick Reference symptom rows. Trimmed iter 88 stage summary (kept only iter 89+ in worklog).
  - `AGENT_NAVIGATION.md`: bumped "Last updated" to iter 91. Added invariant #42 (iter 91 recon patterns — 10 sub-sections a-j: relative_price semantics, current_quantity vs volume_traded, find_price_24h_ago exists, executable_estimate requires persistence, CURRENCY_DISPLAY_NAMES is intentional fallback, 12 API endpoints, 8 free-data fields, 5 not-available data points, 5 new Proposals F-J, refined iter 91-97 plan). Updated §4 Known Issues intro to reference new KIs + TDs.
  - `worklog.md`: trimmed iter 88 (now 3 iterations old — see git log). Trimmed iter 89 to Stage Summary (was full detail). Added iter 90 + iter 91 records.

Stage Summary:
- **iter 91 SHIPPED — recon refinement (NO code changes, NO tests, NO archive of code, NO git commits to source code).** Pure planning + documentation update. User explicitly said "не генерируй докс и пдф, просто текстом в чат" — main analysis is in chat. Documentation updated per user's standard requirement "После выполнения: обнови документацию, упакуй результат в архив, загрузи на tmpfiles.org, git-команды, точка остановки".
- **3 new KIs (7/8/9) + 8 new TDs (1-8) documented** in STATUS.md for future iter 91+ implementation work.
- **5 new Proposals F-J** added to roadmap — all leverage data already collected by DataSnapshot (no new API calls needed).
- **Files changed (3 total — documentation only):** `STATUS.md`, `AGENT_NAVIGATION.md`, `worklog.md`.

Next iteration (iter 92) — recommended priorities (refined plan, awaiting user's answers to iter 90 Q1-Q14):
1. **iter 92 = iter 91 plan implementation** (cleanup + low-hanging fruit, 1-2 days): remove dead TAB_MAP slots + cleanup validTabs, add 5 columns to FlipsTable, fix Watchlist pnl duplicate, truncate cross_rate_warning.affectedCurrencies, unify cross-rate threshold to 7%.
2. **iter 93 = Best Payment primary view** (per user's flip point 1 — Hinakora's Hair example).
3. **iter 94 = Spread Capture view** (per user's flip point 2 — buy 80 / sell 100 example).
4. **iter 95 = Overheat Index + Wall Detection** (per user's "перегретые рынки" request).
5. **iter 96 = Spread persistence + triangular persistence** (TD-3 + TD-4).
6. **iter 97+ = Proposal F-J exposition** (Wall detection UI, OHLCV candlestick, cross-pair correlation, liquidity-tier UI).

User's iter 90 Q1-Q14 still unanswered — these will determine exact iter 92-95 scope. See iter 90 chat output for the 14 questions.
