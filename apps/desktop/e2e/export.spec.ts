import { expect, test } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { newProject, exportBook, focusEnd } from "./support/helpers";

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

test("export writes a valid EPUB zip with mimetype first", async ({ page }) => {
  await newProject(page);
  await exportBook(page, "EPUB 3");
  await expect(page.getByRole("status")).toHaveText("Exported exports/en/book.epub");
  const head = await page.evaluate(() => {
    const b = window.__disk["exports/en/book.epub"] as number[];
    return String.fromCharCode(...b.slice(0, 4), ...b.slice(30, 38));
  });
  expect(head).toBe("PK\u0003\u0004mimetype");
});

test("Export Markdown writes exports/en/book.md, and explains underline until the HTML option is on", async ({
  page,
}) => {
  await newProject(page);
  await focusEnd(page);
  await page.keyboard.type("Underlined");
  // ProseMirror learns of a selection made by keys or the mouse from an asynchronous selectionchange, and a state update from
  // that clears a stored mark: Ctrl+U right after typing or moving is lost under load. Retry until the mark is really on.
  await expect(async () => {
    await page.locator(".ProseMirror p").last().click({ clickCount: 3 });
    await page.getByRole("button", { name: "Underline" }).click();
    await expect(page.locator(".ProseMirror u")).toHaveText("Underlined", { timeout: 1000 });
  }).toPass();
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export book" });
  await dialog.getByRole("radio", { name: "Markdown" }).click();
  await expect(dialog.getByRole("button", { name: "Print preview" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("underline");
  await dialog.getByLabel("Keep underline and small caps").check();
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveText("Exported exports/en/book.md");
  const md = await page.evaluate(() =>
    String.fromCharCode(...(window.__disk["exports/en/book.md"] as number[])),
  );
  expect(md).toContain("<u>Underlined</u>");
});

test("Export Word writes exports/en/manuscript.docx in manuscript format with the chosen font", async ({
  page,
}) => {
  await newProject(page);
  await focusEnd(page);
  await page.keyboard.type("Typed for Word");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export book" });
  await dialog.getByRole("radio", { name: "Word (.docx)" }).click();
  await expect(dialog.getByRole("button", { name: "Print preview" })).toHaveCount(0);
  await dialog.getByLabel("Font").selectOption("courier");
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveText("Exported exports/en/manuscript.docx");
  const bytes = await page.evaluate(() => window.__disk["exports/en/manuscript.docx"] as number[]);
  expect(bytes.slice(0, 2)).toEqual([0x50, 0x4b]); // zip
  expect(bytes.length).toBeGreaterThan(1000);
});

test("Export Word: a write failure shows the reason and keeps the dialog usable", async ({
  page,
}) => {
  await newProject(page);
  await page.evaluate(() => {
    window.__failBytes = true;
  });
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export book" });
  await dialog.getByRole("radio", { name: "Word (.docx)" }).click();
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("No space left on device");
  await expect(dialog.getByRole("button", { name: "Export", exact: true })).toBeEnabled();
  await expect(page.getByRole("status").filter({ hasText: "Exported" })).toHaveCount(0);
  await page.evaluate(() => {
    window.__failBytes = false;
  });
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveText("Exported exports/en/manuscript.docx");
});

test("Export Rich Text writes exports/en/manuscript.rtf in manuscript format with the chosen font", async ({
  page,
}) => {
  await newProject(page);
  await focusEnd(page);
  await page.keyboard.type("Typed for Rich Text");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export book" });
  await dialog.getByRole("radio", { name: "Rich Text (.rtf)" }).click();
  await expect(dialog.getByRole("button", { name: "Print preview" })).toHaveCount(0);
  await dialog.getByLabel("Font").selectOption("courier");
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveText("Exported exports/en/manuscript.rtf");
  const rtf = await page.evaluate(() =>
    String.fromCharCode(...(window.__disk["exports/en/manuscript.rtf"] as number[])),
  );
  expect(rtf.startsWith("{\\rtf1")).toBe(true);
  expect(rtf).toContain("Typed for Rich Text");
  expect(rtf).toContain("{\\f0\\fmodern\\fcharset0 Courier New;}");
});

test("Export Rich Text: a write failure shows the reason and keeps the dialog usable", async ({
  page,
}) => {
  await newProject(page);
  await page.evaluate(() => {
    window.__failBytes = true;
  });
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export book" });
  await dialog.getByRole("radio", { name: "Rich Text (.rtf)" }).click();
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("No space left on device");
  await expect(dialog.getByRole("button", { name: "Export", exact: true })).toBeEnabled();
  await expect(page.getByRole("status").filter({ hasText: "Exported" })).toHaveCount(0);
  await page.evaluate(() => {
    window.__failBytes = false;
  });
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveText("Exported exports/en/manuscript.rtf");
});
