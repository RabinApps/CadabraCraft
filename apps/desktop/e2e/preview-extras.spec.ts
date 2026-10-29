import { expect, test, type Page } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { HEBREW_PDF_BASE64, HEBREW_WORDS } from "./support/hebrewPdf";
import { newProject } from "./support/helpers";

// The print preview's zoom to fit, Ctrl+wheel and pinch zoom, and a click on a word of a page opening the editor at that word.

const CHAPTER = "manuscript/001-chapter-one.json";
const word = (i: number) =>
  ["quiet", "garden", "river", "stone", "letter", "morning", "lantern", "orchard", "winter"][
    i % 9
  ]!;
const wordsOf = (n: number, seed: number) =>
  Array.from({ length: n }, (_, i) => word(i * 7 + seed));

async function seed(page: Page) {
  const doc = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Chapter One" }] },
      ...Array.from({ length: 8 }, (_, i) => ({
        type: "paragraph",
        content: [{ type: "text", text: wordsOf(40, i).join(" ") + "." }],
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

async function preview(page: Page) {
  // On a phone the header keeps Export in its More menu.
  const more = page.getByRole("button", { name: "More actions" });
  if (await more.isVisible()) {
    await more.click();
    await page.getByRole("menuitem", { name: "Export" }).click();
  } else await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export book" });
  await dialog.getByRole("radio", { name: "Print PDF" }).click();
  await dialog.getByRole("button", { name: "Print preview" }).click();
  await expect(page.getByRole("img", { name: "Page 1", exact: true })).toBeVisible();
}

const zoomLabel = (page: Page) => page.getByTestId("preview-zoom");
const pageImg = (page: Page, n: number) =>
  page.getByRole("img", { name: `Page ${n}`, exact: true });
const pageWidth = async (page: Page, n = 1) => (await pageImg(page, n).boundingBox())!.width;

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

test("zoom to fit: the pages fill the window's width, follow it when it changes, and the button toggles back to 100%", async ({
  page,
}) => {
  await newProject(page);
  await preview(page);
  const fit = page.getByRole("button", { name: "Fit to window" });
  await expect(fit).toHaveAttribute("aria-pressed", "false");
  await fit.click();
  await expect(fit).toHaveAttribute("aria-pressed", "true");
  const pane = page.getByTestId("spread-scroll");
  const room = async () => (await pane.evaluate((el) => el.clientWidth)) - 48;
  // Page 1 sits alone: it fills the pane inside its padding (up to 400%).
  await expect
    .poll(async () => Math.abs((await pageWidth(page)) - Math.min(await room(), 5.5 * 200)))
    .toBeLessThan(2);
  // A spread of two pages fits both side by side with the gap between them.
  await page.getByRole("button", { name: "Next pages" }).click();
  await expect(pageImg(page, 3)).toBeVisible();
  await expect
    .poll(async () =>
      Math.abs((await pageWidth(page, 2)) + (await pageWidth(page, 3)) + 8 - (await room())),
    )
    .toBeLessThan(3);
  // A narrower window: the pages shrink with it.
  const before = await pageWidth(page, 2);
  await page.setViewportSize({ width: 800, height: 700 });
  await expect.poll(() => pageWidth(page, 2)).toBeLessThan(before);
  // Zoom in or out leaves fit mode at the next step; the button goes back to 100%.
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(fit).toHaveAttribute("aria-pressed", "false");
  await expect(zoomLabel(page)).toHaveText(/^(75|100|125|150|200|300)%$/);
  await fit.click();
  await fit.click();
  await expect(zoomLabel(page)).toHaveText("100%");
});

test("Ctrl and the wheel, and a pinch on the trackpad or the screen, zoom the pages without scrolling the preview", async ({
  page,
}) => {
  await newProject(page);
  await preview(page);
  const pane = page.getByTestId("spread-scroll");
  const box = (await pane.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 100);
  const base = await pageWidth(page);
  // A wheel with Ctrl held zooms in (up) and out (down); one without scrolls as it always does.
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -200);
  await page.keyboard.up("Control");
  await expect.poll(() => pageWidth(page)).toBeGreaterThan(base * 1.5);
  const grown = await pageWidth(page);
  await expect(zoomLabel(page)).not.toHaveText("100%");
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, 300);
  await page.keyboard.up("Control");
  await expect.poll(() => pageWidth(page)).toBeLessThan(grown);
  // The zoom has no stop between the steps: the buttons go to the next one from where it is.
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(zoomLabel(page)).toHaveText(/^(50|75|100|125|150|200|300)%$/);
  // Safari's pinch on a trackpad arrives as gesture events.
  const level = (await zoomLabel(page).textContent())!;
  await pane.evaluate((el) => {
    const send = (type: string, scale?: number) =>
      el.dispatchEvent(
        Object.assign(new Event(type, { bubbles: true, cancelable: true }), { scale }),
      );
    send("gesturestart");
    send("gesturechange", 2);
    send("gestureend");
  });
  await expect(zoomLabel(page)).not.toHaveText(level);
  const afterPinch = await pageWidth(page);
  await pane.evaluate((el) => {
    const send = (type: string, scale: number) =>
      el.dispatchEvent(
        Object.assign(new Event(type, { bubbles: true, cancelable: true }), { scale }),
      );
    send("gesturestart", 1);
    send("gesturechange", 0.5);
  });
  await expect.poll(() => pageWidth(page)).toBeLessThan(afterPinch);
  // Two fingers on a touch screen: moving apart zooms in, together zooms out, one finger does nothing.
  const touch = (type: string, points: [number, number][]) =>
    pane.evaluate(
      (el, [kind, pts]) => {
        const touches = (pts as [number, number][]).map(
          ([x, y], id) => new Touch({ identifier: id, target: el, clientX: x, clientY: y }),
        );
        el.dispatchEvent(
          new TouchEvent(kind as string, { touches, bubbles: true, cancelable: true }),
        );
      },
      [type, points] as const,
    );
  const start = await pageWidth(page);
  await touch("touchstart", [[300, 300]]);
  await touch("touchmove", [[300, 300]]);
  expect(await pageWidth(page)).toBe(start);
  await touch("touchstart", [
    [300, 300],
    [400, 300],
  ]);
  await touch("touchmove", [
    [250, 300],
    [450, 300],
  ]);
  await expect.poll(() => pageWidth(page)).toBeGreaterThan(start * 1.5);
  await touch("touchend", [[300, 300]]);
  const pinched = await pageWidth(page);
  await touch("touchmove", [
    [250, 300],
    [350, 300],
  ]);
  expect(await pageWidth(page)).toBe(pinched);
});

/** Typst's page report for the seeded chapter: page 2 begins inside block 4 (at its word 30). */
const report = (id: string) =>
  JSON.stringify({
    total: 3,
    starts: [{ id, kind: "chapter", page: 1, end: 3, number: "1" }],
    marks: [
      ["s", 0, 0, "h", 1],
      ["s", 0, 1, "p", 1],
      ["s", 0, 2, "p", 1],
      ["s", 0, 3, "p", 1],
      ["s", 0, 4, "p", 1],
      ["w", 31, 2],
      ["s", 0, 5, "p", 2],
    ],
  });

test("a click on a word of a page opens the editor at that word; on the margin or on no word it opens the start of the page", async ({
  page,
}) => {
  await newProject(page);
  await seed(page);
  const id = await page.evaluate(
    () => JSON.parse(window.__disk["cadabra.json"] as string).chapters[0].id as string,
  );
  // Page 2 of the PDF: a running head, then the words of the paragraph from its word 30 on, one to a line.
  const start = 30;
  const onPage = wordsOf(40, 3).slice(start, start + 12);
  await page.evaluate(
    ([lines]) => {
      window.__typstPageText = [[], [...lines!]];
    },
    [["Chapter One", ...onPage]] as const,
  );
  await preview(page);
  await page.evaluate((r) => (window.__typstQueryResult = r), report(id));
  await page.getByRole("button", { name: "Next pages" }).click();
  const box = (await pageImg(page, 2).boundingBox())!;
  // The PDF is 72 pt to the inch and drawn at 50 px to the inch: line k (0 is the head) has its baseline 72 + 16k pt from the top.
  const lineY = (k: number) => ((72 + 16 * k - 4) / 72) * 50;
  const clickLine = (k: number) =>
    page
      .getByRole("button", { name: "Open page 2 in the editor" })
      .click({ position: { x: ((72 + 8) / 72) * 50, y: lineY(k) } });
  const caretWord = () =>
    page.evaluate(() => {
      const s = getSelection()!;
      return s.anchorNode?.textContent?.slice(s.anchorOffset) ?? "";
    });
  expect(box.height).toBeGreaterThan(300);
  // The seventh word on the page (the head is line 0, so line 8).
  await clickLine(8);
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await expect.poll(caretWord).toBe(
    wordsOf(40, 3)
      .slice(start + 7)
      .join(" ") + ".",
  );
  // The same page again, on the running head: the start of the page's text (a head is no word of the chapter).
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export book" });
  await dialog.getByRole("radio", { name: "Print PDF" }).click();
  await dialog.getByRole("button", { name: "Print preview" }).click();
  await page.getByRole("button", { name: "Next pages" }).click();
  await clickLine(0);
  await expect.poll(caretWord).toBe(wordsOf(40, 3).slice(start).join(" ") + ".");
  // A click where the page has no text opens the start of the page too.
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await dialog.getByRole("radio", { name: "Print PDF" }).click();
  await dialog.getByRole("button", { name: "Print preview" }).click();
  await page.getByRole("button", { name: "Next pages" }).click();
  await page
    .getByRole("button", { name: "Open page 2 in the editor" })
    .click({ position: { x: 5, y: 5 } });
  await expect.poll(caretWord).toBe(wordsOf(40, 3).slice(start).join(" ") + ".");
});

// A right-to-left page: a real Typst PDF (Hebrew, embedded fonts) in which pdf.js lists each line's words from its left edge, the reverse
// of how it is read. The click on a word must still find that word of the chapter.
for (const [name, size] of [
  ["desktop", null],
  ["phone", { width: 390, height: 844 }],
] as const) {
  test(`${name}: a click on a word of a Hebrew page opens the editor at that word, counting the line from its right edge`, async ({
    page,
  }) => {
    if (size) await page.setViewportSize(size);
    await newProject(page);
    const doc = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "פרק ראשון" }] },
        { type: "paragraph", content: [{ type: "text", text: HEBREW_WORDS.join(" ") + "." }] },
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
    await expect(page.locator(".ProseMirror h1")).toHaveText("פרק ראשון");
    const id = await page.evaluate(
      () => JSON.parse(window.__disk["cadabra.json"] as string).chapters[0].id as string,
    );
    await page.evaluate((b64) => (window.__typstPdf = b64), HEBREW_PDF_BASE64);
    await preview(page);
    // Page 2 begins with the paragraph (block 1).
    await page.evaluate(
      (r) => (window.__typstQueryResult = r),
      JSON.stringify({
        total: 2,
        starts: [{ id, kind: "chapter", page: 1, end: 2, number: "1" }],
        marks: [
          ["s", 0, 0, "h", 1],
          ["s", 0, 1, "p", 2],
        ],
      }),
    );
    const caretWord = () =>
      page.evaluate(() => {
        const s = getSelection()!;
        return s.anchorNode?.textContent?.slice(s.anchorOffset) ?? "";
      });
    // The page is 396 x 612 pt. The paragraph's first line (baseline 498 pt from the bottom) reads שקט גן נהר אבן מכתב בוקר פנס פרדס חורף
    // ים ..., "ים" being drawn at 127 to 137 pt from the left: the tenth word, though it is the third from the left of its line.
    const clickAt = async (pt: { x: number; y: number }) => {
      await page.getByRole("button", { name: "Next pages" }).click();
      const button = page.getByRole("button", { name: "Open page 2 in the editor" });
      await expect(button).toBeVisible();
      // The page's size is known once pdf.js has opened it, and the real page is 396 x 612 pt (275 px wide at 100%).
      await expect
        .poll(async () => Math.round((await pageImg(page, 2).boundingBox())!.width))
        .toBe(275);
      const box = (await pageImg(page, 2).boundingBox())!;
      await button.click({
        position: { x: (pt.x / 396) * box.width, y: ((612 - pt.y) / 612) * box.height },
      });
    };
    await clickAt({ x: 132, y: 502 });
    await expect(page.locator(".ProseMirror")).toBeVisible();
    await expect.poll(caretWord).toBe(HEBREW_WORDS.slice(9).join(" ") + ".");
    // The first word of the line is at its right edge, the last word of the second line at its left edge.
    await preview(page);
    await clickAt({ x: 312, y: 502 });
    await expect.poll(caretWord).toBe(HEBREW_WORDS.join(" ") + ".");
    await preview(page);
    await clickAt({ x: 90, y: 486 });
    await expect.poll(caretWord).toBe(HEBREW_WORDS.slice(23).join(" ") + ".");
  });
}
