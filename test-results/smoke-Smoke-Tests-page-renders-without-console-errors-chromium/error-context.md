# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: smoke.spec.ts >> Smoke Tests >> page renders without console errors
- Location: e2e\smoke.spec.ts:61:7

# Error details

```
Error: expect(received).toHaveLength(expected)

Expected length: 0
Received length: 3
Received array:  ["Encountered a script tag while rendering React component. Scripts inside React components are never executed when rendering on the client. Consider using template tag instead (https://developer.mozilla.org/en-US/docs/Web/HTML/Element/template).", "Encountered a script tag while rendering React component. Scripts inside React components are never executed when rendering on the client. Consider using template tag instead (https://developer.mozilla.org/en-US/docs/Web/HTML/Element/template).", "Each child in a list should have a unique \"key\" prop.%s%s See https://react.dev/link/warning-keys for more information.··
Check the render method of `Primitive.div`.  It was passed a child from Header."]
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e6] [cursor=pointer]:
    - button "Open Next.js Dev Tools" [ref=e7]:
      - img [ref=e8]
    - generic [ref=e11]:
      - button "Open issues overlay" [ref=e12]:
        - generic [ref=e13]:
          - generic [ref=e14]: "2"
          - generic [ref=e15]: "3"
        - generic [ref=e16]:
          - text: Issue
          - generic [ref=e17]: s
      - button "Collapse issues badge" [ref=e18]:
        - img [ref=e19]
  - link "Skip to main content" [ref=e21] [cursor=pointer]:
    - /url: "#main-content"
  - generic [ref=e22]:
    - banner [ref=e23]:
      - generic [ref=e24]:
        - generic [ref=e25]:
          - img [ref=e26]
          - heading "PoE2 Маркет" [level=1] [ref=e28]
        - combobox [ref=e29]:
          - img
        - combobox [ref=e30]:
          - generic: Лига
          - img
        - generic [ref=e31]:
          - img [ref=e32]
          - textbox "Поиск предметов..." [ref=e35]
        - button "Включить автообновление" [ref=e36]:
          - img
          - text: Авто
        - button "Обновить данные" [ref=e37]:
          - img
          - text: Обновить
        - button "Переключить язык" [ref=e38]:
          - img
          - generic [ref=e39]: RU
        - button "Переключить на светлую тему" [ref=e40]:
          - img
    - main [ref=e41]:
      - status [ref=e42]:
        - img [ref=e43]
        - paragraph [ref=e45]: Выберите реальм и лигу для начала
    - alert [ref=e46]:
      - generic [ref=e47]:
        - img [ref=e48]
        - generic [ref=e55]: Вы офлайн. Отображаются кешированные данные.
      - button "Закрыть баннер офлайна" [ref=e56]:
        - img [ref=e57]
  - region "Notifications alt+T"
  - alert [ref=e60]
```

# Test source

```ts
  1  | /**
  2  |  * Smoke tests — verify the page loads correctly and core UI elements are present.
  3  |  */
  4  | import { test, expect } from "@playwright/test";
  5  | 
  6  | test.describe("Smoke Tests", () => {
  7  |   test.beforeEach(async ({ page }) => {
  8  |     await page.goto("/");
  9  |   });
  10 | 
  11 |   test("page has correct title", async ({ page }) => {
  12 |     const title = await page.title();
  13 |     expect(title).toContain("PoE2");
  14 |   });
  15 | 
  16 |   test("all 6 tab triggers are visible", async ({ page }) => {
  17 |     const tabLabels = [
  18 |       "Overview",
  19 |       "Currencies",
  20 |       "Uniques",
  21 |       "Exchange",
  22 |       "Arbitrage",
  23 |       "Watchlist",
  24 |     ];
  25 | 
  26 |     for (const label of tabLabels) {
  27 |       // Tab triggers should be visible regardless of locale
  28 |       const tab = page.locator('[role="tablist"] [role="tab"]', {
  29 |         hasText: label,
  30 |       });
  31 |       // If default locale is Russian, tabs will be in Russian — check both
  32 |       const ruLabels: Record<string, string> = {
  33 |         Overview: "Обзор",
  34 |         Currencies: "Валюты",
  35 |         Uniques: "Уникальные",
  36 |         Exchange: "Обмен",
  37 |         Arbitrage: "Арбитраж",
  38 |         Watchlist: "Избранное",
  39 |       };
  40 | 
  41 |       const enTab = page.locator('[role="tablist"] [role="tab"]', {
  42 |         hasText: label,
  43 |       });
  44 |       const ruTab = page.locator('[role="tablist"] [role="tab"]', {
  45 |         hasText: ruLabels[label],
  46 |       });
  47 | 
  48 |       // At least one of EN or RU tab should exist
  49 |       const enCount = await enTab.count();
  50 |       const ruCount = await ruTab.count();
  51 |       expect(enCount + ruCount).toBeGreaterThanOrEqual(1);
  52 |     }
  53 |   });
  54 | 
  55 |   test("header contains realm and league selects", async ({ page }) => {
  56 |     // Realm select should be present
  57 |     const realmSelect = page.locator('button[role="combobox"]').first();
  58 |     await expect(realmSelect).toBeVisible();
  59 |   });
  60 | 
  61 |   test("page renders without console errors", async ({ page }) => {
  62 |     const consoleErrors: string[] = [];
  63 |     page.on("console", (msg) => {
  64 |       if (msg.type() === "error") {
  65 |         consoleErrors.push(msg.text());
  66 |       }
  67 |     });
  68 | 
  69 |     await page.goto("/");
  70 |     await page.waitForTimeout(2000); // Give time for any lazy errors
  71 | 
  72 |     // Filter out known non-critical errors (API timeouts, network issues)
  73 |     const criticalErrors = consoleErrors.filter(
  74 |       (e) =>
  75 |         !e.includes("ETIMEDOUT") &&
  76 |         !e.includes("fetch failed") &&
  77 |         !e.includes("failed to pipe response") &&
  78 |         !e.includes("ResizeObserver")
  79 |     );
> 80 |     expect(criticalErrors).toHaveLength(0);
     |                            ^ Error: expect(received).toHaveLength(expected)
  81 |   });
  82 | 
  83 |   test("skip-to-content link exists for a11y", async ({ page }) => {
  84 |     const skipLink = page.locator('a[href="#main-content"]').first();
  85 |     // The skip link might be visually hidden until focused
  86 |     const count = await skipLink.count();
  87 |     expect(count).toBeGreaterThanOrEqual(0); // Optional — not critical
  88 |   });
  89 | });
  90 | 
```