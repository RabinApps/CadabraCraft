import { expect, test, type Locator, type Page } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { addPage, manifestOf, newProject, sidebar } from "./support/helpers";
import { opening, writeCards } from "./support/pageCards";

// Two writing-surface fixes: a front matter page that the book's rules push to a right-hand page can follow on instead (no blank
// page the author cannot delete), and scrolling on past the last page of a section opens the next one (and up from the top, the
// previous one), so front matter and chapters read as one flow while writing.

const open = async (page: Page, title: string) => {
  const entry = sidebar(page).getByRole("button", { name: title, exact: true });
  await entry.click();
  await expect(entry).toHaveAttribute("aria-current", "true");
};
const menu = (page: Page) => page.getByRole("menu");
const startItem = (page: Page) =>
  menu(page).getByRole("menuitemcheckbox", { name: "Start on the next page" });
const cardsAre = (page: Page, n: number) =>
  expect.poll(async () => (await writeCards(page)).length).toBe(n);

/** The page stack's scroller, hovered so the wheel events land on it. */
const hoverScroll = async (page: Page, testId = "page-scroll") => {
  const box = (await page.getByTestId(testId).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
};
const scrollTop = (page: Page, testId = "page-scroll") =>
  page.getByTestId(testId).evaluate((el) => Math.round(el.scrollTop));
const atBottom = (page: Page, testId = "page-scroll") =>
  page.getByTestId(testId).evaluate((el) => el.scrollTop >= el.scrollHeight - el.clientHeight - 2);

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

test("a dedication's blank page is gone once its row says it starts on the next page, and undo brings it back", async ({
  page,
}) => {
  await newProject(page);
  await addPage(page, "Title page");
  await addPage(page, "Dedication");
  await open(page, "Dedication");
  // The book opens a dedication on a right-hand page, after the title page: a blank left-hand page comes before it, and nobody
  // typed it.
  await cardsAre(page, 2);
  const withBlank = await writeCards(page);
  expect(withBlank[0]?.blank).toBe(true);
  expect(opening(withBlank)?.physical).toBe(3);

  await page.getByRole("button", { name: "Actions for Dedication" }).click();
  const item = startItem(page);
  await expect(item).not.toBeChecked();
  await item.click();
  await expect(page.getByText("Dedication: starts on the next page")).toBeAttached();
  const dedication = async () =>
    (await manifestOf(page)).frontMatter.find((e: { kind: string }) => e.kind === "dedication");
  await expect.poll(async () => (await dedication())?.startOnNext).toBe(true);
  await cardsAre(page, 1);
  const alone = await writeCards(page);
  expect(alone[0]?.blank).toBe(false);
  expect(opening(alone)?.physical).toBe(2);

  // It is a page setting like any other: undo puts the blank page back.
  await page.getByRole("button", { name: /^Undo: Change page start/ }).click();
  await expect.poll(async () => (await dedication())?.startOnNext).toBeUndefined();
  await cardsAre(page, 2);
  await page.getByRole("button", { name: "Actions for Dedication" }).click();
  await expect(startItem(page)).not.toBeChecked();
  await page.keyboard.press("Escape");
});

test("a page the book already puts on the next page says so, and its start choice has nothing to change", async ({
  page,
}) => {
  await newProject(page);
  await addPage(page, "Preface");
  await page.getByRole("button", { name: "Actions for Preface" }).click();
  // The first page of the book has no page before it, so no rule can push it back one: the choice could only do nothing.
  const item = startItem(page);
  await expect(item).toBeVisible();
  await expect(item).toBeDisabled();
  await expect(menu(page).getByText("This page already starts on the next page.")).toBeVisible();
  await page.keyboard.press("Escape");

  // A page put in front of it turns the same row into one with a blank to remove, so the choice becomes usable there.
  await addPage(page, "Title page");
  await open(page, "Preface");
  await page.getByRole("button", { name: "Actions for Preface" }).click();
  await expect(startItem(page)).toBeEnabled();
  await expect(menu(page).getByText("This page already starts on the next page.")).toHaveCount(0);
  await expect.poll(async () => (await writeCards(page)).length).toBe(2);
  await page.keyboard.press("Escape");
});

test("the page start choice is kept when the book is opened again, and chapters have none", async ({
  page,
}) => {
  await newProject(page);
  await addPage(page, "Title page");
  await addPage(page, "Epigraph");
  await page.getByRole("button", { name: "Actions for Epigraph" }).click();
  await startItem(page).click();
  await expect.poll(async () => (await manifestOf(page)).frontMatter[1].startOnNext).toBe(true);
  await page.reload();
  await page.getByRole("button", { name: "Open folder" }).click();
  await open(page, "Epigraph");
  await expect.poll(async () => (await writeCards(page)).length).toBe(1);

  // A chapter opens where the template says and has no such item.
  await open(page, "Chapter One");
  await page.getByRole("button", { name: "Actions for Chapter One" }).click();
  await expect(menu(page)).toBeVisible();
  await expect(startItem(page)).toHaveCount(0);
  await page.keyboard.press("Escape");
});

/** A book of two chapters, the first open. */
async function twoChapters(page: Page) {
  await newProject(page);
  await page.getByRole("button", { name: "Add chapter" }).click();
  await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter 2");
  await open(page, "Chapter One");
  await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter One");
}

test("scrolling on past the last page of a chapter opens the next one, and back up the previous one's last page", async ({
  page,
}) => {
  await twoChapters(page);
  // A short window: the page stack is taller than the pane, so a wheel at the top only scrolls it.
  await page.setViewportSize({ width: 1280, height: 420 });
  const scroller: Locator = page.getByTestId("page-scroll");
  await expect(scroller).toBeVisible();
  await hoverScroll(page);
  await page.mouse.wheel(0, 100);
  await expect.poll(() => scrollTop(page)).toBeGreaterThan(0);
  await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter One");

  // A wheel at the end of its last page opens the next section.
  await scroller.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect.poll(() => atBottom(page)).toBe(true);
  await page.mouse.wheel(0, 160);
  await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter 2");
  await expect.poll(() => scrollTop(page)).toBe(0);

  // Scrolling up at its first page goes back, and the previous chapter shows its last page.
  await hoverScroll(page);
  await expect.poll(() => scrollTop(page)).toBe(0);
  await page.mouse.wheel(0, -160);
  await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter One");
  await expect.poll(() => atBottom(page)).toBe(true);
});

test("scrolling on from the last front matter page opens the first chapter, and the book's last page has no next", async ({
  page,
}) => {
  await newProject(page);
  await addPage(page, "Title page");
  await expect(page.locator(".ProseMirror h1")).toHaveText("E2E Book");
  await hoverScroll(page);
  await page.mouse.wheel(0, 4000);
  await page.mouse.wheel(0, 200);
  await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter One");

  // The last section of the book has nothing after it: a wheel there stays put.
  await open(page, "Chapter One");
  await hoverScroll(page);
  await page.mouse.wheel(0, 4000);
  await page.mouse.wheel(0, 200);
  await page.mouse.wheel(0, 200);
  await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter One");
});

test("a phone's reflowed page scrolls on into the next section too", async ({ page }) => {
  await twoChapters(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId("reflow-scroll")).toBeVisible();
  await hoverScroll(page, "reflow-scroll");
  await page.mouse.wheel(0, 4000);
  await page.mouse.wheel(0, 200);
  await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter 2");
});
