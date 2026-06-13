# Work Log

---
Task ID: 49
Agent: Main Agent
Task: Fix E2E tests, add Python PhaseDetector tests, expand E2E coverage

Work Log:
- Fixed openEventsSidebar() in e2e/events-sidebar.spec.ts
  - Root cause: Events button is inside "More" dropdown menu, not a standalone button
  - Fix: click "More" (⋮) button first, then click Events menu item
  - Also fixed health mock: changed status from "online" to "ok" (dashboard checks status === "ok")
  - Added waitForLoadState("networkidle") in beforeEach
  - Improved Sheet selector: use heading text instead of generic [role="dialog"]
  - Replaced fragile .fill-emerald-500 selector with text-based online indicator check
- Added 2 new E2E tests (total now 7, was 5):
  - "delete an existing event" — verifies delete button click and API mock
  - "form validation — empty description shows error" — verifies create button is disabled when description is empty
- Added 5 new Python tests for PhaseDetector in tests/test_lifecycle.py (total now 15, was 10):
  - test_league_start_does_not_reset_phase
  - test_economy_shift_does_not_reset_phase
  - test_minor_patch_does_not_reset_phase
  - test_streamer_hype_does_not_reset_phase
  - test_only_major_patch_resets_phase
- Updated AGENT_NAVIGATION.md:
  - Updated e2e/events-sidebar.spec.ts description (7 tests, mentions More menu flow)
  - Added 2 E2E-related entries to Known Bugs table

Stage Summary:
- E2E tests: 7/7 passing (was 0/5)
- Jest tests: 291/291 passing (unchanged)
- Python tests: 347/347 passing (including 5 new PhaseDetector tests)
- All tests green
