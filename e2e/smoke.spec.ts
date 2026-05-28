/**
 * Smoke tests — verify the page loads correctly and core UI elements are present.
 */
import { test, expect } from "@playwright/test";

test.describe("Smoke Tests", () => {
  test.beforeEach(async ({ page }) => {
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

  test("language switcher button is visible", async ({ page }) => {
    // The globe icon button — has a Globe icon + locale label (EN/RU/中/한)
    const globeButton = page.locator('button:has(svg.lucide-globe)').first();
    await expect(globeButton).toBeVisible({ timeout: 5000 });
  });

  test("theme toggle button is visible", async ({ page }) => {
    // After mount, the theme toggle should be visible (Sun or Moon icon)
    // Wait a moment for client-side hydration
    await page.waitForTimeout(1000);
    const themeButton = page.locator('button:has(svg.lucide-sun), button:has(svg.lucide-moon)').first();
    await expect(themeButton).toBeVisible({ timeout: 5000 });
  });
});
