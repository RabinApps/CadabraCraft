import { expect, test } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { newProject, focusEnd } from "./support/helpers";

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

test("Export PDF sends the chosen options to Typst and writes exports/en/book.pdf", async ({
  page,
}) => {
  await newProject(page);
  await focusEnd(page);
  await page.keyboard.type("Typeset me");
  await page.getByRole("button", { name: "Book details" }).click();
  const details = page.getByRole("dialog", { name: "Book details" });
  await details.getByLabel("Trim size").selectOption("5x8");
  await details.getByRole("button", { name: "Save details" }).click();
  await expect(details).toBeHidden();
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Export book" })
    .getByRole("radio", { name: "Print PDF" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Export book" });
  await expect(dialog.getByTestId("trim-size")).toContainText("5 × 8 in");
  await dialog.getByLabel("Template").selectOption("nonfiction");
  await dialog.getByLabel("PDF/A (archival)").check();
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveText("Exported exports/en/book.pdf");

  const call = await page.evaluate(() => window.__typstCalls[0]!);
  expect(call.pdfA).toBe(true);
  expect(call.source).toContain("Typeset me"); // unsaved typing was flushed first
  expect(call.source).toMatch(/#set page\(width: 5in, height: 8in/); // 5x8 trim
  const pdf = await page.evaluate(() => window.__disk["exports/en/book.pdf"]);
  expect(pdf!.slice(0, 5)).toEqual([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
  const manifest = await page.evaluate(() => JSON.parse(window.__disk["cadabra.json"] as string));
  expect(manifest.template).toBe("nonfiction");
});

test("PDF/UA is its own option, off by default, and can be combined with PDF/A", async ({
  page,
}) => {
  await newProject(page);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export book" });
  await dialog.getByRole("radio", { name: "Print PDF" }).click();
  const ua = dialog.getByLabel("PDF/UA (accessible)");
  await expect(ua).not.toBeChecked();
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveText("Exported exports/en/book.pdf");

  await page.getByRole("button", { name: "Export", exact: true }).click();
  await dialog.getByRole("radio", { name: "Print PDF" }).click();
  await dialog.getByLabel("PDF/UA (accessible)").check();
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect(dialog).toHaveCount(0);

  await page.getByRole("button", { name: "Export", exact: true }).click();
  await dialog.getByRole("radio", { name: "Print PDF" }).click();
  await dialog.getByLabel("PDF/UA (accessible)").check();
  await dialog.getByLabel("PDF/A (archival)").check();
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect(dialog).toHaveCount(0);

  const calls = await page.evaluate(() => window.__typstCalls.map((c) => [c.pdfA, c.pdfUa]));
  expect(calls).toEqual([
    [false, false],
    [false, true],
    [true, true],
  ]);
});

test("the trim size is a book setting: chosen at creation, shown read-only in Export, changed in Book details", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New project" }).click();
  const create = page.getByRole("dialog", { name: "New book" });
  await create.getByLabel("Title").fill("Sized Book");
  await create.getByLabel("Trim size").selectOption("6x9");
  await create.getByRole("button", { name: "Choose…" }).click();
  await create.getByRole("button", { name: "Create book" }).click();
  await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter One");
  const manifest = () => page.evaluate(() => JSON.parse(window.__disk["cadabra.json"] as string));
  expect((await manifest()).trimSize).toBe("6x9");

  await focusEnd(page);
  await page.keyboard.type("Some words to count");
  await expect(page.getByText(/in the book · \d+ pages? at 6 × 9 in/)).toBeVisible();

  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export book" });
  await dialog.getByRole("radio", { name: "Print PDF" }).click();
  await expect(dialog.getByTestId("trim-size")).toContainText("6 × 9 in");
  await dialog.getByRole("button", { name: "Change" }).click();
  const details = page.getByRole("dialog", { name: "Book details" });
  await details.getByLabel("Trim size").selectOption("5x8");
  await details.getByRole("button", { name: "Save details" }).click();
  await expect(details).toBeHidden();
  expect((await manifest()).trimSize).toBe("5x8");
  await expect(page.getByText(/pages? at 5 × 8 in/)).toBeVisible();
});

test("Export PDF dialog shows KDP print checks for a very short book", async ({ page }) => {
  await newProject(page);
  await focusEnd(page);
  await page.keyboard.type("Just a few words");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export book" });
  await dialog.getByRole("radio", { name: "Print PDF" }).click();
  const checks = dialog.getByRole("list", { name: "Print checks" });
  await expect(checks).toContainText("KDP paperbacks need at least 24");
  await expect(checks).toContainText("no cover image");
});

test("Export PDF explains when Typst is missing and offers no location field", async ({ page }) => {
  await newProject(page);
  await page.evaluate(() => {
    window.__typstError = {
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
  await expect(dialog.getByLabel("Typst location (optional)")).toHaveCount(0);
  expect(await page.evaluate(() => window.__disk["exports/en/book.pdf"])).toBeUndefined();
});

test("Export PDF shows Typst's compile error", async ({ page }) => {
  await newProject(page);
  await page.evaluate(() => {
    window.__compileError = { kind: "compile", message: "main.typ:4:2: error: boom" };
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
