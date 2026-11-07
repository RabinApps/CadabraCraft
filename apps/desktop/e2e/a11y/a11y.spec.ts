import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "../support/coverage";
import { fakeTauri } from "../support/fakeTauri";
import {
  addPage,
  applyE2eLocale,
  chapterAction,
  inLocaleRun,
  newProject,
} from "../support/helpers";
import { fakeImportSources } from "../support/fakeImport";
import { moreScreens, screens as everyScreen } from "../support/a11yScreens";

// WCAG 2.0 to 2.2 A and AA (docs/accessibility.md).
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function scan(page: Page, what: string) {
  // Overlays scale in; scan them at rest so contrast is measured on final colors.
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))),
  );
  // An open modal menu (Radix) marks the page behind it aria-hidden and traps focus in the menu, so nothing behind it can be
  // reached; axe cannot tell and reports every focusable element there, so that one rule is off while a menu is open.
  const menuOpen = (await page.getByRole("menu").count()) > 0;
  const axe = new AxeBuilder({ page }).withTags(TAGS);
  if (menuOpen) axe.disableRules(["aria-hidden-focus"]);
  const { violations } = await axe.analyze();
  const summary = violations.map(
    (v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
  );
  expect(summary, `${what}: axe violations`).toEqual([]);
}

const preview = (page: Page) => page.getByRole("region", { name: "Preview", exact: true });
const typstPages = (page: Page) =>
  page.evaluate(() => {
    window.__typstPages = 6;
    window.__typstQueryResultFor = (source: string) => {
      const id = /#contents-page\("([^"]+)"/.exec(source)?.[1];
      return id
        ? JSON.stringify({
            total: 6,
            starts: [{ id, kind: "contents", page: 2, end: 3, number: "ii" }],
          })
        : undefined;
    };
  });

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

    for (const { name, open } of [
      ...(inLocaleRun
        ? everyScreen
        : [
            ...moreScreens,
            ...everyScreen.filter((x) => /menu/i.test(x.name) && !moreScreens.includes(x)),
          ]),
    ]) {
      test(`axe: ${name}`, async ({ page }) => {
        await open(page);
        await applyE2eLocale(page);
        await scan(page, name);
      });
    }

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

    test("import outline preview", async ({ page }) => {
      await fakeImportSources(page, "outlineMd");
      await page.goto("/");
      await page.getByRole("button", { name: "Import…" }).click();
      const dialog = page.getByRole("dialog", { name: "Import a manuscript" });
      await dialog.getByRole("button", { name: "Choose file…" }).click();
      await dialog.getByRole("button", { name: "Choose…" }).click();
      await dialog.getByRole("button", { name: "Next" }).click();
      await scan(page, "import preview of a Markdown file (Read this file as)");
      await dialog.getByRole("radio", { name: "Outline" }).click();
      await expect(dialog.getByText("2 chapters and 3 scenes will be imported.")).toBeVisible();
      await scan(page, "import outline preview");
    });

    test("editor", async ({ page }) => {
      await newProject(page);
      await scan(page, "editor");
    });

    test("contents page: list, preview and its dialogs", async ({ page }) => {
      await newProject(page);
      await typstPages(page);
      await addPage(page, "Contents");
      const contents = page.getByRole("region", { name: "Contents", exact: true });
      await expect(contents).toBeVisible();
      await expect(
        page.getByRole("region", { name: "Preview", exact: true }).locator("canvas").first(),
      ).toBeVisible({ timeout: 15_000 });
      await scan(page, "contents list and preview");
      // (The open row menu is not scanned: Radix hides the page behind any menu, and axe's aria-hidden-focus then
      // flags every scrollable area of the shell, the same as for the chapter menu.)
      await contents.getByRole("button", { name: "Actions for Chapter One" }).click();
      await page.getByRole("menuitem", { name: "Rename" }).click();
      await expect(contents.getByRole("textbox", { name: "Entry title" })).toBeFocused();
      await scan(page, "contents entry being renamed");
      await page.keyboard.press("Escape");
      await contents.getByRole("button", { name: "Add custom entry" }).click();
      await expect(page.getByRole("dialog", { name: "Add custom entry" })).toBeVisible();
      await scan(page, "add custom entry dialog");
      await page.getByRole("button", { name: "Add entry" }).click();
      await expect(page.getByRole("alert")).toBeVisible();
      await scan(page, "add custom entry dialog with its error");
      await page.keyboard.press("Escape");
      await contents.getByRole("button", { name: "Actions for Chapter One" }).click();
      await page.getByRole("menuitem", { name: "Hide from contents" }).click();
      await contents.getByRole("button", { name: "Reset to outline" }).click();
      await expect(
        page.getByRole("dialog", { name: "Reset the contents to the outline?" }),
      ).toBeVisible();
      await scan(page, "reset to outline confirmation");
    });

    test("contents page below the wide layout: one pane at a time", async ({ page }) => {
      await newProject(page);
      await typstPages(page);
      await addPage(page, "Contents");
      await page.setViewportSize({ width: 800, height: 800 });
      const contents = page.getByRole("region", { name: "Contents", exact: true });
      await scan(page, "contents, Edit pane");
      await contents.getByRole("radio", { name: "Preview" }).click();
      await expect(page.getByRole("region", { name: "Preview", exact: true })).toBeVisible();
      await expect(preview(page).locator("canvas").first()).toBeVisible({ timeout: 15_000 });
      await scan(page, "contents, Preview pane");
    });

    test("contents preview drawn by the app when Typst is missing", async ({ page }) => {
      await newProject(page);
      await page.evaluate(() => {
        window.__typstError = { kind: "not_found", message: "The typst program was not found." };
      });
      await addPage(page, "Contents");
      await expect(page.getByTestId("toc-preview-page").first()).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId("toc-preview-fallback")).toBeVisible();
      await scan(page, "contents approximation");
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
