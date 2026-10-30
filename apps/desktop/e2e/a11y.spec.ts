import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { chapterAction, newProject } from "./support/helpers";
import { fakeImportSources } from "./support/fakeImport";

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

    test("settings screen", async ({ page }) => {
      await page.goto("/");
      await page.getByRole("button", { name: "Settings" }).click();
      await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
      await scan(page, "settings");
    });

    test("export dialog and history dialog", async ({ page }) => {
      await newProject(page);
      await page.getByRole("button", { name: "Export", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Export book" })).toBeVisible();
      await scan(page, "export dialog");
      await page.keyboard.press("Escape");
      await chapterAction(page, "Chapter One", "History");
      await expect(page.getByRole("dialog", { name: "History · Chapter One" })).toBeVisible();
      await scan(page, "history dialog");
    });

    test("import dialog", async ({ page }) => {
      await fakeImportSources(page, "md");
      await page.goto("/");
      await page.getByRole("button", { name: "Import…" }).click();
      const dialog = page.getByRole("dialog", { name: "Import a manuscript" });
      await expect(dialog).toBeVisible();
      await scan(page, "import dialog");
      await dialog.getByRole("button", { name: "Choose file…" }).click();
      await expect(dialog.getByLabel("File")).not.toHaveValue("");
      await dialog.getByRole("button", { name: "Choose…" }).click();
      await dialog.getByRole("button", { name: "Next" }).click();
      await scan(page, "import chapter list");
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
