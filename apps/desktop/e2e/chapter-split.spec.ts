import { expect, test, type Page } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { chapterAction, manifestOf, newProject, sidebar } from "./support/helpers";

// Split an existing chapter at a heading: the chapter actions menu, the dialog, one undo step, and the phone layout.

const p = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const h = (level: number, text: string) => ({
  type: "heading",
  attrs: { level },
  content: [{ type: "text", text }],
});

/** A new book whose first chapter has an intro and two sections. */
async function bookWithSections(page: Page) {
  await fakeTauri(page);
  await newProject(page);
  await page.evaluate(
    (doc) => {
      window.__disk["manuscript/001-chapter-one.json"] = JSON.stringify(doc);
    },
    {
      type: "doc",
      content: [
        h(1, "Chapter One"),
        p("Intro."),
        h(2, "First part"),
        p("One."),
        h(2, "Second part"),
        p("Two."),
      ],
    },
  );
  await page.getByRole("button", { name: "Add chapter" }).click();
  await page.getByRole("button", { name: "Chapter One", exact: true }).click();
  await expect(page.locator(".ProseMirror h2").first()).toHaveText("First part");
}

const run = (page: Page, id: string) =>
  page.evaluate(
    (cmd) =>
      (window as never as { __cadabraMenu: { run: (id: string) => boolean } }).__cadabraMenu.run(
        cmd,
      ),
    id,
  );

test("Split at heading cuts the chapter, opens the new one, and Undo and Redo move it back and forth", async ({
  page,
}) => {
  await bookWithSections(page);
  await chapterAction(page, "Chapter One", "Split at heading…");
  const dialog = page.getByRole("dialog", { name: "Split “Chapter One”" });
  await expect(dialog.getByRole("radio")).toHaveCount(2);
  await expect(dialog.getByRole("radio", { name: "First part" })).toBeChecked();
  await dialog.getByRole("radio", { name: "Second part" }).check();
  await expect(dialog.getByLabel("Title of the new chapter")).toHaveValue("Second part");
  await dialog.getByLabel("Title of the new chapter").fill("The end");
  await dialog.getByRole("button", { name: "Split chapter" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".ProseMirror h2")).toHaveText("Second part");
  await expect(sidebar(page)).toContainText("The end");
  const manifest = await manifestOf(page);
  expect(manifest.chapters.map((c: { titles: { en: string } }) => c.titles.en)).toEqual([
    "Chapter One",
    "The end",
    "Chapter 2",
  ]);
  const first = String(await page.evaluate(() => window.__disk["manuscript/001-chapter-one.json"]));
  expect(first).toContain("First part");
  expect(first).not.toContain("Two.");

  expect(await run(page, "edit.bookUndo")).toBe(true);
  expect((await manifestOf(page)).chapters).toHaveLength(2);
  const whole = String(await page.evaluate(() => window.__disk["manuscript/001-chapter-one.json"]));
  expect(whole).toContain("Two.");
  await expect(page.locator(".ProseMirror")).toContainText("Two.");
  expect(await run(page, "edit.bookRedo")).toBe(true);
  expect((await manifestOf(page)).chapters).toHaveLength(3);
  const cut = String(await page.evaluate(() => window.__disk["manuscript/001-chapter-one.json"]));
  expect(cut).not.toContain("Two.");
});

test("a chapter with no heading to cut at says so", async ({ page }) => {
  await fakeTauri(page);
  await newProject(page);
  await chapterAction(page, "Chapter One", "Split at heading…");
  const dialog = page.getByRole("dialog", { name: /^Split/ });
  await expect(dialog.getByRole("alert")).toContainText("no heading to split at");
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toHaveCount(0);
});

test("a chapter file that cannot be read says so and changes nothing", async ({ page }) => {
  await bookWithSections(page);
  await page.evaluate(() => {
    delete window.__disk["manuscript/001-chapter-one.json"];
  });
  await chapterAction(page, "Chapter One", "Split at heading…");
  const dialog = page.getByRole("dialog", { name: /^Split/ });
  await expect(dialog.getByRole("alert")).toContainText("Could not read this chapter");
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toHaveCount(0);
});

test("a book with translations refuses to split, with a notice in the dialog", async ({ page }) => {
  await fakeTauri(page);
  await newProject(page);
  await page.getByRole("button", { name: /Edition: English/ }).click();
  await page.getByRole("menuitem", { name: "Add language" }).click();
  const add = page.getByRole("dialog", { name: "Add language" });
  await add.getByLabel("Language", { exact: true }).selectOption("fr");
  await add.getByRole("button", { name: "Add language", exact: true }).click();
  await page.getByRole("button", { name: /Edition: Français/ }).click();
  await page.getByRole("menuitem", { name: /English/ }).click();
  await chapterAction(page, "Chapter One", "Split at heading…");
  await expect(page.getByRole("dialog", { name: /^Split/ }).getByRole("alert")).toContainText(
    "translations",
  );
});

test("the split dialog fits a phone and its choices are touch sized", async ({ page }) => {
  await bookWithSections(page);
  await page.setViewportSize({ width: 360, height: 740 });
  await page.getByRole("button", { name: "Show chapters" }).click();
  await chapterAction(page, "Chapter One", "Split at heading…");
  const dialog = page.getByRole("dialog", { name: /^Split/ });
  await expect(dialog.getByRole("radio", { name: "Second part" })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
  const small = await dialog
    .locator("label:has(input[type=radio])")
    .evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().height < 42).length);
  expect(small).toBe(0);
});
