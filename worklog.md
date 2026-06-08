# Worklog

---
Task ID: 8
Agent: main
Task: v1.12 — Expand item_categories, improve snapshot generation, add tests, create live data dump utility

Work Log:
- Expanded `item_categories` in config.yaml: added idol, vaultkeys, delirium (pending live verification)
- Expanded `item_categories` in backend/config.py: same additions with comments
- Expanded `ITEM_CATEGORIES` in src/lib/currency-optimal.ts: same additions with comments
- Improved generate-cache-snapshot.ts: added ByCategory endpoints for ritual/ultimatum categories
- Improved generate-cache-snapshot.ts: SnapshotPairs truncation now prioritizes item-category pairs
- Added backend tests: 5 new tests in TestItemAwareGrouping class (test_optimal_currency.py)
- Created frontend tests: src/__tests__/currency-optimal.test.ts with 20+ tests
- Created scripts/dump-live-data.ts: utility for generating JSON test fixtures from live API (requires VPN)
- Updated AGENT_NAVIGATION.md to v1.12
- Updated worklog.md

Stage Summary:
- Modified: config.yaml, backend/config.py, src/lib/currency-optimal.ts, scripts/generate-cache-snapshot.ts, tests/test_optimal_currency.py, AGENT_NAVIGATION.md, worklog.md
- Created: src/__tests__/currency-optimal.test.ts, scripts/dump-live-data.ts
- All backend tests pass: 40/40 (pytest test_optimal_currency.py)
- Item categories now include: ritual, ultimatum, idol, vaultkeys, delirium
