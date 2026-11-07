import { expect, test, type Locator, type Page } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { addPage, manifestOf, newProject } from "./support/helpers";

// The native drag cannot be started in a browser, so these tests send the events Tauri would send (the same way
// references-drop.spec.ts does). What they cannot show is the operating system delivering a real drag.

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

const panel = (page: Page) => page.getByRole("region", { name: "References" });
const highlight = (page: Page) => page.getByTestId("editor-drop-highlight");
const warning = (page: Page) => page.getByTestId("editor-drop-warning");
const addImageDialog = (page: Page) => page.getByRole("dialog", { name: "Add image" });

/** The centre of an element in the physical pixels Tauri reports (the page divides them by the pixel ratio). */
async function centre(el: Locator) {
  return el.evaluate((n) => {
    const r = n.getBoundingClientRect();
    const scale = window.devicePixelRatio;
    return { x: (r.left + r.width / 2) * scale, y: (r.top + r.height / 2) * scale };
  });
}

type Point = { x: number; y: number };
const enter = (page: Page, paths: string[], position: Point) =>
  page.evaluate(([p, pos]) => window.__emit!("tauri://drag-enter", { paths: p, position: pos }), [
    paths,
    position,
  ] as const);
const over = (page: Page, position: Point) =>
  page.evaluate((pos) => window.__emit!("tauri://drag-over", { position: pos }), position);
const leave = (page: Page) => page.evaluate(() => window.__emit!("tauri://drag-leave", {}));
const drop = (page: Page, paths: string[], position: Point) =>
  page.evaluate(([p, pos]) => window.__emit!("tauri://drag-drop", { paths: p, position: pos }), [
    paths,
    position,
  ] as const);

const pageArea = (page: Page) => page.locator(".ProseMirror");
/** A spot on the page that is on screen (the page is taller than the window). */
const onPageSpot = (page: Page) =>
  pageArea(page).evaluate((n) => {
    const r = n.getBoundingClientRect();
    const scale = window.devicePixelRatio;
    return { x: (r.left + r.width / 2) * scale, y: (r.top + 60) * scale };
  });

async function openPanel(page: Page) {
  await page.getByRole("button", { name: "References", exact: true }).first().click();
  await expect(panel(page)).toBeVisible();
}

test.describe("dropping a picture on the editor", () => {
  test("shows the highlight while files are over the page and hides it on leave", async ({
    page,
  }) => {
    await newProject(page);
    await expect(highlight(page)).toHaveCount(0);
    const at = await onPageSpot(page);
    await enter(page, ["/pics/photo.png"], at);
    await expect(highlight(page)).toBeVisible();
    await expect(highlight(page)).toContainText("Drop a picture to add it");
    await over(page, at);
    await expect(highlight(page)).toBeVisible();
    await leave(page);
    await expect(highlight(page)).toHaveCount(0);
  });

  test("a dropped picture opens the Add image dialog, which still needs a description", async ({
    page,
  }) => {
    await newProject(page);
    const at = await onPageSpot(page);
    await enter(page, ["/pics/photo.png"], at);
    await drop(page, ["/pics/photo.png"], at);
    await expect(highlight(page)).toHaveCount(0);
    const dialog = addImageDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Image file")).toHaveValue("assets/pic.png");
    expect(await page.evaluate(() => window.__imports)).toEqual(["/pics/photo.png"]);
    // Alt text is required, as for a picture added from the toolbar.
    await dialog.getByRole("button", { name: "Insert" }).click();
    await expect(
      dialog.getByText('Describe the image, or tick "This image is decorative".'),
    ).toBeVisible();
    await dialog.getByLabel("Description (alt text)").fill("A single pixel");
    await dialog.getByRole("button", { name: "Insert" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator(".ProseMirror figure img")).toHaveAttribute("alt", "A single pixel");
    await expect(pageArea(page)).toBeFocused();
    // Nothing went to the References panel.
    expect((await manifestOf(page)).references).toEqual([]);
  });

  test("a decorative picture needs no description", async ({ page }) => {
    await newProject(page);
    const at = await onPageSpot(page);
    await drop(page, ["/pics/photo.JPG"], at);
    const dialog = addImageDialog(page);
    await dialog.getByLabel("This image is decorative").check();
    await dialog.getByRole("button", { name: "Insert" }).click();
    await expect(page.locator(".ProseMirror figure img")).toHaveAttribute("alt", "");
  });

  test("a file that is not a picture shows the warning and adds nothing", async ({ page }) => {
    await newProject(page);
    const at = await onPageSpot(page);
    await enter(page, ["/docs/notes.pdf"], at);
    await drop(page, ["/docs/notes.pdf"], at);
    await expect(warning(page)).toContainText("This file type can't be added here.");
    await expect(addImageDialog(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.__imports)).toBeUndefined();
    expect((await manifestOf(page)).references).toEqual([]);
    // A new drag clears the warning.
    await enter(page, ["/pics/photo.png"], at);
    await expect(warning(page).getByText("This file type")).toHaveCount(0);
  });

  test("a folder is not a picture either", async ({ page }) => {
    await newProject(page);
    await drop(page, ["/pics/photos"], await onPageSpot(page));
    await expect(warning(page)).toContainText("This file type can't be added here.");
  });

  test("the warning goes away by itself", async ({ page }) => {
    await newProject(page);
    await drop(page, ["/docs/notes.pdf"], await onPageSpot(page));
    await expect(warning(page)).toContainText("This file type");
    await expect(warning(page).getByText("This file type")).toHaveCount(0, { timeout: 12000 });
  });

  test("several files: the first picture is added and the others are counted", async ({ page }) => {
    await newProject(page);
    const files = ["/docs/a.txt", "/pics/one.png", "/pics/two.jpg", "/pics/three.gif"];
    await drop(page, files, await onPageSpot(page));
    await expect(addImageDialog(page)).toBeVisible();
    expect(await page.evaluate(() => window.__imports)).toEqual(["/pics/one.png"]);
    await expect(warning(page)).toContainText(
      "Only one picture is added at a time. 3 other files were left out.",
    );
  });

  test("one extra file is counted in the singular", async ({ page }) => {
    await newProject(page);
    await drop(page, ["/pics/one.png", "/pics/two.jpg"], await onPageSpot(page));
    await expect(warning(page)).toContainText("1 other file was left out.");
  });

  test("an image the app refuses is reported and opens no dialog", async ({ page }) => {
    await newProject(page);
    await page.evaluate(() => (window.__importError = "photo.png is larger than 25 MB"));
    await drop(page, ["/pics/photo.png"], await onPageSpot(page));
    await expect(page.getByRole("alert")).toContainText("Could not add the image");
    await expect(addImageDialog(page)).toHaveCount(0);
  });

  test("works in focus mode, where the toolbar is hidden", async ({ page }) => {
    await newProject(page);
    await page.getByRole("button", { name: "Focus mode" }).click();
    await expect(page.getByRole("toolbar", { name: "Formatting" })).toHaveCount(0);
    await drop(page, ["/pics/photo.png"], await onPageSpot(page));
    await expect(addImageDialog(page)).toBeVisible();
  });

  test("a blank page takes no drops", async ({ page }) => {
    await newProject(page);
    await addPage(page, "Blank page");
    await expect(pageArea(page)).toHaveAttribute("contenteditable", "false");
    const at = await onPageSpot(page);
    await enter(page, ["/pics/photo.png"], at);
    await expect(highlight(page)).toHaveCount(0);
    await drop(page, ["/pics/photo.png"], at);
    await expect(addImageDialog(page)).toHaveCount(0);
    await expect(warning(page).getByText("This file type")).toHaveCount(0);
    // The editor owns that spot, so the panel did not take the file either.
    expect((await manifestOf(page)).references).toEqual([]);
  });

  test("Read mode takes no picture drops", async ({ page }) => {
    await newProject(page);
    await page.getByRole("radio", { name: "Read" }).click();
    // The reading view shows the pages but is not the editor, which owns no part of the window.
    await expect(page.locator("[data-editor-drop]")).toHaveCount(0);
    await enter(page, ["/pics/photo.png"], { x: 400, y: 400 });
    await expect(highlight(page)).toHaveCount(0);
    await drop(page, ["/pics/photo.png"], { x: 400, y: 400 });
    await expect(addImageDialog(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.__imports)).toBeUndefined();
  });
});

test.describe("who owns a drop: the editor or the References panel", () => {
  test("files over the panel go to the panel and not to the editor", async ({ page }) => {
    await newProject(page);
    await openPanel(page);
    const onPanel = await centre(panel(page));
    await enter(page, ["/refs/photo.png"], onPanel);
    await expect(panel(page)).toHaveAttribute("data-drop-active", "true");
    await expect(highlight(page)).toHaveCount(0);
    await drop(page, ["/refs/photo.png"], onPanel);
    await expect(panel(page).getByRole("listitem")).toHaveCount(1);
    await expect(addImageDialog(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.__imports)).toBeUndefined();
    expect((await manifestOf(page)).references[0]).toMatchObject({ file: "references/photo.png" });
  });

  test("files over the page go to the editor and not to the panel", async ({ page }) => {
    await newProject(page);
    await openPanel(page);
    const onPage = await onPageSpot(page);
    await enter(page, ["/pics/photo.png"], onPage);
    await expect(highlight(page)).toBeVisible();
    await expect(panel(page)).not.toHaveAttribute("data-drop-active", "true");
    await drop(page, ["/pics/photo.png"], onPage);
    await expect(addImageDialog(page)).toBeVisible();
    await expect(panel(page).getByRole("listitem")).toHaveCount(0);
    expect((await manifestOf(page)).references).toEqual([]);
  });

  test("moving from the page to the panel hands the highlight over", async ({ page }) => {
    await newProject(page);
    await openPanel(page);
    await enter(page, ["/pics/photo.png"], await onPageSpot(page));
    await expect(highlight(page)).toBeVisible();
    await over(page, await centre(panel(page)));
    await expect(highlight(page)).toHaveCount(0);
    await expect(panel(page)).toHaveAttribute("data-drop-active", "true");
  });
});
