import type { Page } from "@playwright/test";
import { expect, test } from "../support/coverage";
import { fakeTauri } from "../support/fakeTauri";
import { fakeImportSources } from "../support/fakeImport";
import { addPage, addReference, newProject, seedChapters } from "../support/helpers";

// WCAG 2.2 criterion 2.5.7 (Dragging Movements): everything that can be done by dragging can also be done with a
// single pointer or the keyboard. Each test below never moves the pointer with a button held down.
//
// Drag interactions in the app (grep of apps/desktop/src: no dnd-kit, no draggable attribute, no sliders):
//   1. Reference list reorder (grip, ReferenceRow)          -> row menu "Move up" / "Move down", grip arrow keys
//   2. Import preview chapter reorder (grip)                -> "Move chapter N up/down" buttons, grip arrow keys
//   2b. Contents entry reorder (grip, TocRow)              -> row menu "Move up" / "Move down", grip arrow keys
//   2c. Sidebar chapter reorder (grip, EntryList)          -> row menu "Move up" / "Move down", grip arrow keys
//   2d. Scene board card reorder (grip, SceneCard)         -> card menu "Move earlier" / "Move later" / "Move to chapter", grip arrow keys
//   3. Dropping files, addresses or text on the References panel -> Add menu: "Add files" (file picker), "Add link", "Add note" (dialogs)
//   4. Native textarea resize handle (`resize-y`)           -> user-agent control, exempt from 2.5.7; no test
//   5. Sidebar width (separator, SidebarResizeHandle)       -> arrow keys, Home and End on the separator

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

const PNG = Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

const panel = (page: Page) => page.getByRole("region", { name: "References" });
const refTitles = (page: Page) =>
  panel(page)
    .getByRole("listitem")
    .evaluateAll((li) => li.map((x) => x.querySelector("[data-title]")!.textContent));

async function withReferences(page: Page) {
  await newProject(page);
  const files = {
    "/refs/one.png": PNG,
    "/refs/two.png": PNG.slice(0, 60).concat([1]),
    "/refs/three.png": PNG.slice(0, 50).concat([2, 3]),
  };
  await page.evaluate(
    ([paths, contents]) => {
      window.__pickedRefs = paths as string[];
      window.__refFiles = contents as Record<string, number[]>;
    },
    [Object.keys(files), files] as const,
  );
  await page.getByRole("button", { name: "References", exact: true }).first().click();
  await addReference(page, "Add files");
  await expect(panel(page).getByRole("listitem")).toHaveCount(3);
  await expect.poll(() => refTitles(page)).toEqual(["one", "two", "three"]);
}

test("2.5.7 references: the row menu moves a reference up and down with single clicks", async ({
  page,
}) => {
  await withReferences(page);
  await panel(page).getByRole("button", { name: "Actions for one" }).click();
  await page.getByRole("menuitem", { name: "Move down" }).click();
  await expect.poll(() => refTitles(page)).toEqual(["two", "one", "three"]);
  await panel(page).getByRole("button", { name: "Actions for three" }).click();
  await page.getByRole("menuitem", { name: "Move up" }).click();
  await expect.poll(() => refTitles(page)).toEqual(["two", "three", "one"]);
});

test("2.5.7 references: the grip moves a reference with the arrow keys", async ({ page }) => {
  await withReferences(page);
  await panel(page).getByRole("button", { name: "Reorder one" }).focus();
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => refTitles(page)).toEqual(["two", "one", "three"]);
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => refTitles(page)).toEqual(["two", "three", "one"]);
  await page.keyboard.press("ArrowUp");
  await expect.poll(() => refTitles(page)).toEqual(["two", "one", "three"]);
});

test("2.5.7 import preview: the Move buttons and the grip keys reorder chapters", async ({
  page,
}) => {
  await fakeImportSources(page, "md3");
  await page.goto("/");
  await page.getByRole("button", { name: "Import…" }).click();
  const dialog = page.getByRole("dialog", { name: "Import a manuscript" });
  await dialog.getByRole("button", { name: "Choose file…" }).click();
  await expect(dialog.getByLabel("File")).not.toHaveValue("");
  await dialog.getByRole("button", { name: "Choose…" }).click();
  await expect(dialog.getByLabel("New book folder")).toHaveValue("/newbook");
  await dialog.getByRole("button", { name: "Next" }).click();
  await expect(dialog.getByLabel("Title of chapter 1")).toBeVisible();
  const titles = () =>
    dialog
      .getByRole("list", { name: "Chapters" })
      .locator("input[type=text], input:not([type])")
      .evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));

  expect(await titles()).toEqual(["One", "Two", "Three"]);
  await dialog.getByRole("button", { name: "Move chapter 3 up" }).click();
  expect(await titles()).toEqual(["One", "Three", "Two"]);
  await dialog.getByRole("button", { name: "Move chapter 1 down" }).click();
  expect(await titles()).toEqual(["Three", "One", "Two"]);

  await dialog.getByRole("button", { name: "Reorder chapter 1" }).focus();
  await page.keyboard.press("ArrowDown");
  expect(await titles()).toEqual(["One", "Three", "Two"]);
  await page.keyboard.press("ArrowDown");
  expect(await titles()).toEqual(["One", "Two", "Three"]);
  await page.keyboard.press("ArrowUp");
  expect(await titles()).toEqual(["One", "Three", "Two"]);
});

test("2.5.7 references: files that can be dropped on the window can also be added with a button", async ({
  page,
}) => {
  await newProject(page);
  await page.evaluate(
    ([paths, contents]) => {
      window.__pickedRefs = paths as string[];
      window.__refFiles = contents as Record<string, number[]>;
    },
    [["/refs/one.png"], { "/refs/one.png": PNG }] as [string[], Record<string, number[]>],
  );
  await page.getByRole("button", { name: "References", exact: true }).first().click();
  await expect(panel(page).getByRole("listitem")).toHaveCount(0);
  await addReference(page, "Add files");
  await expect(panel(page).getByRole("listitem")).toHaveCount(1);
  await expect.poll(() => refTitles(page)).toEqual(["one"]);
});

const contents = (page: Page) => page.getByRole("region", { name: "Contents", exact: true });
const tocTitles = (page: Page) =>
  contents(page).locator("[data-toc-key] span.truncate").allTextContents();

async function withContents(page: Page) {
  await newProject(page);
  await page.getByRole("button", { name: "Add chapter", exact: true }).click();
  await page.getByRole("button", { name: "Add chapter", exact: true }).click();
  await addPage(page, "Contents");
  await expect(contents(page)).toBeVisible();
  await expect.poll(() => tocTitles(page)).toEqual(["Chapter One", "Chapter 2", "Chapter 3"]);
}

test("2.5.7 contents: the row menu moves an entry up and down with single clicks", async ({
  page,
}) => {
  await withContents(page);
  await contents(page).getByRole("button", { name: "Actions for Chapter One" }).click();
  await expect(page.getByRole("menuitem", { name: "Move up" })).toBeDisabled();
  await page.getByRole("menuitem", { name: "Move down" }).click();
  await expect.poll(() => tocTitles(page)).toEqual(["Chapter 2", "Chapter One", "Chapter 3"]);
  await contents(page).getByRole("button", { name: "Actions for Chapter 3" }).click();
  await expect(page.getByRole("menuitem", { name: "Move down" })).toBeDisabled();
  await page.getByRole("menuitem", { name: "Move up" }).click();
  await expect.poll(() => tocTitles(page)).toEqual(["Chapter 2", "Chapter 3", "Chapter One"]);
});

test("2.5.7 contents: the grip is a button that moves an entry with the arrow keys and keeps focus", async ({
  page,
}) => {
  await withContents(page);
  const grip = (name: string) => contents(page).getByRole("button", { name: `Reorder ${name}` });
  await expect(grip("Chapter One")).toHaveAttribute("aria-keyshortcuts", "ArrowUp ArrowDown");
  await grip("Chapter One").focus();
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => tocTitles(page)).toEqual(["Chapter 2", "Chapter One", "Chapter 3"]);
  await expect(grip("Chapter One")).toBeFocused();
  // The move is announced: the grip keeps its name, so nothing else would say where the entry went.
  await expect(
    contents(page).locator("[aria-live=polite]").filter({ hasText: "Moved Chapter One" }),
  ).toHaveText("Moved Chapter One to position 2 of 3");
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => tocTitles(page)).toEqual(["Chapter 2", "Chapter 3", "Chapter One"]);
  await page.keyboard.press("ArrowDown"); // already last: nothing happens
  await page.keyboard.press("ArrowUp");
  await expect.poll(() => tocTitles(page)).toEqual(["Chapter 2", "Chapter One", "Chapter 3"]);
  await expect(grip("Chapter One")).toBeFocused();
});

test("2.5.7 sidebar: the row menu and the grip arrow keys reorder chapters without dragging", async ({
  page,
}) => {
  await newProject(page);
  await page.getByRole("button", { name: "Add chapter" }).click();
  const names = () =>
    page.evaluate(() =>
      JSON.parse(window.__disk["cadabra.json"] as string).chapters.map(
        (c: { titles: { en: string } }) => c.titles.en,
      ),
    );
  await page.getByRole("button", { name: "Actions for Chapter 2" }).click();
  await page.getByRole("menuitem", { name: "Move up" }).click();
  await expect.poll(names).toEqual(["Chapter 2", "Chapter One"]);
  await page.getByRole("button", { name: "Reorder Chapter 2" }).focus();
  await page.keyboard.press("ArrowDown");
  await expect.poll(names).toEqual(["Chapter One", "Chapter 2"]);
});

test("2.5.7 sidebar: the divider changes the width without dragging", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await newProject(page);
  const divider = page.getByRole("separator", { name: "Resize chapter list" });
  await divider.focus();
  await page.keyboard.press("ArrowRight");
  await expect(divider).toHaveAttribute("aria-valuenow", "280");
  await page.keyboard.press("End");
  await expect(divider).toHaveAttribute("aria-valuenow", "480");
  await page.keyboard.press("ArrowLeft");
  await expect(divider).toHaveAttribute("aria-valuenow", "464");
});

test("2.5.7 and 4.1.3 sidebar: the grip says where a page went, and why it did not move", async ({
  page,
}) => {
  await newProject(page);
  await page.getByRole("button", { name: "Add chapter" }).click();
  const said = page.locator("section[aria-label] [aria-live=polite]").filter({ hasText: /./ });
  const grip = page.getByRole("button", { name: "Reorder Chapter 2" });
  await expect(grip).toHaveAccessibleDescription(/Escape cancels a drag/);
  await grip.focus();
  await page.keyboard.press("ArrowDown");
  await expect(said.first()).toHaveText("Chapter 2 is already last");
  await page.keyboard.press("ArrowUp");
  await expect(said.first()).toHaveText("Moved Chapter 2 up to position 1 of 2");
  // The message clears itself so the next one is announced even if identical.
  await expect(said).toHaveCount(0, { timeout: 8000 });
});

test("2.5.2 sidebar: Escape cancels a drag and nothing moves", async ({ page }) => {
  await newProject(page);
  await page.getByRole("button", { name: "Add chapter" }).click();
  const names = () =>
    page.evaluate(() =>
      JSON.parse(window.__disk["cadabra.json"] as string).chapters.map(
        (c: { titles: { en: string } }) => c.titles.en,
      ),
    );
  const grip = (await page.getByRole("button", { name: "Reorder Chapter 2" }).boundingBox())!;
  const first = (await page
    .getByRole("button", { name: "Chapter One", exact: true })
    .boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(first.x + 10, first.y + 2, { steps: 5 });
  await expect(page.locator("[data-drop-line]")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-drop-line]")).toHaveCount(0);
  await page.mouse.up();
  expect(await names()).toEqual(["Chapter One", "Chapter 2"]);
});

test("2.5.7 scene board: the card menu and the grip arrow keys move scenes without dragging", async ({
  page,
}) => {
  await newProject(page);
  const scene = (id: string, title: string) => ({
    type: "scene",
    attrs: { id, title },
    content: [{ type: "paragraph", content: [{ type: "text", text: `${title} words` }] }],
  });
  const heading = (text: string) => ({
    type: "heading",
    attrs: { level: 1 },
    content: [{ type: "text", text }],
  });
  await seedChapters(page, [
    { type: "doc", content: [heading("Chapter One"), scene("a", "Alpha"), scene("b", "Bravo")] },
    { type: "doc", content: [heading("Chapter Two")] },
  ] as never);
  await page.getByRole("button", { name: "Scene board" }).click();
  const titles = (chapter: string) =>
    page
      .getByRole("list", { name: `Scenes in ${chapter}` })
      .locator("[data-scene-card] h3")
      .allTextContents();
  await expect.poll(() => titles("Chapter One")).toEqual(["Alpha", "Bravo"]);
  const grip = page.getByRole("button", { name: "Reorder Alpha" });
  await expect(grip).toHaveAccessibleDescription(/Escape cancels a drag/);
  await grip.focus();
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => titles("Chapter One")).toEqual(["Bravo", "Alpha"]);
  await expect(page.locator("[aria-live=polite]")).toContainText(
    "Moved Alpha to position 2 of 2 in Chapter One",
  );
  await expect(grip).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => titles("Chapter Two")).toEqual(["Alpha"]);
  await page.getByRole("button", { name: "Actions for Alpha" }).click();
  await page.getByRole("menuitem", { name: "Chapter One" }).click();
  await expect.poll(() => titles("Chapter One")).toEqual(["Bravo", "Alpha"]);
});

test("2.5.7 references: links and notes can be added without dragging anything", async ({
  page,
}) => {
  await newProject(page);
  await page.getByRole("button", { name: "References", exact: true }).first().click();
  await addReference(panel(page), "Add link");
  const link = page.getByRole("dialog", { name: "Add link" });
  await link.getByLabel("Address").fill("https://a.example.org/");
  await link.getByRole("button", { name: "Add link" }).click();
  await addReference(panel(page), "Add note");
  const note = page.getByRole("dialog", { name: "Add note" });
  await note.getByLabel("Note", { exact: true }).fill("Body");
  await note.getByRole("button", { name: "Add note" }).click();
  await expect.poll(() => refTitles(page)).toEqual(["a.example.org", "Body"]);
});

test("references: Escape cancels a pointer drag and nothing moves", async ({ page }) => {
  await withReferences(page);
  const g = (await panel(page).locator("[data-grip]").first().boundingBox())!;
  const l = (await panel(page).getByRole("listitem").last().boundingBox())!;
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + 4, l.y + l.height + 4, { steps: 4 });
  await expect(panel(page).locator("[data-drop-line]")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect.poll(() => refTitles(page)).toEqual(["one", "two", "three"]);
});
