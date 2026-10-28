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

  test("undo and redo are available from the toolbar", async ({ page }) => {
    await typeLine(page, "oops");
    await tb(page, "Undo").click();
    await expect(ed(page)).not.toContainText("oops");
    await tb(page, "Redo").click();
    await expect(ed(page)).toContainText("oops");
  });
});
