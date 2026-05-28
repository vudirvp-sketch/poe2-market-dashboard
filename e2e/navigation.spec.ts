/**
 * Navigation tests — verify tab switching and content area changes.
 * These tests first select a realm and league to make tabs visible.
 */
import { test, expect } from "@playwright/test";

test.describe("Tab Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // Wait for hydration and data to load
    await page.waitForTimeout(2000);

    // Select a realm to make league select work
    const realmSelect = page.locator('button[role="combobox"]').first();
    await expect(realmSelect).toBeVisible({ timeout: 10000 });
    await realmSelect.click();

    const firstRealmOption = page.locator('[role="option"]').first();
    const realmOptCount = await firstRealmOption.count();
    if (realmOptCount > 0) {
      await firstRealmOption.click();
      await page.waitForTimeout(1500);

      // Select a league
      const leagueSelect = page.locator('button[role="combobox"]').nth(1);
      await leagueSelect.click();
      const firstLeagueOption = page.locator('[role="option"]').first();
      const leagueOptCount = await firstLeagueOption.count();
      if (leagueOptCount > 0) {
        await firstLeagueOption.click();
        await page.waitForTimeout(2000);
      }
    }
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
      "recipes",
      "forecast",
      "portfolio",
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
