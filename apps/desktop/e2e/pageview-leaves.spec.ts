import { expect, test, type Page } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { addPage, focusEnd, newProject, seedChapters, remeasure } from "./support/helpers";

// Exact page breaks for the blocks that hold others (lists, quotes, tables), for a word Typst hyphenated, for front matter, for Read
// mode and for a chapter measured on its own. The Typst answers are canned (`__typstQueryResultFor`); the layout is real Chromium.

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
const answerWith = async (page: Page, answer: string) => {
  const set = (a: string) => {
    window.__typstQueryResultFor = (source) => (source.includes("bm-s(") ? a : undefined);
  };
  // Also for the next load (seeding reloads the page), so the first measure of a chapter already gets the answer.
  await page.addInitScript(set, answer);
  await page.evaluate(set, answer);
};

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

test("quotes, lists and tables: a page begins between items and rows, and inside a paragraph of an item, where Typst began it", async ({
  page,
}) => {
  await newProject(page);
  await answerWith(page, report("chapter-1"));
  await seedChapters(page, [doc()]);
  await page.getByLabel("Page zoom").selectOption({ label: "100%" });
  await expect(page.locator(".page-chip")).toHaveText("5.5 × 8.5 in · breaks as in the PDF", {
    timeout: 10_000,
  });
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

/**
 * A table of one row and two cells under the chapter title, and a paragraph after it: cell A is one paragraph of 60 words, cell B has
 * two, of 15 and 50. Typst cuts the row at the foot of page 1: A at its word 30, B inside its second paragraph at its word 20.
 */
const rowDoc = () => ({
  type: "doc",
  content: [
    h1("Chapter One"),
    {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            { type: "tableCell", content: [p(words(60, 1))] },
            { type: "tableCell", content: [p(words(15, 2)), p(words(50, 3))] },
          ],
        },
      ],
    },
    p(words(10, 4)),
  ],
});
const rowReport = JSON.stringify({
  total: 2,
  starts: [{ id: "chapter-1", kind: "chapter", page: 1, end: 2, number: "1" }],
  marks: [
    ["s", 0, 0, "h", 1],
    ["s", 0, 1, "p", 1],
    ["w", 31, 2],
    ["s", 0, 1, "p", 1],
    ["s", 0, 1, "p", 1],
    ["w", 21, 2],
    ["s", 0, 2, "p", 2],
  ],
});

/** Where the text after each spacer in the table begins, px from the top of the page card it is on, and which card that is. */
const tails = (page: Page) =>
  page.evaluate(() => {
    const cards = [...document.querySelectorAll<HTMLElement>(".page")].map((c) =>
      c.getBoundingClientRect(),
    );
    return [...document.querySelectorAll<HTMLElement>("td .pv-gap")].map((gap) => {
      const next = gap.nextSibling ?? gap.nextElementSibling!;
      const range = document.createRange();
      if (next.nodeType === Node.TEXT_NODE) {
        range.setStart(next, 0);
        range.setEnd(next, 1);
      } else range.selectNodeContents(next);
      const top = range.getBoundingClientRect().top;
      const card = cards.findIndex((c) => top >= c.top && top < c.bottom);
      return {
        cell: gap.closest("td")!.cellIndex,
        inline: gap.classList.contains("pv-gap-inline"),
        card,
        fromTop: card < 0 ? -1 : top - cards[card]!.top,
        text: (next.textContent ?? "").slice(0, 10),
      };
    });
  });

test("a page that begins inside a table row begins in each cell that runs onto it, at that cell's own word, on the next page", async ({
  page,
}) => {
  await newProject(page);
  await answerWith(page, rowReport);
  await seedChapters(page, [rowDoc() as never]);
  await page.getByLabel("Page zoom").selectOption({ label: "100%" });
  await expect(page.locator(".page-chip")).toHaveText("5.5 × 8.5 in · breaks as in the PDF", {
    timeout: 10_000,
  });
  await expect(cards(page)).toHaveCount(2);
  // A spacer in each cell that runs over, in the paragraph the page begins in, right before that word.
  await expect(page.locator("td .pv-gap")).toHaveCount(2);
  const t = await tails(page);
  expect(t.map((x) => [x.cell, x.inline, x.card, x.text])).toEqual([
    [0, true, 1, words(60, 1).split(" ").slice(30).join(" ").slice(0, 10)],
    [1, true, 1, words(50, 3).split(" ").slice(20).join(" ").slice(0, 10)],
  ]);
  // Both cells go on at the top of the same page, level with each other.
  expect(Math.abs(t[0]!.fromTop - t[1]!.fromTop)).toBeLessThan(2);
  // Cell A's first part and B's first paragraph are on the first card; the paragraph after the table, on the second.
  const onCard = await page.evaluate(() => {
    const cards = [...document.querySelectorAll<HTMLElement>(".page")].map((c) =>
      c.getBoundingClientRect(),
    );
    const cardOf = (el: Element) => {
      const r = el.getBoundingClientRect();
      return cards.findIndex((c) => r.top >= c.top && r.top < c.bottom);
    };
    return {
      b1: cardOf(document.querySelectorAll("td")[1]!.querySelector("p")!),
      after: cardOf(document.querySelector(".ProseMirror")!.lastElementChild!),
    };
  });
  expect(onCard).toEqual({ b1: 0, after: 1 });
  // The caret's page follows the cell it is in: B's first paragraph is on page 1, the end of A on page 2.
  await page.locator("td").nth(1).locator("p").first().click();
  await expect(page.getByTestId("page-position")).toHaveText(/ · Page 1 of 2$/, { timeout: 5_000 });
  await page.waitForTimeout(500); // the page measures once more after the first click; let the layout settle
  // A click on the first word after cell A's spacer: the caret is past the break, in a cell whose neighbour was cut elsewhere.
  const tail = await page.evaluate(() => {
    const next = document.querySelector("td .pv-gap")!.nextSibling!;
    (next.parentElement ?? document.body).scrollIntoView({ block: "center" });
    // The text after the spacer may be wrapped (a left-hand page shifts it).
    const text = document.createTreeWalker(next, NodeFilter.SHOW_TEXT).nextNode() ?? next;
    const range = document.createRange();
    range.setStart(text, 1);
    range.setEnd(text, 2);
    const r = range.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.click(tail.x, tail.y);
  await expect(page.getByTestId("page-position")).toHaveText(/ · Page 2 of 2$/, {
    timeout: 5_000,
  });
  // The author's text is untouched.
  expect(await page.evaluate(() => JSON.stringify(window.__disk))).not.toContain("pv-gap");
});

test("a table row cut for a cell that ends before the page does leaves that cell on the first page, and a row of three pages is drawn on three", async ({
  page,
}) => {
  await newProject(page);
  const long = {
    type: "doc",
    content: [
      h1("Chapter One"),
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              { type: "tableCell", content: [p(words(120, 1))] },
              { type: "tableCell", content: [p(words(8, 2))] },
              { type: "tableCell", content: [p(words(70, 3))] },
            ],
          },
        ],
      },
    ],
  };
  await seedChapters(page, [long as never]);
  // Cell 0 runs onto pages 2 and 3 (at its words 40 and 90), cell 1 ends on page 1, cell 2 runs onto page 2 only (at its word 30).
  await answerWith(
    page,
    JSON.stringify({
      total: 3,
      starts: [{ id: "chapter-1", kind: "chapter", page: 1, end: 3, number: "1" }],
      marks: [
        ["s", 0, 0, "h", 1],
        ["s", 0, 1, "p", 1],
        ["w", 41, 2],
        ["w", 91, 3],
        ["s", 0, 1, "p", 1],
        ["s", 0, 1, "p", 1],
        ["w", 31, 2],
      ],
    }),
  );
  await remeasure(page);
  await page.getByLabel("Page zoom").selectOption({ label: "100%" });
  await expect(page.locator(".page-chip")).toHaveText(/breaks as in the PDF/, { timeout: 10_000 });
  await expect(cards(page)).toHaveCount(3);
  const t = await tails(page);
  expect(t.map((x) => [x.cell, x.card])).toEqual([
    [0, 1],
    [0, 2],
    [2, 1],
  ]);
  // The cell that ends first has no spacer and stays on the first card.
  const short = await page.evaluate(() => {
    const cards = [...document.querySelectorAll<HTMLElement>(".page")].map((c) =>
      c.getBoundingClientRect(),
    );
    const r = document.querySelectorAll("td")[1]!.querySelector("p")!.getBoundingClientRect();
    return cards.findIndex((c) => r.top >= c.top && r.top < c.bottom);
  });
  expect(short).toBe(0);
});

test("a table that Typst starts a page inside of, at a cell that is not at the top of its row, falls back to the estimate for the whole chapter", async ({
  page,
}) => {
  await newProject(page);
  await seedChapters(page, [doc()]);
  // A page begins at the second cell of the first row: Typst starts all the cells of a row together, so these marks cannot be right.
  const bad = JSON.parse(report("chapter-1"));
  const cells = bad.marks.filter((m: unknown[]) => m[0] === "s" && m[2] === 4);
  cells[1][4] = 5;
  await answerWith(page, JSON.stringify(bad));
  await remeasure(page);
  await page.getByLabel("Page zoom").selectOption({ label: "100%" });
  await expect
    .poll(() => page.evaluate(() => window.__typstQueryCalls?.length ?? 0))
    .toBeGreaterThan(1);
  await expect(page.locator(".page-chip")).toHaveText("5.5 × 8.5 in · approximate");
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
  await remeasure(page);
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
  await focusEnd(page);
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
  // An edit and its undo make the page measure again, now that Typst answers.
  await page.keyboard.type("x");
  await page.keyboard.press("Backspace");
  await remeasure(page);
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
  await answerWith(page, report("chapter-1"));
  await seedChapters(page, [doc()]);
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
  const own = (r: string) => {
    // Only the chapter on its own (one chapter-start in the source) gets an answer; the book's has nothing usable.
    window.__typstQueryResultFor = (source) =>
      (source.match(/#chapter-start\(/g) ?? []).length === 1 ? r : undefined;
  };
  await page.addInitScript(own, report("chapter-1"));
  await seedChapters(page, [
    doc(),
    { type: "doc", content: [h1("Chapter Two"), p(words(20, 1))] } as never,
  ]);
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
