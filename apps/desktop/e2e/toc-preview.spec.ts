import { expect, test, type Page } from "./support/coverage";
import { audit } from "./support/audit";
import { fakeTauri } from "./support/fakeTauri";
import {
  addPage,
  chapterDoc,
  manifestOf,
  newProject,
  seedChapters,
  sidebar,
} from "./support/helpers";

// The Contents preview: the contents page as printed, beside the list (from xl) or behind an Edit | Preview switch (below it). Typst's
// answers are canned: a `typst_query` page report that puts the contents page on physical pages `first` to `end`, and the fake PDF
// (blank pages). Pixels are not read; what Typst was asked to draw is read from the source of its calls. With Typst missing (or a
// compile error) the HTML approximation is the thing under test, and its lines are read from the DOM.

type Node = { type: string; attrs?: { level: number }; content?: { type: string; text: string }[] };
const heading = (level: number, text: string): Node => ({
  type: "heading",
  attrs: { level },
  content: [{ type: "text", text }],
});
const doc = (...content: Node[]) => ({ type: "doc", content }) as unknown as { content: Node[] };

async function threeChapters(page: Page) {
  await newProject(page);
  await seedChapters(page, [
    doc(heading(1, "Arrival"), heading(2, "The harbour"), heading(2, "The inn")),
    doc(heading(1, "Storm"), heading(2, "The harbour")),
    chapterDoc("Calm", 1),
  ]);
}

const contents = (page: Page) => page.getByRole("region", { name: "Contents", exact: true });
const preview = (page: Page) => page.getByRole("region", { name: "Preview", exact: true });
const lines = (page: Page) => preview(page).locator("[data-preview-line]");
const lineTitles = async (page: Page) =>
  (await lines(page).locator("span.min-w-0").allTextContents()).map((s) => s.trim());
const numbers = async (page: Page) =>
  (await lines(page).evaluateAll((els) =>
    els.map((el) => el.querySelector("[data-number]")?.textContent ?? null),
  )) as (string | null)[];
const status = (page: Page) => page.getByTestId("toc-preview-status");
const cards = (page: Page) => preview(page).getByTestId("toc-preview-page");
const canvases = (page: Page) => preview(page).locator("canvas");
const view = (page: Page) => contents(page).getByRole("radiogroup", { name: "Contents view" });
const list = (page: Page) => contents(page).getByRole("list", { name: "Contents entries" });
const depth = (page: Page, label: string) =>
  contents(page).getByRole("radio", { name: label, exact: true }).click();
const menuOf = (page: Page, title: string) =>
  contents(page)
    .getByRole("button", { name: `Actions for ${title}`, exact: true })
    .first();
const compiled = (page: Page) =>
  page.evaluate(() => (window.__typstCalls ?? []).map((c) => c.source));
const lastCompiled = async (page: Page) => (await compiled(page)).at(-1) ?? "";

/** Typst's page report: the contents page is on physical pages `first` to `end` of `total`. Set before the Contents page is added. */
async function typstReport(page: Page, first = 2, end = 3) {
  await page.evaluate(
    ([f, e]) => {
      window.__typstPages = 6;
      window.__typstQueryResultFor = (source: string) => {
        const id = /#contents-page\("([^"]+)"/.exec(source)?.[1];
        return id
          ? JSON.stringify({
              total: 6,
              starts: [{ id, kind: "contents", page: f, end: e, number: "ii" }],
            })
          : undefined;
      };
    },
    [first, end] as const,
  );
}

const typstMissing = (page: Page) =>
  page.evaluate(() => {
    window.__typstError = { kind: "not_found", message: "The typst program was not found." };
  });

async function openContents(page: Page) {
  await addPage(page, "Contents");
  await expect(contents(page)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

test("from xl the list and the preview sit side by side, the editor on the start side", async ({
  page,
}) => {
  await threeChapters(page);
  await typstReport(page);
  await openContents(page);
  await expect(preview(page)).toBeVisible();
  await expect(preview(page).getByRole("heading", { name: "Preview" })).toBeVisible();
  await expect(list(page)).toBeVisible();
  // No switch at this width.
  await expect(view(page)).toBeHidden();
  const [l, p] = await Promise.all([list(page).boundingBox(), preview(page).boundingBox()]);
  expect(l && p && l.x + l.width <= p.x + 1).toBe(true);
  // Typst drew pages 2 and 3, the contents page's own.
  await expect(status(page)).toHaveText("Exact pages from Typst");
  await expect(canvases(page)).toHaveCount(2);
  await expect(preview(page).getByRole("img", { name: "Page 2", exact: true })).toBeVisible();
  await expect(page.getByTestId("toc-preview-fallback")).toHaveCount(0);
  await expect(page.getByTestId("toc-preview-skeleton")).toHaveCount(0);
});

test("the preview stays in view and scrolls on its own while the list scrolls", async ({
  page,
}) => {
  await newProject(page);
  await seedChapters(page, [
    doc(...Array.from({ length: 40 }, (_, i) => heading(1, `Heading ${i + 1}`))),
  ]);
  await typstReport(page);
  await openContents(page);
  await depth(page, "+H1");
  const before = await preview(page).boundingBox();
  await list(page).evaluate((el) => {
    for (let n: Element | null = el; n; n = n.parentElement)
      if (n.scrollHeight > n.clientHeight && getComputedStyle(n).overflowY === "auto")
        return void (n.scrollTop = 600);
  });
  const after = await preview(page).boundingBox();
  expect(after?.y).toBe(before?.y);
  const scroll = page.getByTestId("toc-preview-scroll");
  expect(await scroll.evaluate((el) => getComputedStyle(el).overflowY)).toBe("auto");
});

test("Typst path: what is drawn follows rename, hide, reorder, depth and the page-number switch", async ({
  page,
}) => {
  await threeChapters(page);
  await typstReport(page);
  await openContents(page);
  await expect(status(page)).toHaveText("Exact pages from Typst");
  // The real contents page is the book's own Typst run: the resolved list is what it was given.
  const source = await lastCompiled(page);
  expect(source).toContain('title: "Arrival"');
  expect(source).toContain("#let toc-numbers = true");
  const rename = async (from: string, to: string) => {
    await contents(page).getByText(from, { exact: true }).first().dblclick();
    await page.getByLabel("Entry title").fill(to);
    await page.keyboard.press("Enter");
  };
  await rename("Storm", "The Great Storm");
  await expect.poll(() => lastCompiled(page), { timeout: 15_000 }).toContain("The Great Storm");
  await menuOf(page, "Calm").click();
  await page.getByRole("menuitem", { name: "Hide from contents" }).click();
  await expect
    .poll(async () => (await lastCompiled(page)).includes('title: "Calm"'), { timeout: 15_000 })
    .toBe(false);
  await menuOf(page, "The Great Storm").click();
  await page.getByRole("menuitem", { name: "Move up" }).click();
  await expect
    .poll(
      async () => {
        const s = await lastCompiled(page);
        return s.indexOf('title: "The Great Storm"') < s.indexOf('title: "Arrival"');
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  await depth(page, "+H1-H2");
  await expect.poll(() => lastCompiled(page), { timeout: 15_000 }).toContain('title: "The inn"');
  await contents(page).getByRole("switch", { name: "Page numbers" }).click();
  await expect
    .poll(() => lastCompiled(page), { timeout: 15_000 })
    .toContain("#let toc-numbers = false");
  await expect(status(page)).toHaveText("Exact pages from Typst");
  expect(await manifestOf(page)).toBeTruthy();
});

test("the preview is Typst's own pages: only the contents pages are drawn, as many as the report says", async ({
  page,
}) => {
  await threeChapters(page);
  await typstReport(page, 3, 5);
  await openContents(page);
  await expect(canvases(page)).toHaveCount(3);
  await expect(preview(page).getByRole("img", { name: "Page 3", exact: true })).toBeVisible();
  await expect(preview(page).getByRole("img", { name: "Page 5", exact: true })).toBeVisible();
  await expect(preview(page).getByRole("img", { name: "Page 1", exact: true })).toHaveCount(0);
  // 24 px between the cards.
  const [a, b] = await Promise.all([
    preview(page).getByRole("img", { name: "Page 3", exact: true }).boundingBox(),
    preview(page).getByRole("img", { name: "Page 4", exact: true }).boundingBox(),
  ]);
  expect(a && b && Math.round(b.y - (a.y + a.height))).toBe(24);
});

test.describe("Typst is not installed", () => {
  test("the approximation lists the visible entries from the same list, with ≈ numbers and a notice", async ({
    page,
  }) => {
    await threeChapters(page);
    await typstMissing(page);
    await openContents(page);
    await expect(status(page)).toHaveText("Approximate: Typst is not available");
    await expect(page.getByTestId("toc-preview-fallback")).toContainText("Typst is not installed");
    await expect(page.getByTestId("toc-preview-fallback")).toBeVisible();
    await expect.poll(() => lineTitles(page)).toEqual(["Arrival", "Storm", "Calm"]);
    expect((await numbers(page)).every((n) => /^≈\d+$/.test(n ?? ""))).toBe(true);
    // The heading of the page, and one card.
    await expect(preview(page).getByText("Contents", { exact: true })).toBeVisible();
    await expect(cards(page)).toHaveCount(1);
    // Chapter entries are bold; the dot leaders are decoration.
    const weights = await lines(page).evaluateAll((els) =>
      els.map((el) => getComputedStyle(el).fontWeight),
    );
    expect(weights.every((w) => Number(w) >= 700)).toBe(true);
    await expect(preview(page).locator("[data-leader]").first()).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    // The card is the book's trim size (5.5 x 8.5 in).
    const box = (await cards(page).first().boundingBox())!;
    expect(box.height / box.width).toBeCloseTo(8.5 / 5.5, 1);
    // Nothing was typeset.
    expect(await compiled(page)).toEqual([]);
  });

  test("it follows rename, hide, reorder, depth and the page-number switch", async ({ page }) => {
    await threeChapters(page);
    await typstMissing(page);
    await openContents(page);
    await expect.poll(() => lineTitles(page)).toEqual(["Arrival", "Storm", "Calm"]);
    await contents(page).getByText("Storm", { exact: true }).first().dblclick();
    await page.getByLabel("Entry title").fill("The Great Storm");
    await page.keyboard.press("Enter");
    await expect.poll(() => lineTitles(page)).toEqual(["Arrival", "The Great Storm", "Calm"]);
    await menuOf(page, "Calm").click();
    await page.getByRole("menuitem", { name: "Hide from contents" }).click();
    await expect.poll(() => lineTitles(page)).toEqual(["Arrival", "The Great Storm"]);
    await menuOf(page, "The Great Storm").click();
    await page.getByRole("menuitem", { name: "Move up" }).click();
    await expect.poll(() => lineTitles(page)).toEqual(["The Great Storm", "Arrival"]);
    await depth(page, "+H1-H2");
    await expect
      .poll(() => lineTitles(page))
      .toEqual([
        "The Great Storm",
        "Storm",
        "The harbour",
        "Arrival",
        "Arrival",
        "The harbour",
        "The inn",
        "Calm",
      ]);
    // 16 px of indent per heading level.
    const indents = await lines(page).evaluateAll((els) =>
      els.map((el) => parseFloat(getComputedStyle(el).paddingInlineStart)),
    );
    expect(indents.map((n) => Math.round(n))).toEqual([0, 16, 32, 0, 16, 32, 32, 16]);
    const weights = await lines(page).evaluateAll((els) =>
      els.map((el) => Number(getComputedStyle(el).fontWeight)),
    );
    expect(weights.map((w) => w >= 700)).toEqual([
      true,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
    ]);
    // Page numbers off: no leaders and no numbers.
    await contents(page).getByRole("switch", { name: "Page numbers" }).click();
    await expect(preview(page).locator("[data-number]")).toHaveCount(0);
    await expect(preview(page).locator("[data-leader]")).toHaveCount(0);
    await contents(page).getByRole("switch", { name: "Page numbers" }).click();
    await expect(preview(page).locator("[data-number]")).toHaveCount(8);
    // A custom entry is listed too.
    await contents(page).getByRole("button", { name: "Add custom entry" }).click();
    const dialog = page.getByRole("dialog", { name: "Add custom entry" });
    await dialog.getByLabel("Entry title").fill("Interlude");
    await dialog.getByRole("button", { name: "Add entry" }).click();
    await expect.poll(() => lineTitles(page)).toContain("Interlude");
  });

  test("a long list continues on further cards with a roman folio at the foot", async ({
    page,
  }) => {
    await newProject(page);
    await seedChapters(page, [
      doc(...Array.from({ length: 70 }, (_, i) => heading(1, `Part ${i + 1}`))),
    ]);
    await typstMissing(page);
    await openContents(page);
    await depth(page, "+H1");
    await expect.poll(() => cards(page).count()).toBeGreaterThanOrEqual(2);
    const count = await cards(page).count();
    expect(await cards(page).first().locator("[data-folio]").count()).toBe(0);
    await expect(cards(page).nth(1).locator("[data-folio]")).toHaveText("ii");
    // The heading is on the first card only, and every entry is on exactly one card.
    await expect(preview(page).getByText("Contents", { exact: true })).toHaveCount(1);
    await expect(lines(page)).toHaveCount(71);
    if (count > 2) await expect(cards(page).nth(2).locator("[data-folio]")).toHaveText("iii");
    // Cards are stacked with 24 px between them.
    const [a, b] = await Promise.all([
      cards(page).nth(0).boundingBox(),
      cards(page).nth(1).boundingBox(),
    ]);
    expect(a && b && Math.round(b.y - (a.y + a.height))).toBe(24);
  });
});

test("a compile error shows a notice with Retry, and Retry draws the page", async ({ page }) => {
  await threeChapters(page);
  await typstReport(page);
  await page.evaluate(() => {
    window.__compileError = { kind: "compile", message: "main.typ:4:2: error: boom" };
  });
  await openContents(page);
  const alert = preview(page).getByRole("alert");
  await expect(alert).toContainText("Could not draw the preview");
  await expect(status(page)).toHaveText("Could not draw the preview");
  await page.evaluate(() => {
    window.__compileError = undefined;
  });
  await alert.getByRole("button", { name: "Retry" }).click();
  await expect(status(page)).toHaveText("Exact pages from Typst");
  await expect(alert).toHaveCount(0);
  await expect(canvases(page)).toHaveCount(2);
});

test("loading: skeleton lines and a spinner until the first page is drawn, then the old page stays while a new one is made", async ({
  page,
}) => {
  await threeChapters(page);
  await typstReport(page);
  // Typst answers when the test says so (a source with HOLD in it waits).
  await page.evaluate(() => {
    const w = window as unknown as {
      __TAURI_INTERNALS__: { invoke: (cmd: string, ...rest: unknown[]) => Promise<unknown> };
      __hold: Promise<void> | null;
      __releaseHold: () => void;
    };
    const original = w.__TAURI_INTERNALS__.invoke;
    w.__hold = new Promise<void>((resolve) => (w.__releaseHold = resolve));
    w.__TAURI_INTERNALS__.invoke = async (cmd, ...rest) => {
      if (cmd === "typst_query" || cmd === "typst_compile") await w.__hold;
      return original(cmd, ...rest);
    };
  });
  await openContents(page);
  await expect(page.getByTestId("toc-preview-skeleton")).toBeVisible();
  await expect(page.getByTestId("toc-preview-spinner")).toBeVisible();
  await expect(status(page)).toHaveText("Making the preview…");
  await page.evaluate(() => (window as unknown as { __releaseHold: () => void }).__releaseHold());
  await expect(status(page)).toHaveText("Exact pages from Typst");
  await expect(page.getByTestId("toc-preview-skeleton")).toHaveCount(0);
  await expect(page.getByTestId("toc-preview-spinner")).toHaveCount(0);
  await expect(canvases(page)).toHaveCount(2);
});

test("an answer that arrives after a newer one never replaces it", async ({ page }) => {
  await threeChapters(page);
  // The report gives the contents page one page for the title "BBB" and three for "AAA".
  await page.evaluate(() => {
    const w = window as unknown as {
      __TAURI_INTERNALS__: { invoke: (cmd: string, ...rest: unknown[]) => Promise<unknown> };
      __hold: Promise<void>;
      __releaseHold: () => void;
    };
    window.__typstPages = 6;
    window.__typstQueryResultFor = (source: string) => {
      const id = /#contents-page\("([^"]+)"/.exec(source)?.[1];
      if (!id) return undefined;
      const end = source.includes('title: "AAA"') ? 4 : 2;
      return JSON.stringify({
        total: 6,
        starts: [{ id, kind: "contents", page: 2, end, number: "ii" }],
      });
    };
    const original = w.__TAURI_INTERNALS__.invoke;
    const held = ((window as unknown as { __held: { n: number } }).__held = { n: 0 });
    w.__hold = new Promise<void>((resolve) => (w.__releaseHold = resolve));
    w.__TAURI_INTERNALS__.invoke = async (cmd, ...rest) => {
      if (cmd === "typst_compile") {
        const body = rest[0] as Uint8Array | undefined;
        const size = body ? new DataView(body.buffer, body.byteOffset).getUint32(0, true) : 0;
        const text = body ? new TextDecoder().decode(body.subarray(4, 4 + size)) : "";
        if (text.includes('title: \\"AAA\\"')) {
          held.n += 1;
          await w.__hold;
        }
      }
      return original(cmd, ...rest);
    };
  });
  await openContents(page);
  await expect(canvases(page)).toHaveCount(1);
  const rename = async (to: string) => {
    await contents(page).getByText("Arrival", { exact: true }).first().dblclick();
    await page.getByLabel("Entry title").fill(to);
    await page.keyboard.press("Enter");
  };
  // First edit: its run starts (and waits). Second edit while it waits: a newer run that is not held.
  await rename("AAA");
  // Its run is in flight when its typeset is held.
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __held: { n: number } }).__held.n), {
      timeout: 15_000,
    })
    .toBe(1);
  await contents(page).getByText("AAA", { exact: true }).first().dblclick();
  await page.getByLabel("Entry title").fill("BBB");
  await page.keyboard.press("Enter");
  await expect
    .poll(async () => (await compiled(page)).some((s) => s.includes('title: "BBB"')), {
      timeout: 15_000,
    })
    .toBe(true);
  await expect(canvases(page)).toHaveCount(1);
  // Now the old answer arrives (three pages): it is dropped.
  await page.evaluate(() => (window as unknown as { __releaseHold: () => void }).__releaseHold());
  await expect
    .poll(async () => (await compiled(page)).some((s) => s.includes('title: "AAA"')), {
      timeout: 15_000,
    })
    .toBe(true);
  await page.waitForTimeout(500);
  await expect(canvases(page)).toHaveCount(1);
  await expect(status(page)).toHaveText("Exact pages from Typst");
});

test.describe("below xl", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 800 });
  });

  test("a Segmented Edit | Preview shows one pane at a time, and the choice is remembered", async ({
    page,
  }) => {
    await threeChapters(page);
    await typstReport(page);
    await openContents(page);
    await expect(view(page)).toBeVisible();
    await expect(view(page).getByRole("radio", { name: "Edit" })).toBeChecked();
    await expect(list(page)).toBeVisible();
    await expect(preview(page)).toHaveCount(0);
    // The switch sits under the title.
    const [title, switcher] = await Promise.all([
      contents(page).getByRole("heading", { name: "Contents", level: 2 }).boundingBox(),
      view(page).boundingBox(),
    ]);
    expect(title && switcher && switcher.y > title.y).toBe(true);
    await view(page).getByRole("radio", { name: "Preview" }).click();
    await expect(preview(page)).toBeVisible();
    await expect(list(page)).toHaveCount(0);
    await expect(view(page).getByRole("radio", { name: "Preview" })).toBeChecked();
    await expect(contents(page).getByRole("heading", { name: "Contents", level: 2 })).toBeVisible();
    await expect(canvases(page)).toHaveCount(2);
    // Leave the page and come back: still on the preview.
    await sidebar(page).getByRole("button", { name: "Arrival", exact: true }).click();
    await sidebar(page).getByRole("button", { name: "Contents", exact: true }).click();
    await expect(preview(page)).toBeVisible();
    await view(page).getByRole("radio", { name: "Edit" }).click();
    await expect(list(page)).toBeVisible();
    await expect(preview(page)).toHaveCount(0);
  });

  test("the switch works from the keyboard", async ({ page }) => {
    await threeChapters(page);
    await typstReport(page);
    await openContents(page);
    await view(page).getByRole("radio", { name: "Edit" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(view(page).getByRole("radio", { name: "Preview" })).toBeFocused();
    await page.keyboard.press("Space");
    await expect(preview(page)).toBeVisible();
    await expect(list(page)).toHaveCount(0);
  });

  test("nothing is typeset while the preview is hidden, and it is drawn when shown", async ({
    page,
  }) => {
    await threeChapters(page);
    await typstReport(page);
    await openContents(page);
    await page.waitForTimeout(3000);
    expect(await compiled(page)).toEqual([]);
    // Edits while hidden make no preview either.
    await contents(page).getByText("Storm", { exact: true }).first().dblclick();
    await page.getByLabel("Entry title").fill("Squall");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(3000);
    expect(await compiled(page)).toEqual([]);
    await view(page).getByRole("radio", { name: "Preview" }).click();
    await expect.poll(() => lastCompiled(page)).toContain('title: "Squall"');
    await expect(status(page)).toHaveText("Exact pages from Typst");
    // Hidden again: no new run for an edit; showing it again draws what changed.
    await view(page).getByRole("radio", { name: "Edit" }).click();
    const runs = (await compiled(page)).length;
    await contents(page).getByText("Squall", { exact: true }).first().dblclick();
    await page.getByLabel("Entry title").fill("Gale");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(3000);
    expect((await compiled(page)).length).toBe(runs);
    await view(page).getByRole("radio", { name: "Preview" }).click();
    await expect.poll(() => lastCompiled(page)).toContain('title: "Gale"');
  });

  test("the pages are scaled to the pane on a phone and nothing overflows", async ({ page }) => {
    await threeChapters(page);
    await typstMissing(page);
    await openContents(page);
    await view(page).getByRole("radio", { name: "Preview" }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => lineTitles(page)).toEqual(["Arrival", "Storm", "Calm"]);
    const [pane, card] = await Promise.all([
      page.getByTestId("toc-preview-scroll").boundingBox(),
      cards(page).first().boundingBox(),
    ]);
    expect(pane && card && card.width <= pane.width).toBe(true);
    expect(pane && card && card.x >= pane.x).toBe(true);
    expect(await audit(page)).toEqual([]);
    // The list side too.
    await view(page).getByRole("radio", { name: "Edit" }).click();
    await expect(list(page)).toBeVisible();
    expect(await audit(page)).toEqual([]);
  });
});

test("accessibility: the preview is a named region, leaders are hidden, the cards are named, nothing is unnamed", async ({
  page,
}) => {
  await threeChapters(page);
  await typstMissing(page);
  await openContents(page);
  await expect.poll(() => lineTitles(page)).toEqual(["Arrival", "Storm", "Calm"]);
  await expect(page.getByRole("region", { name: "Preview" })).toHaveCount(1);
  await expect(cards(page).first()).toHaveAttribute("aria-label", "Page 1 of 1");
  await expect(preview(page).getByRole("list", { name: "Printed entries" })).toBeVisible();
  const leaders = await preview(page)
    .locator("[data-leader]")
    .evaluateAll((els) => els.map((el) => el.getAttribute("aria-hidden")));
  expect(leaders).toEqual(["true", "true", "true"]);
  const unnamed = await preview(page).evaluate((root) =>
    [...root.querySelectorAll("button, [role=img], canvas")]
      .filter(
        (el) => !(el.getAttribute("aria-label") ?? "").trim() && !(el.textContent ?? "").trim(),
      )
      .map((el) => el.outerHTML.slice(0, 80)),
  );
  expect(unnamed).toEqual([]);
  // Colour is not the only difference between a chapter and a heading, and the body text is readable against the card.
  const contrast = await lines(page)
    .first()
    .evaluate((el) => {
      const rgb = (c: string) =>
        c
          .match(/\d+(\.\d+)?/g)!
          .slice(0, 3)
          .map(Number);
      const lum = ([r, g, b]: number[]) => {
        const f = (v: number) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
      };
      let bg = el as HTMLElement | null;
      while (bg && /rgba\(0, 0, 0, 0\)|transparent/.test(getComputedStyle(bg).backgroundColor))
        bg = bg.parentElement;
      const a = lum(rgb(getComputedStyle(el).color));
      const b = lum(rgb(getComputedStyle(bg!).backgroundColor));
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    });
  expect(contrast).toBeGreaterThanOrEqual(4.5);
  expect((await audit(page)).filter((i) => i.kind !== "small" && i.kind !== "truncated")).toEqual(
    [],
  );
});

test("right-to-left: the numbers sit on the start's far side, the pages stay left to right, nothing overflows", async ({
  page,
}) => {
  await threeChapters(page);
  await typstMissing(page);
  await openContents(page);
  await depth(page, "+H1-H2");
  await expect.poll(() => lines(page).count()).toBe(9);
  await page.evaluate(() => {
    document.documentElement.dir = "rtl";
    document.documentElement.lang = "he";
  });
  // The editor is on the right now and the preview on the left.
  const [l, p] = await Promise.all([list(page).boundingBox(), preview(page).boundingBox()]);
  expect(l && p && p.x + p.width <= l.x + 1).toBe(true);
  const first = lines(page).first();
  const [title, number] = await Promise.all([
    first.locator("span.min-w-0").boundingBox(),
    first.locator("[data-number]").boundingBox(),
  ]);
  // The card itself is a physical page and keeps the book's direction (English here), so its text is still left to right.
  expect(title && number && title.x < number.x).toBe(true);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
});

test("a new book previews a one-entry contents page", async ({ page }) => {
  await newProject(page);
  await typstMissing(page);
  await openContents(page);
  await expect(status(page)).toHaveText("Approximate: Typst is not available");
  await expect(cards(page)).toHaveCount(1);
  await expect(lines(page)).toHaveCount(1);
});
