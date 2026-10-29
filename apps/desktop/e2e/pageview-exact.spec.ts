import { expect, test, type Page } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { newProject } from "./support/helpers";

// Page view with Typst's page marks (exact breaks inside a chapter, the cursor's exact page) and the print preview's zoom and
// "open this page in the editor". The Typst answers are canned (`__typstQueryResult`); the layout is real Chromium.

const CHAPTER = "manuscript/001-chapter-one.json";
const toggle = (page: Page) => page.getByRole("button", { name: "Page view", exact: true });
const cards = (page: Page) => page.locator(".page");

const word = (i: number) =>
  ["quiet", "garden", "river", "stone", "letter", "morning", "lantern", "orchard", "winter"][
    i % 9
  ]!;
const para = (n: number, seed: number) =>
  Array.from({ length: n }, (_, i) => word(i * 7 + seed)).join(" ") + ".";

/** The chapter: a title and eight paragraphs of 40 words (block 0 is the title, block `k` the paragraph with seed `k - 1`). */
async function seed(page: Page) {
  const doc = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Chapter One" }] },
      ...Array.from({ length: 8 }, (_, i) => ({
        type: "paragraph",
        content: [{ type: "text", text: para(40, i) }],
      })),
    ],
  };
  await page.evaluate(
    ([file, json]) => {
      window.__disk[file!] = json!;
      sessionStorage.setItem("disk", JSON.stringify(window.__disk));
    },
    [CHAPTER, JSON.stringify(doc)],
  );
  await page.reload();
  await page.getByRole("button", { name: "Open folder" }).click();
  await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter One");
}

/** Typst's page report for the seeded chapter: three pages, page 2 starts inside block 4 (at its word 30), page 3 before block 7. */
const report = (id: string, kinds: string[] = []) =>
  JSON.stringify({
    total: 3,
    starts: [{ id, kind: "chapter", page: 1, end: 3, number: "1" }],
    marks: [
      ["s", 0, 0, kinds[0] ?? "h", 1],
      ["s", 0, 1, "p", 1],
      ["s", 0, 2, "p", 1],
      ["s", 0, 3, "p", 1],
      ["s", 0, 4, "p", 1],
      ["w", 31, 2],
      ["s", 0, 5, "p", 2],
      ["s", 0, 6, "p", 2],
      ["s", 0, 7, "p", 3],
      ["s", 0, 8, "p", 3],
    ],
  });

const chapterId = (page: Page) =>
  page.evaluate(
    () =>
      /#chapter-start\("Chapter One", 1, id: "([^"]+)"/.exec(
        (window.__typstQueryCalls?.[0] ?? window.__typstCalls?.[0])!.source,
      )![1]!,
  );

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

test("Typst's marks put the page breaks inside the chapter where the PDF has them, to the word, and the cursor's page is exact", async ({
  page,
}) => {
  await newProject(page);
  await seed(page);
  await toggle(page).click();
  await page.getByLabel("Page zoom").selectOption({ label: "100%" });
  await expect(cards(page).first()).toBeVisible();
  // The first measures (the chapter on its own, and the book) have no marks that fit: the estimate, and the chip says so.
  await expect.poll(() => page.evaluate(() => window.__typstQueryCalls?.length ?? 0)).toBe(2);
  await expect(page.locator(".page-chip")).toHaveText("Page view · 5.5 × 8.5 in · approximate");
  const id = await chapterId(page);
  await page.evaluate((r) => (window.__typstQueryResult = r), report(id));
  // Any edit asks Typst again once the book has been still.
  await page.locator(".ProseMirror p").first().click();
  await page.keyboard.press("End");
  await page.keyboard.insertText(" x");
  await expect(page.locator(".page-chip")).toHaveText(
    "Page view · 5.5 × 8.5 in · breaks as in the PDF",
    {
      timeout: 10_000,
    },
  );
  await expect(cards(page)).toHaveCount(3);
  // Page 2 starts at the word Typst began it with, in the middle of a paragraph...
  const inner = page.locator(".pv-gap-inline");
  await expect(inner).toHaveCount(1);
  const cut = para(40, 3).split(" ").slice(30).join(" ");
  expect(
    await inner.evaluate((el) => el.nextElementSibling?.textContent ?? el.nextSibling?.textContent),
  ).toBe(cut);
  // ...and page 3 before the block Typst started it with.
  const between = page.locator(".pv-gap:not(.pv-gap-inline)");
  await expect(between).toHaveCount(1);
  expect(await between.evaluate((el) => el.nextElementSibling?.textContent)).toBe(para(40, 6));
  // The cursor's page is exact once the report is current: no "≈" anywhere.
  await expect(page.getByTestId("page-position")).toHaveText(/Page \d of 3$/, { timeout: 10_000 });
  const caretAt = (index: number, offset: number) =>
    page.evaluate(
      ([i, o]) => {
        const p = document.querySelectorAll(".ProseMirror > p")[i!]!;
        const text = [...p.childNodes].find((n) => n.nodeType === 3 || n.firstChild)!;
        getSelection()!.collapse(text.nodeType === 3 ? text : text.firstChild!, o!);
      },
      [index, offset],
    );
  await caretAt(7, 20); // the last paragraph: page 3
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("page-position")).toHaveText(/ · Page 3 of 3$/);
  await caretAt(1, 20); // the first: page 1
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("page-position")).toHaveText(/ · Page 1 of 3$/);
  // On either side of the break inside the paragraph the cursor is on the page that side is on.
  await page.evaluate(() => {
    const p = document.querySelectorAll(".ProseMirror > p")[3]!;
    const sel = getSelection()!;
    const text = [...p.childNodes].find((n) => n.nodeType === 3)!;
    sel.collapse(text, 5); // in the first words of the paragraph: page 1
  });
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("page-position")).toHaveText(/ · Page 1 of 3$/);
  await page.evaluate(() => {
    const p = document.querySelectorAll(".ProseMirror > p")[3]!;
    const spans = [...p.querySelectorAll(".pv-gap-inline")];
    const after = spans[0]!.nextElementSibling ?? spans[0]!.nextSibling!;
    const text = after.nodeType === 3 ? after : after.firstChild!;
    getSelection()!.collapse(text, 3); // in the words after the break: page 2
  });
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("page-position")).toHaveText(/ · Page 2 of 3$/);
  // The text is the author's: no spacer, mark or page is in what is saved.
  expect(await page.evaluate((f) => window.__disk[f] as string, CHAPTER)).not.toContain("pv-gap");
});

test("marks that do not fit the text leave the estimate, and a stale report is not called exact", async ({
  page,
}) => {
  await newProject(page);
  await seed(page);
  await toggle(page).click();
  await page.getByLabel("Page zoom").selectOption({ label: "100%" });
  await expect.poll(() => page.evaluate(() => window.__typstQueryCalls?.length ?? 0)).toBe(2);
  const id = await chapterId(page);
  // The report says block 0 is a scene break: it is a heading, so none of it is used.
  await page.evaluate((r) => (window.__typstQueryResult = r), report(id, ["s"]));
  await page.locator(".ProseMirror p").first().click();
  await page.keyboard.press("End");
  await page.keyboard.insertText(" x");
  await expect(page.getByTestId("page-position")).toHaveText(/Page ≈ 1 of 3$/, {
    timeout: 10_000,
  });
  await expect(page.locator(".page-chip")).toHaveText("Page view · 5.5 × 8.5 in · approximate");
  // With good marks the breaks follow them; an edit keeps them (only the cursor's page loses its exactness until the next measure).
  await page.evaluate((r) => (window.__typstQueryResult = r), report(id));
  await page.keyboard.insertText("y");
  await expect(page.locator(".page-chip")).toHaveText(/breaks as in the PDF/, { timeout: 10_000 });
  await page.keyboard.insertText("z");
  await expect(page.getByTestId("page-position")).toHaveText(/Page \d of 3$/);
  await expect(page.getByTestId("page-position")).not.toHaveText(/≈/, { timeout: 10_000 });
  await expect(page.locator(".page-chip")).toHaveText(/breaks as in the PDF/);
});

/** The print preview of the seeded chapter, with Typst's layout of it ready for a click on a page. */
async function previewOfSeeded(page: Page) {
  await newProject(page);
  await seed(page);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export book" });
  await dialog.getByRole("radio", { name: "Print PDF" }).click();
  await dialog.getByRole("button", { name: "Print preview" }).click();
  await expect(page.getByRole("img", { name: "Page 1", exact: true })).toBeVisible();
  return chapterId(page);
}

test("print preview zoom: the pages grow and shrink in steps and the buttons stop at the ends", async ({
  page,
}) => {
  await previewOfSeeded(page);
  const label = page.getByTestId("preview-zoom");
  const width = async () =>
    (await page.getByRole("img", { name: "Page 1", exact: true }).boundingBox())!.width;
  await expect(label).toHaveText("100%");
  const base = await width();
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(label).toHaveText("125%");
  await expect.poll(width).toBeCloseTo(base * 1.25, 0);
  await page.getByRole("button", { name: "Zoom out" }).click();
  await page.getByRole("button", { name: "Zoom out" }).click();
  await expect(label).toHaveText("75%");
  await expect.poll(width).toBeCloseTo(base * 0.75, 0);
  await page.getByRole("button", { name: "Zoom out" }).click();
  await expect(label).toHaveText("50%");
  await expect(page.getByRole("button", { name: "Zoom out" })).toBeDisabled();
  for (let i = 0; i < 6; i++) await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(label).toHaveText("300%");
  await expect(page.getByRole("button", { name: "Zoom in" })).toBeDisabled();
  // The zoom stays when the spread is turned.
  await page.getByRole("button", { name: "Next pages" }).click();
  await expect(label).toHaveText("300%");
});

test("print preview: a page opens its chapter in the editor with the caret at the text that starts the page", async ({
  page,
}) => {
  const id = await previewOfSeeded(page);
  await page.evaluate((r) => (window.__typstQueryResult = r), report(id));
  await page.getByRole("button", { name: "Next pages" }).click();
  await expect(page.getByRole("img", { name: "Page 3", exact: true })).toBeVisible();
  const before = await page.evaluate(() => window.__typstQueryCalls?.length ?? 0);
  // Page 2 begins inside block 4, at its word 30.
  await page.getByRole("button", { name: "Open page 2 in the editor" }).click();
  await expect(page.locator(".ProseMirror")).toBeVisible();
  const at = para(40, 3).split(" ").slice(30).join(" ");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const s = getSelection()!;
        return s.anchorNode?.textContent?.slice(s.anchorOffset) ?? "";
      }),
    )
    .toBe(at);
  // One layout answered it, and it was asked with the marks on; the word is a page began in, so a second run asked where in it.
  const calls = await page.evaluate(() => window.__typstQueryCalls ?? []);
  expect(calls.length - before).toBe(2);
  expect(calls.at(-2)!.source).toContain("#let wm(w)");
  expect(calls.at(-1)!.source).toContain("#cm(");
  // Back in the preview, a page that starts with a block puts the caret at its beginning.
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export book" });
  await dialog.getByRole("radio", { name: "Print PDF" }).click();
  await dialog.getByRole("button", { name: "Print preview" }).click();
  await page.getByRole("button", { name: "Next pages" }).click();
  await page.getByRole("button", { name: "Open page 3 in the editor" }).click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const s = getSelection()!;
        return s.anchorNode?.textContent?.slice(s.anchorOffset, s.anchorOffset + 30) ?? "";
      }),
    )
    .toBe(para(40, 6).slice(0, 30));
});

test("print preview: opening a page says it is looking, leaves Read mode for Write mode, and reports a book it cannot place or a Typst failure", async ({
  page,
}) => {
  const id = await previewOfSeeded(page);
  // Typst cannot lay it out.
  await page.evaluate(() => {
    window.__compileError = { kind: "not_found", message: "no typst" };
  });
  await page.getByRole("button", { name: "Open page 1 in the editor" }).click();
  await expect(page.getByRole("alert")).toContainText("no typst");
  // Nothing in the layout: the page is not in the book.
  await page.evaluate(() => {
    window.__compileError = undefined;
  });
  await page.getByRole("button", { name: "Open page 1 in the editor" }).click();
  await expect(page.getByRole("alert")).toHaveText("That page is not in the book.");
  // The book is read, not written, when the preview is opened: the jump goes to the editor.
  await page.evaluate((r) => (window.__typstQueryResult = r), report(id));
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("radio", { name: "Read" }).click();
  await expect(page.getByRole("radio", { name: "Read" })).toBeChecked();
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export book" });
  await dialog.getByRole("radio", { name: "Print PDF" }).click();
  await dialog.getByRole("button", { name: "Print preview" }).click();
  // (A layout is kept per trim size: another size asks Typst again, now with a layout to answer from.)
  await page.getByLabel("Trim size").selectOption("5x8");
  await page.getByRole("button", { name: "Open page 1 in the editor" }).click();
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await expect(page.getByRole("radio", { name: "Write" })).toBeChecked();
});
