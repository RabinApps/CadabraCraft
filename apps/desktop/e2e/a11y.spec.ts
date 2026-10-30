import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { newProject } from "./support/helpers";

// WCAG 2.0 to 2.2 A and AA (docs/accessibility.md).
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function scan(page: Page, what: string) {
  // Overlays scale in; scan them at rest so contrast is measured on final colors.
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))),
  );
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const summary = violations.map(
    (v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
  );
  expect(summary, `${what}: axe violations`).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

for (const theme of ["light", "dark"] as const) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((th) => {
        document.documentElement.dataset.theme = th;
      }, theme);
    });

    test("home screen and new book dialog", async ({ page }) => {
      await page.goto("/");
      await scan(page, "home");
      await page.getByRole("button", { name: "New project" }).click();
      await expect(page.getByRole("dialog", { name: "New book" })).toBeVisible();
      await scan(page, "new book dialog");
    });

    test("editor", async ({ page }) => {
      await newProject(page);
      await scan(page, "editor");
    });
  });
}

test("dialogs close with Escape and give focus back", async ({ page }) => {
  await page.goto("/");
  const open = page.getByRole("button", { name: "New project" });
  await open.click();
  await expect(page.getByRole("dialog", { name: "New book" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(open).toBeFocused();
});
