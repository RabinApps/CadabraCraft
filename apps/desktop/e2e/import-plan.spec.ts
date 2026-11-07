import { expect, test, type Locator, type Page } from "./support/coverage";
import { fakeImportTauri } from "./support/fakeImport";
import { chapterAction, newProject, sidebar } from "./support/helpers";

// The import preview: reorder (drag, keyboard, buttons), merge, split, and importing into the open book.

async function startImport(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Import…" }).click();
  const dialog = page.getByRole("dialog", { name: "Import a manuscript" });
  await dialog.getByRole("button", { name: "Choose file…" }).click();
  await expect(dialog.getByLabel("File")).not.toHaveValue("");
  await dialog.getByRole("button", { name: "Choose…" }).click();
  await expect(dialog.getByLabel("New book folder")).toHaveValue("/newbook");
  await dialog.getByRole("button", { name: "Next" }).click();
  await expect(dialog.getByLabel("Title of chapter 1")).toBeVisible();
  return dialog;
}

/** The chapter buttons of the sidebar (not their action menus), top to bottom. */
const chapterNames = (page: Page) =>
  sidebar(page).locator(
    "li > div > button:not([aria-label^='Actions']):not([data-grip]):not([aria-expanded])",
  );

/** The chapter titles in the preview, top to bottom. */
const previewTitles = (dialog: Locator) =>
  dialog
    .getByRole("list", { name: "Chapters" })
    .locator("input[type=text], input:not([type])")
    .evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));

const finish = async (page: Page, button = "Import") => {
  await page.getByRole("dialog").getByRole("button", { name: button, exact: true }).click();
  const report = page.getByRole("dialog", { name: "Import report" });
  await expect(report).toBeVisible();
  await report.getByRole("button", { name: "Done" }).click();
};

test("the preview moves chapters with the Move buttons, and the import follows the new order", async ({
  page,
}) => {
  await fakeImportTauri(page, "md3");
  const dialog = await startImport(page);
  expect(await previewTitles(dialog)).toEqual(["One", "Two", "Three"]);
  await expect(dialog.getByRole("button", { name: "Move chapter 1 up" })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Move chapter 3 down" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Move chapter 3 up" }).click();
  expect(await previewTitles(dialog)).toEqual(["One", "Three", "Two"]);
  await dialog.getByRole("button", { name: "Move chapter 1 down" }).click();
  expect(await previewTitles(dialog)).toEqual(["Three", "One", "Two"]);
  expect(await page.evaluate(() => Object.keys(window.__disk).length)).toBe(0); // still nothing written
  await finish(page);
  await expect(chapterNames(page)).toHaveText(["Three", "One", "Two"]);
  const files = await page.evaluate(() => Object.keys(window.__disk).sort());
  expect(files).toEqual(
    expect.arrayContaining([
      "manuscript/001-three.json",
      "manuscript/002-one.json",
      "manuscript/003-two.json",
    ]),
  );
});

test("Enter in a chapter title imports, and Enter with no chapter kept does not", async ({
  page,
}) => {
  await fakeImportTauri(page, "md3");
  const dialog = await startImport(page);
  const checks = dialog.getByRole("list", { name: "Chapters" }).getByRole("checkbox");
  const n = await checks.count();
  for (let i = 0; i < n; i++) await checks.nth(i).uncheck();
  await dialog.getByLabel("Title of chapter 1").press("Enter");
  await expect(dialog).toBeVisible(); // nothing kept: nothing happens
  expect(await page.evaluate(() => Object.keys(window.__disk).length)).toBe(0);
  await checks.nth(0).check();
  await dialog.getByLabel("Title of chapter 1").press("Enter");
  await expect(page.getByRole("dialog", { name: "Import report" })).toBeVisible();
});

test("the grip moves a chapter with the arrow keys and keeps focus on it", async ({ page }) => {
  await fakeImportTauri(page, "md3");
  const dialog = await startImport(page);
  await dialog.getByRole("button", { name: "Reorder chapter 1" }).focus();
  await page.keyboard.press("ArrowDown");
  expect(await previewTitles(dialog)).toEqual(["Two", "One", "Three"]);
  await expect(dialog.getByRole("button", { name: "Reorder chapter 2" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown"); // already last: stays
  expect(await previewTitles(dialog)).toEqual(["Two", "Three", "One"]);
  await page.keyboard.press("ArrowUp");
  expect(await previewTitles(dialog)).toEqual(["Two", "One", "Three"]);
  await page.keyboard.press("Home"); // other keys do nothing
  expect(await previewTitles(dialog)).toEqual(["Two", "One", "Three"]);
});

test("dragging the grip moves a chapter and shows where it will land", async ({ page }) => {
  await fakeImportTauri(page, "md3");
  const dialog = await startImport(page);
  const grip = await dialog.getByRole("button", { name: "Reorder chapter 1" }).boundingBox();
  const last = await dialog.getByLabel("Title of chapter 3").boundingBox();
  await page.mouse.move(grip!.x + grip!.width / 2, grip!.y + grip!.height / 2);
  await page.mouse.down();
  await page.mouse.move(last!.x + 20, last!.y + last!.height + 30, { steps: 6 });
  await expect(dialog.locator("[data-drop-line]")).toHaveCount(1);
  await page.mouse.up();
  await expect(dialog.locator("[data-drop-line]")).toHaveCount(0);
  expect(await previewTitles(dialog)).toEqual(["Two", "Three", "One"]);
  // Dropping where it started changes nothing.
  const first = await dialog.getByRole("button", { name: "Reorder chapter 3" }).boundingBox();
  await page.mouse.move(first!.x + first!.width / 2, first!.y + first!.height / 2);
  await page.mouse.down();
  await page.mouse.move(first!.x + 10, first!.y + first!.height + 40, { steps: 4 });
  await page.mouse.up();
  expect(await previewTitles(dialog)).toEqual(["Two", "Three", "One"]);
});

test("a chapter merges into the previous one, splits back, and the merged text is imported", async ({
  page,
}) => {
  await fakeImportTauri(page, "md3");
  const dialog = await startImport(page);
  await expect(
    dialog.getByRole("button", { name: "Merge chapter 1 into the previous one" }),
  ).toBeDisabled();
  await dialog.getByLabel("Include chapter 1").uncheck();
  await expect(
    dialog.getByRole("button", { name: "Merge chapter 2 into the previous one" }),
  ).toBeDisabled(); // merging into a skipped chapter would lose it
  await dialog.getByLabel("Include chapter 1").check();
  await dialog.getByRole("button", { name: "Merge chapter 2 into the previous one" }).click();
  expect(await previewTitles(dialog)).toEqual(["One", "Three"]);
  await expect(dialog.getByRole("button", { name: /^Split chapter 1 back/ })).toBeVisible();
  await expect(dialog.getByRole("status")).toContainText("2 chapters will be imported.");
  await dialog.getByRole("button", { name: /^Split chapter 1 back/ }).click();
  expect(await previewTitles(dialog)).toEqual(["One", "Two", "Three"]);
  await expect(dialog.getByRole("button", { name: /^Split chapter \d+ back/ })).toHaveCount(0);
  // Merge again, rename, and import.
  await dialog.getByRole("button", { name: "Merge chapter 3 into the previous one" }).click();
  await dialog.getByLabel("Title of chapter 2").fill("Two and three");
  await finish(page);
  await expect(chapterNames(page)).toHaveText(["One", "Two and three"]);
  const merged = String(
    await page.evaluate(() => window.__disk["manuscript/002-two-and-three.json"]),
  );
  expect(merged).toContain("Second text.");
  expect(merged).toContain("Third text.");
  expect(merged.indexOf("Second text.")).toBeLessThan(merged.indexOf("Third text."));
  const files = await page.evaluate(() => Object.keys(window.__disk));
  expect(files.filter((f) => f.startsWith("manuscript/"))).toHaveLength(2);
});

test("changing the split level starts the plan over", async ({ page }) => {
  await fakeImportTauri(page, "md3");
  const dialog = await startImport(page);
  await dialog.getByRole("button", { name: "Move chapter 3 up" }).click();
  await dialog.getByRole("radio", { name: "Heading 2" }).click();
  expect(await previewTitles(dialog)).toEqual(["Untitled"]); // no level-2 headings: one chapter
  await dialog.getByRole("radio", { name: "Heading 1" }).click();
  expect(await previewTitles(dialog)).toEqual(["One", "Two", "Three"]); // the earlier move is gone
});

test("importing into the open book appends the chapters and never touches the existing ones", async ({
  page,
}) => {
  await fakeImportTauri(page, "md3", false);
  await newProject(page);
  const before = await page.evaluate(() => window.__disk["manuscript/001-chapter-one.json"]);
  await page.waitForFunction(() =>
    Boolean((window as never as { __cadabraMenu?: unknown }).__cadabraMenu),
  );
  expect(
    await page.evaluate(() =>
      (window as never as { __cadabraMenu: { run: (id: string) => boolean } }).__cadabraMenu.run(
        "file.importInto",
      ),
    ),
  ).toBe(true);
  const dialog = page.getByRole("dialog", { name: "Import into this book" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Title")).toHaveCount(0);
  await expect(dialog.getByLabel("New book folder")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Next" })).toBeEnabled(); // pressing it says the file is missing
  await dialog.getByRole("button", { name: "Choose file…" }).click();
  await dialog.getByRole("button", { name: "Next" }).click();
  await dialog.getByRole("button", { name: "Move chapter 3 up" }).click();
  await dialog.getByLabel("Title of chapter 1").fill("Prologue");
  await dialog.getByRole("button", { name: "Add to book", exact: true }).click();
  const report = page.getByRole("dialog", { name: "Import report" });
  await expect(report).toContainText("Imported 3 chapters from three.md.");
  await report.getByRole("button", { name: "Done" }).click();
  await expect(chapterNames(page)).toHaveText(["Chapter One", "Prologue", "Three", "Two"]);
  await expect(page.locator(".ProseMirror h1")).toHaveText("One"); // the first new chapter is open
  expect(await page.evaluate(() => window.__disk["manuscript/001-chapter-one.json"])).toBe(before);
  const manifest = await page.evaluate(() => JSON.parse(window.__disk["cadabra.json"] as string));
  expect(manifest.chapters).toHaveLength(4);
  const created = await page.evaluate(
    () => window.__calls!.filter((c) => c.cmd === "create_project").length,
  );
  expect(created).toBe(1); // only the book's own creation

  // The whole import is one undo step (Edit > Undo): all three chapters go, the first chapter stays untouched.
  const run = (id: string) =>
    page.evaluate(
      (cmd) =>
        (window as never as { __cadabraMenu: { run: (id: string) => boolean } }).__cadabraMenu.run(
          cmd,
        ),
      id,
    );
  expect(await run("edit.bookUndo")).toBe(true);
  await expect(chapterNames(page)).toHaveText(["Chapter One"]);
  await expect(page.locator(".ProseMirror")).toBeVisible();
  const undone = await page.evaluate(() => JSON.parse(window.__disk["cadabra.json"] as string));
  expect(undone.chapters).toHaveLength(1);
  expect(await page.evaluate(() => window.__disk["manuscript/001-chapter-one.json"])).toBe(before);
  expect(
    await page.evaluate(() =>
      Object.keys(window.__disk).filter((k) => k.startsWith("manuscript/")),
    ),
  ).toEqual(["manuscript/001-chapter-one.json"]);
  // Redo brings the three chapters back, in the order they were imported in, with their text.
  expect(await run("edit.bookRedo")).toBe(true);
  await expect(chapterNames(page)).toHaveText(["Chapter One", "Prologue", "Three", "Two"]);
  const redone = await page.evaluate(() => JSON.parse(window.__disk["cadabra.json"] as string));
  expect(redone.chapters.map((c: { titles: { en: string } }) => c.titles.en)).toEqual([
    "Chapter One",
    "Prologue",
    "Three",
    "Two",
  ]);
  expect(
    await page.evaluate(() =>
      Object.keys(window.__disk).filter((k) => k.startsWith("manuscript/")),
    ),
  ).toHaveLength(4);
});

test("Cancel in the open-book import changes nothing, and the dialog opens again empty", async ({
  page,
}) => {
  await fakeImportTauri(page, "md3", false);
  await newProject(page);
  const disk = await page.evaluate(() => JSON.stringify(window.__disk));
  await page.setViewportSize({ width: 390, height: 844 }); // the phone header menu
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Import into this book" }).click();
  const dialog = page.getByRole("dialog", { name: "Import into this book" });
  await dialog.getByRole("button", { name: "Choose file…" }).click();
  await dialog.getByRole("button", { name: "Next" }).click();
  await expect(dialog.getByLabel("Title of chapter 1")).toBeVisible();
  await dialog.getByRole("button", { name: "Back" }).click();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => JSON.stringify(window.__disk))).toBe(disk);
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Import into this book" }).click();
  await expect(
    page.getByRole("dialog", { name: "Import into this book" }).getByLabel("File"),
  ).toHaveValue("");
});

test("a failed open-book import shows the error and leaves the book as it was", async ({
  page,
}) => {
  await fakeImportTauri(page, "broken", false);
  await newProject(page);
  const disk = await page.evaluate(() => JSON.stringify(window.__disk));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Import into this book" }).click();
  const dialog = page.getByRole("dialog", { name: "Import into this book" });
  await dialog.getByRole("button", { name: "Choose file…" }).click();
  await dialog.getByRole("button", { name: "Next" }).click();
  await expect(dialog.getByRole("alert")).toContainText("does not look like a valid .docx");
  expect(await page.evaluate(() => JSON.stringify(window.__disk))).toBe(disk);
});

test("the preview list is usable on a phone and mirrors in right-to-left", async ({ page }) => {
  await fakeImportTauri(page, "md3");
  await page.setViewportSize({ width: 360, height: 740 });
  const dialog = await startImport(page);
  const fits = () =>
    page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  expect(await fits()).toBe(true);
  const small = await dialog
    .getByRole("list", { name: "Chapters" })
    .getByRole("button")
    .evaluateAll(
      (els) =>
        els.map((e) => e.getBoundingClientRect()).filter((r) => r.width < 43.5 || r.height < 43.5)
          .length,
    );
  expect(small).toBe(0);
  await page.evaluate(() => {
    document.documentElement.dir = "rtl";
  });
  expect(await fits()).toBe(true);
  const grip = await dialog.getByRole("button", { name: "Reorder chapter 1" }).boundingBox();
  const title = await dialog.getByLabel("Title of chapter 1").boundingBox();
  expect(grip!.x + grip!.width / 2).toBeGreaterThan(title!.x + title!.width / 2); // the controls start at the right edge
});

test("a chapter merges into the next one, which keeps its title", async ({ page }) => {
  await fakeImportTauri(page, "md3");
  const dialog = await startImport(page);
  await expect(
    dialog.getByRole("button", { name: "Merge chapter 3 into the next one" }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: "Merge chapter 1 into the next one" }).click();
  expect(await previewTitles(dialog)).toEqual(["Two", "Three"]);
  await finish(page);
  await expect(chapterNames(page)).toHaveText(["Two", "Three"]);
  const merged = String(await page.evaluate(() => window.__disk["manuscript/001-two.json"]));
  expect(merged.indexOf("First text.")).toBeLessThan(merged.indexOf("Second text."));
});

test("a chapter splits at a heading in the preview, merges back, and resets with the level", async ({
  page,
}) => {
  await fakeImportTauri(page, "sections");
  const dialog = await startImport(page);
  expect(await previewTitles(dialog)).toEqual(["Book", "Last"]);
  await expect(dialog.getByRole("button", { name: "Split chapter 2 at a heading" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Split chapter 1 at a heading" }).click();
  await page.getByRole("menuitem", { name: "Beta" }).click();
  expect(await previewTitles(dialog)).toEqual(["Book", "Beta", "Last"]);
  await dialog.getByRole("button", { name: "Split chapter 1 at a heading" }).click();
  await page.getByRole("menuitem", { name: "Alpha" }).click();
  expect(await previewTitles(dialog)).toEqual(["Book", "Alpha", "Beta", "Last"]);
  await dialog.getByRole("button", { name: "Merge chapter 3 into the previous one" }).click();
  await dialog.getByRole("button", { name: "Merge chapter 2 into the previous one" }).click();
  expect(await previewTitles(dialog)).toEqual(["Book", "Last"]); // split and merge cancel out
  await dialog.getByRole("button", { name: "Split chapter 1 at a heading" }).click();
  await page.getByRole("menuitem", { name: "Beta" }).click();
  await dialog.getByRole("radio", { name: "Heading 2" }).click();
  await dialog.getByRole("radio", { name: "Heading 1" }).click();
  expect(await previewTitles(dialog)).toEqual(["Book", "Last"]); // the plan started over
  await dialog.getByRole("button", { name: "Split chapter 1 at a heading" }).click();
  await page.getByRole("menuitem", { name: "Beta" }).click();
  await finish(page);
  await expect(chapterNames(page)).toHaveText(["Book", "Beta", "Last"]);
  const first = String(await page.evaluate(() => window.__disk["manuscript/001-book.json"]));
  const second = String(await page.evaluate(() => window.__disk["manuscript/002-beta.json"]));
  expect(first).toContain("Alpha text.");
  expect(first).not.toContain("Beta text.");
  expect(second).toContain("Beta text.");
});

test("importing into the open book adds the chapters where the author chose, inside a part too", async ({
  page,
}) => {
  await fakeImportTauri(page, "md3", false);
  await newProject(page);
  await page.getByRole("button", { name: "Add chapter" }).click();
  await chapterAction(page, "Chapter 2", "Start part here");
  await page.waitForFunction(() =>
    Boolean((window as never as { __cadabraMenu?: unknown }).__cadabraMenu),
  );
  await page.evaluate(() =>
    (window as never as { __cadabraMenu: { run: (id: string) => boolean } }).__cadabraMenu.run(
      "file.importInto",
    ),
  );
  const dialog = page.getByRole("dialog", { name: "Import into this book" });
  await dialog.getByRole("button", { name: "Choose file…" }).click();
  await dialog.getByRole("button", { name: "Next" }).click();
  const where = dialog.getByLabel("Add the chapters");
  await expect(where.locator("option")).toHaveText([
    "At the end of the book",
    "After Chapter One",
    "At the start of Part 1",
    "After Chapter 2",
  ]);
  await expect(dialog).toContainText("join that part");
  await where.selectOption({ label: "At the start of Part 1" });
  await dialog.getByRole("button", { name: "Add to book", exact: true }).click();
  const report = page.getByRole("dialog", { name: "Import report" });
  await report.getByRole("button", { name: "Done" }).click();
  const manifest = await page.evaluate(() => JSON.parse(window.__disk["cadabra.json"] as string));
  expect(manifest.chapters.map((c: { titles: { en: string } }) => c.titles.en)).toEqual([
    "Chapter One",
    "Part 1",
    "One",
    "Two",
    "Three",
    "Chapter 2",
  ]);
});
