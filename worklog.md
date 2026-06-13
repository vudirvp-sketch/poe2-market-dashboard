# Work Log

---
Task ID: 48
Agent: Main Agent
Task: Create use-price-stream.ts hook, render createdAt in events-sidebar, add E2E tests for events sidebar, verify PhaseDetector for league_start/economy_shift

Work Log:
- Created src/hooks/use-price-stream.ts — SSE consumer hook that connects to /api/flipper/prices/stream
  - Accepts { enabled, backendOnline, invalidationThresholdPct }
  - Returns { status, lastError, reconnectCount }
  - Invalidates React Query caches (flipperPrices, flipperFlips, heatmap, etc.) on price changes >= threshold
  - Auto-reconnect with exponential backoff, circuit breaker for never-connected state
  - Respects backendOnline transitions (close on offline, reconnect on recovery)
- Updated events-sidebar.tsx — added createdAt rendering
  - Added formatCreatedAt() helper (compact date format: "Jun 13, 14:30")
  - Modified event card layout: createdAt shown with Calendar icon, expiresAt shown below with i18n "Expires" label
  - Added "eventsExpires" i18n key to all 4 locales (en, ru, zh, ko)
- Created e2e/events-sidebar.spec.ts — Playwright E2E tests for events sidebar
  - installEventsApiMocks() helper — mocks flipper health as online, events with mock data (league_start + economy_shift)
  - Test: sidebar opens and shows active events with createdAt
  - Test: impact summary visible when events are active
  - Test: create a new event via the form
  - Test: deactivate an existing event
  - Test: backend offline warning shown when backend is offline
- Verified PhaseDetector handling of league_start and economy_shift
  - league_start: used only at PhaseDetector init (from config), NOT reset via event creation
  - economy_shift: not handled by PhaseDetector at all — affects scoring via EventManager.get_event_score_penalty()
  - major_patch: only type that resets PhaseDetector (by design per spec)
  - Conclusion: current behavior is correct — documented in AGENT_NAVIGATION.md rule 14
- Updated AGENT_NAVIGATION.md v14.0
  - Added use-price-stream.ts to directory table
  - Added e2e/events-sidebar.spec.ts entry
  - Added rule 14 about PhaseDetector event handling
  - Updated events-sidebar.tsx description (renders createdAt + expiresAt)
  - Added Playwright test command

Stage Summary:
- use-price-stream.ts created — fixes pre-existing TS error (imported but missing in dashboard-page.tsx)
- events-sidebar.tsx now renders createdAt in event cards with compact date format
- E2E tests for events sidebar added (5 tests covering open/create/deactivate/offline)
- PhaseDetector verification: league_start and economy_shift correctly handled (scoring only, no phase reset)
- Documentation updated and cleaned
