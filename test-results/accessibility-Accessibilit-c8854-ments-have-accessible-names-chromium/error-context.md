# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: accessibility.spec.ts >> Accessibility Checks >> all interactive elements have accessible names
- Location: e2e\accessibility.spec.ts:13:7

# Error details

```
Error: expect(received).toBeTruthy()

Received: ""
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - link "Skip to main content" [ref=e2] [cursor=pointer]:
    - /url: "#main-content"
  - generic [ref=e3]:
    - banner [ref=e4]:
      - generic [ref=e5]:
        - generic [ref=e6]:
          - img [ref=e7]
          - heading "PoE2 Маркет" [level=1] [ref=e9]
        - combobox [ref=e10]:
          - img
        - combobox [ref=e11]:
          - generic: Лига
          - img
        - generic [ref=e12]:
          - img [ref=e13]
          - textbox "Поиск предметов..." [ref=e16]
        - button "Включить автообновление" [ref=e17]:
          - img
          - text: Авто
        - button "Обновить данные" [ref=e18]:
          - img
          - text: Обновить
        - button "Переключить язык" [ref=e19]:
          - img
          - generic [ref=e20]: RU
        - button "Переключить на светлую тему" [ref=e21]:
          - img
    - main [ref=e22]:
      - status [ref=e23]:
        - img [ref=e24]
        - paragraph [ref=e26]: Выберите реальм и лигу для начала
    - alert [ref=e27]:
      - generic [ref=e28]:
        - img [ref=e29]
        - generic [ref=e36]: Вы офлайн. Отображаются кешированные данные.
      - button "Закрыть баннер офлайна" [ref=e37]:
        - img [ref=e38]
  - region "Notifications alt+T"
  - alert [ref=e41]
```

# Test source

```ts
  1   | /**
  2   |  * Accessibility tests — basic a11y checks for each tab.
  3   |  * Uses Playwright's built-in accessibility assertions.
  4   |  * For a full axe-core audit, install @axe-core/playwright.
  5   |  */
  6   | import { test, expect } from "@playwright/test";
  7   | 
  8   | test.describe("Accessibility Checks", () => {
  9   |   test.beforeEach(async ({ page }) => {
  10  |     await page.goto("/");
  11  |   });
  12  | 
  13  |   test("all interactive elements have accessible names", async ({ page }) => {
  14  |     // Check that buttons have aria-labels or visible text
  15  |     const buttons = page.locator("button");
  16  |     const count = await buttons.count();
  17  | 
  18  |     for (let i = 0; i < Math.min(count, 20); i++) {
  19  |       const btn = buttons.nth(i);
  20  |       const ariaLabel = await btn.getAttribute("aria-label");
  21  |       const textContent = await btn.textContent();
  22  |       const hasAccessibleName = ariaLabel || (textContent && textContent.trim().length > 0);
> 23  |       expect(hasAccessibleName).toBeTruthy();
      |                                 ^ Error: expect(received).toBeTruthy()
  24  |     }
  25  |   });
  26  | 
  27  |   test("main content landmark exists", async ({ page }) => {
  28  |     const main = page.locator('main, [role="main"]');
  29  |     await expect(main).toBeVisible();
  30  |   });
  31  | 
  32  |   test("tab list has proper ARIA roles", async ({ page }) => {
  33  |     const tabList = page.locator('[role="tablist"]').first();
  34  |     await expect(tabList).toBeVisible();
  35  | 
  36  |     const tabs = tabList.locator('[role="tab"]');
  37  |     const tabCount = await tabs.count();
  38  |     expect(tabCount).toBe(6);
  39  |   });
  40  | 
  41  |   test("dialog focus trapping works", async ({ page }) => {
  42  |     // Select a realm and league first
  43  |     const realmSelect = page.locator('button[role="combobox"]').first();
  44  |     await realmSelect.click();
  45  |     const pcOption = page.locator('[role="option"]', { hasText: "PC" }).first();
  46  |     const pcCount = await pcOption.count();
  47  |     if (pcCount > 0) {
  48  |       await pcOption.click();
  49  |       await page.waitForTimeout(1000);
  50  | 
  51  |       // Select first league
  52  |       const leagueSelect = page.locator('button[role="combobox"]').nth(1);
  53  |       await leagueSelect.click();
  54  |       const firstLeague = page.locator('[role="option"]').first();
  55  |       const leagueCount = await firstLeague.count();
  56  |       if (leagueCount > 0) {
  57  |         await firstLeague.click();
  58  |         await page.waitForTimeout(2000);
  59  |       }
  60  |     }
  61  | 
  62  |     // Try to open price alerts dialog
  63  |     const alertButton = page.locator("button", { hasText: /alert|оповещ/i }).first();
  64  |     const alertCount = await alertButton.count();
  65  |     if (alertCount > 0) {
  66  |       await alertButton.click();
  67  |       await page.waitForTimeout(500);
  68  | 
  69  |       // Dialog should be open
  70  |       const dialog = page.locator('[role="dialog"]').first();
  71  |       const dialogCount = await dialog.count();
  72  |       if (dialogCount > 0) {
  73  |         // Press Escape to close
  74  |         await page.keyboard.press("Escape");
  75  |         await page.waitForTimeout(300);
  76  | 
  77  |         // Dialog should be closed
  78  |         const dialogAfterClose = await page.locator('[role="dialog"]').count();
  79  |         expect(dialogAfterClose).toBe(0);
  80  |       }
  81  |     }
  82  |   });
  83  | 
  84  |   test("images have alt text", async ({ page }) => {
  85  |     const images = page.locator("img");
  86  |     const count = await images.count();
  87  | 
  88  |     for (let i = 0; i < Math.min(count, 20); i++) {
  89  |       const img = images.nth(i);
  90  |       const alt = await img.getAttribute("alt");
  91  |       // alt="" is valid for decorative images
  92  |       expect(alt).not.toBeNull();
  93  |     }
  94  |   });
  95  | 
  96  |   test("color contrast — no text-muted-foreground on light backgrounds without sufficient contrast", async ({ page }) => {
  97  |     // This is a visual test that can't be fully automated without axe-core.
  98  |     // We check that the page doesn't use obviously failing color combinations.
  99  |     const mutedElements = page.locator(".text-muted-foreground");
  100 |     const count = await mutedElements.count();
  101 | 
  102 |     // Just verify muted-foreground elements exist (they're styled by Tailwind)
  103 |     // A real contrast audit needs axe-core or manual testing
  104 |     expect(count).toBeGreaterThan(0);
  105 |   });
  106 | });
  107 | 
```