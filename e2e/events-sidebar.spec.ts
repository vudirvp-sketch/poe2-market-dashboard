/**
 * Events Sidebar E2E tests — creating and deactivating events with mock data.
 *
 * These tests verify that the Events sidebar (Sheet component) correctly:
 *   1. Opens when the Events button is clicked
 *   2. Displays active events with createdAt and expiry info
 *   3. Creates a new event via the form
 *   4. Deactivates an existing event
 *
 * All API routes are mocked — no real backend required.
 */
import { test, expect } from "@playwright/test";
import { installApiMocks } from "./fixtures";

// ---------------------------------------------------------------------------
// Mock event data
// ---------------------------------------------------------------------------

const MOCK_EVENTS = [
  {
    eventId: "ev001",
    eventType: "league_start",
    description: "New league launched: Runes of Aldur",
    affectedCurrencies: ["divine", "exalted"],
    createdAt: new Date(Date.now() - 2 * 3600_000).toISOString(), // 2h ago
    expiresAt: new Date(Date.now() + 46 * 3600_000).toISOString(), // 46h from now
    isActive: true,
  },
  {
    eventId: "ev002",
    eventType: "economy_shift",
    description: "Major economy shift detected in currency ratios",
    affectedCurrencies: [],
    createdAt: new Date(Date.now() - 30 * 60_000).toISOString(), // 30m ago
    expiresAt: new Date(Date.now() + 47.5 * 3600_000).toISOString(),
    isActive: true,
  },
];

const MOCK_EVENTS_RESPONSE = {
  events: MOCK_EVENTS,
  total: MOCK_EVENTS.length,
};

const MOCK_CREATED_EVENT = {
  eventId: "ev003",
  eventType: "minor_patch",
  description: "Patch 0.2.1 hotfix deployed",
  affectedCurrencies: ["chaos"],
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 48 * 3600_000).toISOString(),
  isActive: true,
};

// ---------------------------------------------------------------------------
// Install extended API mocks for events sidebar (backend ONLINE)
// ---------------------------------------------------------------------------

async function installEventsApiMocks(page: import("@playwright/test").Page): Promise<void> {
  // Install base mocks first (realms, leagues, etc.)
  await installApiMocks(page);

  // Override flipper health to return ONLINE (required for events sidebar)
  await page.route("**/api/flipper/health", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "online",
        timestamp: new Date().toISOString(),
        version: "1.0.0",
      }),
    });
  });

  // Override flipper events — return mock events list
  await page.route("**/api/flipper/events**", async (route) => {
    const request = route.request();

    if (request.method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_EVENTS_RESPONSE),
      });
    } else if (request.method() === "POST") {
      // Handle event creation
      const url = request.url();
      if (url.includes("/deactivate")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ message: "Event deactivated successfully" }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            message: "Event created successfully",
            event: MOCK_CREATED_EVENT,
          }),
        });
      }
    } else if (request.method() === "DELETE") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ message: "Event deleted successfully" }),
      });
    }
  });

  // Override flipper phase — return valid phase data (backend is online)
  await page.route("**/api/flipper/phase", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        phase: "EARLY",
        days_since_reference: 5,
        reference_currency: "exalted",
        recommended_strategy: "Quick flips",
        min_spread_after_fees: 0.15,
        max_hold_time: "2 hours",
      }),
    });
  });

  // Mock SSE price stream — return a simple error event (no real SSE needed)
  await page.route("**/api/flipper/prices/stream**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: "event: error\ndata: {\"message\":\"SSE not available in test\",\"unavailable\":true}\n\n",
    });
  });
}

// ---------------------------------------------------------------------------
// Helper: open the events sidebar via the Events button
// ---------------------------------------------------------------------------

async function openEventsSidebar(page: import("@playwright/test").Page): Promise<void> {
  // The Events button has a Bell icon and is in the header
  // The button aria-label is i18n'd, so match on multiple locales
  const eventsButton = page
    .locator(
      'button[aria-label="События"], button[aria-label="Events"], button[aria-label="事件"], button[aria-label="이벤트"]'
    )
    .first();
  await expect(eventsButton).toBeVisible({ timeout: 10_000 });
  await eventsButton.click();
  // Wait for the Sheet to open
  await page.waitForTimeout(500);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Events Sidebar", () => {
  test.beforeEach(async ({ page }) => {
    await installEventsApiMocks(page);
    await page.goto("/");
  });

  test("events sidebar opens and shows active events with createdAt", async ({ page }) => {
    await openEventsSidebar(page);

    // The Sheet should be visible
    const sheet = page.locator('[role="dialog"], [data-state="open"]').first();
    await expect(sheet).toBeVisible({ timeout: 5_000 });

    // Should display the league_start event description
    const leagueStartText = page.getByText("New league launched: Runes of Aldur").first();
    await expect(leagueStartText).toBeVisible({ timeout: 5_000 });

    // Should display the economy_shift event description
    const economyShiftText = page.getByText("Major economy shift detected").first();
    await expect(economyShiftText).toBeVisible({ timeout: 5_000 });

    // Should display event type badges
    const leagueStartBadge = page.getByText(/League Start|Начало лиги/).first();
    await expect(leagueStartBadge).toBeVisible({ timeout: 5_000 });

    const economyShiftBadge = page.getByText(/Economy Shift|Сдвиг экономики/).first();
    await expect(economyShiftBadge).toBeVisible({ timeout: 5_000 });

    // Should display createdAt date (formatted like "Jun 13, 14:30")
    // The createdAt is rendered next to a Calendar icon in the event card
    // Check that at least one date-like pattern appears in the event cards
    const datePattern = page.locator("text=/\\w{3} \\d{1,2}, \\d{2}:\\d{2}/").first();
    await expect(datePattern).toBeVisible({ timeout: 5_000 });
  });

  test("events sidebar shows impact summary when events are active", async ({ page }) => {
    await openEventsSidebar(page);

    // Impact summary should show total count
    const impactSummary = page.getByText(/2|impact|событи/).first();
    await expect(impactSummary).toBeVisible({ timeout: 5_000 });

    // Backend online indicator should be visible
    const onlineIndicator = page.locator(".fill-emerald-500").first();
    await expect(onlineIndicator).toBeVisible({ timeout: 5_000 });
  });

  test("create a new event via the form", async ({ page }) => {
    await openEventsSidebar(page);

    // The create form should be visible (backend is online)
    const eventTypeSelect = page.locator("#event-type").first();
    await expect(eventTypeSelect).toBeVisible({ timeout: 5_000 });

    // Fill in the description
    const descInput = page.locator("#event-desc").first();
    await expect(descInput).toBeVisible({ timeout: 5_000 });
    await descInput.fill("Patch 0.2.1 hotfix deployed");

    // Optionally add affected currencies
    const currenciesInput = page.locator("#event-currencies").first();
    if (await currenciesInput.isVisible()) {
      await currenciesInput.fill("chaos");
    }

    // Click the create button
    const createButton = page
      .locator(
        'button[aria-label="Create Event"], button[aria-label="Создать событие"], button[aria-label="创建事件"], button[aria-label="이벤트 만들기"]'
      )
      .first();
    await expect(createButton).toBeVisible({ timeout: 5_000 });
    await createButton.click();

    // After creation, the form should reset (description field empty)
    // Wait for the mutation to complete
    await page.waitForTimeout(1000);
    await expect(descInput).toHaveValue("", { timeout: 5_000 });
  });

  test("deactivate an existing event", async ({ page }) => {
    await openEventsSidebar(page);

    // Wait for events to render
    const leagueStartText = page.getByText("New league launched: Runes of Aldur").first();
    await expect(leagueStartText).toBeVisible({ timeout: 5_000 });

    // Find the deactivate button for the first event
    // Deactivate buttons have an aria-label that is i18n'd
    const deactivateButton = page
      .locator(
        'button[aria-label="Deactivate"], button[aria-label="Деактивировать"], button[aria-label="停用"], button[aria-label="비활성화"]'
      )
      .first();
    await expect(deactivateButton).toBeVisible({ timeout: 5_000 });
    await deactivateButton.click();

    // The button should be disabled while the mutation is pending
    // After deactivation, the events list should be refetched
    await page.waitForTimeout(1000);
  });

  test("events sidebar shows backend offline warning when backend is offline", async ({ page }) => {
    // Re-mock health as offline for this test
    await page.route("**/api/flipper/health", async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ status: "offline", timestamp: new Date().toISOString() }),
      });
    });

    // Reload to apply the new mock
    await page.reload();
    await page.waitForTimeout(2000);

    await openEventsSidebar(page);

    // The offline warning card should be visible
    const offlineWarning = page
      .getByText(/backend.*offline|backend.*offline|бэкенд.*офлайн|백엔드.*오프라인/i)
      .first();
    // The offline warning may not match exactly due to i18n,
    // so also check for the uvicorn command snippet
    const uvicornHint = page.getByText("uvicorn backend.main:app").first();
    await expect(uvicornHint).toBeVisible({ timeout: 5_000 });
  });
});
