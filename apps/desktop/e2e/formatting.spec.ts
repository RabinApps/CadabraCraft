import { expect, test, type Page } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { newProject, exportBook } from "./support/helpers";

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

test.describe("formatting toolbar", () => {
  const ed = (page: Page) => page.locator(".ProseMirror");
  const tb = (page: Page, name: string) =>
    page.getByRole("toolbar", { name: "Formatting" }).getByRole("button", { name, exact: true });
  async function typeLine(page: Page, text: string) {
    // The new chapter ends with an empty paragraph; click it rather than rely on platform-specific End shortcuts.
    await ed(page).locator("p").last().click();
    await page.keyboard.type(text);
  }
  // Triple-click selects the paragraph; Shift+Home is platform-specific in Chromium.
  const selectLine = async (page: Page) => {
    await ed(page).locator("p").last().click({ clickCount: 3 });
  };

  test.beforeEach(async ({ page }) => {
    await newProject(page);
  });

  test("bold, italic, underline and small caps wrap the selection", async ({ page }) => {
    await typeLine(page, "styled");
    for (const [name, sel] of [
      ["Bold", "strong"],
      ["Italic", "em"],
      ["Underline", "u"],
      ["Small caps", "span.small-caps"],
    ] as const) {
      await selectLine(page);
      await tb(page, name).click();
      await expect(tb(page, name)).toHaveAttribute("aria-pressed", "true");
      await expect(ed(page).locator(sel)).toHaveText("styled");
    }
  });

  test("headings, quote and lists change the block type", async ({ page }) => {
    await typeLine(page, "block");
    await tb(page, "Heading 2").click();
    await expect(ed(page).locator("h2")).toHaveText("block");
    await tb(page, "Heading 2").click();
    await tb(page, "Block quote").click();
    await expect(ed(page).locator("blockquote")).toContainText("block");
    await tb(page, "Block quote").click();
    await tb(page, "Bulleted list").click();
    await expect(ed(page).locator("ul li")).toContainText("block");
    await tb(page, "Numbered list").click();
    await expect(ed(page).locator("ol li")).toContainText("block");
  });

  test("scene break and footnote insert, and export contains them", async ({ page }) => {
    await typeLine(page, "text");
    await tb(page, "Scene break").click();
    await expect(ed(page).locator("hr.scene-break")).toHaveCount(1);
    await tb(page, "Footnote").click();
    await expect(ed(page).locator("span.footnote")).toHaveCount(1);
    await exportBook(page, "EPUB 3");
    await expect(page.getByRole("status")).toHaveText("Exported exports/en/book.epub");
    const saved = await page.evaluate(() => window.__disk["manuscript/001-chapter-one.json"]);
    expect(saved).toContain("sceneBreak");
    expect(saved).toContain("footnote");
  });

  test("task lists toggle a checkbox on click and definition lists insert a term and description, and both export", async ({
    page,
  }) => {
    const menu = async (id: string) => {
      await page.waitForFunction(() => Boolean(window.__cadabraMenu));
      return page.evaluate((i) => window.__cadabraMenu.run(i) as boolean, id);
    };
    await typeLine(page, "buy milk");
    expect(await menu("editor.taskList")).toBe(true);
    const item = ed(page).locator('li[data-type="taskItem"]');
    await expect(item).toHaveCount(1);
    await expect(item).toHaveAttribute("data-checked", "false");
    await item.locator("label").click({ force: true });
    await expect(item).toHaveAttribute("data-checked", "true");
    await item.locator("label").click({ force: true });
    await expect(item).toHaveAttribute("data-checked", "false");
    await item.locator("label").click({ force: true });
    await page.keyboard.press("Enter");
    await page.keyboard.type("second");
    await expect(ed(page).locator('li[data-type="taskItem"]')).toHaveCount(2);
    expect(await menu("editor.taskList")).toBe(true); // the caret item leaves the list
    await expect(item).toHaveCount(1); // only the item with the caret leaves the list

    expect(await menu("editor.definitionList")).toBe(true);
    await expect(ed(page).locator("dl dt")).toHaveCount(1);
    await expect(ed(page).locator("dl dd")).toHaveCount(1);
    await page.keyboard.type("Term"); // the caret starts in the term
    await ed(page).locator("dl dd p").click();
    await page.keyboard.type("Meaning");
    await expect(ed(page).locator("dl dt")).toHaveText("Term");
    await expect(ed(page).locator("dl dd")).toHaveText("Meaning");

    await exportBook(page, "EPUB 3");
    await expect(page.getByRole("status")).toHaveText("Exported exports/en/book.epub");
    const saved = await page.evaluate(() => window.__disk["manuscript/001-chapter-one.json"]);
    expect(saved).toContain("definitionList");
  });

  test("tables: Insert > Table and the Format > Table commands edit rows, columns and the header, and export", async ({
    page,
  }) => {
    // The native menu cannot be clicked in a browser; the dev build exposes its command runner (what each menu item calls).
    const menu = async (id: string) => {
      await page.waitForFunction(() => Boolean(window.__cadabraMenu));
      return page.evaluate((i) => window.__cadabraMenu.run(i) as boolean, id);
    };
    const cells = (sel: string) => ed(page).locator(`table ${sel}`);
    expect(await menu("editor.tableAddRow")).toBe(false); // not in a table yet
    expect(await menu("editor.table")).toBe(true);
    const dialog = page.getByRole("dialog", { name: "Insert table" });
    await dialog.getByLabel("Rows").fill("3");
    await dialog.getByLabel("Columns").fill("2");
    await dialog.getByRole("button", { name: "Insert" }).click();
    await expect(cells("tr")).toHaveCount(3);
    await expect(cells("th")).toHaveCount(2);
    await expect(cells("td")).toHaveCount(4);

    await cells("th").first().click();
    await page.keyboard.type("Item");
    await page.keyboard.press("Tab");
    await page.keyboard.type("Cost & note");
    await page.keyboard.press("Tab");
    await page.keyboard.type("Ten");
    expect(await menu("editor.table")).toBe(false); // cells cannot hold tables

    expect(await menu("editor.tableAddRow")).toBe(true);
    await expect(cells("tr")).toHaveCount(4);
    expect(await menu("editor.tableAddColumn")).toBe(true);
    await expect(cells("tr").first().locator("th")).toHaveCount(3);
    expect(await menu("editor.tableDeleteColumn")).toBe(true);
    expect(await menu("editor.tableDeleteRow")).toBe(true);
    await expect(cells("tr")).toHaveCount(3);
    await expect(cells("tr").first().locator("th")).toHaveCount(2);

    await exportBook(page, "EPUB 3");
    await expect(page.getByRole("status")).toHaveText("Exported exports/en/book.epub");
    const saved = await page.evaluate(() => window.__disk["manuscript/001-chapter-one.json"]);
    expect(saved).toContain('"type": "tableHeader"');
    expect(saved).toContain("Cost & note");

    await cells("td").first().click();
    expect(await menu("editor.tableHeaderRow")).toBe(true);
    await expect(cells("th")).toHaveCount(0);
    expect(await menu("editor.tableDelete")).toBe(true);
    await expect(ed(page).locator("table")).toHaveCount(0);
    expect(await menu("editor.tableDelete")).toBe(false);
  });

  test("links accept https and refuse javascript:", async ({ page }) => {
    await typeLine(page, "click me");
    await selectLine(page);
    await tb(page, "Link").click();
    const dialog = page.getByRole("dialog", { name: "Add link" });
    await dialog.getByLabel("Address").fill("javascript:alert(1)");
    await dialog.getByRole("button", { name: "Apply" }).click();
    await expect(dialog.getByRole("alert")).toBeVisible(); // refused, dialog stays open
    await expect(ed(page).locator("a")).toHaveCount(0);
    await dialog.getByLabel("Address").fill("example.com");
    await dialog.getByRole("button", { name: "Apply" }).click();
    await expect(ed(page).locator("a")).toHaveAttribute("href", "https://example.com/");
    await tb(page, "Link").click(); // toggles off
    await expect(ed(page).locator("a")).toHaveCount(0);
  });

  const more = (page: Page) => tb(page, "More formatting");

  test("the More formatting menu holds the rarely used marks and blocks and shows their state", async ({
    page,
  }) => {
    await typeLine(page, "styled");
    await selectLine(page);
    await more(page).click();
    const menu = page.getByRole("menu", { name: "More formatting" });
    for (const [name, sel] of [
      ["Strikethrough", "s"],
      ["Code", "code"],
      ["Superscript", "sup"],
      ["Subscript", "sub"],
    ] as const) {
      await menu.getByRole("menuitemcheckbox", { name, exact: true }).click();
      await expect(ed(page).locator(`p ${sel}`)).toHaveText("styled");
      // The choice returns the focus to the text.
      await expect(ed(page)).toBeFocused();
      await more(page).click();
      await expect(menu.getByRole("menuitemcheckbox", { name, exact: true })).toHaveAttribute(
        "aria-checked",
        "true",
      );
      await menu.getByRole("menuitemcheckbox", { name, exact: true }).click();
      await expect(ed(page).locator(`p ${sel}`)).toHaveCount(0);
      await more(page).click();
    }
    // Strikethrough shows its key.
    await expect(menu.getByRole("menuitemcheckbox", { name: "Strikethrough" })).toHaveAttribute(
      "aria-keyshortcuts",
      /^(Control|Meta)\+Shift\+S$/,
    );
    await menu.getByRole("menuitemcheckbox", { name: "Code Block" }).click();
    await expect(ed(page).locator("pre")).toHaveCount(1);
    await more(page).click();
    await menu.getByRole("menuitemcheckbox", { name: "Code Block" }).click();
    await more(page).click();
    await menu.getByRole("menuitemcheckbox", { name: "Task list" }).click();
    await expect(ed(page).locator("ul[data-type=taskList]")).toHaveCount(1);
  });

  test("the More formatting button is the last stop of the toolbar: arrows reach it, Escape returns to it", async ({
    page,
  }) => {
    await tb(page, "Bold").focus();
    await page.keyboard.press("End");
    await expect(more(page)).toBeFocused();
    await expect(more(page)).toHaveAttribute("tabindex", "0");
    await expect(tb(page, "Bold")).toHaveAttribute("tabindex", "-1");
    await page.keyboard.press("ArrowRight");
    await expect(tb(page, "Undo")).toBeDisabled();
    await expect(tb(page, "Bold")).toBeFocused(); // wraps to the first enabled button
    await page.keyboard.press("ArrowLeft");
    await expect(more(page)).toBeFocused();
    await page.keyboard.press("Enter");
    const menu = page.getByRole("menu", { name: "More formatting" });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitemcheckbox", { name: "Strikethrough" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(more(page)).toBeFocused();
  });

  test("the toolbar stays on one row from 768 px up, and does not scroll sideways at 320 px", async ({
    page,
  }) => {
    const bar = page.getByRole("toolbar", { name: "Formatting" });
    for (const width of [1280, 1024, 768]) {
      await page.setViewportSize({ width, height: 800 });
      const tops = await bar
        .getByRole("button")
        .evaluateAll(
          (bs) => new Set(bs.map((b) => Math.round(b.getBoundingClientRect().top))).size,
        );
      expect(tops, `${width}px`).toBe(1);
    }
    await page.setViewportSize({ width: 320, height: 640 });
    await expect(more(page)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
  });

  test("undo and redo are available from the toolbar", async ({ page }) => {
    await typeLine(page, "oops");
    await tb(page, "Undo").click();
    await expect(ed(page)).not.toContainText("oops");
    await tb(page, "Redo").click();
    await expect(ed(page)).toContainText("oops");
  });
});

test("Tab types a tab character and stays in the editor; Escape then Tab leaves it", async ({
  page,
}) => {
  await newProject(page);
  const ed = page.locator(".ProseMirror");
  await ed.locator("p").last().click();
  await page.keyboard.type("a");
  await page.keyboard.press("Tab");
  await page.keyboard.type("b");
  await expect(ed.locator("p").last()).toHaveText("a\tb");
  await expect(ed).toBeFocused();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Tab");
  await expect(ed).not.toBeFocused();
  expect(await ed.locator("p").last().textContent()).toBe("a\tb");
});

test("Tab in a list indents the item and does not type a tab", async ({ page }) => {
  await newProject(page);
  const ed = page.locator(".ProseMirror");
  await ed.locator("p").last().click();
  await page
    .getByRole("toolbar", { name: "Formatting" })
    .getByRole("button", { name: "Bulleted list", exact: true })
    .click();
  await page.keyboard.type("one");
  await page.keyboard.press("Enter");
  await page.keyboard.type("two");
  await page.keyboard.press("Tab");
  await expect(ed.locator("ul ul")).toHaveCount(1);
  expect(await ed.locator("ul").first().textContent()).not.toContain("\t");
  await expect(ed).toBeFocused();
});
