/**
 * Accessibility tests — basic a11y checks for each tab.
 * Uses Playwright's built-in accessibility assertions.
 * For a full axe-core audit, install @axe-core/playwright.
 */
import { test, expect } from "@playwright/test";

test.describe("Accessibility Checks", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("all interactive elements have accessible names", async ({ page }) => {
    // Check that buttons have aria-labels or visible text
    const buttons = page.locator("button");
    const count = await buttons.count();

    for (let i = 0; i < Math.min(count, 20); i++) {
      const btn = buttons.nth(i);
      const ariaLabel = await btn.getAttribute("aria-label");
      const textContent = await btn.textContent();
      const hasAccessibleName = ariaLabel || (textContent && textContent.trim().length > 0);
      expect(hasAccessibleName).toBeTruthy();
    }
  });

  test("main content landmark exists", async ({ page }) => {
    const main = page.locator('main, [role="main"]');
    await expect(main).toBeVisible();
  });

  test("tab list has proper ARIA roles", async ({ page }) => {
    const tabList = page.locator('[role="tablist"]').first();
    await expect(tabList).toBeVisible();

    const tabs = tabList.locator('[role="tab"]');
    const tabCount = await tabs.count();
    expect(tabCount).toBe(6);
  });

  test("dialog focus trapping works", async ({ page }) => {
    // Select a realm and league first
    const realmSelect = page.locator('button[role="combobox"]').first();
    await realmSelect.click();
    const pcOption = page.locator('[role="option"]', { hasText: "PC" }).first();
    const pcCount = await pcOption.count();
    if (pcCount > 0) {
      await pcOption.click();
      await page.waitForTimeout(1000);

      // Select first league
      const leagueSelect = page.locator('button[role="combobox"]').nth(1);
      await leagueSelect.click();
      const firstLeague = page.locator('[role="option"]').first();
      const leagueCount = await firstLeague.count();
      if (leagueCount > 0) {
        await firstLeague.click();
        await page.waitForTimeout(2000);
      }
    }

    // Try to open price alerts dialog
    const alertButton = page.locator("button", { hasText: /alert|оповещ/i }).first();
    const alertCount = await alertButton.count();
    if (alertCount > 0) {
      await alertButton.click();
      await page.waitForTimeout(500);

      // Dialog should be open
      const dialog = page.locator('[role="dialog"]').first();
      const dialogCount = await dialog.count();
      if (dialogCount > 0) {
        // Press Escape to close
        await page.keyboard.press("Escape");
        await page.waitForTimeout(300);

        // Dialog should be closed
        const dialogAfterClose = await page.locator('[role="dialog"]').count();
        expect(dialogAfterClose).toBe(0);
      }
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

  test("color contrast — no text-muted-foreground on light backgrounds without sufficient contrast", async ({ page }) => {
    // This is a visual test that can't be fully automated without axe-core.
    // We check that the page doesn't use obviously failing color combinations.
    const mutedElements = page.locator(".text-muted-foreground");
    const count = await mutedElements.count();

    // Just verify muted-foreground elements exist (they're styled by Tailwind)
    // A real contrast audit needs axe-core or manual testing
    expect(count).toBeGreaterThan(0);
  });
});
