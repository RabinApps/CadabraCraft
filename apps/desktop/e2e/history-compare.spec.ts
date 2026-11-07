import type { Page } from "@playwright/test";
import { expect, test } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { covBackend, failOn } from "./support/cov";
import { seedBookSnapshots } from "./support/bookSnapshots";
import { newProject, chapterAction, seedSnapshot, focusEnd } from "./support/helpers";

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
  await covBackend(page);
});

const save = async (page: Page) => {
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved");
};

/** A book with " old words" saved, one book snapshot of that, then " new words" typed and saved. */
async function bookWithSnapshot(page: Page) {
  await newProject(page);
  await focusEnd(page);
  await page.keyboard.type(" old words");
  await save(page);
  const [path] = await seedBookSnapshots(page, [{ name: "Before the edit" }]);
  await focusEnd(page);
  await page.keyboard.type(" new words");
  await save(page);
  return path!;
}

const wholeBook = async (page: Page, chapter = "Chapter One") => {
  await chapterAction(page, chapter, "History");
  const dialog = page.getByRole("dialog", { name: `History · ${chapter}` });
  await dialog.getByRole("radio", { name: "Whole book" }).click();
  return dialog;
};

const COMPARE = "Comparison of “Chapter One” with the snapshot";

test("Whole book view compares this chapter in the snapshot with the current text before Restore this page only", async ({
  page,
}) => {
  await bookWithSnapshot(page);
  const dialog = await wholeBook(page);
  const compare = dialog.getByLabel(COMPARE);
  await expect(compare).toBeVisible();
  await expect(compare.locator("del", { hasText: "new" })).toBeVisible(); // only in the current text
  await expect(compare.locator("ins")).toHaveCount(0);
  const restore = dialog.getByRole("button", { name: "Restore this page only" });
  const a = (await compare.boundingBox())!;
  const b = (await restore.boundingBox())!;
  expect(a.y + a.height).toBeLessThanOrEqual(b.y);

  // Restoring from here brings back the compared text.
  await restore.click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(".ProseMirror")).not.toContainText("new words");
});

test("Whole book compare says when the text is the same, and follows the selected snapshot", async ({
  page,
}) => {
  await newProject(page);
  await focusEnd(page);
  await page.keyboard.type(" same words");
  await save(page);
  await seedBookSnapshots(page, [{ name: "First" }]);
  await page.evaluate(() => {
    // A second, newer snapshot that has other words in the chapter.
    const key = Object.keys(window.__disk).find((k) => k.startsWith(".cadabra/snapshots/"))!;
    const f = JSON.parse(window.__disk[key] as string);
    const first = Object.keys(f.pages)[0]!;
    f.name = "Second";
    f.pages[first] = JSON.stringify({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "different text" }] }],
    });
    window.__disk[".cadabra/snapshots/20261015-1000.json"] = JSON.stringify(f);
  });
  const dialog = await wholeBook(page);
  const compare = dialog.getByLabel(COMPARE);
  await expect(compare.locator("ins", { hasText: "different" })).toBeVisible(); // the newest is selected
  await dialog.getByRole("button", { name: /^First/ }).click();
  await expect(compare).toContainText("same words as the current text");
});

test("Whole book compare: a snapshot without this chapter says so and offers no restore", async ({
  page,
}) => {
  await newProject(page);
  await seedBookSnapshots(page, [{ name: "Only chapter one" }]);
  await page.getByRole("button", { name: "Add chapter" }).click();
  await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter 2");
  const dialog = await wholeBook(page, "Chapter 2");
  await expect(dialog.getByRole("status")).toContainText(
    "This snapshot has no copy of “Chapter 2”",
  );
  await expect(dialog.getByRole("button", { name: "Restore this page only" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Restore whole book" })).toBeEnabled();
});

test("Whole book compare: a chapter that is in the snapshot but no longer in the book", async ({
  page,
}) => {
  await newProject(page);
  await focusEnd(page);
  await page.keyboard.type(" old words");
  await save(page);
  await seedBookSnapshots(page, [{ name: "Before" }]);
  const { file } = await seedSnapshot(page, "x"); // only for the chapter file's path
  await page.evaluate((f) => {
    delete window.__disk[f];
  }, file);
  const dialog = await wholeBook(page);
  const compare = dialog.getByLabel(COMPARE);
  await expect(compare).toContainText("This chapter is not in the book now");
  await expect(compare.locator("ins", { hasText: "old" })).toBeVisible();
  await expect(compare.locator("del")).toHaveCount(0);
});

test("Whole book compare: a snapshot page that is gone, unreadable or fails to load", async ({
  page,
}) => {
  const path = await bookWithSnapshot(page);
  await failOn(page, "read_book_snapshot_page", { kind: "not_found", path: "x" }, 1);
  let dialog = await wholeBook(page);
  await expect(dialog.getByRole("status")).toContainText("has no copy of “Chapter One”");
  await page.keyboard.press("Escape");

  await failOn(page, "read_book_snapshot_page", { kind: "io", message: "disk exploded" }, 1);
  dialog = await wholeBook(page);
  await expect(dialog.getByRole("alert")).toContainText("Could not compare “Chapter One”");
  await expect(dialog.getByRole("alert")).toContainText("disk exploded");
  await page.keyboard.press("Escape");

  await page.evaluate((k) => {
    const f = JSON.parse(window.__disk[k] as string);
    for (const p of Object.keys(f.pages)) f.pages[p] = "{ not a chapter";
    window.__disk[k] = JSON.stringify(f);
  }, path);
  dialog = await wholeBook(page);
  await expect(dialog.getByRole("alert")).toContainText("could not be read as a chapter");
});

test("Whole book compare fits a phone and mirrors in RTL", async ({ page }) => {
  await bookWithSnapshot(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Show chapters" }).click();
  await chapterAction(page, "Chapter One", "History");
  const dialog = page.getByRole("dialog", { name: "History · Chapter One" });
  await dialog.getByRole("radio", { name: "Whole book" }).click();
  await expect(dialog.getByLabel(COMPARE)).toBeVisible();
  const fits = () =>
    page.evaluate(() => {
      const d = document.querySelector("[role=dialog]")!;
      return (
        d.scrollWidth <= d.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth + 1
      );
    });
  expect(await fits()).toBe(true);
  await page.evaluate(() => {
    document.documentElement.dir = "rtl";
  });
  expect(await fits()).toBe(true);
});
