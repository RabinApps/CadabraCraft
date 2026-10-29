import { expect, test, type Page } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { newProject } from "./support/helpers";
import { bigChapter } from "../src/test/bigBook";

// Page view: the chapter as real pages (cards at the trim's shape, mirrored margins, running heads, page numbers, split paragraphs).
// Real Chromium layout; the Tauri backend is the in-memory fake.

const toggle = (page: Page) => page.getByRole("button", { name: "Page view", exact: true });
const zoom = (page: Page) => page.getByLabel("Page zoom");
const cards = (page: Page) => page.locator(".page");
const CHAPTER = "manuscript/001-chapter-one.json";

const word = (i: number) =>
  ["quiet", "garden", "river", "stone", "letter", "morning", "lantern", "orchard", "winter"][
    i % 9
  ]!;
/** A paragraph of `n` words, different for each `seed`. */
const para = (n: number, seed: number) =>
  Array.from({ length: n }, (_, i) => word(i * 7 + seed)).join(" ") + ".";

/** The chapter with `count` paragraphs of about 40 words each, written to the fake disk before the book is opened. */
async function seed(page: Page, count: number, per = 40) {
  const doc = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Chapter One" }] },
      ...Array.from({ length: count }, (_, i) => ({
        type: "paragraph",
        content: [{ type: "text", text: para(per, i) }],
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

async function pageViewAt100(page: Page) {
  await toggle(page).click();
  await zoom(page).selectOption({ label: "100%" });
  await expect(cards(page).first()).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

test("the page cards have the shape of the trim size and follow a trim change", async ({
  page,
}) => {
  await newProject(page);
  await pageViewAt100(page);
  const ratio = () =>
    cards(page)
      .first()
      .evaluate((el) => {
        const r = el.getBoundingClientRect();
        return r.width / r.height;
      });
  expect(await ratio()).toBeCloseTo(5.5 / 8.5, 2);
  for (const [trim, w, h] of [
    ["5x8", 5, 8],
    ["6x9", 6, 9],
    ["5.5x8.5", 5.5, 8.5],
  ] as const) {
    await page.getByRole("button", { name: "Book details" }).click();
    const details = page.getByRole("dialog", { name: "Book details" });
    await details.getByLabel("Trim size").selectOption(trim);
    await details.getByRole("button", { name: "Save details" }).click();
    await expect(details).toBeHidden();
    await expect.poll(async () => Math.abs((await ratio()) / (w / h) - 1)).toBeLessThan(0.005);
    const box = await cards(page).first().boundingBox();
    expect(Math.abs(box!.width - w * 96)).toBeLessThan(2);
    expect(Math.abs(box!.height - h * 96)).toBeLessThan(2);
  }
  await expect(page.locator(".page-chip")).toHaveText("Page view · 5.5 × 8.5 in · approximate");
});

test("a long chapter is paginated: running heads, numbers, mirrored margins and the page count", async ({
  page,
}) => {
  await newProject(page);
  await seed(page, 60);
  await pageViewAt100(page);
  await expect.poll(() => cards(page).count()).toBeGreaterThan(4);
  const n = await cards(page).count();
  // The status bar counts the same pages.
  await expect(page.getByTestId("page-position")).toHaveText(new RegExp(`Page 1 of ≈ ${n}$`));
  // Numbers count up from 1; the chapter's opening page has no running head, the pages after it do.
  expect(await page.locator(".page .page-number").allTextContents()).toEqual(
    Array.from({ length: n }, (_, i) => String(i + 1)),
  );
  await expect(page.locator('.page[data-page="1"] .page-head')).toHaveCount(0);
  await expect(page.locator('.page[data-page="2"] .page-head')).toHaveText("E2E Book"); // verso: the book
  await expect(page.locator('.page[data-page="3"] .page-head')).toHaveText("Chapter One"); // recto: the chapter
  // Facing pages mirror: the text's left edge, measured from its card, is further in on a right-hand page.
  const left = (num: number) =>
    page.evaluate((k) => {
      const card = document.querySelector(`.page[data-page="${k}"]`)!.getBoundingClientRect();
      const paras = [...document.querySelectorAll<HTMLElement>(".ProseMirror > p")];
      const whole = paras.find((p) => {
        const r = p.getBoundingClientRect();
        return r.top > card.top + 90 && r.bottom < card.bottom - 90;
      })!;
      return whole.getBoundingClientRect().left - card.left;
    }, num);
  const recto = await left(3);
  const verso = await left(2);
  expect(recto).toBeGreaterThan(verso + 15);
  expect(Math.abs(recto - 0.9 * 96)).toBeLessThan(2);
  expect(Math.abs(verso - 0.65 * 96)).toBeLessThan(2);
  // No page is left empty inside the chapter, and none holds more than its text box.
  const fill = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".page")].map((card) => {
      const c = card.getBoundingClientRect();
      // Text line boxes, not paragraph boxes: a paragraph that splits across pages reaches into the next card,
      // and its spacer is as tall as the rest of the page.
      const bottoms = [...document.querySelectorAll<HTMLElement>(".ProseMirror > p")]
        .flatMap((p) => {
          const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
          const rects: DOMRect[] = [];
          for (let t = walker.nextNode(); t; t = walker.nextNode()) {
            if ((t.parentElement as HTMLElement).closest(".pv-gap-inline")) continue;
            const range = document.createRange();
            range.selectNodeContents(t);
            rects.push(...range.getClientRects());
          }
          return rects;
        })
        .filter((r) => r.height > 0 && r.top >= c.top && r.top < c.bottom - 40)
        .map((r) => r.bottom);
      return bottoms.length ? Math.max(...bottoms) - c.top : 0;
    }),
  );
  for (const f of fill.slice(0, -1)) expect(f).toBeLessThanOrEqual(8.5 * 96 - 0.9 * 96 + 24);
});

test("a paragraph is split across pages and the text stays one paragraph", async ({ page }) => {
  await newProject(page);
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("ControlOrMeta+End");
  const long = Array.from({ length: 12 }, (_, i) => para(100, i)).join(" ");
  await page.keyboard.insertText(long);
  await pageViewAt100(page);
  await expect.poll(() => cards(page).count()).toBeGreaterThanOrEqual(2);
  await expect(page.locator(".ProseMirror p")).toHaveCount(1);
  await expect(page.locator(".pv-gap-inline").first()).toBeAttached();
  // The text after the break starts at the top of the next card's text box.
  const offset = await page.evaluate(() => {
    const gap = document.querySelector(".pv-gap-inline")!.getBoundingClientRect();
    const next = document.querySelector('.page[data-index="1"]')!.getBoundingClientRect();
    return gap.bottom - next.top;
  });
  expect(Math.abs(offset - 0.8 * 96)).toBeLessThan(2);
  // The justified line before the break fills the line (it is a wrapped line, not a last line).
  const widths = await page.evaluate(() => {
    const gap = document.querySelector(".pv-gap-inline")!;
    const p = gap.parentElement!.getBoundingClientRect();
    const range = document.createRange();
    range.setStart(gap.parentElement!.firstChild!, 0);
    range.setEndBefore(gap);
    const rects = [...range.getClientRects()];
    const lastLine = rects.filter((r) => Math.abs(r.top - rects[rects.length - 1]!.top) < 2);
    return {
      p: p.width,
      line: Math.max(...lastLine.map((r) => r.right)) - Math.min(...lastLine.map((r) => r.left)),
    };
  });
  expect(widths.line).toBeGreaterThan(widths.p * 0.9);
});

test("a word split across a page break shows its hyphen", async ({ page }) => {
  await newProject(page);
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("ControlOrMeta+End");
  const words = [
    "extraordinarily",
    "incomprehensible",
    "uncharacteristically",
    "internationalization",
    "of",
    "the",
    "unmistakably",
  ];
  // A repeating text breaks every page at the same place in its cycle, which can always be between words;
  // a fixed pseudo-random order makes the breaks differ whatever font the page is set in.
  let state = 7;
  const long = Array.from({ length: 2400 }, () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return words[state % words.length];
  }).join(" ");
  await page.keyboard.insertText(long);
  await pageViewAt100(page);
  await expect(page.locator(".pv-gap-inline").first()).toBeAttached();
  const hyphenated = await page.evaluate(
    () => getComputedStyle(document.querySelector(".ProseMirror")!).hyphens === "auto",
  );
  test.skip(!hyphenated, "this template does not hyphenate");
  // Every break that falls inside a word has a hyphen right before its spacer, and no break at a space has one.
  const breaks = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".pv-gap-inline")].map((gap) => {
      const before = gap.previousSibling;
      const after = gap.nextSibling?.textContent?.[0] ?? "";
      const prev = before instanceof HTMLElement ? before : null;
      const text = (prev ? prev.previousSibling : before)?.textContent ?? "";
      return {
        midWord: /\p{L}$/u.test(text) && /\p{L}/u.test(after),
        hyphen: !!prev?.matches(".pv-hyphen"),
      };
    }),
  );
  expect(breaks.length).toBeGreaterThan(0);
  for (const b of breaks) expect(b.hyphen).toBe(b.midWord);
  expect(breaks.some((b) => b.hyphen)).toBe(true);
});

test("typing a lot adds pages; nothing of the pagination reaches the saved chapter", async ({
  page,
}) => {
  await newProject(page);
  await pageViewAt100(page);
  await expect(cards(page)).toHaveCount(1);
  await expect(page.getByTestId("page-position")).toHaveText(/Page 1 of ≈ 1$/);
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("ControlOrMeta+End");
  const typed = Array.from({ length: 30 }, (_, i) => para(110, i)).join(" ");
  await page.keyboard.insertText(typed);
  await expect.poll(() => cards(page).count()).toBeGreaterThanOrEqual(4);
  const n = await cards(page).count();
  await expect(page.getByTestId("page-position")).toHaveText(new RegExp(`of ≈ ${n}$`));
  // The cursor is at the end of the text: the position follows it.
  await expect(page.getByTestId("page-position")).toHaveText(new RegExp(`Page ${n} of`));
  await expect
    .poll(() => page.evaluate((f) => window.__disk[f] as string, CHAPTER))
    .toContain("quiet");
  const json = await page.evaluate((f) => window.__disk[f] as string, CHAPTER);
  expect(json).not.toMatch(/pv-|page|gap|verso/i);
  const doc = JSON.parse(json) as {
    content: { type: string; content?: { text?: string }[] }[];
  };
  expect(doc.content.map((b) => b.type)).toEqual(["heading", "paragraph"]);
  expect(doc.content[1]!.content!.map((t) => t.text).join("")).toBe(typed);
  // Copying a selection takes the text only, not the page spacers.
  await page.keyboard.press("ControlOrMeta+a");
  const copied = await page.evaluate(() => {
    const sel = window.getSelection()!;
    return sel.toString();
  });
  expect(copied).not.toContain("pv-");
});

test("zoom 75% and 125% scale the stack, Fit width fills the pane, off restores the editor", async ({
  page,
}) => {
  await newProject(page);
  await seed(page, 40);
  await toggle(page).click();
  const width = () =>
    cards(page)
      .first()
      .evaluate((el) => el.getBoundingClientRect().width);
  await zoom(page).selectOption({ label: "75%" });
  await expect.poll(width).toBeGreaterThan(395);
  expect(Math.abs((await width()) - 5.5 * 96 * 0.75)).toBeLessThan(1.5);
  await zoom(page).selectOption({ label: "125%" });
  await expect.poll(async () => Math.round(await width())).toBe(660);
  // The scroll height follows the scaled height of the stack.
  const heights = await page.evaluate(() => {
    const sizer = document.querySelector<HTMLElement>(".page-sizer")!;
    const stack = document.querySelector<HTMLElement>(".page-stack")!;
    return {
      sizer: sizer.getBoundingClientRect().height,
      stack: stack.getBoundingClientRect().height,
    };
  });
  expect(Math.abs(heights.sizer - heights.stack)).toBeLessThan(2);
  await zoom(page).selectOption({ label: "Fit width" });
  const fit = async () =>
    page.evaluate(() => {
      const pane = document.querySelector<HTMLElement>('[data-testid="page-scroll"]')!;
      const card = document.querySelector(".page")!.getBoundingClientRect();
      return { pane: pane.clientWidth, card: card.width };
    });
  await expect
    .poll(async () => Math.abs((await fit()).card - ((await fit()).pane - 48)))
    .toBeLessThan(2);
  // Off: the normal editor, no page cards.
  await toggle(page).click();
  await expect(cards(page)).toHaveCount(0);
  await expect(page.locator(".prose-page")).toHaveCount(0);
  await expect(page.getByTestId("page-position")).toHaveCount(0);
  await expect(page.locator(".page-chip")).toHaveCount(0);
  await expect(page.locator(".pv-gap")).toHaveCount(0);
  await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter One");
  await expect(page.locator(".ProseMirror p")).toHaveCount(40);
});

test("a chapter that would open on a left-hand page gets a blank verso page first", async ({
  page,
}) => {
  await newProject(page);
  // The first chapter is empty: one page, so the second would open on page 2 and the template starts chapters on a right-hand page.
  await page.getByRole("button", { name: "Add chapter" }).click();
  await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter 2");
  await toggle(page).click();
  await expect(cards(page)).toHaveCount(2);
  const blank = cards(page).first();
  await expect(blank).toHaveAttribute("data-blank", "true");
  await expect(blank).toHaveAttribute("data-page", "2");
  await expect(blank.locator(".page-number")).toHaveText("2");
  await expect(blank.locator(".page-head")).toHaveCount(0);
  const opening = cards(page).nth(1);
  await expect(opening).toHaveAttribute("data-page", "3");
  await expect(opening).not.toHaveAttribute("data-blank", "true");
  await expect(opening.locator(".page-head")).toHaveCount(0);
  // The chapter title sits on the opening page, below the blank page.
  const boxes = await page.evaluate(() => ({
    blank: document.querySelector(".page")!.getBoundingClientRect().bottom,
    title: document.querySelector(".ProseMirror h1")!.getBoundingClientRect().top,
  }));
  expect(boxes.title).toBeGreaterThan(boxes.blank);
  await expect(page.getByTestId("page-position")).toHaveText(/of ≈ 2$/);
});

test("the second chapter is numbered after the first and opens on a right-hand page", async ({
  page,
}) => {
  await newProject(page);
  await seed(page, 70);
  await page.getByRole("button", { name: "Add chapter" }).click();
  await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter 2");
  await toggle(page).click();
  await expect(cards(page).first()).toBeVisible();
  const opening = page.locator(".page:not([data-blank])").first();
  const number = Number(await opening.getAttribute("data-page"));
  expect(number % 2).toBe(1);
  expect(number).toBeGreaterThan(8);
  await expect(page.locator(".page-head")).toHaveCount(0);
});

test("find still highlights, editing keeps working and undo restores the text in Page view", async ({
  page,
}) => {
  await newProject(page);
  await seed(page, 30);
  await pageViewAt100(page);
  await expect.poll(() => cards(page).count()).toBeGreaterThan(2);
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("ControlOrMeta+f");
  await page.keyboard.type("lantern");
  await expect.poll(() => page.locator(".prose-page .search-match").count()).toBeGreaterThan(10);
  await page.keyboard.press("Escape");
  await page.locator(".ProseMirror p").nth(3).click();
  await page.keyboard.press("End");
  const before = await page.locator(".ProseMirror p").nth(3).textContent();
  await page.keyboard.type(" extra");
  await expect(page.locator(".ProseMirror p").nth(3)).toContainText("extra");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator(".ProseMirror p").nth(3)).toHaveText(before!);
  // The tooltip of the chip says which font sets the text.
  await expect(page.locator(".page-chip")).toHaveAttribute("title", /Libertinus Serif/);
});

test("a long chapter (100,000 words in one document) stays responsive", async ({ page }) => {
  test.setTimeout(180_000);
  await newProject(page);
  const big = JSON.stringify(bigChapter(100_000, 7, "Long"));
  await page.evaluate(
    ([file, json]) => {
      window.__disk[file!] = json!;
      sessionStorage.setItem("disk", JSON.stringify(window.__disk));
    },
    [CHAPTER, big],
  );
  await page.reload();
  await page.getByRole("button", { name: "Open folder" }).click();
  await expect(page.locator(".ProseMirror h1")).toHaveText("Long");
  const t0 = Date.now();
  await toggle(page).click();
  await zoom(page).selectOption({ label: "75%" });
  await expect.poll(() => cards(page).count(), { timeout: 90_000 }).toBeGreaterThan(200);
  const first = Date.now() - t0;
  const n = await cards(page).count();
  await expect(page.getByTestId("page-position")).toHaveText(new RegExp(`of ≈ ${n}$`));
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.evaluate(() => {
    const lat: number[] = [];
    window.__lat = lat;
    window.addEventListener(
      "keydown",
      () => {
        const t = performance.now();
        requestAnimationFrame(() => requestAnimationFrame(() => lat.push(performance.now() - t)));
      },
      true,
    );
  });
  for (let i = 0; i < 40; i++) await page.keyboard.type("x");
  await expect.poll(() => page.evaluate(() => window.__lat.length)).toBe(40);
  const sorted = [...(await page.evaluate(() => window.__lat as number[]))].sort((a, b) => a - b);
  console.info(
    `[perf] Page view, 100k words in one chapter: ${n} pages, first pagination ${first} ms, typing median ${sorted[20]!.toFixed(1)} ms, worst ${sorted[39]!.toFixed(1)} ms`,
  );
  // Ceilings far above what the dev machine measures: they catch a per-keystroke pass that is quadratic or blocks typing.
  expect(sorted[20]!).toBeLessThan(500);
  expect(sorted[39]!).toBeLessThan(2000);
  // Editing one paragraph re-measures that block only; the pages stay.
  await expect.poll(() => cards(page).count()).toBe(n);
});

/**
 * Turns automatic hyphenation off for the page (also after a reload). The pages are measured with the hyphen glyph left out, and
 * Chromium loads its hyphenation dictionary lazily: under load a word split at a page break can be hyphenated only after the
 * measurement, and the glyph then pushes the line over, so the page ends one line later than measured (a lasting 19 px offset).
 * Tests of exact card geometry do not depend on hyphens; "a word split across a page break shows its hyphen" covers them.
 */
const noHyphens = (page: Page) =>
  page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = ".ProseMirror { hyphens: manual !important; }";
      document.head.append(style);
    });
  });

/**
 * Every card is exactly the page size and the cards are one page plus the 24 px gap apart (zoom 100%). The pages are re-measured
 * and re-laid out in steps after a trim or text change (slower under load), so the check is retried until the layout has settled
 * rather than read once after a fixed pause.
 */
async function expectExactCards(page: Page, w: number, h: number) {
  await expect(() => checkExactCards(page, w, h)).toPass({ timeout: 15_000 });
}

async function checkExactCards(page: Page, w: number, h: number) {
  const boxes = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".page")].map((c) => ({
      w: c.getBoundingClientRect().width,
      h: c.getBoundingClientRect().height,
      top: c.getBoundingClientRect().top,
    })),
  );
  expect(boxes.length).toBeGreaterThan(0);
  boxes.forEach((b, i) => {
    expect(Math.abs(b.w - w * 96), `card ${i} width`).toBeLessThan(0.5);
    expect(Math.abs(b.h - h * 96), `card ${i} height`).toBeLessThan(0.5);
    if (i > 0)
      expect(Math.abs(b.top - boxes[i - 1]!.top - (h * 96 + 24)), `card ${i} pitch`).toBeLessThan(
        0.5,
      );
  });
}

test("every card is exactly the page size on every trim, for short and long chapters", async ({
  page,
}) => {
  await noHyphens(page);
  await newProject(page);
  await seed(page, 15, 60); // about 900 words: the opening page is full of text
  await pageViewAt100(page);
  for (const [trim, w, h] of [
    ["5x8", 5, 8],
    ["6x9", 6, 9],
    ["5.5x8.5", 5.5, 8.5],
  ] as const) {
    await page.getByRole("button", { name: "Book details" }).click();
    const details = page.getByRole("dialog", { name: "Book details" });
    await details.getByLabel("Trim size").selectOption(trim);
    await details.getByRole("button", { name: "Save details" }).click();
    await expect(details).toBeHidden();
    await expect.poll(() => cards(page).count()).toBeGreaterThan(2);
    await expect
      .poll(() =>
        cards(page)
          .first()
          .evaluate((c) => Math.round(c.getBoundingClientRect().width)),
      )
      .toBe(Math.round(w * 96));
    await page.waitForTimeout(400);
    await expectExactCards(page, w, h);
  }
  await seed(page, 80, 45);
  await expect(zoom(page)).toHaveValue("1"); // Page view and its zoom are remembered across the reload
  await expect.poll(() => cards(page).count()).toBeGreaterThan(4);
  await page.waitForTimeout(400);
  await expectExactCards(page, 5.5, 8.5);
});

test("the opening page is exact with a heading after the title or a very short first paragraph", async ({
  page,
}) => {
  await noHyphens(page);
  await newProject(page);
  const text = (t: string) => [{ type: "text", text: t }];
  const doc = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 1 }, content: text("Chapter One") },
      { type: "heading", attrs: { level: 2 }, content: text("A subheading") },
      { type: "paragraph", content: text("Short.") },
      ...Array.from({ length: 20 }, (_, i) => ({ type: "paragraph", content: text(para(60, i)) })),
    ],
  };
  await page.evaluate(
    ([f, j]) => {
      window.__disk[f!] = j!;
      sessionStorage.setItem("disk", JSON.stringify(window.__disk));
    },
    [CHAPTER, JSON.stringify(doc)],
  );
  await page.reload();
  await page.getByRole("button", { name: "Open folder" }).click();
  await pageViewAt100(page);
  await expect.poll(() => cards(page).count()).toBeGreaterThan(3);
  await page.waitForTimeout(400);
  await expectExactCards(page, 5.5, 8.5);
});

test("with Page view on, Typst's page report replaces the estimate in the status bar and the chapter's first page number", async ({
  page,
}) => {
  await newProject(page);
  await page.evaluate(() => {
    window.__typstQueryResult = JSON.stringify({
      total: 40,
      starts: [{ id: "chapter-1", kind: "chapter", page: 1, end: 1, number: "1" }],
    });
  });
  await page.locator(".ProseMirror").click();
  await page.keyboard.insertText("A few words.");
  // Off, nothing asks Typst and the count stays an estimate.
  await expect(page.getByText(/≈ \d+ pages? at/)).toBeVisible();
  expect(await page.evaluate(() => window.__typstQueryCalls?.length ?? 0)).toBe(0);
  await pageViewAt100(page);
  // On, the book is measured once it has been still, and the "≈" goes.
  await expect(page.getByText(/ · 40 pages at 5\.5 × 8\.5 in/)).toBeVisible({ timeout: 10_000 });
  const calls = await page.evaluate(() => window.__typstQueryCalls ?? []);
  // The book, and the chapter on its own (for its breaks).
  expect(calls).toHaveLength(2);
  expect(calls[0]!.selector).toBe("<page-report>");
  // An edit makes the report stale at once, so the report's count goes until the next measure.
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.insertText(" More words.");
  await expect(page.getByText(/ · 40 pages at/)).toBeHidden();
  await expect(page.getByText(/ · 40 pages at/)).toBeVisible({ timeout: 10_000 });
  expect(await page.evaluate(() => window.__typstQueryCalls?.length ?? 0)).toBe(4);
});

test("the chapter's first page takes the number Typst printed for it", async ({ page }) => {
  await newProject(page);
  await page.locator(".ProseMirror").click();
  await page.keyboard.insertText("A few words.");
  await pageViewAt100(page);
  await expect.poll(() => page.evaluate(() => window.__typstQueryCalls?.length ?? 0)).toBe(2);
  const id = await page.evaluate(
    () =>
      /#chapter-start\("Chapter One", 1, id: "([^"]+)"/.exec(
        window.__typstQueryCalls[0]!.source,
      )![1]!,
  );
  expect(await page.locator(".page .page-number").first().textContent()).toBe("1");
  // The book gains pages before this chapter, so Typst now numbers it from page 5 (a right-hand page).
  await page.evaluate((chapterId) => {
    window.__typstQueryResult = JSON.stringify({
      total: 12,
      starts: [{ id: chapterId, kind: "chapter", page: 9, end: 9, number: "5" }],
    });
  }, id);
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.insertText(" More words.");
  await expect(page.locator(".page .page-number").first()).toHaveText("5", { timeout: 10_000 });
  // The chapter's own length is Typst's too: no "≈" on the total (the cursor's page is still the editor's).
  await expect(page.getByTestId("page-position")).toHaveText(/Page ≈ 1 of 1$/);
});
