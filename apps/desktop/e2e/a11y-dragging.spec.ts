import type { Page } from "@playwright/test";
import { expect, test } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { fakeImportSources } from "./support/fakeImport";
import { addPage, newProject } from "./support/helpers";

// WCAG 2.2 criterion 2.5.7 (Dragging Movements): everything that can be done by dragging can also be done with a
// single pointer or the keyboard. Each test below never moves the pointer with a button held down.
//
// Drag interactions in the app (grep of apps/desktop/src: no dnd-kit, no draggable attribute, no sliders, no
// pointer-capture handles):
//   1. Reference list reorder (grip, ReferenceRow)          -> row menu "Move up" / "Move down", grip arrow keys
//   2. Import preview chapter reorder (grip)                -> "Move chapter N up/down" buttons, grip arrow keys
//   2b. Contents entry reorder (grip, TocRow)              -> row menu "Move up" / "Move down", grip arrow keys
//   3. Dropping files on the window to add references       -> "Add files" button (file picker)
//   4. Native textarea resize handle (`resize-y`)           -> user-agent control, exempt from 2.5.7; no test

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
  await page.getByRole("button", { name: "Add files" }).click();
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
  await page.getByRole("button", { name: "Add files" }).click();
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
