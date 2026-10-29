import { expect, test, type Page } from "./support/coverage";
import { TINY_MD } from "./fixtures";
import { fakeImportTauri } from "./support/fakeImport";

const chapterNav = (page: Page) => page.getByRole("navigation", { name: "Chapters" });

async function startImport(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Import…" }).click();
  const dialog = page.getByRole("dialog", { name: "Import a manuscript" });
  await dialog.getByRole("button", { name: "Choose file…" }).click();
  await expect(dialog.getByLabel("File")).not.toHaveValue("");
  await dialog.getByRole("button", { name: "Choose…" }).click();
  await expect(dialog.getByLabel("New book folder")).toHaveValue("/newbook");
  await dialog.getByRole("button", { name: "Next" }).click();
  return dialog;
}

test("importing Markdown creates a new project with chapters, shows the report, and leaves the source untouched", async ({
  page,
}) => {
  await fakeImportTauri(page, "md");
  const dialog = await startImport(page);
  await dialog.getByRole("button", { name: "Back" }).click();
  await expect(dialog.getByLabel("Title")).toHaveValue("My Book"); // from the file name
  await dialog.getByRole("button", { name: "Next" }).click();
  await dialog.getByRole("button", { name: "Import", exact: true }).click();

  const report = page.getByRole("dialog", { name: "Import report" });
  await expect(report).toBeVisible();
  await expect(report).toContainText("Imported 2 chapters from My_Book.md.");
  await expect(report).toContainText("1 image added.");
  await expect(report.getByRole("region", { name: "Import warnings" })).toContainText("Raw HTML"); // the raw HTML was kept as text
  await expect(report.getByRole("button", { name: "Copy report" })).toBeVisible();
  await report.getByRole("button", { name: "Done" }).click();
  await expect(report).toBeHidden();
  await expect(chapterNav(page).getByRole("button", { name: "Alpha", exact: true })).toBeVisible();
  await expect(chapterNav(page).getByRole("button", { name: "Beta", exact: true })).toBeVisible();
  await expect(page.locator(".ProseMirror h1")).toHaveText("Alpha");
  await expect(page.locator(".ProseMirror img")).toHaveCount(1);

  const result = await page.evaluate(() => {
    const w = window;
    return {
      sources: w.__sources as Record<string, number[]>,
      files: Object.keys(w.__disk) as string[],
      sourceWrites: w.__calls!.filter(
        (c) =>
          /^(write|create|import_asset|trash)/.test(c.cmd) &&
          JSON.stringify(c.args).includes("/src/"),
      ).length,
    };
  });
  expect(Buffer.from(result.sources["/src/My_Book.md"]!).toString()).toBe(TINY_MD);
  expect(result.sourceWrites).toBe(0);
  expect(result.files).toEqual(
    expect.arrayContaining([
      "cadabra.json",
      "manuscript/001-alpha.json",
      "manuscript/002-beta.json",
      "assets/pixel.png",
    ]),
  );
  expect(
    result.files.every(
      (f) => f === "cadabra.json" || f.startsWith("manuscript/") || f.startsWith("assets/"),
    ),
  ).toBe(true);
});

test("importing a DOCX works the same way", async ({ page }) => {
  await fakeImportTauri(page, "docx");
  const dialog = await startImport(page);
  await dialog.getByRole("button", { name: "Import", exact: true }).click();
  const report = page.getByRole("dialog", { name: "Import report" });
  await expect(report).toContainText("Imported 2 chapters from book.docx.");
  await report.getByRole("button", { name: "Done" }).click();
  await expect(chapterNav(page).getByRole("button", { name: "Dawn", exact: true })).toBeVisible();
  await expect(chapterNav(page).getByRole("button", { name: "Dusk", exact: true })).toBeVisible();
});

test("importing an HTML file keeps headings and bold text, drops scripts and reports what was lost", async ({
  page,
}) => {
  await fakeImportTauri(page, "html");
  const dialog = await startImport(page);
  await dialog.getByRole("button", { name: "Import", exact: true }).click();
  const report = page.getByRole("dialog", { name: "Import report" });
  await expect(report).toContainText("Imported 1 chapter from page.html.");
  await expect(report.getByRole("region", { name: "Import warnings" })).toContainText(
    "Unsupported HTML elements",
  );
  await report.getByRole("button", { name: "Done" }).click();
  await expect(chapterNav(page).getByRole("button", { name: "Gamma", exact: true })).toBeVisible();
  await expect(page.locator(".ProseMirror h1")).toHaveText("Gamma");
  await expect(page.locator(".ProseMirror strong")).toHaveText("strong");
  const saved = await page.evaluate(() => JSON.stringify(window.__disk));
  expect(saved).not.toContain("stealCookies");
});

test("an unreadable file shows the error in the dialog and creates no project", async ({
  page,
}) => {
  await fakeImportTauri(page, "broken");
  const dialog = await startImport(page);
  await expect(dialog.getByRole("alert")).toContainText("does not look like a valid .docx");
  await expect(dialog).toBeVisible();
  const created = await page.evaluate(() => Object.keys(window.__disk).length);
  expect(created).toBe(0);
});

test("the preview step lets the author rename and skip chapters before anything is written", async ({
  page,
}) => {
  await fakeImportTauri(page, "md");
  const dialog = await startImport(page);
  await expect(dialog.getByLabel("Title of chapter 1")).toHaveValue("Alpha");
  expect(await page.evaluate(() => Object.keys(window.__disk).length)).toBe(0); // nothing written yet
  await dialog.getByLabel("Title of chapter 1").fill("Prologue");
  await dialog.getByLabel("Include chapter 2").uncheck();
  await dialog.getByRole("button", { name: "Import", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Import report" })
    .getByRole("button", { name: "Done" })
    .click();
  await expect(
    chapterNav(page).getByRole("button", { name: "Prologue", exact: true }),
  ).toBeVisible();
  await expect(chapterNav(page).getByRole("button", { name: "Beta", exact: true })).toHaveCount(0);
});
