import { expect, test, type Page } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import {
  chapterDoc,
  manifestOf,
  newProject,
  seedChapters,
  sidebar,
  focusEnd,
} from "./support/helpers";
import { bigChapter } from "../src/test/bigBook";

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

const read = (page: Page) => page.getByRole("radio", { name: "Read" }).click();
const scroller = (page: Page) => page.getByTestId("reading-scroll");
const sections = (page: Page) => page.getByTestId("reading-section");
const section = (page: Page, i: number) => sections(page).nth(i);
const editors = (page: Page) => page.locator(".ProseMirror");
/** Scrolls the reader so section `i` starts at the top. */
const scrollToSection = (page: Page, i: number) =>
  scroller(page).evaluate((sc, n) => {
    const el = sc.querySelectorAll<HTMLElement>("[data-reading-id]")[n]!;
    sc.scrollTop = el.offsetTop;
  }, i);
/** Three chapters of about five pages each at the default trim. */
const book = (page: Page) =>
  seedChapters(page, [
    chapterDoc("Chapter One", 28, 40, 0),
    chapterDoc("Chapter Two", 28, 40, 3),
    chapterDoc("Chapter Three", 28, 40, 5),
  ]);

test("word count follows typing", async ({ page }) => {
  await newProject(page);
  await expect(page.getByText("2 words in this chapter")).toBeVisible(); // the "Chapter One" heading
  await focusEnd(page);
  await page.keyboard.type("one two three");
  await expect(page.getByText("5 words in this chapter")).toBeVisible();
});

test("reading mode is read-only, shows unsaved typing and scrolls through every chapter", async ({
  page,
}) => {
  await newProject(page);
  await page.getByRole("button", { name: "Add chapter" }).click();
  await page.getByRole("button", { name: "Chapter One", exact: true }).click();
  await focusEnd(page);
  await page.keyboard.type("Hello reading");
  await read(page);
  // Both chapters are in the one scroller, one read-only editor each (the second is mounted once it is near the viewport).
  await expect(sections(page)).toHaveCount(2);
  await expect(editors(page).first()).toContainText("Hello reading");
  await expect(editors(page).first()).toHaveAttribute("contenteditable", "false");
  await expect(page.getByRole("toolbar", { name: "Formatting" })).toHaveCount(0);
  await expect(page.getByText("Chapter 1 of 2")).toBeVisible();
  await page.getByRole("button", { name: "Next chapter" }).click();
  await expect(page.getByText("Chapter 2 of 2")).toBeVisible();
  // Only the chapters near the viewport have an editor, so chapter 1's may be gone by now: look at chapter 2's own section.
  await expect(section(page, 1).locator(".ProseMirror h1")).toHaveText("Chapter 2");
  await expect(section(page, 1).locator(".ProseMirror")).toHaveAttribute(
    "contenteditable",
    "false",
  );
  await expect(page.getByRole("button", { name: "Previous chapter" })).toBeVisible();
  await page.getByRole("button", { name: "Reading settings" }).click();
  await page.getByRole("menuitem", { name: "Larger text" }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("radio", { name: "Write" }).click();
  await expect(page.getByRole("toolbar", { name: "Formatting" })).toBeVisible();
  const saved = await page.evaluate(() =>
    Object.values(window.__disk)
      .filter((v) => typeof v === "string")
      .join("\n"),
  );
  expect(saved).toContain("Hello reading");
});

test("the footer follows the scroll, the open chapter follows the footer, Previous and Next scroll", async ({
  page,
}) => {
  await newProject(page);
  await book(page);
  await read(page);
  await expect(sections(page)).toHaveCount(3);
  await expect(page.getByText("Chapter 1 of 3")).toBeVisible();
  // The chapters above lay out one after another and move this one down, and a jump made before that is not re-anchored (the reader
  // only keeps what a scroll event has captured), so the jump is repeated until the footer shows it landed.
  await expect(async () => {
    await scrollToSection(page, 2);
    await expect(page.getByText("Chapter 3 of 3")).toBeVisible({ timeout: 1_500 });
  }).toPass();
  // After a pause the chapter list follows the reader.
  await expect(
    sidebar(page).getByRole("button", { name: "Chapter Three", exact: true }),
  ).toHaveAttribute("aria-current", "true");
  await expect(editors(page).filter({ hasText: "quiet" }).first()).toBeVisible();
  await page.getByRole("button", { name: "Previous chapter: Chapter Two" }).click();
  await expect(page.getByText("Chapter 2 of 3")).toBeVisible();
  await expect(page.locator('[data-reading-id="chapter-2"] h1')).toBeInViewport();
  // A click in the chapter list scrolls there too.
  await sidebar(page).getByRole("button", { name: "Chapter Three", exact: true }).click();
  await expect(page.getByText("Chapter 3 of 3")).toBeVisible();
  await expect(page.locator('[data-reading-id="chapter-3"] h1')).toBeInViewport();
  // The scroll is the chapter the reader was in when going back to Write.
  await page.getByRole("radio", { name: "Write" }).click();
  await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter Three");
});

test("entering Read mode starts at the chapter that was open", async ({ page }) => {
  await newProject(page);
  await book(page);
  await sidebar(page).getByRole("button", { name: "Chapter Two", exact: true }).click();
  await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter Two");
  await read(page);
  await expect(page.getByText("Chapter 2 of 3")).toBeVisible();
  await expect(page.locator('[data-reading-id="chapter-2"] h1')).toBeInViewport();
});

test("a wide window reads the book as trim-size pages: cards, running heads, chained numbers", async ({
  page,
}) => {
  await newProject(page);
  await book(page);
  await read(page);
  await expect(scroller(page)).toHaveAttribute("data-paged", "true");
  await expect(page.locator(".prose-reading")).toHaveCount(0);
  await expect(page.locator(".prose-page").first()).toBeVisible();
  const cards = (i: number) => section(page, i).locator(".page");
  await expect.poll(() => cards(0).count()).toBeGreaterThan(3);
  await expect(cards(0).first()).toHaveAttribute("data-kind", "open");
  await expect(cards(0).first().locator(".page-number")).toHaveText("1");
  // Cards are aria-hidden decoration; the text is the accessible content.
  await expect(section(page, 0).locator(".page-cards")).toHaveAttribute("aria-hidden", "true");
  // A body page has a running head: the book title on a left-hand page, the chapter title on a right-hand one.
  await expect(cards(0).filter({ hasText: "E2E Book" }).first()).toBeVisible();
  await expect(
    cards(0).filter({ hasText: "Chapter One" }).first().locator(".page-head"),
  ).toHaveText("Chapter One");
  // The next chapter's first page follows the last page of the previous one (a blank left-hand page first where chapters open on the right).
  await scrollToSection(page, 1);
  await expect.poll(() => cards(1).count()).toBeGreaterThan(3);
  await expect.poll(() => cards(0).count()).toBeGreaterThan(3);
  const numbers = async (i: number) =>
    (await cards(i).locator(".page-number").allTextContents()).map(Number);
  const openNo = async () =>
    Number(
      (await section(page, 1).locator('.page[data-kind="open"] .page-number').textContent()) ?? NaN,
    );
  // Each section counts up from its own first page and its first card follows the one before it. The reader lays a section out as
  // it comes near the viewport and the book's layout settles behind it, so read every number in one pass and retry until they are
  // the settled ones rather than catching a section halfway drawn.
  await expect
    .poll(async () => {
      const [first, second] = await Promise.all([numbers(0), numbers(1)]);
      const open = await openNo();
      const last = first.at(-1);
      return {
        rising: first.every((v, k) => v === k + 1) && second.every((v, k) => v === second[0]! + k),
        chained: last === undefined ? null : second[0]! - last,
        // The opening card is the section's first, or its second behind a blank left-hand page.
        opensChapter: open - second[0]! === 0 || open - second[0]! === 1,
      };
    })
    .toEqual({ rising: true, chained: 1, opensChapter: true });
  // The footer says which page the reader is on.
  await expect(page.getByText(/Chapter 2 of 3 · Page \d+/)).toBeVisible();
  // Dropping the Write-mode preference changes nothing: Read always draws pages.
  await expect(page.getByRole("button", { name: "Page view", exact: true })).toHaveCount(0);
});

test("Typst's printed numbers replace the chained ones", async ({ page }) => {
  await newProject(page);
  await book(page);
  const m = await manifestOf(page);
  await page.evaluate(
    (ids: string[]) => {
      window.__typstQueryResult = JSON.stringify({
        total: 60,
        starts: [
          { id: ids[0], kind: "chapter", page: 1, end: 20, number: "1" },
          { id: ids[1], kind: "chapter", page: 21, end: 40, number: "21" },
          { id: ids[2], kind: "chapter", page: 41, end: 60, number: "41" },
        ],
      });
    },
    m.chapters.map((c: { id: string }) => c.id),
  );
  await read(page);
  await expect.poll(() => section(page, 0).locator(".page").count()).toBeGreaterThan(3);
  await scrollToSection(page, 1);
  await expect(
    section(page, 1).locator(".page[data-kind='open'] .page-number"),
    "after the 2 s the book is still, Typst is asked and the number is used",
  ).toHaveText("21", { timeout: 15_000 });
  const calls = await page.evaluate(() => window.__typstQueryCalls ?? []);
  expect(calls.length).toBeGreaterThanOrEqual(1);
});

test("the reading size and width settings zoom the pages", async ({ page }) => {
  await newProject(page);
  await book(page);
  await read(page);
  const zoom = async () =>
    Number(await page.locator(".page-stack").first().getAttribute("data-zoom"));
  await expect.poll(zoom).toBeGreaterThan(0.3);
  const base = await zoom();
  const settings = async (item: string) => {
    await page.getByRole("button", { name: "Reading settings" }).click();
    await page.getByRole("menuitem", { name: item }).click();
    await page.keyboard.press("Escape");
  };
  await settings("Larger text");
  await expect.poll(zoom).toBeGreaterThan(base);
  await settings("Smaller text");
  await settings("Smaller text");
  await expect.poll(zoom).toBeLessThan(base);
  await settings("Larger text");
  await page.getByRole("button", { name: "Reading settings" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Wide page" }).click();
  await page.keyboard.press("Escape");
  await expect.poll(zoom).toBeGreaterThan(base);
});

test("a phone keeps the plain reading layout and scrolls through the whole book", async ({
  page,
}) => {
  await newProject(page);
  await book(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await read(page);
  await expect(scroller(page)).toHaveAttribute("data-paged", "false");
  await expect(page.locator(".prose-reading").first()).toBeVisible();
  await expect(page.locator(".page")).toHaveCount(0);
  await expect(page.locator(".prose-page")).toHaveCount(0);
  await expect(sections(page)).toHaveCount(3);
  await expect(page.getByText("Chapter 1 of 3")).toBeVisible();
  await page.getByRole("button", { name: "Next chapter" }).click();
  await expect(page.getByText("Chapter 2 of 3")).toBeVisible();
  await expect(page.locator('[data-reading-id="chapter-2"] h1')).toBeInViewport();
  await scrollToSection(page, 2);
  await expect(page.getByText("Chapter 3 of 3")).toBeVisible();
  await expect(page.getByText(/Page \d+/)).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  // Crossing back to a wide window redraws the same book as pages.
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(scroller(page)).toHaveAttribute("data-paged", "true");
  await expect(page.locator(".page").first()).toBeVisible();
});

test("a large book mounts only the chapters near the viewport", async ({ page }) => {
  await newProject(page);
  const docs = Array.from({ length: 40 }, (_, i) => bigChapter(1500, 7 + i, `Chapter ${i + 1}`));
  await seedChapters(page, docs);
  await read(page);
  await expect(sections(page)).toHaveCount(40);
  await expect(page.getByText("Chapter 1 of 40")).toBeVisible();
  const mounted = () => editors(page).count();
  await expect.poll(mounted).toBeGreaterThan(0);
  expect(await mounted()).toBeLessThanOrEqual(8);
  // Jump to the middle: the editors move with the viewport and stay few, and the footer follows.
  const before = await scroller(page).evaluate((sc) => sc.scrollHeight);
  await scrollToSection(page, 20);
  await expect(page.getByText(/Chapter 2[01] of 40/)).toBeVisible();
  await expect(
    page
      .locator(".ProseMirror h1")
      .filter({ hasText: /^Chapter 2[01]$/ })
      .first(),
  ).toBeVisible();
  await page.waitForTimeout(500);
  expect(await mounted()).toBeLessThanOrEqual(8);
  expect(await scroller(page).evaluate((sc) => sc.scrollHeight)).toBeGreaterThan(before * 0.5);
  // And on a phone.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(scroller(page)).toHaveAttribute("data-paged", "false");
  await scrollToSection(page, 30);
  await expect(page.getByText(/Chapter 3[01] of 40/)).toBeVisible();
  await page.waitForTimeout(500);
  expect(await mounted()).toBeLessThanOrEqual(10);
  expect(await mounted()).toBeGreaterThan(0);
});

test("read-only chapter text is a named document, not a textbox", async ({ page }) => {
  await newProject(page);
  await read(page);
  const text = sections(page).first().locator(".ProseMirror");
  await expect(text).toHaveAttribute("role", "document");
  await expect(text).toHaveAttribute("aria-label", "Chapter One");
  await expect(page.getByRole("textbox", { name: "Chapter One" })).toHaveCount(0);
});

test("Read mode has the same page zoom select as Write mode, and the two share the choice", async ({
  page,
}) => {
  await newProject(page);
  await book(page);
  await read(page);
  const select = page.getByLabel("Page zoom");
  const zoom = async () =>
    Number(await page.locator(".page-stack").first().getAttribute("data-zoom"));
  await expect(select).toBeVisible();
  await expect(select).toHaveValue("fit");
  await expect(select.locator("option")).toHaveText(["Fit width", "75%", "100%", "125%"]);
  await select.selectOption({ label: "75%" });
  await expect.poll(zoom).toBeCloseTo(0.75, 2);
  await select.selectOption({ label: "125%" });
  await expect.poll(zoom).toBeCloseTo(1.25, 2);
  // The text size still scales on top of the chosen zoom.
  await page.getByRole("button", { name: "Reading settings" }).click();
  await page.getByRole("menuitem", { name: "Larger text" }).click();
  await page.keyboard.press("Escape");
  await expect.poll(zoom).toBeGreaterThan(1.25);
  // Write mode shows the same choice.
  await page.getByRole("radio", { name: "Write" }).click();
  await expect(select).toHaveValue("1.25");
});

test("a phone has no page zoom in Read mode, because the book is not drawn as pages", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await newProject(page);
  await read(page);
  await expect(scroller(page)).toBeVisible();
  await expect(page.getByLabel("Page zoom")).toHaveCount(0);
});
