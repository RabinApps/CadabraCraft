import type { Page } from "@playwright/test";
import { expect, test } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { newProject, titles, chapterAction, focusEnd } from "./support/helpers";

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

test("creating a project shows a first chapter in the editor", async ({ page }) => {
  await newProject(page);
  expect(await titles(page)).toEqual(["Chapter One"]);
  await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter One");
  const manifest = await page.evaluate(() => JSON.parse(window.__disk["cadabra.json"] as string));
  expect(manifest).toMatchObject({
    formatVersion: 14,
    editions: [{ title: "E2E Book", author: "Tester" }],
  });
});

test("typed text is saved as TipTap JSON and survives a reload via Open", async ({ page }) => {
  await newProject(page);
  await focusEnd(page);
  await page.keyboard.type("Hello from Playwright");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved");
  await page.reload();
  await page.getByRole("button", { name: "Open folder" }).click();
  await expect(page.locator(".ProseMirror")).toContainText("Hello from Playwright");
});

test("switching chapters keeps unsaved typing", async ({ page }) => {
  await newProject(page);
  await focusEnd(page);
  await page.keyboard.type("first chapter text");
  await page.getByRole("button", { name: "Add chapter" }).click();
  await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter 2");
  await page.getByRole("button", { name: "Chapter One", exact: true }).click();
  await expect(page.locator(".ProseMirror")).toContainText("first chapter text");
});

test("rename, reorder and delete chapters", async ({ page }) => {
  await newProject(page);
  await page.getByRole("button", { name: "Add chapter" }).click();
  await chapterAction(page, "Chapter 2", "Rename");
  await page.getByLabel("Chapter title").fill("Second");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Second", exact: true })).toBeVisible();

  await chapterAction(page, "Second", "Move up");
  const order = await page.evaluate(() =>
    JSON.parse(window.__disk["cadabra.json"] as string).chapters.map(
      (c: { titles: { en: string } }) => c.titles.en,
    ),
  );
  expect(order).toEqual(["Second", "Chapter One"]);

  await chapterAction(page, "Second", "Move to trash");
  await page.getByRole("dialog").getByRole("button", { name: "Move to trash" }).click();
  await expect(page.getByRole("button", { name: "Second", exact: true })).toHaveCount(0);
  const trashed = await page.evaluate(() =>
    Object.keys(window.__disk).filter((k) => k.startsWith(".cadabra/trash/")),
  );
  expect(trashed).toHaveLength(1);
});

const order = (page: Page) =>
  page.evaluate(() =>
    JSON.parse(window.__disk["cadabra.json"] as string).chapters.map(
      (c: { titles: { en: string } }) => c.titles.en,
    ),
  );

test("the sidebar grip reorders a chapter with the arrow keys", async ({ page }) => {
  await newProject(page);
  await page.getByRole("button", { name: "Add chapter" }).click();
  const grip = page.getByRole("button", { name: "Reorder Chapter 2" });
  await grip.focus();
  await page.keyboard.press("ArrowUp");
  await expect.poll(() => order(page)).toEqual(["Chapter 2", "Chapter One"]);
  await expect(grip).toBeFocused();
  await expect(page.getByText("Moved Chapter 2 up to position 1 of 2")).toBeAttached();
  await page.keyboard.press("ArrowUp"); // already first: nothing happens
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => order(page)).toEqual(["Chapter One", "Chapter 2"]);
});

test("dragging the sidebar grip drops a chapter at the line", async ({ page }) => {
  await newProject(page);
  await page.getByRole("button", { name: "Add chapter", exact: true }).click();
  await page.getByRole("button", { name: "Add chapter", exact: true }).click();
  const grip = (await page.getByRole("button", { name: "Reorder Chapter 3" }).boundingBox())!;
  const first = (await page
    .getByRole("button", { name: "Chapter One", exact: true })
    .boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(first.x + 10, first.y + 2, { steps: 5 });
  await expect(page.locator("[data-drop-line]")).toHaveCount(1);
  await page.mouse.up();
  await expect.poll(() => order(page)).toEqual(["Chapter 3", "Chapter One", "Chapter 2"]);
});

test("keyboard: chapter controls are reachable with Tab", async ({ page }) => {
  await newProject(page);
  await page.getByRole("button", { name: "Chapter One", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Actions for Chapter One" })).toBeFocused();
});

test("a chapter icon is picked in a dialog, shown before the title, kept on disk and undone", async ({
  page,
}) => {
  await newProject(page);
  const icon = page.getByRole("button", { name: "Chapter One", exact: true }).locator("svg");
  await expect(icon).toHaveCount(0);
  await chapterAction(page, "Chapter One", "Change icon…");
  const dialog = page.getByRole("dialog", { name: "Icon for “Chapter One”" });
  await expect(dialog.getByRole("button", { name: "None" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await dialog.getByRole("button", { name: "Moon" }).click();
  await expect(dialog).toBeHidden();
  await expect(icon).toHaveCount(1);
  await expect(icon).toHaveAttribute("aria-hidden", "true");
  const saved = await page.evaluate(() => JSON.parse(window.__disk["cadabra.json"] as string));
  expect(saved.chapters[0].icon).toBe("moon");
  await chapterAction(page, "Chapter One", "Change icon…");
  await expect(page.getByRole("button", { name: "Moon" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "None" }).click();
  await expect(icon).toHaveCount(0);
  await page.getByRole("button", { name: /^Undo: Change icon/ }).click();
  await expect(icon).toHaveCount(1);
});

test("a chapter's first letter is Default, Big or Normal from its menu, and undone", async ({
  page,
}) => {
  await newProject(page);
  const dropCap = () =>
    page.evaluate(() => JSON.parse(window.__disk["cadabra.json"] as string).chapters[0].dropCap);
  const open = async () => {
    await page.getByRole("button", { name: "Actions for Chapter One" }).click();
    return page.getByRole("menu");
  };
  let menu = await open();
  await expect(menu.getByRole("menuitemradio", { name: "Default" })).toBeChecked();
  await menu.getByRole("menuitemradio", { name: "Normal" }).click();
  await expect.poll(dropCap).toBe(false);
  menu = await open();
  await expect(menu.getByRole("menuitemradio", { name: "Normal" })).toBeChecked();
  await menu.getByRole("menuitemradio", { name: "Big" }).click();
  await expect.poll(dropCap).toBe(true);
  await page.getByRole("button", { name: /^Undo: Change first letter/ }).click();
  await expect.poll(dropCap).toBe(false);
});

test("the First letter group is named, and each choice and icon change is announced", async ({
  page,
}) => {
  await newProject(page);
  await page.getByRole("button", { name: "Actions for Chapter One" }).click();
  const group = page.getByRole("menu").getByRole("group", { name: "First letter" });
  await expect(group.getByRole("menuitemradio")).toHaveCount(3);
  await group.getByRole("menuitemradio", { name: "Big" }).click();
  await expect(page.getByText("Chapter One: big first letter")).toBeAttached();
  // Focus goes back to the row's menu button, not to the page.
  await expect(page.getByRole("button", { name: "Actions for Chapter One" })).toBeFocused();
  await chapterAction(page, "Chapter One", "Change icon…");
  await page.getByRole("dialog").getByRole("button", { name: "Moon" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Icon of “Chapter One” changed" }),
  ).toBeAttached();
  await expect(page.getByRole("button", { name: "Actions for Chapter One" })).toBeFocused();
});
