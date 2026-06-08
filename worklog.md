# Worklog

---
Task ID: 10
Agent: main
Task: v1.14 — Add ByCategory for idol/vaultkeys/delirium, verify flip logic vs fixtures, update docs

Work Log:
- Added ByCategory endpoints for idol, vaultkeys, delirium to `scripts/generate-cache-snapshot.ts` (3 new fetch entries, total 14→17 endpoints)
- Added ByCategory fetching for idol, vaultkeys, delirium to `scripts/dump-live-data.ts` (loop expanded from 2 to 5 categories)
- Created `scripts/verify-flips-vs-fixtures.py` — offline verification script that checks:
  (a) all 5 item categories present in fixture pairs ✓
  (b) BestPaymentBadge correctly finds savings for Omens/Soul Cores (up to 86% paying in Exalted vs Chaos) ✓
  (c) fixture consistency (categories.json labels match) ✓
  (d) vaultkeys label = "Reliquary Keys" ✓
- Updated AGENT_NAVIGATION.md to v1.14: marked TODO #3 done, updated TODO list, added Frequent Bug #22, added verify script to commands

Stage Summary:
- Modified: scripts/generate-cache-snapshot.ts, scripts/dump-live-data.ts, AGENT_NAVIGATION.md
- Created: scripts/verify-flips-vs-fixtures.py
- Next iteration needs: regenerate cache-snapshot.json with VPN, run backend+frontend for live flip verification, generate bycategory fixtures for idol/vaultkeys/delirium
