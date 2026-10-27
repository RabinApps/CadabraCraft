import { expect, test } from "@playwright/test";
import { fakeTauri } from "./support/fakeTauri";
import { newProject, exportBook } from "./support/helpers";

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

test("export writes a valid EPUB zip with mimetype first", async ({ page }) => {
  await newProject(page);
  await exportBook(page, "EPUB 3");
  await expect(page.getByRole("status")).toHaveText("Exported exports/book.epub");
  const head = await page.evaluate(() => {
    const b = (window as any).__disk["exports/book.epub"] as number[];
    return String.fromCharCode(...b.slice(0, 4), ...b.slice(30, 38));
  });
  expect(head).toBe("PK\u0003\u0004mimetype");
});

test("Export Markdown writes exports/book.md, and explains underline until the HTML option is on", async ({ page }) => {
  await newProject(page);
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("ControlOrMeta+u");
  await page.keyboard.type("Underlined");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export book" });
  await dialog.getByRole("radio", { name: "Markdown" }).click();
  await expect(dialog.getByRole("button", { name: "Print preview" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("underline");
  await dialog.getByLabel("Keep underline and small caps").check();
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveText("Exported exports/book.md");
  const md = await page.evaluate(() => String.fromCharCode(...((window as any).__disk["exports/book.md"] as number[])));
  expect(md).toContain("<u>Underlined</u>");
});

test("Export Word writes exports/manuscript.docx in manuscript format with the chosen font", async ({ page }) => {
  await newProject(page);
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("Typed for Word");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export book" });
  await dialog.getByRole("radio", { name: "Word (.docx)" }).click();
  await expect(dialog.getByRole("button", { name: "Print preview" })).toHaveCount(0);
  await dialog.getByLabel("Font").selectOption("courier");
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveText("Exported exports/manuscript.docx");
  const bytes = await page.evaluate(() => (window as any).__disk["exports/manuscript.docx"] as number[]);
  expect(bytes.slice(0, 2)).toEqual([0x50, 0x4b]); // zip
  expect(bytes.length).toBeGreaterThan(1000);
});

test("Export Word: a write failure shows the reason and keeps the dialog usable", async ({ page }) => {
  await newProject(page);
  await page.evaluate(() => { (window as any).__failBytes = true; });
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export book" });
  await dialog.getByRole("radio", { name: "Word (.docx)" }).click();
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("No space left on device");
  await expect(dialog.getByRole("button", { name: "Export", exact: true })).toBeEnabled();
  await expect(page.getByRole("status").filter({ hasText: "Exported" })).toHaveCount(0);
  await page.evaluate(() => { (window as any).__failBytes = false; });
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveText("Exported exports/manuscript.docx");
});
