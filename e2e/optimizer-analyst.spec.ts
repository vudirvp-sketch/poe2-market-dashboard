/**
 * Smoke tests for the Optimizer and Analyst tabs (Steps 5 & 7).
 *
 * Verifies that:
 * - The Optimizer tab renders its path optimizer and rate matrix UI
 * - The Analyst tab renders league insights, trends, and anomalies
 * - Both tabs handle offline backend gracefully (fallback UI)
 * - i18n keys are used (no raw English in Russian default locale)
 */
import { test, expect } from "@playwright/test";
import { installApiMocks, selectRealmAndLeague } from "./fixtures";

test.describe("Optimizer Tab", () => {
  test.beforeEach(async ({ page }) => {
    await installApiMocks(page);
    await page.goto("/");
    await selectRealmAndLeague(page);
  });

  test("Optimizer tab is clickable and renders path optimizer UI", async ({ page }) => {
    // Find and click the Optimizer tab
    const optimizerTab = page.locator('button[role="tab"], [role="tablist"] button').filter({ hasText: /Оптимизатор|Optimizer/ }).first();
    await expect(optimizerTab).toBeVisible({ timeout: 10000 });
    await optimizerTab.click();
    await page.waitForTimeout(1000);

    // The path optimizer form should be visible with From/To/Amount inputs
    // The placeholder is i18n'd but contains "chaos" and "divine" in all locales
    // (e.g. "напр. chaos, divine" in ru, "e.g. chaos, divine" in en)
    const fromInput = page.locator('input[placeholder*="chaos"], input[placeholder*="divine"]').first();
    await expect(fromInput).toBeVisible({ timeout: 15000 });
  });

  test("Optimizer tab shows backend offline fallback gracefully", async ({ page }) => {
    const optimizerTab = page.locator('button[role="tab"], [role="tablist"] button').filter({ hasText: /Оптимизатор|Optimizer/ }).first();
    await expect(optimizerTab).toBeVisible({ timeout: 10000 });
    await optimizerTab.click();
    await page.waitForTimeout(1000);

    // With backend offline (503 mocked), the tab should show a graceful offline
    // state or the form — but NOT throw an unhandled error
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    // Give it time to attempt fetch and handle the error
    await page.waitForTimeout(3000);

    // No critical JS errors from the Optimizer tab
    const criticalErrors = pageErrors.filter(
      (e) =>
        !e.includes("503") &&
        !e.includes("fetch") &&
        !e.includes("NetworkError")
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test("Optimizer tab does not use raw English strings in Russian locale", async ({ page }) => {
    const optimizerTab = page.locator('button[role="tab"], [role="tablist"] button').filter({ hasText: /Оптимизатор|Optimizer/ }).first();
    await expect(optimizerTab).toBeVisible({ timeout: 10000 });
    await optimizerTab.click();
    await page.waitForTimeout(1500);

    // In Russian default locale, the tab title should say "Оптимизатор" not "Optimizer"
    // Check the heading or card title
    const heading = page.locator("h2, h3").filter({ hasText: /Оптимизатор пути валют|Currency Path Optimizer/ }).first();
    const headingCount = await heading.count();
    // If heading found, it should be in Russian
    if (headingCount > 0) {
      const text = await heading.textContent();
      expect(text).toContain("Оптимизатор");
    }
  });
});

test.describe("Analyst Tab", () => {
  test.beforeEach(async ({ page }) => {
    await installApiMocks(page);
    await page.goto("/");
    await selectRealmAndLeague(page);
  });

  test("Analyst tab is clickable and renders league analyst UI", async ({ page }) => {
    const analystTab = page.locator('button[role="tab"], [role="tablist"] button').filter({ hasText: /Аналитик|Analyst/ }).first();
    await expect(analystTab).toBeVisible({ timeout: 10000 });
    await analystTab.click();
    await page.waitForTimeout(1000);

    // The analyst tab should show some UI — either data or offline state
    // Check for the main content area to not be empty
    const tabPanel = page.locator('[role="tabpanel"]').filter({ has: page.locator("h2, h3, p") }).first();
    await expect(tabPanel).toBeVisible({ timeout: 10000 });
  });

  test("Analyst tab handles backend offline gracefully", async ({ page }) => {
    const analystTab = page.locator('button[role="tab"], [role="tablist"] button').filter({ hasText: /Аналитик|Analyst/ }).first();
    await expect(analystTab).toBeVisible({ timeout: 10000 });
    await analystTab.click();

    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.waitForTimeout(3000);

    // No critical JS errors from the Analyst tab
    const criticalErrors = pageErrors.filter(
      (e) =>
        !e.includes("503") &&
        !e.includes("fetch") &&
        !e.includes("NetworkError")
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test("Analyst tab uses i18n — no raw English strings in Russian locale", async ({ page }) => {
    const analystTab = page.locator('button[role="tab"], [role="tablist"] button').filter({ hasText: /Аналитик|Analyst/ }).first();
    await expect(analystTab).toBeVisible({ timeout: 10000 });
    await analystTab.click();
    await page.waitForTimeout(1500);

    // The tab name in Russian should be "Аналитик", not "Analyst"
    // Check that the analyst-specific heading uses Russian text
    const analystHeading = page.locator("h2, h3").filter({ hasText: /Аналитика лиги|League Insights/ }).first();
    const headingCount = await analystHeading.count();
    if (headingCount > 0) {
      const text = await analystHeading.textContent();
      expect(text).toContain("Аналитика");
    }
  });
});
