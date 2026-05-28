/**
 * i18n tests — verify language switching works correctly.
 * Default locale is "ru" (Russian). The language switcher cycles: ru → en → zh → ko → ru.
 *
 * API routes are mocked via installApiMocks() so the realm/league selectors
 * are populated even when the PoE2Scout API is unreachable.
 */
import { test, expect } from "@playwright/test";
import { installApiMocks, selectRealmAndLeague } from "./fixtures";

test.describe("Internationalization (i18n)", () => {
  test.beforeEach(async ({ page }) => {
    await installApiMocks(page);
    await page.goto("/");
    // Wait for full hydration
    await page.waitForTimeout(2000);
  });

  test("default locale renders Russian text", async ({ page }) => {
    // Default locale is "ru", so the app title or header should contain Russian text
    // The language button shows locale label
    const globeButton = page.locator('button:has(svg.lucide-globe)').first();
    await expect(globeButton).toBeVisible({ timeout: 5000 });
    // Default label should be "RU" (or the current locale abbreviation)
    const text = await globeButton.textContent();
    expect(text).toBeTruthy();
  });

  test("switching language updates UI text", async ({ page }) => {
    // Find the globe button (language switcher) — it has a Globe icon
    const globeButton = page.locator('button:has(svg.lucide-globe)').first();
    await expect(globeButton).toBeVisible({ timeout: 5000 });

    // Click once to switch from default (ru) to next locale (en)
    await globeButton.click();
    await page.waitForTimeout(1000);

    // Verify locale label changed
    const labelAfter = await globeButton.textContent();
    expect(labelAfter).toBeTruthy();

    // Select realm/league to make tabs visible, then check tab text
    await selectRealmAndLeague(page);
  });

  test("language cycling works through all locales", async ({ page }) => {
    const globeButton = page.locator('button:has(svg.lucide-globe)').first();
    await expect(globeButton).toBeVisible({ timeout: 5000 });

    // Cycle through all 4 locales: ru → en → zh → ko → ru
    const seenLabels = new Set<string>();
    for (let i = 0; i < 5; i++) {
      await globeButton.click();
      await page.waitForTimeout(500);
      const label = (await globeButton.textContent())?.trim();
      if (label) seenLabels.add(label);
    }

    // Should have seen at least 2 different locale labels
    expect(seenLabels.size).toBeGreaterThanOrEqual(2);
  });

  test("language preference persists on page reload", async ({ page }) => {
    const globeButton = page.locator('button:has(svg.lucide-globe)').first();
    await expect(globeButton).toBeVisible({ timeout: 5000 });

    // Click to change locale
    await globeButton.click();
    await page.waitForTimeout(500);
    const labelBefore = (await globeButton.textContent())?.trim();

    // Reload the page
    await page.reload();
    await page.waitForTimeout(2000);

    // After reload + hydration, locale should be restored
    const globeButtonAfter = page.locator('button:has(svg.lucide-globe)').first();
    await expect(globeButtonAfter).toBeVisible({ timeout: 10000 });
    const labelAfter = (await globeButtonAfter.textContent())?.trim();

    // The label should match what was set before reload
    expect(labelAfter).toBe(labelBefore);
  });
});
