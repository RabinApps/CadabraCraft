import { expect, test, type Locator, type Page } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { chapterDoc, newProject, seedChapters } from "./support/helpers";

// Command palette (Cmd/Ctrl+K) and outline navigator (Cmd/Ctrl+Shift+O).

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

const palette = (page: Page) => page.getByRole("dialog", { name: "Command palette" });
const paletteBox = (page: Page) => page.getByRole("combobox", { name: "Command palette" });
const outline = (page: Page) => page.getByRole("dialog", { name: "Outline" });
const outlineBox = (page: Page) => page.getByRole("combobox", { name: "Outline" });

const doc = (...content: object[]) => ({ type: "doc", content }) as unknown as { content: never[] };
/**
 * Opens by key and waits for the box to have focus, so typed text lands in it. A key pressed right after the page changed
 * state (focus mode, a closing dialog) was once swallowed on a slow CI runner, so the key is pressed again while the box is
 * still absent; it is never pressed again once the box exists, which would close it.
 */
const openByKey = async (page: Page, key: string, box: Locator) => {
  await expect(async () => {
    if ((await box.count()) === 0) await page.keyboard.press(key);
    await expect(box).toBeFocused({ timeout: 1500 });
  }).toPass({ timeout: 10_000 });
};
const openPalette = (page: Page) => openByKey(page, "ControlOrMeta+k", paletteBox(page));
const openOutline = (page: Page) => openByKey(page, "ControlOrMeta+Shift+o", outlineBox(page));

const heading = (level: number, text: string) => ({
  type: "heading",
  attrs: { level },
  content: [{ type: "text", text }],
});
const para = (n: number) => ({
  type: "paragraph",
  content: [{ type: "text", text: `Paragraph ${n} of the story, long enough to take a line.` }],
});

/** Two chapters; the first has three headings with enough text between them that the last one starts below the fold. */
async function bookWithHeadings(page: Page) {
  await newProject(page);
  await seedChapters(page, [
    doc(
      heading(1, "Chapter One"),
      ...Array.from({ length: 25 }, (_, i) => para(i)),
      heading(2, "The harbor"),
      ...Array.from({ length: 25 }, (_, i) => para(i + 25)),
      heading(3, "Lantern light"),
      para(99),
    ),
    chapterDoc("Second Part", 2),
  ]);
}

test.describe("command palette", () => {
  test("opens with Ctrl/Cmd+K as a combobox over a listbox, and Escape closes it", async ({
    page,
  }) => {
    await newProject(page);
    await page.keyboard.press("ControlOrMeta+k");
    await expect(palette(page)).toBeVisible();
    const box = paletteBox(page);
    await expect(box).toBeFocused();
    await expect(box).toHaveAttribute("aria-expanded", "true");
    await expect(box).toHaveAttribute("aria-autocomplete", "list");
    const list = page.getByRole("listbox", { name: "Command palette" });
    await expect(box).toHaveAttribute("aria-controls", (await list.getAttribute("id"))!);
    // The first row is the highlighted one, and the input points at it.
    const first = list.getByRole("option").first();
    await expect(first).toHaveAttribute("aria-selected", "true");
    await expect(box).toHaveAttribute("aria-activedescendant", (await first.getAttribute("id"))!);
    expect(await list.getByRole("option").count()).toBeGreaterThan(30);
    await page.keyboard.press("Escape");
    await expect(palette(page)).toHaveCount(0);
  });

  test("the same key closes it again, and a header button opens it", async ({ page }) => {
    await newProject(page);
    await page.keyboard.press("ControlOrMeta+k");
    await expect(palette(page)).toBeVisible();
    // A second press within a few ms is taken for the same key arriving twice (menu and page) and ignored.
    await page.waitForTimeout(150);
    await page.keyboard.press("ControlOrMeta+k");
    await expect(palette(page)).toHaveCount(0);
    await page.getByRole("button", { name: "Command palette" }).click();
    await expect(palette(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(palette(page)).toHaveCount(0);
  });

  test("filters by a few letters, highlights them and says when nothing matches", async ({
    page,
  }) => {
    await newProject(page);
    await openPalette(page);
    await page.keyboard.type("fcs");
    const options = palette(page).getByRole("option");
    await expect(options.first()).toContainText("Focus Mode");
    await expect(options.first().locator("mark")).toHaveText(["F", "c", "s"]);
    await expect(palette(page).getByRole("status")).toHaveText(/^\d+ results$/);
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("qqqq");
    await expect(palette(page).getByRole("status")).toHaveText("No command matches “qqqq”.");
    await expect(options).toHaveCount(0);
    // Enter with nothing listed does nothing.
    await page.keyboard.press("Enter");
    await expect(palette(page)).toBeVisible();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("export markdown");
    await expect(options.filter({ hasText: "Markdown…" })).toBeVisible();
  });

  test("shows the menu a command is in, its shortcut, and a tick for what is on", async ({
    page,
  }) => {
    await newProject(page);
    await openPalette(page);
    await page.keyboard.type("focus mode");
    const focus = palette(page).getByRole("option", { name: /Focus Mode/ });
    await expect(focus).toContainText("View");
    // The keycaps are announced as words ("Control Shift F"), as in Settings > Shortcuts.
    await expect(focus).toHaveAccessibleName(/Focus Mode.*(Control Shift|Shift Command) F$/);
    await expect(focus).toHaveAttribute("aria-checked", "false");
    await page.keyboard.press("Enter");
    await expect(palette(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Exit focus mode" })).toBeVisible();
    await openPalette(page);
    await page.keyboard.type("focus mode");
    await expect(palette(page).getByRole("option", { name: /Focus Mode/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("arrow keys move the highlight and wrap, Enter runs the highlighted command", async ({
    page,
  }) => {
    await newProject(page);
    await openPalette(page);
    await page.keyboard.type("heading");
    const options = palette(page).getByRole("option");
    await expect(options).toHaveCount(3);
    const selected = () =>
      options.evaluateAll((els) => els.findIndex((e) => e.ariaSelected === "true"));
    expect(await selected()).toBe(0);
    await page.keyboard.press("ArrowDown");
    expect(await selected()).toBe(1);
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    expect(await selected()).toBe(2);
    await page.keyboard.press("ArrowDown");
    expect(await selected()).toBe(0);
    // The input keeps focus the whole time.
    await expect(paletteBox(page)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(palette(page)).toHaveCount(0);
    await expect(page.locator(".ProseMirror h2")).toHaveText("Chapter One");
  });

  test("shows commands that cannot run as disabled, and choosing one does nothing", async ({
    page,
  }) => {
    await newProject(page);
    await openPalette(page);
    await page.keyboard.type("undo chapter");
    const undo = palette(page).getByRole("option", { name: /Undo Chapter Change/ });
    await expect(undo).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Enter");
    await expect(palette(page)).toBeVisible();
    await undo.click({ force: true });
    await expect(palette(page)).toBeVisible();
    // A command that exists in the menu but not on this screen: Read mode has no Focus Mode.
    await page.keyboard.press("Escape");
    await page.getByRole("radio", { name: "Read" }).click();
    await openPalette(page);
    await page.keyboard.type("focus mode");
    await expect(palette(page).getByRole("option", { name: /Focus Mode/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  test("clicking a command runs it", async ({ page }) => {
    await newProject(page);
    await openPalette(page);
    await page.keyboard.type("book details");
    await palette(page)
      .getByRole("option", { name: /Book Details/ })
      .click();
    await expect(page.getByRole("dialog", { name: "Book details" })).toBeVisible();
    await expect(palette(page)).toHaveCount(0);
  });

  test("works with no book open: the start commands run, the book commands are greyed", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "New project" })).toBeVisible();
    await page.keyboard.press("ControlOrMeta+k");
    await expect(palette(page)).toBeVisible();
    await page.keyboard.type("save");
    await expect(palette(page).getByRole("option", { name: /^Save/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("new proj");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "New book" })).toBeVisible();
  });

  test("lists recent projects and opens the one chosen", async ({ page }) => {
    await newProject(page);
    await page.reload();
    await expect(page.getByRole("region", { name: "Recent projects" })).toBeVisible();
    await openPalette(page);
    await page.keyboard.type("e2e book");
    const recent = palette(page).getByRole("option", { name: /E2E Book/ });
    await expect(recent).toContainText("File · Open Recent");
    await page.keyboard.press("Enter");
    await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter One");
  });

  test("stays out of the way of another dialog", async ({ page }) => {
    await newProject(page);
    await page.getByRole("button", { name: "Book details" }).first().click();
    await expect(page.getByRole("dialog", { name: "Book details" })).toBeVisible();
    await page.keyboard.press("ControlOrMeta+k");
    await expect(palette(page)).toHaveCount(0);
    await page.keyboard.press("ControlOrMeta+Shift+o");
    await expect(outline(page)).toHaveCount(0);
  });

  test("is listed in Settings > Shortcuts", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Settings" }).click();
    await page
      .getByRole("navigation", { name: "Settings sections" })
      .getByRole("button", { name: "Shortcuts" })
      .click();
    const section = page.locator("#shortcuts");
    const row = section.getByRole("listitem").filter({ hasText: "Command Palette" });
    await expect(row.getByRole("img", { name: /^(Control|Command) K$/ })).toBeVisible();
    const outlineRow = section.getByRole("listitem").filter({ hasText: "Outline" });
    await expect(
      outlineRow.getByRole("img", { name: /^(Control Shift|Shift Command) O$/ }),
    ).toBeVisible();
    // The palette also works from Settings.
    await page.keyboard.press("ControlOrMeta+k");
    await expect(palette(page)).toBeVisible();
  });
});

test.describe("outline navigator", () => {
  test("lists the headings of the chapter and the chapters, and marks the open one", async ({
    page,
  }) => {
    await bookWithHeadings(page);
    await page.keyboard.press("ControlOrMeta+Shift+o");
    await expect(outline(page)).toBeVisible();
    await expect(outlineBox(page)).toBeFocused();
    const list = page.getByRole("listbox", { name: "Outline" });
    await expect(list.getByRole("group", { name: "In this chapter" })).toBeVisible();
    await expect(list.getByRole("group", { name: "Chapters" })).toBeVisible();
    const headings = list.getByRole("group", { name: "In this chapter" }).getByRole("option");
    await expect(headings).toHaveText(["Chapter One", "The harbor", "Lantern light"]);
    await expect(headings.nth(1)).toHaveAttribute("aria-level", "2");
    await expect(headings.nth(2)).toHaveAttribute("aria-level", "3");
    const pages = list.getByRole("group", { name: "Chapters" }).getByRole("option");
    await expect(pages).toHaveText(["Chapter OneCurrent", "Second Part"]);
    await expect(pages.first()).toHaveAttribute("aria-current", "true");
    await page.keyboard.press("Escape");
    await expect(outline(page)).toHaveCount(0);
  });

  test("choosing a heading puts the caret there and scrolls it into view", async ({ page }) => {
    await bookWithHeadings(page);
    const target = page.locator(".ProseMirror h3");
    await expect(target).not.toBeInViewport();
    await openOutline(page);
    await page.keyboard.type("lantern");
    await page.keyboard.press("ArrowDown");
    // Filtering put the heading first and the same-named page below it; the heading is row 0.
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("Enter");
    await expect(outline(page)).toHaveCount(0);
    await expect(target).toBeInViewport();
    await expect
      .poll(() =>
        page.evaluate(() => getSelection()?.anchorNode?.parentElement?.closest("h3")?.textContent),
      )
      .toBe("Lantern light");
    // Typing continues in that heading.
    await page.keyboard.type("!");
    await expect(target).toHaveText("!Lantern light");
  });

  test("choosing a chapter opens it", async ({ page }) => {
    await bookWithHeadings(page);
    await openOutline(page);
    await page.keyboard.type("second");
    const rows = outline(page).getByRole("option");
    await expect(rows).toHaveCount(1);
    await expect(rows.first().locator("mark")).toHaveText(["Second"]);
    await rows.first().click();
    await expect(page.locator(".ProseMirror h1")).toHaveText("Second Part");
    // The outline now shows that chapter's headings, with it as the open one.
    await page.keyboard.press("ControlOrMeta+Shift+o");
    const headings = outline(page)
      .getByRole("group", { name: "In this chapter" })
      .getByRole("option");
    await expect(headings).toHaveText(["Second Part"]);
    await expect(
      outline(page)
        .getByRole("option", { name: /Second Part/ })
        .last(),
    ).toHaveAttribute("aria-current", "true");
  });

  test("says when nothing matches, and a header button opens it", async ({ page }) => {
    await bookWithHeadings(page);
    await page.getByRole("button", { name: "Outline" }).click();
    await page.keyboard.type("zzzz");
    await expect(outline(page).getByRole("status")).toHaveText(
      "No heading or chapter matches “zzzz”.",
    );
    await expect(outline(page).getByRole("option")).toHaveCount(0);
  });

  test("a chapter without headings lists only the chapters", async ({ page }) => {
    await newProject(page);
    await page.locator(".ProseMirror").click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("No heading here.");
    await page.keyboard.press("ControlOrMeta+Alt+0");
    await expect(page.locator(".ProseMirror h1")).toHaveCount(0);
    await page.keyboard.press("ControlOrMeta+Shift+o");
    await expect(outline(page).getByRole("group", { name: "In this chapter" })).toHaveCount(0);
    await expect(outline(page).getByRole("group", { name: "Chapters" })).toBeVisible();
  });

  test("is not offered in Read mode, in the palette or by the key", async ({ page }) => {
    await bookWithHeadings(page);
    await page.getByRole("radio", { name: "Read" }).click();
    await expect(page.getByRole("button", { name: "Outline" })).toHaveCount(0);
    await page.keyboard.press("ControlOrMeta+Shift+o");
    await expect(outline(page)).toHaveCount(0);
    await openPalette(page);
    await page.keyboard.type("outline");
    await expect(palette(page).getByRole("option", { name: /Outline/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  test("the palette opens it", async ({ page }) => {
    await bookWithHeadings(page);
    await openPalette(page);
    await page.keyboard.type("outline");
    await page.keyboard.press("Enter");
    await expect(outline(page)).toBeVisible();
  });
});
