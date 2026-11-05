import { expect, test } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import {
  newProject,
  titles,
  chapterAction,
  addPage,
  manifestOf,
  sidebar,
  exportBook,
  focusEnd,
} from "./support/helpers";

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

test("add front and back matter pages with generated content, and they open in the editor", async ({
  page,
}) => {
  await newProject(page);
  await addPage(page, "Title page");
  await expect(page.locator(".ProseMirror h1")).toHaveText("E2E Book");
  await expect(page.locator(".ProseMirror")).toContainText("Tester");
  await expect(sidebar(page).getByRole("heading", { name: "Front matter" })).toBeVisible();
  await addPage(page, "Copyright page");
  await expect(page.locator(".ProseMirror")).toContainText("All rights reserved.");
  await addPage(page, "About the author");
  await expect(page.locator(".ProseMirror h1")).toHaveText("About the Author");
  await expect(sidebar(page).getByRole("heading", { name: "Back matter" })).toBeVisible();
  const m = await manifestOf(page);
  expect(
    m.frontMatter.map((e: { kind: string; files: { en: string } }) => [e.kind, e.files.en]),
  ).toEqual([
    ["title-page", "front-matter/01-title-page.json"],
    ["copyright", "front-matter/02-copyright.json"],
  ]);
  expect(m.backMatter.map((e: { kind: string }) => e.kind)).toEqual(["about-the-author"]);
  // selecting any entry opens the editor on it
  await sidebar(page).getByRole("button", { name: "Title Page", exact: true }).click();
  await expect(page.locator(".ProseMirror h1")).toHaveText("E2E Book");
  await expect(page.getByText("Front matter", { exact: true }).last()).toBeVisible();
});

test("title page and copyright page can only be added once", async ({ page }) => {
  await newProject(page);
  await addPage(page, "Title page");
  await page.getByRole("button", { name: "Add page" }).click();
  await expect(page.getByRole("menuitem", { name: "Title page", exact: true })).toHaveAttribute(
    "data-disabled",
    "",
  );
  await expect(
    page.getByRole("menuitem", { name: "Copyright page", exact: true }),
  ).not.toHaveAttribute("data-disabled", "");
  await expect(page.getByRole("menuitem", { name: "Dedication", exact: true })).not.toHaveAttribute(
    "data-disabled",
    "",
  );
});

test("rename, reorder and delete front and back matter", async ({ page }) => {
  await newProject(page);
  await addPage(page, "Dedication");
  await addPage(page, "Foreword");
  await chapterAction(page, "Foreword", "Rename");
  await page.getByLabel("Page title").fill("Words Before");
  await page.keyboard.press("Enter");
  await expect(
    sidebar(page).getByRole("button", { name: "Words Before", exact: true }),
  ).toBeVisible();
  await chapterAction(page, "Words Before", "Move up");
  expect(
    (await manifestOf(page)).frontMatter.map((e: { titles: { en: string } }) => e.titles.en),
  ).toEqual(["Words Before", "Dedication"]);
  await page.getByRole("button", { name: "Actions for Words Before" }).click();
  await expect(page.getByRole("menuitem", { name: "Move up" })).toHaveAttribute(
    "data-disabled",
    "",
  );
  await page.keyboard.press("Escape");

  await addPage(page, "Acknowledgments");
  await addPage(page, "Colophon");
  await chapterAction(page, "Colophon", "Move up");
  expect((await manifestOf(page)).backMatter.map((e: { kind: string }) => e.kind)).toEqual([
    "colophon",
    "acknowledgments",
  ]);

  await chapterAction(page, "Dedication", "Move to trash");
  await page.getByRole("dialog").getByRole("button", { name: "Move to trash" }).click();
  await expect(sidebar(page).getByRole("button", { name: "Dedication", exact: true })).toHaveCount(
    0,
  );
  const trashed = await page.evaluate(() =>
    Object.keys(window.__disk).filter((k) => k.startsWith(".cadabra/trash/")),
  );
  expect(trashed).toEqual([".cadabra/trash/20260101-1200-front-matter__01-dedication.json"]);
  expect((await manifestOf(page)).chapters).toHaveLength(1); // chapters untouched
});

test("keyboard: the Add page menu opens and selects with the keyboard", async ({ page }) => {
  await newProject(page);
  await page.getByRole("button", { name: "Add page" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(page.getByRole("menuitem").first()).toBeFocused();
  // The menu opens on Blank page, so two ArrowDowns pass Title page and land on Copyright.
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem").nth(1)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem").nth(2)).toBeFocused(); // Enter before focus moves would pick the first item
  await page.keyboard.press("Enter");
  await expect(sidebar(page).getByRole("button", { name: "Copyright", exact: true })).toBeVisible();
  expect((await manifestOf(page)).frontMatter.map((e: { kind: string }) => e.kind)).toEqual([
    "copyright",
  ]);
});

test("EPUB and PDF exports include the matter pages", async ({ page }) => {
  await newProject(page);
  await addPage(page, "Title page");
  await addPage(page, "Acknowledgments");
  await exportBook(page, "EPUB 3");
  await expect(page.getByRole("status")).toHaveText("Exported exports/en/book.epub");
  const names = await page.evaluate(() => {
    const b = window.__disk["exports/en/book.epub"] as number[];
    return String.fromCharCode(...b).match(/OEBPS\/(fm|bm|ch)-\d+\.xhtml/g);
  });
  expect([...new Set(names)].sort()).toEqual([
    "OEBPS/bm-1.xhtml",
    "OEBPS/ch-1.xhtml",
    "OEBPS/fm-1.xhtml",
  ]);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Export book" })
    .getByRole("radio", { name: "Print PDF" })
    .click();
  await page
    .getByRole("dialog", { name: "Export book" })
    .getByRole("button", { name: "Export", exact: true })
    .click();
  await expect(page.getByRole("status")).toHaveText("Exported exports/en/book.pdf");
  const source: string = await page.evaluate(() => window.__typstCalls[0]!.source);
  expect(source).toContain("#title-page(");
  expect(source).toContain('#chapter-start("Acknowledgments", none, id:');
});

test("restoring a page from the trash puts it back at the end and opens it", async ({ page }) => {
  await newProject(page);
  await page.getByRole("button", { name: "Add chapter" }).click();
  await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter 2");
  await chapterAction(page, "Chapter 2", "Move to trash");
  await page.getByRole("dialog").getByRole("button", { name: "Move to trash" }).click();
  await expect(page.getByRole("button", { name: "Chapter 2", exact: true })).toHaveCount(0);
  // A new chapter takes the freed file name, so the restored page must not overwrite it.
  await page.getByRole("button", { name: "Add chapter" }).click();
  await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter 2");
  await focusEnd(page);
  await page.keyboard.type("new one");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved");

  await page.getByRole("button", { name: "Trash", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Trash" });
  await expect(dialog.getByText("Chapter 2")).toBeVisible();
  await dialog.getByRole("button", { name: "Restore Chapter 2" }).click();
  await expect(dialog).toHaveCount(0);

  const manifest = await page.evaluate(() => JSON.parse(window.__disk["cadabra.json"] as string));
  expect(manifest.chapters.map((c: { titles: { en: string } }) => c.titles.en)).toEqual([
    "Chapter One",
    "Chapter 2",
    "Chapter 2",
  ]);
  const files: string[] = manifest.chapters.map((c: { files: { en: string } }) => c.files.en);
  expect(new Set(files).size).toBe(3);
  const disk = await page.evaluate(() => window.__disk as Record<string, string>);
  expect(disk[files[1]!]).toContain("new one");
  expect(Object.keys(disk).filter((k) => k.startsWith(".cadabra/trash/"))).toEqual([]);
  await expect(page.getByRole("button", { name: "Chapter 2", exact: true })).toHaveCount(2);
  expect(await titles(page)).toEqual(["Chapter 2"]);

  await page.getByRole("button", { name: "Trash", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Trash" }).getByText("The trash is empty."),
  ).toBeVisible();
});
