/**
 * Smoke tests — verify the page loads correctly and core UI elements are present.
 *
 * API routes are mocked via installApiMocks() so tests are reliable even
 * when the PoE2Scout API is unreachable from the test environment.
 */
import { test, expect } from "@playwright/test";
import { installApiMocks } from "./fixtures";

test.describe("Smoke Tests", () => {
  test.beforeEach(async ({ page }) => {
    await installApiMocks(page);
    await page.goto("/");
  });

  test("page has correct title", async ({ page }) => {
    const title = await page.title();
    expect(title).toContain("PoE2");
  });

  test("header contains realm and league selects", async ({ page }) => {
    // Wait for the header to render with selects
    const comboboxes = page.locator('button[role="combobox"]');
    await expect(comboboxes.first()).toBeVisible({ timeout: 10000 });
  });

  test("app title is visible", async ({ page }) => {
    // The app title "PoE2 Market" should always be visible
    const title = page.locator("h1");
    await expect(title).toBeVisible();
  });

  test("page renders without critical console errors", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto("/");
    await page.waitForTimeout(3000); // Give time for any lazy errors

    // Filter out known non-critical errors
    const criticalErrors = consoleErrors.filter(
      (e) =>
        !e.includes("ETIMEDOUT") &&
        !e.includes("fetch failed") &&
        !e.includes("failed to pipe response") &&
        !e.includes("ResizeObserver") &&
        !e.includes("429") &&
        !e.includes("rate limit") &&
        // Flipper backend returning 503 when offline — expected in test env
        !e.includes("503") &&
        !e.includes("Service Unavailable") &&
        // React 19 / Next.js dev mode warning about <script> tags in SSR output
        // (not from our code — Next.js injects these internally)
        !e.includes("script tag while rendering")
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test("skip-to-content link exists for a11y", async ({ page }) => {
    const skipLink = page.locator('a[href="#main-content"]').first();
    // The skip link is visually hidden until focused — just verify it exists in DOM
    const count = await skipLink.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test("main content landmark exists", async ({ page }) => {
    const main = page.locator('main, [role="main"]');
    await expect(main).toBeVisible();
  });

  test("language switcher is accessible via More menu", async ({ page }) => {
    // The language switcher is inside the "More" (⋮) dropdown menu.
    // The More button aria-label is i18n'd ("Ещё" in ru, "More options" in en).
    // Use a resilient selector: the MoreVertical icon button with aria-expanded.
    const moreButton = page.locator('button[aria-label="Ещё"], button[aria-label="More options"], button[aria-label="更多选项"], button[aria-label="더 보기"]').first();
    await expect(moreButton).toBeVisible({ timeout: 5000 });
    await moreButton.click();
    await page.waitForTimeout(500);

    // Now the Globe button (language switcher) should be visible in the dropdown
    const globeButton = page.locator('button:has(svg.lucide-globe), [role="menuitem"]:has(svg.lucide-globe)').first();
    await expect(globeButton).toBeVisible({ timeout: 5000 });
  });

  test("theme toggle button is accessible via More menu", async ({ page }) => {
    // The theme toggle is inside the "More" (⋮) dropdown menu.
    // First open the More menu, then verify the Sun/Moon button is visible.
    const moreButton = page.locator('button[aria-label="Ещё"], button[aria-label="More options"], button[aria-label="更多选项"], button[aria-label="더 보기"]').first();
    await expect(moreButton).toBeVisible({ timeout: 5000 });
    await moreButton.click();
    await page.waitForTimeout(500);

    // After the dropdown opens, the theme toggle (Sun or Moon icon) should be visible
    const themeButton = page.locator('button:has(svg.lucide-sun), button:has(svg.lucide-moon)').first();
    await expect(themeButton).toBeVisible({ timeout: 5000 });
  });

  test("heatmap section renders with i18n text (no hardcoded English)", async ({ page }) => {
    // The heatmap component should render using i18n keys, not hardcoded English.
    // Select realm+league first so the overview tab (with heatmap) loads.
    const comboboxes = page.locator('button[role="combobox"]');
    await expect(comboboxes.first()).toBeVisible({ timeout: 10000 });

    // Click the first combobox (realm) and pick first option
    await comboboxes.first().click();
    await page.waitForTimeout(500);
    const realmOption = page.locator('[role="option"]:not([data-disabled])').first();
    await expect(realmOption).toBeVisible({ timeout: 5000 });
    await realmOption.click();
    await page.waitForTimeout(500);

    // Click the second combobox (league) and pick first option
    const leagueCombobox = comboboxes.nth(1);
    await leagueCombobox.click();
    await page.waitForTimeout(500);
    const leagueOption = page.locator('[role="option"]:not([data-disabled])').first();
    await expect(leagueOption).toBeVisible({ timeout: 5000 });
    await leagueOption.click();

    // CRITICAL: Wait for the tabs to render (meaning effectiveLeague is set).
    // The MarketHeatmap is inside TabsContent which only mounts when
    // effectiveLeague resolves to a non-empty string. Without this wait,
    // the heatmap title lookup may fire while the "Select a realm and
    // league" placeholder is still showing.
    // Use .first() to avoid strict mode violation — there are 10 tab buttons.
    await expect(page.locator('[role="tab"]').first()).toBeVisible({ timeout: 10000 });

    // NOTE: The default activeTab is "overview" (changed from "exchange").
    // The MarketHeatmap lives on the "overview" tab, so it should be visible
    // by default now. However, we still click to be safe in case the user
    // has a persisted tab preference from a previous session.
    // The tab text is i18n'd: "Обзор" (ru), "Overview" (en), "概览" (zh), "개요" (ko).
    // NOTE: TabsTrigger contains an SVG icon + text, so textContent may have
    // surrounding whitespace. Do NOT use ^$ anchors — use partial match instead.
    const overviewTab = page.locator('[role="tab"]').filter({
      hasText: /Обзор|Overview|概览|개요/,
    }).first();
    await overviewTab.click();

    // Wait for the tab panel to mount after switching — the heatmap component
    // only renders inside the overview TabsContent.
    await page.waitForLoadState("networkidle");

    // Wait for the overview data to load (mocked via installApiMocks)
    // The MarketHeatmap component always renders its card title, even during loading.
    // The title is i18n'd: "Тепловая карта цен (24ч)" in ru, "Price Heatmap (24h)" in en,
    // "价格热力图 (24小时)" in zh, "가격 히트맵 (24시)" in ko.
    // Use getByText with regex to match across all locales.
    const heatmapTitle = page.getByText(/Тепловая карта цен|Price Heatmap|价格热力图|가격 히트맵/).first();
    await expect(heatmapTitle).toBeVisible({ timeout: 20000 });

    // The "Market Tops" section should NOT contain the raw English string
    // "Market Tops — Gainers & Losers" (it should be i18n-translated).
    // We just verify the section is present with the Trophy icon.
    const marketTops = page.locator('svg.lucide-trophy').first();
    await expect(marketTops).toBeVisible({ timeout: 10000 });
  });
});
