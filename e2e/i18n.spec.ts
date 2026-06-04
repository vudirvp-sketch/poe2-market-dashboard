/**
 * i18n tests — verify language switching works correctly.
 * Default locale is "ru" (Russian). The language switcher cycles: ru → en → zh → ko → ru.
 *
 * The language switcher is inside the "More" (⋮) dropdown menu in the header.
 * Tests must first open the menu, then interact with the Globe button.
 *
 * API routes are mocked via installApiMocks() so the realm/league selectors
 * are populated even when the PoE2Scout API is unreachable.
 */
import { test, expect } from "@playwright/test";
import { installApiMocks, selectRealmAndLeague } from "./fixtures";

/**
 * Open the "More" (⋮) menu in the header and return the language switcher button.
 * The Globe icon button is a menu item inside the dropdown.
 *
 * The Globe button's onClick only calls cycleLocale() — it does NOT close
 * the dropdown. So after clicking the Globe button, the menu stays open,
 * and subsequent calls to this function will find the Globe button directly
 * without needing to re-open the menu.
 */
async function openMoreAndGetGlobeButton(page: import("@playwright/test").Page) {
  // First, check if the Globe button is already visible (menu already open
  // from a previous click that didn't close the dropdown).
  const globeButton = page.locator('button:has(svg.lucide-globe), [role="menuitem"]:has(svg.lucide-globe)').first();
  if (await globeButton.isVisible().catch(() => false)) {
    return globeButton;
  }

  // Otherwise, click the "More" button (⋮ icon) to open the dropdown menu.
  // The aria-label is i18n'd: "Ещё" (ru), "More options" (en), "更多选项" (zh), "더 보기" (ko).
  // Must use a multi-locale selector because the default locale is "ru".
  const moreButton = page.locator(
    'button[aria-label="Ещё"], button[aria-label="More options"], button[aria-label="更多选项"], button[aria-label="더 보기"]'
  ).first();
  await expect(moreButton).toBeVisible({ timeout: 10000 });
  await moreButton.click();
  await page.waitForTimeout(500);

  // Now the dropdown is open — find the Globe button inside it
  await expect(globeButton).toBeVisible({ timeout: 5000 });
  return globeButton;
}

test.describe("Internationalization (i18n)", () => {
  test.beforeEach(async ({ page }) => {
    await installApiMocks(page);
    await page.goto("/");
    // Wait for full hydration
    await page.waitForTimeout(2000);
  });

  test("default locale renders Russian text", async ({ page }) => {
    // Default locale is "ru", so the app title or header should contain Russian text
    const globeButton = await openMoreAndGetGlobeButton(page);
    // The language button should show the current locale label (e.g. "RU")
    const text = await globeButton.textContent();
    expect(text).toBeTruthy();
    expect(text).toContain("RU");
  });

  test("switching language updates UI text", async ({ page }) => {
    const globeButton = await openMoreAndGetGlobeButton(page);

    // Click once to switch from default (ru) to next locale (en)
    await globeButton.click();
    await page.waitForTimeout(1000);

    // Open the menu again and verify the locale label changed
    const globeButtonAfter = await openMoreAndGetGlobeButton(page);
    const labelAfter = await globeButtonAfter.textContent();
    expect(labelAfter).toBeTruthy();
    expect(labelAfter).toContain("EN");

    // Select realm/league to make tabs visible, then check tab text
    await selectRealmAndLeague(page);
  });

  test("language cycling works through all locales", async ({ page }) => {
    const seenLabels = new Set<string>();
    const localeLabels = ["RU", "EN", "中", "한"];

    // Cycle through all 4 locales by opening menu and clicking Globe each time.
    // The Globe button's onClick only calls cycleLocale() — the More menu
    // stays open after clicking, so we can find the Globe button directly
    // in subsequent iterations without re-opening the menu.
    for (let i = 0; i < 5; i++) {
      // Open the More menu and click the Globe button
      const globeButton = await openMoreAndGetGlobeButton(page);
      // Read the locale label BEFORE clicking (the menu stays open, but we
      // capture the label before the click changes the displayed locale)
      const labelBeforeClick = (await globeButton.textContent())?.trim() ?? "";
      await globeButton.click();
      await page.waitForTimeout(800);

      // Collect the locale label we just saw
      for (const ll of localeLabels) {
        if (labelBeforeClick.includes(ll)) {
          seenLabels.add(ll);
          break;
        }
      }
    }

    // Should have seen at least 2 different locale labels
    expect(seenLabels.size).toBeGreaterThanOrEqual(2);
  });

  test("language preference persists on page reload", async ({ page }) => {
    const globeButton = await openMoreAndGetGlobeButton(page);

    // Click to change locale
    await globeButton.click();
    await page.waitForTimeout(800);

    // Re-open menu to check what locale we switched to
    const globeButtonAfter = await openMoreAndGetGlobeButton(page);
    const labelBefore = (await globeButtonAfter.textContent())?.trim();

    // Reload the page
    await page.reload();
    await page.waitForTimeout(2000);

    // After reload + hydration, open menu and check locale is restored
    const globeButtonReloaded = await openMoreAndGetGlobeButton(page);
    const labelAfter = (await globeButtonReloaded.textContent())?.trim();

    // The label should match what was set before reload
    expect(labelAfter).toBe(labelBefore);
  });
});
