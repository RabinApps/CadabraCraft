import { expect, test, type Page } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { chapterDoc, newProject, seedChapters, sidebar } from "./support/helpers";

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

const KEY = "cadabracraft.readingPositions";
const read = (page: Page) => page.getByRole("radio", { name: "Read" }).click();
const scroller = (page: Page) => page.getByTestId("reading-scroll");
const book = (page: Page) =>
  seedChapters(page, [
    chapterDoc("Chapter One", 28, 40, 0),
    chapterDoc("Chapter Two", 28, 40, 3),
    chapterDoc("Chapter Three", 28, 40, 5),
  ]);
const stored = (page: Page) =>
  page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "{}") as Record<string, unknown>, KEY);
/** Reopens the book as a new session would: the page reloads and the folder is opened again. */
async function reopen(page: Page) {
  await page.reload();
  await page.getByRole("button", { name: "Open folder" }).click();
  await expect(page.locator(".ProseMirror h1").first()).toBeVisible();
}

test("Read mode resumes where the book was left in the last session", async ({ page }) => {
  await newProject(page);
  await book(page);
  await read(page);
  await expect(page.getByText("Chapter 1 of 3")).toBeVisible();
  await sidebar(page).getByRole("button", { name: "Chapter Three", exact: true }).click();
  await expect(page.getByText("Chapter 3 of 3")).toBeVisible();
  // Scroll a little way into the chapter, and wait for the position to be written to the app preferences.
  await scroller(page).evaluate((sc) => {
    sc.scrollTop += sc.clientHeight;
  });
  await expect.poll(async () => JSON.stringify(await stored(page))).toContain("chapter-3");
  // Never an absolute path in the project, and the book's own files do not carry the position.
  const disk = await page.evaluate(() => JSON.stringify(window.__disk));
  expect(disk).not.toContain("readingPositions");

  await reopen(page);
  await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter One"); // the book opens at its first chapter
  await read(page);
  await expect(page.getByText("Chapter 3 of 3")).toBeVisible();
  await expect(page.locator('[data-reading-id="chapter-3"]')).toBeInViewport();
  // The chapter list follows the reader to where the book was left.
  await expect(
    sidebar(page).getByRole("button", { name: "Chapter Three", exact: true }),
  ).toHaveAttribute("aria-current", "true");
});

test("a chapter chosen in Write mode wins over the saved position, and a damaged one is ignored", async ({
  page,
}) => {
  await newProject(page);
  await book(page);
  await read(page);
  await sidebar(page).getByRole("button", { name: "Chapter Three", exact: true }).click();
  await expect(page.getByText("Chapter 3 of 3")).toBeVisible();
  await expect.poll(async () => JSON.stringify(await stored(page))).toContain("chapter-3");

  await reopen(page);
  await sidebar(page).getByRole("button", { name: "Chapter Two", exact: true }).click();
  await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter Two");
  await read(page);
  await expect(page.getByText("Chapter 2 of 3")).toBeVisible();

  await page.evaluate((k) => localStorage.setItem(k, "{not json"), KEY);
  await reopen(page);
  await read(page);
  await expect(page.getByText("Chapter 1 of 3")).toBeVisible();
});
