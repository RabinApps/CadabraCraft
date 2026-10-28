import { expect, test } from "@playwright/test";
import { fakeTauri } from "./support/fakeTauri";
import { newProject } from "./support/helpers";

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

test("Export PDF sends the chosen options to Typst and writes exports/book.pdf", async ({
  page,
}) => {
  await newProject(page);
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("Typeset me");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Export book" })
    .getByRole("radio", { name: "Print PDF" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Export book" });
  await dialog.getByLabel("Trim size").selectOption("5x8");
  await dialog.getByLabel("Template").selectOption("nonfiction");
  await dialog.getByLabel("PDF/A (archival)").check();
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveText("Exported exports/book.pdf");

  const call = await page.evaluate(() => (window as any).__typstCalls[0]);
  expect(call.pdfA).toBe(true);
  expect(call.source).toContain("Typeset me"); // unsaved typing was flushed first
  expect(call.source).toMatch(/#set page\(width: 5in, height: 8in/); // 5x8 trim
  const pdf = await page.evaluate(() => (window as any).__disk["exports/book.pdf"]);
  expect(pdf).toEqual([0x25, 0x50, 0x44, 0x46, 0x2d]);
  const manifest = await page.evaluate(() => JSON.parse((window as any).__disk["cadabra.json"]));
  expect(manifest.template).toBe("nonfiction");
});

test("Export PDF dialog shows KDP print checks for a very short book", async ({ page }) => {
  await newProject(page);
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("Just a few words");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export book" });
  await dialog.getByRole("radio", { name: "Print PDF" }).click();
  const checks = dialog.getByRole("list", { name: "Print checks" });
  await expect(checks).toContainText("KDP paperbacks need at least 24");
  await expect(checks).toContainText("no cover image");
});

test("Export PDF explains when Typst is missing and offers a location field", async ({ page }) => {
  await newProject(page);
  await page.evaluate(() => {
    (window as any).__typstError = {
      kind: "not_found",
      message: 'The "typst" program was not found. Install Typst (brew install typst).',
    };
  });
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Export book" })
    .getByRole("radio", { name: "Print PDF" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Export book" });
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("brew install typst");
  await expect(dialog.getByLabel("Typst location (optional)")).toBeVisible();
  expect(await page.evaluate(() => (window as any).__disk["exports/book.pdf"])).toBeUndefined();
});

test("Export PDF shows Typst's compile error", async ({ page }) => {
  await newProject(page);
  await page.evaluate(() => {
    (window as any).__compileError = { kind: "compile", message: "main.typ:4:2: error: boom" };
  });
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Export book" })
    .getByRole("radio", { name: "Print PDF" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Export book" });
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("main.typ:4:2: error: boom");
  await expect(dialog.getByRole("button", { name: "Export", exact: true })).toBeEnabled();
});
