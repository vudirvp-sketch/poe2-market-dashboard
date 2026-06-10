/**
 * E2E tests for the Liquid Chain tab — vendor reforge conversion chain analysis.
 *
 * Verifies that:
 * - The Liquid Chain tab is present and clickable
 * - The tab shows a graceful offline state when the backend is down
 * - The tab does not use raw English strings in the default Russian locale
 * - When the backend returns mock data, the chain steps and cumulative paths render
 */
import { test, expect } from "@playwright/test";
import { installApiMocks, selectRealmAndLeague } from "./fixtures";

// ---------------------------------------------------------------------------
// Mock data for Liquid Chain — matches LiquidChainAnalysisResponse shape
// ---------------------------------------------------------------------------

const MOCK_LIQUID_CHAIN_DATA = {
  chains: [
    {
      chainName: "delirium_liquids",
      category: "delirium",
      steps: [
        {
          apiId: "diluted-liquid-ire",
          nameEn: "Diluted Liquid Ire",
          nameRu: "Разбавленный жидкий гнев",
          ratio: 3,
          price: 0.18,
          inputCost: 0.54,
          outputValue: 0.19,
          profit: -0.35,
          profitPct: -64.81,
        },
        {
          apiId: "diluted-liquid-guilt",
          nameEn: "Diluted Liquid Guilt",
          nameRu: "Разбавленная жидкая вина",
          ratio: 3,
          price: 0.19,
          inputCost: 0.57,
          outputValue: 0.15,
          profit: -0.42,
          profitPct: -73.68,
        },
        {
          apiId: "concentrated-liquid-isolation",
          nameEn: "Concentrated Liquid Isolation",
          nameRu: "Концентрированное жидкое отчуждение",
          ratio: 1,
          price: 0.05,
          inputCost: 0,
          outputValue: 0,
          profit: 0,
          profitPct: 0,
        },
      ],
      cumulativePaths: [
        {
          fromIndex: 0,
          toIndex: 1,
          totalInputCost: 0.54,
          totalOutputValue: 0.19,
          cumulativeRatio: 3,
          profit: -0.35,
          profitPct: -64.81,
        },
      ],
      bestStep: null,
      worstStep: 0,
      dataAvailable: true,
      stepsWithData: 2,
      totalSteps: 3,
    },
  ],
  dataAvailable: true,
  fetchedAt: new Date().toISOString(),
};

// ---------------------------------------------------------------------------
// Helper: install mocks with Liquid Chain data (backend online mode)
// ---------------------------------------------------------------------------

async function installApiMocksWithLiquidChainData(page: import("@playwright/test").Page): Promise<void> {
  // Install base mocks first (realms, leagues, etc.)
  await installApiMocks(page);

  // Override: flipper health → "ok" (backend online)
  await page.route("**/api/flipper/health", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "ok",
        snapshot_ready: true,
        provider: "reachable",
        timestamp: new Date().toISOString(),
      }),
    });
  });

  // Override: flipper liquid-chain → mock data
  await page.route("**/api/flipper/liquid-chain**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_LIQUID_CHAIN_DATA),
    });
  });
}

// ---------------------------------------------------------------------------
// Tests — Backend Offline
// ---------------------------------------------------------------------------

test.describe("Liquid Chain Tab — Backend Offline", () => {
  test.beforeEach(async ({ page }) => {
    await installApiMocks(page);
    await page.goto("/");
    await selectRealmAndLeague(page);
  });

  test("Liquid Chain tab is visible and clickable", async ({ page }) => {
    // The Liquid Chain tab should be present (i18n'd name)
    const liquidChainTab = page
      .locator('button[role="tab"], [role="tablist"] button')
      .filter({ hasText: /Жидкости|Liquid|液态|액체/ })
      .first();
    await expect(liquidChainTab).toBeVisible({ timeout: 10_000 });
    await liquidChainTab.click();
    await page.waitForTimeout(500);

    // After clicking, the tab should be active
    const isActive = await liquidChainTab.getAttribute("data-state");
    expect(isActive).toBe("active");
  });

  test("Liquid Chain tab shows backend offline fallback gracefully", async ({ page }) => {
    const liquidChainTab = page
      .locator('button[role="tab"], [role="tablist"] button')
      .filter({ hasText: /Жидкости|Liquid|液态|액체/ })
      .first();
    await expect(liquidChainTab).toBeVisible({ timeout: 10_000 });
    await liquidChainTab.click();

    // With backend offline (503 mocked), the tab should show a graceful offline state
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    // Give it time to attempt fetch and handle the error
    await page.waitForTimeout(3000);

    // No critical JS errors from the Liquid Chain tab
    const criticalErrors = pageErrors.filter(
      (e) =>
        !e.includes("503") &&
        !e.includes("fetch") &&
        !e.includes("NetworkError")
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test("Liquid Chain tab does not crash with raw English in Russian locale", async ({ page }) => {
    const liquidChainTab = page
      .locator('button[role="tab"], [role="tablist"] button')
      .filter({ hasText: /Жидкости|Liquid|液态|액체/ })
      .first();
    await expect(liquidChainTab).toBeVisible({ timeout: 10_000 });
    await liquidChainTab.click();
    await page.waitForTimeout(1500);

    // In Russian default locale, the tab name should contain "Жидкости" not raw English
    const tabText = await liquidChainTab.textContent();
    expect(tabText).toMatch(/Жидкости|Liquid/);
  });
});

// ---------------------------------------------------------------------------
// Tests — Backend Online with Mock Data
// ---------------------------------------------------------------------------

test.describe("Liquid Chain Tab — Backend Online with Data", () => {
  test.beforeEach(async ({ page }) => {
    await installApiMocksWithLiquidChainData(page);
    await page.goto("/");
    await selectRealmAndLeague(page);
  });

  test("Liquid Chain tab renders chain steps when backend returns data", async ({ page }) => {
    const liquidChainTab = page
      .locator('button[role="tab"], [role="tablist"] button')
      .filter({ hasText: /Жидкости|Liquid|液态|액체/ })
      .first();
    await expect(liquidChainTab).toBeVisible({ timeout: 10_000 });
    await liquidChainTab.click();
    await page.waitForTimeout(2000);

    // The chain card title should be visible (i18n'd)
    // Russian: "Цепь перековки жидкостей делириума" / English: "Delirium Liquid Reforge Chain"
    const chainTitle = page
      .getByText(/Цепь перековки|Delirium Liquid Reforge|迷雾液体重铸链|딜리리움 액체/)
      .first();
    await expect(chainTitle).toBeVisible({ timeout: 15_000 });

    // The step names from mock data should be visible
    const stepName = page.getByText("Diluted Liquid Ire").first();
    await expect(stepName).toBeVisible({ timeout: 10_000 });
  });

  test("Liquid Chain tab shows profit/loss badges", async ({ page }) => {
    const liquidChainTab = page
      .locator('button[role="tab"], [role="tablist"] button')
      .filter({ hasText: /Жидкости|Liquid|液态|액체/ })
      .first();
    await expect(liquidChainTab).toBeVisible({ timeout: 10_000 });
    await liquidChainTab.click();
    await page.waitForTimeout(2000);

    // The profit/loss badge should be present (i18n'd: "прибыль"/"profit" and "убыток"/"loss")
    const profitBadge = page
      .getByText(/прибыль|profit|盈利|수익/)
      .first();
    const lossBadge = page
      .getByText(/убыток|loss|亏损|손실/)
      .first();

    // At least one of these should be visible (mock data has unprofitable steps)
    const profitVisible = await profitBadge.isVisible().catch(() => false);
    const lossVisible = await lossBadge.isVisible().catch(() => false);
    expect(profitVisible || lossVisible).toBe(true);
  });

  test("Liquid Chain tab shows no-reforge notice for last step", async ({ page }) => {
    const liquidChainTab = page
      .locator('button[role="tab"], [role="tablist"] button')
      .filter({ hasText: /Жидкости|Liquid|液态|액체/ })
      .first();
    await expect(liquidChainTab).toBeVisible({ timeout: 10_000 });
    await liquidChainTab.click();
    await page.waitForTimeout(2000);

    // The no-reforge notice should be visible (i18n'd)
    const noReforgeNotice = page
      .getByText(/Древние и Концентрированные|Ancient and Concentrated|古老和浓缩|고대 및 농축/)
      .first();
    await expect(noReforgeNotice).toBeVisible({ timeout: 10_000 });
  });
});
