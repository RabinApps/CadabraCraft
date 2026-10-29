import { expect, test, type Page } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { newProject } from "./support/helpers";

// Every enabled language switches the whole interface, and the right-to-left ones mirror the layout.
const LANGUAGES = [
  { code: "es", dir: "ltr", settings: "Ajustes" },
  { code: "it", dir: "ltr", settings: "Impostazioni" },
  { code: "fr", dir: "ltr", settings: "Réglages" },
  { code: "de", dir: "ltr", settings: "Einstellungen" },
  { code: "he", dir: "rtl", settings: "הגדרות" },
  { code: "ar", dir: "rtl", settings: "الإعدادات" },
] as const;

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

const noOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

for (const { code, dir, settings } of LANGUAGES) {
  test(`${code}: the interface switches language and ${dir === "rtl" ? "mirrors" : "keeps"} its direction`, async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByLabel("Interface language").selectOption(code);
    await expect(page.getByRole("heading", { name: settings, level: 1 })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", code);
    await expect(page.locator("html")).toHaveAttribute("dir", dir);
    expect(await noOverflow(page)).toBe(true);
    // The choice is remembered across a reload.
    await page.reload();
    await page.getByRole("button", { name: settings }).first().click();
    await expect(page.getByRole("heading", { name: settings, level: 1 })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("dir", dir);
  });
}

for (const { code, settings } of LANGUAGES.filter((l) => l.dir === "rtl")) {
  test(`${code}: the editor mirrors and does not overflow`, async ({ page }) => {
    await newProject(page);
    await page.getByRole("button", { name: "Settings" }).first().click();
    await page.getByLabel("Interface language").selectOption(code);
    await expect(page.getByRole("heading", { name: settings, level: 1 })).toBeVisible();
    // The back arrow is the first button of the page header.
    await page.locator("header").first().getByRole("button").first().click();
    await expect(page.locator(".ProseMirror")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    const vw = page.viewportSize()?.width ?? 1280;
    const sidebar = await page.locator("nav").first().boundingBox();
    expect(sidebar && sidebar.x + sidebar.width / 2 > vw / 2).toBe(true);
    expect(await noOverflow(page)).toBe(true);
  });
}
