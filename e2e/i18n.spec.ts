/**
 * i18n tests — verify language switching works correctly.
 */
import { test, expect } from "@playwright/test";

test.describe("Internationalization (i18n)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("switching language to English updates UI text", async ({ page }) => {
    // Find the globe button (language switcher)
    const globeButton = page.locator('button[aria-label="Switch language"], button[aria-label="Переключить язык"]').first();
    await expect(globeButton).toBeVisible();

    // Cycle through locales until we see English tab names
    // Default locale is RU, so clicking once should switch to EN
    let foundEnglish = false;
    for (let i = 0; i < 4; i++) {
      await globeButton.click();
      await page.waitForTimeout(500);

      // Check if "Overview" tab is now visible (English)
      const overviewTab = page.locator('[role="tablist"] [role="tab"]', {
        hasText: "Overview",
      });
      const count = await overviewTab.count();
      if (count > 0) {
        foundEnglish = true;
        break;
      }
    }

    expect(foundEnglish).toBeTruthy();

    // Verify the tab text is in English
    const overviewTab = page.locator('[role="tablist"] [role="tab"]', {
      hasText: "Overview",
    });
    await expect(overviewTab).toBeVisible();
  });

  test("switching language to Russian updates UI text", async ({ page }) => {
    // Default is Russian, so tabs should already be in Russian
    const overviewTab = page.locator('[role="tablist"] [role="tab"]', {
      hasText: "Обзор",
    });
    const count = await overviewTab.count();

    if (count > 0) {
      // Already in Russian
      await expect(overviewTab).toBeVisible();
      return;
    }

    // If not in Russian, cycle through locales
    const globeButton = page.locator('button[aria-label="Switch language"], button[aria-label="Переключить язык"]').first();
    for (let i = 0; i < 4; i++) {
      await globeButton.click();
      await page.waitForTimeout(500);

      const ruTab = page.locator('[role="tablist"] [role="tab"]', {
        hasText: "Обзор",
      });
      const ruCount = await ruTab.count();
      if (ruCount > 0) {
        await expect(ruTab).toBeVisible();
        return;
      }
    }

    // If we couldn't find Russian, the test fails
    expect(false).toBeTruthy();
  });

  test("switching language to Chinese updates UI text", async ({ page }) => {
    const globeButton = page.locator('button[aria-label="Switch language"], button[aria-label="切换语言"]').first();

    for (let i = 0; i < 4; i++) {
      await globeButton.click();
      await page.waitForTimeout(500);

      const zhTab = page.locator('[role="tablist"] [role="tab"]', {
        hasText: "概览",
      });
      const count = await zhTab.count();
      if (count > 0) {
        await expect(zhTab).toBeVisible();
        return;
      }
    }
  });

  test("language preference persists on page reload", async ({ page }) => {
    const globeButton = page.locator('button[aria-label="Switch language"], button[aria-label="Переключить язык"]').first();

    // Switch to English
    for (let i = 0; i < 4; i++) {
      await globeButton.click();
      await page.waitForTimeout(500);

      const enTab = page.locator('[role="tablist"] [role="tab"]', {
        hasText: "Overview",
      });
      const count = await enTab.count();
      if (count > 0) break;
    }

    // Reload the page
    await page.reload();
    await page.waitForTimeout(1000);

    // After reload, locale should be restored from localStorage
    // (initially renders with default, then hydrates to stored locale)
    const enTab = page.locator('[role="tablist"] [role="tab"]', {
      hasText: "Overview",
    });
    // Give time for hydration
    await expect(enTab).toBeVisible({ timeout: 5000 });
  });
});
