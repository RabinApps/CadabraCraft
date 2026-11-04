import { expect, test, type Page } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { manifestOf, newProject } from "./support/helpers";

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

const ed = (page: Page) => page.locator(".ProseMirror").first();
const bar = (page: Page) => page.getByRole("toolbar", { name: "Formatting" });
const alignButton = (page: Page) => bar(page).getByRole("button", { name: "Text alignment" });
const alignMenu = (page: Page) => page.getByRole("menu", { name: "Text alignment" });
const lastLine = (page: Page) => ed(page).locator("p").last();
const choose = async (page: Page, item: string) => {
  await alignButton(page).click();
  await alignMenu(page).getByRole("menuitemradio", { name: item }).click();
};

async function typeLine(page: Page, text: string) {
  await lastLine(page).click();
  await page.keyboard.type(text);
}
/** Triple click selects the paragraph. */
const selectLastLine = (page: Page) => lastLine(page).click({ clickCount: 3 });
const alignOf = (locator: ReturnType<Page["locator"]>) =>
  locator.evaluate((el) => getComputedStyle(el).textAlign);

/** Runs a command the way the native menu does (native menu clicks cannot be driven from outside). */
const menuCommand = async (page: Page, id: string) => {
  await page.waitForFunction(() => Boolean(window.__cadabraMenu));
  return page.evaluate((i) => window.__cadabraMenu.run(i) as boolean, id);
};

/** The chapter file the open page is saved in, as written to disk. */
const savedText = async (page: Page) => {
  const m = await manifestOf(page);
  const files = m.chapters[0].files as Record<string, string>;
  const file = files[Object.keys(files)[0]!]!;
  return page.evaluate((f) => window.__disk[f] as string, file);
};
interface SavedBlock {
  type: string;
  attrs?: { level?: number; textAlign?: string };
}
const savedBlocks = async (page: Page): Promise<SavedBlock[]> =>
  (JSON.parse(await savedText(page)) as { content: SavedBlock[] }).content;
const savedAlign = async (page: Page) => (await savedBlocks(page)).at(-1)?.attrs?.textAlign;

test.describe("text alignment", () => {
  test("the toolbar aligns start, centre and end, and Template Default puts the paragraph back", async ({
    page,
  }) => {
    await newProject(page);
    await typeLine(page, "A line to align");
    await selectLastLine(page);

    // start and end are the logical sides: a browser may report the keyword or the side it resolves to.
    for (const [item, attr, css] of [
      ["Centre", "center", ["center"]],
      ["Align to End", "end", ["end", "right"]],
      ["Align to Start", "start", ["start", "left"]],
    ] as const) {
      await choose(page, item);
      await expect(lastLine(page)).toHaveAttribute("data-text-align", attr);
      expect(css, item).toContain(await alignOf(lastLine(page)));
    }

    await choose(page, "Template Default");
    await expect(lastLine(page)).not.toHaveAttribute("data-text-align");
  });

  test("headings can be aligned too", async ({ page }) => {
    await newProject(page);
    await ed(page).locator("h1").click();
    await choose(page, "Centre");
    await expect(ed(page).locator("h1")).toHaveAttribute("data-text-align", "center");
    expect(await alignOf(ed(page).locator("h1"))).toBe("center");
  });

  test("the alignment is written to the chapter JSON and survives a reload, and Template Default stores nothing", async ({
    page,
  }) => {
    await newProject(page);
    await typeLine(page, "Saved alignment");
    await selectLastLine(page);
    await choose(page, "Align to End");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status")).toContainText("Saved");
    expect(await savedAlign(page)).toBe("end");

    await page.reload();
    await page.getByRole("button", { name: "Open folder" }).click();
    await expect(lastLine(page)).toHaveAttribute("data-text-align", "end");
    await expect(alignButton(page)).toBeVisible();

    // Back to the template, saved again: the attribute is gone from the file, not stored as null.
    await lastLine(page).click();
    await choose(page, "Template Default");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status")).toContainText("Saved");
    expect(await savedText(page)).not.toContain("textAlign");
  });

  test("the Format menu applies an alignment and the menu is told to tick it", async ({ page }) => {
    await newProject(page);
    await typeLine(page, "From the menu");
    await lastLine(page).click();
    expect(await menuCommand(page, "editor.alignCenter")).toBe(true);
    await expect(lastLine(page)).toHaveAttribute("data-text-align", "center");

    const alignment = await page.evaluate(() => {
      type Item = { kind: string; text?: string; checked?: boolean; items?: Item[] };
      const model = window.__cadabraMenu.model as Item[];
      const format = model.find((e) => e.text === "Format")!;
      return format.items!.find((e) => e.text === "Alignment")!.items!;
    });
    // The submenu has a separator before Template Default; only the command items have a text.
    expect(alignment.filter((i) => i.kind === "command").map((i) => [i.text, i.checked])).toEqual([
      ["Align to Start", false],
      ["Centre", true],
      ["Align to End", false],
      ["Template Default", false],
    ]);
  });

  test("the keyboard shortcuts align the paragraph without the menu", async ({ page }) => {
    await newProject(page);
    await typeLine(page, "From the keys");
    for (const [key, attr] of [
      ["l", "start"],
      ["c", "center"],
      ["r", "end"],
    ] as const) {
      await lastLine(page).click();
      await page.keyboard.press(`ControlOrMeta+Shift+${key}`);
      await expect(lastLine(page)).toHaveAttribute("data-text-align", attr);
    }
    // Mod+E is inline code, so the centre key had to be C (Mod+Shift+E is Print PDF in the menu).
    await selectLastLine(page);
    await page.keyboard.press("ControlOrMeta+Shift+c");
    await expect(lastLine(page)).toHaveAttribute("data-text-align", "center");
  });

  test("Page view and Read mode draw the alignment", async ({ page }) => {
    await newProject(page);
    await typeLine(page, "Centred on the page");
    await selectLastLine(page);
    await choose(page, "Centre");
    // The page surface is the writing surface, and the paginator measures the CSS the author sees.
    await expect(page.locator(".page").first()).toBeVisible();
    await expect(lastLine(page)).toHaveAttribute("data-text-align", "center");
    // The page surface paints the alignment from that attribute; poll because it lands a frame after the swap.
    await expect.poll(() => alignOf(lastLine(page))).toBe("center");

    await page.getByRole("radio", { name: "Read" }).click();
    const section = page.getByTestId("reading-section").first();
    await expect(section).toBeVisible();
    await expect.poll(() => alignOf(section.locator("p").first())).toBe("center");
  });

  test("the toolbar stays on one row with the alignment button, at 1280, 1024 and 768 px", async ({
    page,
  }) => {
    await newProject(page);
    for (const width of [1280, 1024, 768]) {
      await page.setViewportSize({ width, height: 800 });
      await expect(alignButton(page)).toBeVisible();
      const tops = await bar(page)
        .getByRole("button")
        .evaluateAll(
          (bs) => new Set(bs.map((b) => Math.round(b.getBoundingClientRect().top))).size,
        );
      expect(tops, `${width}px`).toBe(1);
    }
  });

  test("the menu is a named radio group with the current choice checked", async ({ page }) => {
    await newProject(page);
    await typeLine(page, "Accessible alignment");
    await lastLine(page).click();

    await expect(alignButton(page)).toHaveAttribute("aria-haspopup", "menu");
    await alignButton(page).click();
    await expect(alignMenu(page).getByRole("group", { name: "Text alignment" })).toBeVisible();
    const items = alignMenu(page).getByRole("menuitemradio");
    await expect(items).toHaveCount(4);
    await expect(
      alignMenu(page).getByRole("menuitemradio", { name: "Template Default" }),
    ).toHaveAttribute("aria-checked", "true");
    await expect(alignMenu(page).getByRole("menuitemradio", { name: "Centre" })).toHaveAttribute(
      "aria-keyshortcuts",
      /Shift\+C/,
    );
    await page.keyboard.press("Escape");
    await expect(alignMenu(page)).toHaveCount(0);
    await expect(alignButton(page)).toBeFocused();
  });

  test("the alignment button is one stop of the toolbar's roving tab stop", async ({ page }) => {
    await newProject(page);
    // The caret must be in the paragraph the choice applies to: a toolbar click keeps the selection, a key move restores it.
    await typeLine(page, "Roving stop");
    await bar(page).getByRole("button", { name: "Numbered list" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(alignButton(page)).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(alignMenu(page)).toBeVisible();
    // A choice runs after the menu closes, so the focus goes back to the text.
    await alignMenu(page).getByRole("menuitemradio", { name: "Centre" }).click();
    await expect(ed(page).locator("p").last()).toHaveAttribute("data-text-align", "center");
  });
});
