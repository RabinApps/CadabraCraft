import { expect, test, type Page } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { chapterDoc, newProject, seedChapters, sidebar } from "./support/helpers";

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

const read = (page: Page) => page.getByRole("radio", { name: "Read" }).click();
const scroller = (page: Page) => page.getByTestId("reading-scroll");
const bar = (page: Page) => page.getByRole("search", { name: "Find in the book" });
const query = (page: Page) => bar(page).getByLabel("Find", { exact: true });
const editors = (page: Page) => page.locator(".ProseMirror");
const scrollToSection = (page: Page, i: number) =>
  scroller(page).evaluate((sc, n) => {
    const el = sc.querySelectorAll<HTMLElement>("[data-reading-id]")[n]!;
    sc.scrollTop = el.offsetTop;
  }, i);

/** `doc` with a paragraph of `text` appended. */
function withLine(doc: ReturnType<typeof chapterDoc>, text: string) {
  return {
    ...doc,
    content: [...doc.content, { type: "paragraph", content: [{ type: "text", text }] }],
  };
}

/** Three chapters of about five pages: "zeppelin" is once in the first, never in the second and twice in the third. */
async function book(page: Page) {
  await seedChapters(page, [
    withLine(chapterDoc("Chapter One", 28, 40, 0), "A zeppelin crossed the sky."),
    chapterDoc("Chapter Two", 28, 40, 3),
    withLine(
      withLine(chapterDoc("Chapter Three", 28, 40, 5), "The Zeppelin landed."),
      "Another zeppelin followed.",
    ),
  ]);
}

test("finds across every chapter, counts them and jumps to a match in a chapter that has no editor", async ({
  page,
}) => {
  await newProject(page);
  await book(page);
  await read(page);
  await expect(page.getByText("Chapter 1 of 3")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+f");
  await expect(bar(page)).toBeVisible();
  await expect(query(page)).toBeFocused();
  await page.keyboard.type("zeppelin");
  // The whole book is counted, the chapter beyond the viewport included.
  await expect(bar(page).getByText("1 of 3")).toBeVisible();
  const rows = bar(page).getByRole("list", { name: "Results by page" });
  await expect(rows.getByRole("listitem")).toHaveCount(2);
  await expect(rows.getByRole("button", { name: "Chapter One, 1 match" })).toBeVisible();
  await expect(rows.getByRole("button", { name: "Chapter Three, 2 matches" })).toBeVisible();
  // The first match is the one at the reading line, in chapter one, and is marked in its editor.
  await expect(page.locator(".search-match-current")).toHaveCount(1);
  await expect(page.locator('[data-reading-id="chapter-1"] .search-match-current')).toBeVisible();

  // Next goes to chapter three, which had no editor: it is mounted on the way, marked, and scrolled into view.
  await page.keyboard.press("Enter");
  await expect(bar(page).getByText("2 of 3")).toBeVisible();
  await expect(
    page.locator('[data-reading-id="chapter-3"] .search-match-current'),
  ).toBeInViewport();
  await expect(page.getByText("Chapter 3 of 3")).toBeVisible();
  await expect(
    sidebar(page).getByRole("button", { name: "Chapter Three", exact: true }),
  ).toHaveAttribute("aria-current", "true");
  // The match in the book is the matches of the editors: the search is not case sensitive.
  await expect(page.locator('[data-reading-id="chapter-3"] .search-match')).toHaveCount(2);

  await page.keyboard.press("Enter");
  await expect(bar(page).getByText("3 of 3")).toBeVisible();
  await expect(
    page.locator('[data-reading-id="chapter-3"] .search-match-current'),
  ).toBeInViewport();
  await page.keyboard.press("Enter"); // wraps to the first match of the book
  await expect(bar(page).getByText("1 of 3")).toBeVisible();
  await expect(
    page.locator('[data-reading-id="chapter-1"] .search-match-current'),
  ).toBeInViewport();
  await bar(page).getByRole("button", { name: "Previous match" }).click(); // and back to the last
  await expect(bar(page).getByText("3 of 3")).toBeVisible();

  // A row of the results list goes to the first match of that chapter.
  await rows.getByRole("button", { name: "Chapter One, 1 match" }).click();
  await expect(bar(page).getByText("1 of 3")).toBeVisible();
  await expect(
    page.locator('[data-reading-id="chapter-1"] .search-match-current'),
  ).toBeInViewport();

  // The reader is read-only: no replace row.
  await expect(bar(page).getByLabel("Replace with")).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(bar(page)).toHaveCount(0);
  await expect(page.locator(".search-match")).toHaveCount(0);
});

test("match case, whole word and regex change the count; a bad pattern and no results say so", async ({
  page,
}) => {
  await newProject(page);
  await book(page);
  await read(page);
  await page.keyboard.press("ControlOrMeta+f");
  await page.keyboard.type("zeppelin");
  await expect(bar(page).getByText("1 of 3")).toBeVisible();
  await bar(page).getByRole("button", { name: "Match case" }).click();
  await expect(bar(page).getByText("1 of 2")).toBeVisible(); // "Zeppelin" at the start of a sentence no longer matches
  await bar(page).getByRole("button", { name: "Whole word" }).click();
  await expect(bar(page).getByText("1 of 2")).toBeVisible();
  await bar(page).getByRole("button", { name: "Match case" }).click();
  await bar(page).getByRole("button", { name: "Whole word" }).click();
  await query(page).fill("zep+elin");
  await expect(bar(page).getByText("No results")).toBeVisible();
  await bar(page).getByRole("button", { name: "Regex" }).click();
  await expect(bar(page).getByText("1 of 3")).toBeVisible();
  await query(page).fill("(unclosed");
  await expect(bar(page).getByText("Invalid pattern")).toBeVisible();
  await query(page).fill("nothing like this");
  await bar(page).getByRole("button", { name: "Regex" }).click();
  await expect(bar(page).getByText("No results")).toBeVisible();
  await expect(bar(page).getByRole("button", { name: "Next match" })).toBeDisabled();
});

test("the selected text becomes the query, and the bar survives scrolling and a chapter jump", async ({
  page,
}) => {
  await newProject(page);
  await book(page);
  await read(page);
  await editors(page).first().locator("h1").dblclick();
  await page.keyboard.press("ControlOrMeta+f");
  await expect(query(page)).toHaveValue(/Chapter|One/);
  await query(page).fill("zeppelin");
  await expect(bar(page).getByText("1 of 3")).toBeVisible();
  await scrollToSection(page, 2);
  await expect(bar(page)).toBeVisible();
  await sidebar(page).getByRole("button", { name: "Chapter Two", exact: true }).click();
  await expect(bar(page).getByText(/of 3/)).toBeVisible();
});

test("Find also works at phone width, in the plain reading layout", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await newProject(page);
  await book(page);
  await read(page);
  await expect(scroller(page)).toHaveAttribute("data-paged", "false");
  await page.keyboard.press("ControlOrMeta+f");
  await page.keyboard.type("zeppelin");
  await expect(bar(page).getByText("1 of 3")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(bar(page).getByText("2 of 3")).toBeVisible();
  await expect(
    page.locator('[data-reading-id="chapter-3"] .search-match-current'),
  ).toBeInViewport();
});
