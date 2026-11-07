import { expect, test, type Page } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import {
  addPage,
  chapterDoc,
  focusEnd,
  manifestOf,
  newProject,
  seedChapters,
  sidebar,
} from "./support/helpers";
import { cardsOf, lastOf, opening, settledCards, writeCards } from "./support/pageCards";

// The page numbers of the whole book, on every surface that shows one: front matter in roman (no folio on the title, copyright and
// contents pages), chapter 1 on arabic 1 after it, and each chapter on from the last one's end, with a blank verso where the
// template opens chapters on a right-hand page. The bug these cover: every section and chapter started at 1.

const open = async (page: Page, title: string) => {
  const entry = sidebar(page).getByRole("button", { name: title, exact: true });
  await entry.click();
  await expect(entry).toHaveAttribute("aria-current", "true");
};
/** A page drawn as pages (every entry but the contents page, which is the list editor). */
const openPage = async (page: Page, title: string) => {
  await open(page, title);
  await expect(page.locator(".page").first()).toBeVisible();
};
const read = (page: Page) => page.getByRole("radio", { name: "Read" }).click();
const sections = (page: Page) => page.getByTestId("reading-section");
/**
 * Brings section `i` into view, again and again until it is laid out: the reader keeps only the chapters near the viewport as
 * editors, and the placeholders above move as the chapters before them are laid out.
 */
const gotoSection = async (page: Page, i: number) => {
  const section = sections(page).nth(i);
  await expect(async () => {
    await section.scrollIntoViewIfNeeded();
    await expect(section.locator(".page").first()).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 30_000 });
  return section;
};

const contents = (page: Page) => page.getByRole("region", { name: "Contents" });
const contentsRow = (page: Page, title: string) =>
  contents(page)
    .getByRole("list", { name: "Contents entries" })
    .locator("[data-toc-key]")
    .filter({ hasText: title })
    .first();
const contentsNumber = (page: Page, title: string) =>
  contentsRow(page, title).locator("[data-toc-page]");

/** A book with a title page, copyright, contents, three chapters of several pages and acknowledgments. */
async function numberedBook(page: Page) {
  await newProject(page);
  await addPage(page, "Title page");
  await addPage(page, "Copyright page");
  await addPage(page, "Contents");
  await addPage(page, "Acknowledgments");
  await seedChapters(page, [
    chapterDoc("Chapter One", 14, 40, 0),
    chapterDoc("Chapter Two", 14, 40, 3),
    chapterDoc("Chapter Three", 14, 40, 5),
  ]);
  await expect(page.locator(".ProseMirror h1").first()).toHaveText("Chapter One");
}

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

test("numbers continue through the book: roman front matter, chapter 1 on arabic 1, each chapter after the last", async ({
  page,
}) => {
  await numberedBook(page);
  // The title page prints no folio (the PDF does not number it).
  await openPage(page, "Title Page");
  await expect.poll(async () => (await writeCards(page)).length).toBeGreaterThan(0);
  expect((await writeCards(page))[0]?.folio).toBe("");
  await expect(page.locator(".page .page-number")).toHaveCount(0);

  await openPage(page, "Chapter One");
  const one = await settledCards(page);
  expect(opening(one)?.folio).toBe("1");
  expect(opening(one)?.physical).toBeGreaterThan(4); // after the front matter

  await openPage(page, "Chapter Two");
  const two = await settledCards(page);
  const lastOne = Number(lastOf(one)?.folio);
  // The template opens chapters on a right-hand page: one more blank verso when the next page would be even.
  const expected = lastOne + 1 + ((lastOne + 1) % 2 === 0 ? 1 : 0);
  expect(Number(opening(two)?.folio)).toBe(expected);
  expect(opening(two)?.folio).not.toBe("1");
  if (two[0]?.blank) expect(two[0]?.folio).toBe(String(expected - 1));

  await openPage(page, "Chapter Three");
  const three = await settledCards(page);
  expect(Number(opening(three)?.folio)).toBeGreaterThan(Number(opening(two)?.folio));

  // The book's last page: the status bar's total is the whole interior, front and back matter included.
  await openPage(page, "Acknowledgments");
  const total = lastOf(await settledCards(page))?.physical;
  expect(total).toBeGreaterThan(Number(lastOf(three)?.folio));

  // The status bar names the page under the cursor as the PDF prints it, and the book's last page.
  await openPage(page, "Chapter Two");
  await expect(page.getByTestId("page-position")).toContainText(
    `Page ${opening(two)?.folio} of ≈ ${total}`,
  );

  // The Contents list prints the same numbers as the pages.
  await open(page, "Contents");
  await expect(contentsNumber(page, "Chapter One")).toHaveText(/^(≈)?1$/);
  await expect(contentsNumber(page, "Chapter Two")).toContainText(opening(two)?.folio ?? "");
  await expect(contentsNumber(page, "Chapter Three")).toContainText(opening(three)?.folio ?? "");

  // Read mode draws the same folios on the same cards (section 4 is the second chapter: three front matter pages first).
  await read(page);
  const section = await gotoSection(page, 4);
  await expect.poll(async () => opening(await cardsOf(section))?.folio).toBe(opening(two)?.folio);
});

test("Typst's report gives every surface the PDF's numbers, and the PDF numbers the book once", async ({
  page,
}) => {
  await numberedBook(page);
  const m = await manifestOf(page);
  const id = (list: { id: string; kind?: string }[], kind: string) =>
    list.find((e) => e.kind === kind)!.id;
  const ids = {
    title: id(m.frontMatter, "title-page"),
    copyright: id(m.frontMatter, "copyright"),
    contents: id(m.frontMatter, "contents"),
    one: m.chapters[0].id as string,
    two: m.chapters[1].id as string,
    three: m.chapters[2].id as string,
    back: id(m.backMatter, "acknowledgments"),
  };
  // Typst's report of the book: the front matter in roman, chapter 1 on arabic 1, then 7, 13 and 19.
  await page.evaluate((i) => {
    window.__typstQueryResult = JSON.stringify({
      total: 26,
      starts: [
        { id: i.title, kind: "title-page", page: 1, end: 1, number: "" },
        { id: i.copyright, kind: "copyright", page: 2, end: 2, number: "" },
        { id: i.contents, kind: "contents", page: 3, end: 3, number: "iii" },
        { id: i.one, kind: "chapter", page: 7, end: 12, number: "1" },
        { id: i.two, kind: "chapter", page: 13, end: 18, number: "7" },
        { id: i.three, kind: "chapter", page: 19, end: 24, number: "13" },
        { id: i.back, kind: "acknowledgments", page: 25, end: 26, number: "19" },
      ],
    });
  }, ids);
  // A change to the text is what asks Typst again (a measure is cached by the book's content).
  await openPage(page, "Chapter One");
  await focusEnd(page);
  await page.keyboard.type(" and");
  await expect(page.getByRole("status").first()).toContainText("Saved");

  // Switching pages makes the last report stale; the new one arrives after the book has been still (2 s) and holds its starts.
  await openPage(page, "Chapter Two");
  await expect
    .poll(async () => opening(await writeCards(page))?.folio, { timeout: 20_000 })
    .toBe("7");
  // Typst placed the start and every page before it, so the status bar names the PDF's page and its total with no "≈" (this
  // report carries no word marks, so the card under the cursor is the app's own break, which the page chip says).
  await expect(page.getByTestId("page-position")).toContainText("Page 7 of 26");

  await openPage(page, "Chapter Three");
  await expect
    .poll(async () => opening(await writeCards(page))?.folio, { timeout: 20_000 })
    .toBe("13");

  await open(page, "Contents");
  await expect(contentsNumber(page, "Chapter Two")).toHaveText("7");
  await expect(contentsNumber(page, "Chapter Three")).toHaveText("13");

  await read(page);
  const readTwo = await gotoSection(page, 4);
  await expect.poll(async () => opening(await cardsOf(readTwo))?.folio).toBe("7");

  // The print preview typesets the whole book once: front matter in roman, then one arabic count for every chapter after it.
  await page.getByRole("radio", { name: "Write" }).click();
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export book" });
  await dialog.getByRole("radio", { name: "Print PDF" }).click();
  await dialog.getByRole("button", { name: "Print preview" }).click();
  await expect(page.getByRole("heading", { name: "Print preview" })).toBeVisible();
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          (window.__typstCalls ?? []).some((c: { source: string }) =>
            c.source.includes("#chapter-start("),
          ),
        ),
      { timeout: 20_000 },
    )
    .toBe(true);
  const source = await page.evaluate(
    () =>
      (window.__typstCalls ?? []).find((c: { source: string }) =>
        c.source.includes("#chapter-start("),
      )!.source,
  );
  expect(source.match(/#counter\(page\)\.update\(1\)/g)).toHaveLength(1);
  expect(source.match(/#set page\(numbering: "1"\)/g)).toHaveLength(1);
  expect(source).toContain('numbering: "i"');
  const chapters = source.indexOf("#chapter-start(");
  expect(chapters).toBeGreaterThan(source.indexOf("#counter(page).update(1)"));
  expect(source.slice(chapters + 1)).not.toContain("#counter(page).update(1)");
});
