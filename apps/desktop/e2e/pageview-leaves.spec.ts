import { expect, test, type Page } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { addPage, newProject, seedChapters } from "./support/helpers";

// Exact page breaks for the blocks that hold others (lists, quotes, tables), for a word Typst hyphenated, for front matter, for Read
// mode and for a chapter measured on its own. The Typst answers are canned (`__typstQueryResultFor`); the layout is real Chromium.

const toggle = (page: Page) => page.getByRole("button", { name: "Page view", exact: true });
const cards = (page: Page) => page.locator(".page");

const word = (i: number) =>
  ["quiet", "garden", "river", "stone", "letter", "morning", "lantern", "orchard", "winter"][
    i % 9
  ]!;
const words = (n: number, seed: number) =>
  Array.from({ length: n }, (_, i) => word(i * 7 + seed)).join(" ");
const p = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const h1 = (text: string) => ({
  type: "heading",
  attrs: { level: 1 },
  content: [{ type: "text", text }],
});
const item = (text: string) => ({ type: "listItem", content: [p(text)] });
const cell = (kind: "tableCell" | "tableHeader", text: string) => ({
  type: kind,
  content: [p(text)],
});
const row = (kind: "tableCell" | "tableHeader", ...texts: string[]) => ({
  type: "tableRow",
  content: texts.map((t) => cell(kind, t)),
});

/** Block 0 the title, 1 a paragraph, 2 a list of four items, 3 a quote of two paragraphs, 4 a table (a header row and three rows), 5 a paragraph. */
const doc = () => ({
  type: "doc",
  content: [
    h1("Chapter One"),
    p(words(40, 0)),
    { type: "bulletList", content: [1, 2, 3, 4].map((k) => item(`item${k} ${words(10, k)}`)) },
    { type: "blockquote", content: [p(words(30, 1)), p(words(30, 2))] },
    {
      type: "table",
      content: [
        row("tableHeader", "Name", "Age"),
        ...[1, 2, 3].map((k) => row("tableCell", `row${k} ${words(3, k)}`, `age${k}`)),
      ],
    },
    p(words(40, 5)),
  ],
});

/** The marks Typst reports for `doc()`: five pages, a page begins at list item 3, quote paragraph 2 (and again inside it, at its word 10) and table row 2. */
const marks = [
  ["s", 0, 0, "h", 1],
  ["s", 0, 1, "p", 1],
  ...[1, 1, 2, 2].map((pg) => ["s", 0, 2, "p", pg]),
  ["s", 0, 3, "p", 2],
  ["s", 0, 3, "p", 3],
  ["w", 11, 4],
  ...[4, 4, 5, 5, 5, 5].map((pg) => ["s", 0, 4, "p", pg]),
  ["s", 0, 5, "p", 5],
];
const report = (id: string, extra: unknown[] = []) =>
  JSON.stringify({
    total: 5,
    starts: [{ id, kind: "chapter", page: 1, end: 5, number: "1" }],
    marks: [...marks, ...extra],
  });

/** Typst answers, for the run of a chapter or book with marks, with `answer`; the book without marks stays unanswered. */
const answerWith = (page: Page, answer: string) =>
  page.evaluate((a) => {
    window.__typstQueryResultFor = (source) => (source.includes("bm-s(") ? a : undefined);
  }, answer);

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

test("quotes, lists and tables: a page begins between items and rows, and inside a paragraph of an item, where Typst began it", async ({
  page,
}) => {
  await newProject(page);
  await seedChapters(page, [doc()]);
  await answerWith(page, report("chapter-1"));
  await toggle(page).click();
  await page.getByLabel("Page zoom").selectOption({ label: "100%" });
  await expect(page.locator(".page-chip")).toHaveText(
    "Page view · 5.5 × 8.5 in · breaks as in the PDF",
    { timeout: 10_000 },
  );
  await expect(cards(page)).toHaveCount(5);
  // A spacer is a child of the list, the quote and the table's body, right before the item, paragraph or row a page begins with.
  const gaps = page.locator(".pv-gap");
  await expect(gaps).toHaveCount(4);
  const where = await gaps.evaluateAll((els) =>
    els.map((el) => ({
      parent: el.parentElement!.tagName,
      inline: el.classList.contains("pv-gap-inline"),
      next: (el.nextElementSibling ?? el.nextSibling)?.textContent?.slice(0, 12) ?? "",
    })),
  );
  expect(where).toEqual([
    { parent: "UL", inline: false, next: "item3 stone " },
    { parent: "BLOCKQUOTE", inline: false, next: words(30, 2).slice(0, 12) },
    { parent: "P", inline: true, next: words(30, 2).split(" ").slice(10).join(" ").slice(0, 12) },
    { parent: "TBODY", inline: false, next: "row2 " + words(3, 2).slice(0, 7) },
  ]);
  // The author's text is untouched.
  const saved = await page.evaluate(() => JSON.stringify(window.__disk));
  expect(saved).not.toContain("pv-gap");
});

test("a table that Typst starts a page inside of falls back to the estimate for the whole chapter", async ({
  page,
}) => {
  await newProject(page);
  await seedChapters(page, [doc()]);
  // A page begins at the second cell of the first row: nothing can be drawn there.
  const bad = JSON.parse(report("chapter-1"));
  const cells = bad.marks.filter((m: unknown[]) => m[0] === "s" && m[2] === 4);
  cells[1][4] = 5;
  await answerWith(page, JSON.stringify(bad));
  await toggle(page).click();
  await page.getByLabel("Page zoom").selectOption({ label: "100%" });
  await expect
    .poll(() => page.evaluate(() => window.__typstQueryCalls?.length ?? 0))
    .toBeGreaterThan(1);
  await expect(page.locator(".page-chip")).toHaveText("Page view · 5.5 × 8.5 in · approximate");
  await expect(page.locator(".pv-gap")).not.toHaveCount(0);
});

test("a word Typst hyphenated begins the next page at the character the line broke at, with the hyphen at the foot of the page before", async ({
  page,
}) => {
  await newProject(page);
  await seedChapters(page, [
    { type: "doc", content: [h1("Chapter One"), p(words(40, 3)), p(words(40, 6))] } as never,
  ]);
  // Page 2 begins 4 characters into the paragraph's word 30 (the first run says the word; the second, the character).
  const first = JSON.stringify({
    total: 2,
    starts: [{ id: "chapter-1", kind: "chapter", page: 1, end: 2, number: "1" }],
    marks: [
      ["s", 0, 0, "h", 1],
      ["s", 0, 1, "p", 1],
      ["w", 31, 2],
      ["s", 0, 2, "p", 2],
    ],
  });
  const second = JSON.stringify({
    ...JSON.parse(first),
    marks: [
      ["s", 0, 0, "h", 1],
      ["s", 0, 1, "p", 1],
      ["c", 0, 1, 0, 30, 5, 2],
      ["s", 0, 2, "p", 2],
    ],
  });
  await page.evaluate(
    ([a, b]) => {
      window.__typstQueryResultFor = (source) =>
        source.includes("#cm(") ? b : source.includes("bm-s(") ? a : undefined;
    },
    [first, second] as const,
  );
  await toggle(page).click();
  await page.getByLabel("Page zoom").selectOption({ label: "100%" });
  await expect(page.locator(".page-chip")).toHaveText(/breaks as in the PDF/, { timeout: 10_000 });
  const inner = page.locator(".pv-gap-inline");
  await expect(inner).toHaveCount(1);
  const w = words(40, 3).split(" ")[30]!;
  const tail = words(40, 3).split(" ").slice(30).join(" ").slice(4);
  expect(await inner.evaluate((el) => (el.nextElementSibling ?? el.nextSibling)?.textContent)).toBe(
    tail,
  );
  expect(w.length).toBeGreaterThan(4);
  // The second run named the words it wanted, and asked for no word marks.
  const calls = await page.evaluate(() => window.__typstQueryCalls);
  const run2 = calls.find((c) => c.source.includes("#cm("))!;
  expect(run2.source).toContain("#cm(0, 1, 0, 30, 1)");
  expect(run2.source).not.toMatch(/#wm\(\d/);
});

test("front matter has exact breaks too", async ({ page }) => {
  await newProject(page);
  await addPage(page, "Foreword");
  await page.locator(".ProseMirror").click();
  await page.keyboard.insertText(words(50, 0));
  const id = await page.evaluate(
    () => JSON.parse(window.__disk["cadabra.json"] as string).frontMatter[0].id as string,
  );
  const m = JSON.stringify({
    total: 2,
    starts: [{ id, kind: "foreword", page: 1, end: 2, number: "i" }],
    // The page opens with its title as a heading, then the typed paragraph.
    marks: [
      ["s", 0, 0, "h", 1],
      ["s", 0, 1, "p", 1],
      ["w", 21, 2],
    ],
  });
  await answerWith(page, m);
  await toggle(page).click();
  await page.getByLabel("Page zoom").selectOption({ label: "100%" });
  await expect(page.locator(".page-chip")).toHaveText(/breaks as in the PDF/, { timeout: 10_000 });
  await expect(cards(page)).toHaveCount(2);
  const tail = words(50, 0).split(" ").slice(20).join(" ");
  expect(
    await page
      .locator(".pv-gap-inline")
      .evaluate((el) => (el.nextElementSibling ?? el.nextSibling)?.textContent),
  ).toBe(tail);
});

test("Read mode draws every chapter's pages where Typst broke them", async ({ page }) => {
  await newProject(page);
  await seedChapters(page, [doc()]);
  await answerWith(page, report("chapter-1"));
  await page.getByRole("radio", { name: "Read" }).click();
  const section = page.getByTestId("reading-section").first();
  await expect(section.locator(".pv-gap")).toHaveCount(4, { timeout: 10_000 });
  await expect(section.locator(".page-card:not([data-blank])")).toHaveCount(5);
  // The book was measured with the marks (Read mode needs every chapter's breaks), once.
  const calls = await page.evaluate(() => window.__typstQueryCalls);
  expect(calls.filter((c) => c.source.includes("bm-s("))).not.toHaveLength(0);
});

test("a chapter is measured on its own, so its breaks are exact before the book has been measured, and the book is measured without marks", async ({
  page,
}) => {
  await newProject(page);
  await seedChapters(page, [
    doc(),
    { type: "doc", content: [h1("Chapter Two"), p(words(20, 1))] } as never,
  ]);
  await page.evaluate((r) => {
    // Only the chapter on its own (one chapter-start in the source) gets an answer; the book's has nothing usable.
    window.__typstQueryResultFor = (source) =>
      (source.match(/#chapter-start\(/g) ?? []).length === 1 ? r : undefined;
  }, report("chapter-1"));
  await toggle(page).click();
  await page.getByLabel("Page zoom").selectOption({ label: "100%" });
  await expect(page.locator(".page-chip")).toHaveText(/breaks as in the PDF/, { timeout: 10_000 });
  const calls = await page.evaluate(() => window.__typstQueryCalls);
  // The book's measure is the one without marks.
  const book = calls.filter((c) => (c.source.match(/#chapter-start\(/g) ?? []).length === 2);
  expect(book.length).toBeGreaterThan(0);
  for (const c of book) expect(c.source).not.toContain("bm-s(");
  // The chapter's own measure is marked.
  expect(
    calls.some(
      (c) => (c.source.match(/#chapter-start\(/g) ?? []).length === 1 && c.source.includes("bm-s("),
    ),
  ).toBe(true);
});
