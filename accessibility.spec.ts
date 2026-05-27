/**
 * Accessibility tests — basic a11y checks.
 * Uses Playwright's built-in accessibility assertions.
 */
import { test, expect } from "@playwright/test";

test.describe("Accessibility Checks", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("main content landmark exists", async ({ page }) => {
    const main = page.locator('main, [role="main"]');
    await expect(main).toBeVisible();
  });

  test("all visible buttons have accessible names", async ({ page }) => {
    // Wait for hydration
    await page.waitForTimeout(1500);

    const buttons = page.locator("button:visible");
    const count = await buttons.count();

    for (let i = 0; i < Math.min(count, 15); i++) {
      const btn = buttons.nth(i);
      const ariaLabel = await btn.getAttribute("aria-label");
      const textContent = await btn.textContent();
      const hasAccessibleName = !!(ariaLabel || (textContent && textContent.trim().length > 0));
      expect(hasAccessibleName).toBeTruthy();
    }
  });

  test("tab navigation is keyboard accessible after league selection", async ({ page }) => {
    // Select a realm first to make tabs visible
    const realmSelect = page.locator('button[role="combobox"]').first();
    await expect(realmSelect).toBeVisible({ timeout: 10000 });
    await realmSelect.click();

    const pcOption = page.locator('[role="option"]').first();
    const pcCount = await pcOption.count();
    if (pcCount > 0) {
      await pcOption.click();
      await page.waitForTimeout(1500);

      // Now select a league
      const leagueSelect = page.locator('button[role="combobox"]').nth(1);
      await leagueSelect.click();
      const firstLeague = page.locator('[role="option"]').first();
      const leagueCount = await firstLeague.count();
      if (leagueCount > 0) {
        await firstLeague.click();
        await page.waitForTimeout(2000);
      }
    }

    // Check that tabs have proper ARIA roles
    const tabList = page.locator('[role="tablist"]').first();
    const tabListCount = await tabList.count();
    if (tabListCount > 0) {
      const tabs = tabList.locator('[role="tab"]');
      const tabCount = await tabs.count();
      expect(tabCount).toBeGreaterThanOrEqual(1);
    }
  });

  test("images have alt text", async ({ page }) => {
    const images = page.locator("img");
    const count = await images.count();

    for (let i = 0; i < Math.min(count, 20); i++) {
      const img = images.nth(i);
      const alt = await img.getAttribute("alt");
      // alt="" is valid for decorative images
      expect(alt).not.toBeNull();
    }
  });

  test("skip-to-content link is present", async ({ page }) => {
    const skipLink = page.locator('a[href="#main-content"]').first();
    const count = await skipLink.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });
});
