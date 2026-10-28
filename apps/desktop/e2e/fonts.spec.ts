import { expect, test, type Page } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { manifestOf, newProject } from "./support/helpers";

// Settings, Fonts (list, delete, import, catalog), the editor font, and the print fonts in the Export dialog.

const LORA = { id: "lora", family: "Lora", source: "downloaded", files: ["Lora.ttf", "OFL.txt"] };

/** Puts Lora in the fake fonts folder before the app starts. */
const withLora = (page: Page) =>
  page.addInitScript((lora) => {
    window.__fontsInstalled = [lora];
  }, LORA);

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

const openSettings = async (page: Page) => {
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
};

const openFontsSettings = async (page: Page) => {
  await page.goto("/");
  await openSettings(page);
  await page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("button", { name: "Fonts" })
    .click();
};

test("Settings, Fonts lists the bundled, installed, downloaded and imported fonts with badges", async ({
  page,
}) => {
  await withLora(page);
  await openFontsSettings(page);
  const row = (name: string) => page.getByTestId(`font-${name}`);
  await expect(row("Newsreader")).toContainText("Installed");
  await expect(row("Inter")).toContainText("Installed");
  await expect(row("Libertinus Serif")).toContainText("Installed");
  await expect(row("Lora")).toContainText("Downloaded");
  // Only the app's own fonts can be deleted.
  await expect(row("Newsreader").getByRole("button")).toHaveCount(0);
  await expect(row("Libertinus Serif").getByRole("button")).toHaveCount(0);

  await page.getByRole("button", { name: "Choose file…" }).click();
  await expect(row("Custom Sans")).toContainText("Imported");

  await page.getByRole("button", { name: "Delete Lora" }).click();
  await expect(row("Lora")).toHaveCount(0);
  await page.getByRole("button", { name: "Delete Custom Sans" }).click();
  await expect(row("Custom Sans")).toHaveCount(0);
  await expect(row("Newsreader")).toBeVisible();
});

test("Settings, Fonts says so when a file cannot be imported, and ignores a cancelled picker", async ({
  page,
}) => {
  await openFontsSettings(page);
  await page.evaluate(() => {
    window.__fontImportError = { kind: "invalid_font", message: "no family name" };
  });
  await page.getByRole("button", { name: "Choose file…" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "That file is not a usable font. Choose a .ttf or .otf file.",
  );
  await page.evaluate(() => {
    window.__fontImportError = undefined;
    window.__pickedFont = null;
  });
  await page.getByRole("button", { name: "Choose file…" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByTestId("font-Custom Sans")).toHaveCount(0);
});

test("the catalog downloads a font with progress, can cancel it, shows a failure and retries", async ({
  page,
}) => {
  await openFontsSettings(page);
  await page.evaluate(() => {
    window.__fontHold = true;
  });
  await page.getByRole("button", { name: "Browse fonts…" }).click();
  const dialog = page.getByRole("dialog", { name: "Download fonts" });
  await expect(dialog).toContainText("Google Fonts");
  const lora = dialog.getByTestId("catalog-lora");
  await expect(lora).toContainText("2 styles · 2.4 MB");
  await expect(lora.getByRole("button", { name: "SIL Open Font Licence 1.1" })).toBeVisible();

  // Progress, then cancel: the row goes back to Download and nothing is installed.
  await lora.getByRole("button", { name: "Download Lora" }).click();
  await expect(lora.getByRole("progressbar")).toBeVisible();
  await expect(lora).toContainText("Downloading… 0.8 MB of 2.4 MB");
  await lora.getByRole("button", { name: "Cancel the download of Lora" }).click();
  await expect(lora.getByRole("button", { name: "Download Lora" })).toBeVisible();
  await expect(dialog.getByRole("alert")).toHaveCount(0);

  // A failure shows a plain message and Try again.
  await page.evaluate(() => {
    window.__fontHold = false;
    window.__fontError = { kind: "network", message: "offline" };
  });
  await lora.getByRole("button", { name: "Download Lora" }).click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "The download failed. Check your connection and try again.",
  );
  await lora.getByRole("button", { name: "Try again to download Lora" }).click();
  await expect(lora).toContainText("Installed");
  await expect(dialog.getByRole("alert")).toHaveCount(0);

  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByTestId("font-Lora")).toContainText("Downloaded");
  expect(await page.evaluate(() => window.__fontDownloads)).toEqual(["lora", "lora", "lora"]);
});

test("a downloaded font can be the manuscript font and is applied to the editor", async ({
  page,
}) => {
  await withLora(page);
  await newProject(page);
  const page_ = page.locator(".prose-manuscript");
  await expect(page_).toHaveAttribute("style", /var\(--font-book\)/);
  await openSettings(page);
  await page.getByLabel("Manuscript font").selectOption("Lora");
  await expect(page.getByLabel("Manuscript font")).toHaveValue("Lora");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page_).toHaveAttribute("style", /font-family: "?Lora"?, var\(--font-book\)/);
  // Its bytes were asked for; the fake sends no real font, so the editor keeps the serif behind it.
  expect(await page.evaluate(() => window.__fontDataCalls)).toContain("lora/Lora.ttf");
  await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter One");
  // The choice is an app preference and survives a reload.
  const stored = await page.evaluate(() => localStorage.getItem("cadabracraft.settings"));
  expect(JSON.parse(stored!).manuscriptFont).toBe("Lora");
});

const openPdfPanel = async (page: Page) => {
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export book" });
  await dialog.getByRole("radio", { name: "Print PDF" }).click();
  return dialog;
};

test("Export PDF saves the body and heading fonts in the book and sends them to Typst", async ({
  page,
}) => {
  await withLora(page);
  await newProject(page);
  const dialog = await openPdfPanel(page);
  const body = dialog.getByLabel("Body font");
  const heading = dialog.getByLabel("Heading font");
  await expect(body).toHaveValue("");
  await expect(body.locator("option").first()).toHaveText(/^Template default \(/);
  await expect(heading.locator("option").first()).toHaveText("Same as body");
  await body.selectOption("Lora");
  await heading.selectOption("New Computer Modern");
  await expect
    .poll(async () => (await manifestOf(page)).fonts)
    .toEqual({
      body: "Lora",
      heading: "New Computer Modern",
    });
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const call = await page.evaluate(() => window.__typstCalls[0]!);
  expect(call.source).toContain("Lora");
  expect(call.source).toContain("New Computer Modern");

  // Back to the template's fonts removes the key.
  const again = await openPdfPanel(page);
  await again.getByLabel("Heading font").selectOption({ label: "Same as body" });
  await expect.poll(async () => (await manifestOf(page)).fonts).toEqual({ body: "Lora" });
  await again.getByLabel("Body font").selectOption({ index: 0 });
  await expect.poll(async () => "fonts" in (await manifestOf(page))).toBe(false);
});

test("Export PDF explains a missing font and Open Fonts goes to Settings, Fonts", async ({
  page,
}) => {
  await withLora(page);
  await newProject(page);
  const dialog = await openPdfPanel(page);
  await dialog.getByLabel("Body font").selectOption("Lora");
  await expect.poll(async () => (await manifestOf(page)).fonts).toEqual({ body: "Lora" });
  // The book is now on a computer without Lora.
  await page.evaluate(() => {
    window.__fontsInstalled = [];
  });
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "The font “Lora” is not on this computer. Download it in Settings, Fonts, or pick another font.",
  );
  // The book's font stays selectable, so the notice and the select agree.
  await expect(dialog.getByLabel("Body font")).toHaveValue("Lora");
  await dialog.getByRole("button", { name: "Open Fonts" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Fonts", level: 2 })).toBeInViewport();
  // Nothing was exported.
  expect(await page.evaluate(() => window.__disk["exports/en/book.pdf"])).toBeUndefined();
});

test("the Word format can use any available font", async ({ page }) => {
  await withLora(page);
  await newProject(page);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export book" });
  await dialog.getByRole("radio", { name: "Word (.docx)" }).click();
  const font = dialog.getByLabel("Font");
  await expect(font.locator("option")).toContainText([
    "Times New Roman",
    "Courier New",
    "Libertinus Serif",
    "Lora",
    "New Computer Modern",
  ]);
  await font.selectOption("Lora");
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const docx = await page.evaluate(() => window.__disk["exports/en/manuscript.docx"]);
  expect(Array.isArray(docx)).toBe(true);
});
