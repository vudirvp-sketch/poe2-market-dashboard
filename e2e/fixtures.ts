/**
 * Shared E2E test fixtures — mock API data and route helpers.
 *
 * The PoE2Scout public API is often unreachable from CI/test environments,
 * which causes realm/league selectors to show only disabled placeholder items.
 * These fixtures intercept the Next.js API routes via Playwright's page.route()
 * and return deterministic mock data so that E2E tests can interact with
 * populated dropdowns.
 */

import { expect, type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Mock data — matches the app's internal Realm / League types (src/lib/types.ts)
// ---------------------------------------------------------------------------

export const MOCK_REALMS = [
  { name: "poe2", displayName: "PoE2", defaultLeague: "Runes of Aldur" },
  { name: "pc", displayName: "PoE1 PC", defaultLeague: "Standard" },
];

export const MOCK_LEAGUES = [
  {
    name: "runes",
    displayName: "Runes of Aldur",
    startAt: null,
    endAt: null,
    active: true,
    baseCurrencyApiId: "exalted",
    baseCurrencyText: "Exalted Orb",
    defaultCurrency: {
      apiId: "exalted",
      text: "Exalted Orb",
      iconUrl: null,
      relativePrice: 1,
    },
  },
  {
    name: "runeshc",
    displayName: "HC Runes of Aldur",
    startAt: null,
    endAt: null,
    active: false,
    baseCurrencyApiId: "exalted",
    baseCurrencyText: "Exalted Orb",
    defaultCurrency: {
      apiId: "exalted",
      text: "Exalted Orb",
      iconUrl: null,
      relativePrice: 1,
    },
  },
  {
    name: "standard",
    displayName: "Standard",
    startAt: null,
    endAt: null,
    active: false,
    baseCurrencyApiId: "exalted",
    baseCurrencyText: "Exalted Orb",
    defaultCurrency: {
      apiId: "exalted",
      text: "Exalted Orb",
      iconUrl: null,
      relativePrice: 1,
    },
  },
];

// ---------------------------------------------------------------------------
// Route-mocking helpers
// ---------------------------------------------------------------------------

/**
 * Install Playwright route mocks for the PoE2 API endpoints that the
 * dashboard's selectors depend on.  Also mocks the flipper health endpoint
 * so the StickyBar / OfflineBanner don't try to hit a real backend.
 *
 * Call this BEFORE page.goto("/") so the routes are in place when the
 * app makes its first data fetches.
 */
export async function installApiMocks(page: Page): Promise<void> {
  // Realms endpoint
  await page.route("**/api/poe2/realms", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_REALMS),
    });
  });

  // Leagues endpoint — must match the query param `realm=poe2` (or any realm)
  await page.route("**/api/poe2/leagues**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_LEAGUES),
    });
  });

  // Flipper health — return "offline" so flipper-only tabs show their
  // graceful offline state without trying to reach a real backend
  await page.route("**/api/flipper/health", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ status: "offline", timestamp: new Date().toISOString() }),
    });
  });

  // Flipper phase — 503 (backend offline)
  await page.route("**/api/flipper/phase", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "backend_offline" }),
    });
  });

  // Flipper events — 503 (backend offline)
  await page.route("**/api/flipper/events**", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "backend_offline", events: [], total: 0 }),
    });
  });

  // Flipper heatmap — return mock data so the heatmap component renders
  await page.route("**/api/flipper/heatmap**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { currency: "divine", change24h: 5.2 },
        { currency: "exalted", change24h: -3.1 },
        { currency: "chaos", change24h: 1.8 },
      ]),
    });
  });

  // POE2 Overview — return minimal mock so MarketOverview doesn't hang
  await page.route("**/api/poe2/overview**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        topGainers: [],
        topLosers: [],
        topGainers7d: [],
        topLosers7d: [],
        stats: { totalVolume: 0, trackedItems: 0, exchangePairs: 0 },
        snapshotHistory: [],
      }),
    });
  });

  // Flipper portfolio/correlation — return empty so ComparativeChart doesn't hang
  await page.route("**/api/flipper/portfolio/correlation**", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "backend_offline" }),
    });
  });

  // Flipper triangular — 503 (backend offline)
  await page.route("**/api/flipper/triangular**", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "backend_offline" }),
    });
  });
}

// ---------------------------------------------------------------------------
// Reusable selector helpers
// ---------------------------------------------------------------------------

/**
 * Select the first realm in the realm dropdown, then select the first
 * (active) league.  Waits for the Radix Select animations to settle.
 */
export async function selectRealmAndLeague(page: Page): Promise<void> {
  // Open realm dropdown and pick first option
  const realmSelect = page.locator('button[role="combobox"]').first();
  await expect(realmSelect).toBeVisible({ timeout: 10_000 });
  await realmSelect.click();

  // Wait for the dropdown to render, then click the first enabled option
  const firstRealmOption = page.locator('[role="option"]:not([data-disabled])').first();
  await expect(firstRealmOption).toBeVisible({ timeout: 5_000 });
  await firstRealmOption.click();
  await page.waitForTimeout(500);

  // Open league dropdown and pick first option
  const leagueSelect = page.locator('button[role="combobox"]').nth(1);
  await leagueSelect.click();

  const firstLeagueOption = page.locator('[role="option"]:not([data-disabled])').first();
  await expect(firstLeagueOption).toBeVisible({ timeout: 5_000 });
  await firstLeagueOption.click();
  await page.waitForTimeout(1000);
}
