# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: i18n.spec.ts >> Internationalization (i18n) >> switching language to English updates UI text
- Location: e2e\i18n.spec.ts:11:7

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for locator('button[aria-label="Switch language"], button[aria-label="Переключить язык"]').first()

```

# Page snapshot

```yaml
- generic [ref=e1]:
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
          - heading "PoE2 市场" [level=1] [ref=e28]
        - combobox [ref=e29]:
          - img
        - combobox [ref=e30]:
          - generic: 联赛
          - img
        - generic [ref=e31]:
          - img [ref=e32]
          - textbox "搜索物品..." [ref=e35]
        - button "启用自动刷新" [ref=e36]:
          - img
          - text: 自动
        - button "刷新数据" [ref=e37]:
          - img
          - text: 刷新
        - button "切换语言" [active] [ref=e38]:
          - img
          - generic [ref=e39]: 中
        - button "切换到浅色模式" [ref=e40]:
          - img
    - main [ref=e41]:
      - status [ref=e42]:
        - img [ref=e43]
        - paragraph [ref=e45]: 请选择服务器和联赛开始
    - alert [ref=e46]:
      - generic [ref=e47]:
        - img [ref=e48]
        - generic [ref=e55]: 您已离线。显示缓存数据。
      - button "关闭离线横幅" [ref=e56]:
        - img [ref=e57]
  - region "Notifications alt+T"
  - alert [ref=e60]
```

# Test source

```ts
  1   | /**
  2   |  * i18n tests — verify language switching works correctly.
  3   |  */
  4   | import { test, expect } from "@playwright/test";
  5   | 
  6   | test.describe("Internationalization (i18n)", () => {
  7   |   test.beforeEach(async ({ page }) => {
  8   |     await page.goto("/");
  9   |   });
  10  | 
  11  |   test("switching language to English updates UI text", async ({ page }) => {
  12  |     // Find the globe button (language switcher)
  13  |     const globeButton = page.locator('button[aria-label="Switch language"], button[aria-label="Переключить язык"]').first();
  14  |     await expect(globeButton).toBeVisible();
  15  | 
  16  |     // Cycle through locales until we see English tab names
  17  |     // Default locale is RU, so clicking once should switch to EN
  18  |     let foundEnglish = false;
  19  |     for (let i = 0; i < 4; i++) {
> 20  |       await globeButton.click();
      |                         ^ Error: locator.click: Test timeout of 30000ms exceeded.
  21  |       await page.waitForTimeout(500);
  22  | 
  23  |       // Check if "Overview" tab is now visible (English)
  24  |       const overviewTab = page.locator('[role="tablist"] [role="tab"]', {
  25  |         hasText: "Overview",
  26  |       });
  27  |       const count = await overviewTab.count();
  28  |       if (count > 0) {
  29  |         foundEnglish = true;
  30  |         break;
  31  |       }
  32  |     }
  33  | 
  34  |     expect(foundEnglish).toBeTruthy();
  35  | 
  36  |     // Verify the tab text is in English
  37  |     const overviewTab = page.locator('[role="tablist"] [role="tab"]', {
  38  |       hasText: "Overview",
  39  |     });
  40  |     await expect(overviewTab).toBeVisible();
  41  |   });
  42  | 
  43  |   test("switching language to Russian updates UI text", async ({ page }) => {
  44  |     // Default is Russian, so tabs should already be in Russian
  45  |     const overviewTab = page.locator('[role="tablist"] [role="tab"]', {
  46  |       hasText: "Обзор",
  47  |     });
  48  |     const count = await overviewTab.count();
  49  | 
  50  |     if (count > 0) {
  51  |       // Already in Russian
  52  |       await expect(overviewTab).toBeVisible();
  53  |       return;
  54  |     }
  55  | 
  56  |     // If not in Russian, cycle through locales
  57  |     const globeButton = page.locator('button[aria-label="Switch language"], button[aria-label="Переключить язык"]').first();
  58  |     for (let i = 0; i < 4; i++) {
  59  |       await globeButton.click();
  60  |       await page.waitForTimeout(500);
  61  | 
  62  |       const ruTab = page.locator('[role="tablist"] [role="tab"]', {
  63  |         hasText: "Обзор",
  64  |       });
  65  |       const ruCount = await ruTab.count();
  66  |       if (ruCount > 0) {
  67  |         await expect(ruTab).toBeVisible();
  68  |         return;
  69  |       }
  70  |     }
  71  | 
  72  |     // If we couldn't find Russian, the test fails
  73  |     expect(false).toBeTruthy();
  74  |   });
  75  | 
  76  |   test("switching language to Chinese updates UI text", async ({ page }) => {
  77  |     const globeButton = page.locator('button[aria-label="Switch language"], button[aria-label="切换语言"]').first();
  78  | 
  79  |     for (let i = 0; i < 4; i++) {
  80  |       await globeButton.click();
  81  |       await page.waitForTimeout(500);
  82  | 
  83  |       const zhTab = page.locator('[role="tablist"] [role="tab"]', {
  84  |         hasText: "概览",
  85  |       });
  86  |       const count = await zhTab.count();
  87  |       if (count > 0) {
  88  |         await expect(zhTab).toBeVisible();
  89  |         return;
  90  |       }
  91  |     }
  92  |   });
  93  | 
  94  |   test("language preference persists on page reload", async ({ page }) => {
  95  |     const globeButton = page.locator('button[aria-label="Switch language"], button[aria-label="Переключить язык"]').first();
  96  | 
  97  |     // Switch to English
  98  |     for (let i = 0; i < 4; i++) {
  99  |       await globeButton.click();
  100 |       await page.waitForTimeout(500);
  101 | 
  102 |       const enTab = page.locator('[role="tablist"] [role="tab"]', {
  103 |         hasText: "Overview",
  104 |       });
  105 |       const count = await enTab.count();
  106 |       if (count > 0) break;
  107 |     }
  108 | 
  109 |     // Reload the page
  110 |     await page.reload();
  111 |     await page.waitForTimeout(1000);
  112 | 
  113 |     // After reload, locale should be restored from localStorage
  114 |     // (initially renders with default, then hydrates to stored locale)
  115 |     const enTab = page.locator('[role="tablist"] [role="tab"]', {
  116 |       hasText: "Overview",
  117 |     });
  118 |     // Give time for hydration
  119 |     await expect(enTab).toBeVisible({ timeout: 5000 });
  120 |   });
```