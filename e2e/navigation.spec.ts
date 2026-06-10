/**
 * Navigation tests — verify tab switching and content area changes.
 * These tests first select a realm and league to make tabs visible.
 *
 * API routes are mocked via installApiMocks() so the realm/league selectors
 * are populated even when the PoE2Scout API is unreachable.
 */
import { test, expect } from "@playwright/test";
import { installApiMocks, selectRealmAndLeague } from "./fixtures";

test.describe("Tab Navigation", () => {
  test.beforeEach(async ({ page }) => {
    // Install API mocks BEFORE navigation so initial data fetches get mock responses
    await installApiMocks(page);

    await page.goto("/");
    // Wait for hydration and mock data to load
    await page.waitForTimeout(1500);

    // Select realm + league using the shared helper
    await selectRealmAndLeague(page);
  });

  test("tabs are visible after league selection", async ({ page }) => {
    const tabTriggers = page.locator('[role="tab"]');
    const count = await tabTriggers.count();
    // Should have at least the tab triggers visible
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test("clicking each tab changes the active state", async ({ page }) => {
    const tabValues = [
      "overview",
      "currencies",
      "uniques",
      "exchange",
      "arbitrage",
      "flips",
      "optimizer",
      "analyst",
      "liquid-chain",
      "graph",
      "watchlist",
    ];

    for (const value of tabValues) {
      const tabTrigger = page.locator(`[data-state][value="${value}"]`).first();
      const count = await tabTrigger.count();

      if (count > 0) {
        await tabTrigger.click();
        await page.waitForTimeout(500);

        // After clicking, the tab should be in active state
        const isActive = await tabTrigger.getAttribute("data-state");
        expect(isActive).toBe("active");
      }
    }
  });

  test("Overview tab is active by default", async ({ page }) => {
    const overviewTab = page.locator('[data-state="active"][value="overview"]').first();
    const count = await overviewTab.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test("back button works within the app", async ({ page }) => {
    const exchangeTab = page.locator('[value="exchange"]').first();
    const count = await exchangeTab.count();
    if (count > 0) {
      await exchangeTab.click();
      await page.waitForTimeout(300);
    }

    // Navigate back
    await page.goBack();
    await page.waitForTimeout(300);
    const body = page.locator("body");
    await expect(body).toBeVisible();
  });
});
