import { expect, test } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { newProject, chapterAction, seedSnapshot } from "./support/helpers";

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

test("book undo and redo: sidebar buttons and shortcut, trash round trip, separate from editor undo", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await newProject(page);
  const nav = page.getByRole("navigation", { name: "Chapters" });
  const undo = nav.getByRole("button", { name: /^Undo/ });
  const redo = nav.getByRole("button", { name: /^Redo/ });
  await expect(undo).toBeDisabled();
  await expect(redo).toBeDisabled();
  const chapters = () =>
    page.evaluate(() =>
      JSON.parse(window.__disk["cadabra.json"] as string).chapters.map(
        (c: { titles: { en: string } }) => c.titles.en,
      ),
    );
  const trashCount = () =>
    page.evaluate(
      () => Object.keys(window.__disk).filter((k) => k.startsWith(".cadabra/trash/")).length,
    );

  await page.getByRole("button", { name: "Add chapter" }).click();
  await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter 2");
  await expect(undo).toHaveAccessibleName("Undo: Add Chapter 2");
  // Removing then undoing brings the page back from the trash.
  await chapterAction(page, "Chapter 2", "Move to trash");
  await page.getByRole("dialog").getByRole("button", { name: "Move to trash" }).click();
  expect(await chapters()).toEqual(["Chapter One"]);
  expect(await trashCount()).toBe(1);
  await undo.click();
  expect(await chapters()).toEqual(["Chapter One", "Chapter 2"]);
  expect(await trashCount()).toBe(0);
  await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter 2");
  await expect(redo).toBeEnabled();
  await redo.click();
  expect(await chapters()).toEqual(["Chapter One"]);
  expect(await trashCount()).toBe(1);

  // Keyboard: Mod+Alt+Z undoes the book edit; Mod+Z in the editor only undoes typing.
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" typed");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter One");
  expect(await chapters()).toEqual(["Chapter One"]); // editor undo did not touch the tree
  await page.keyboard.press("ControlOrMeta+Alt+z");
  await expect(page.getByRole("button", { name: "Chapter 2", exact: true })).toBeVisible();
  expect(await chapters()).toEqual(["Chapter One", "Chapter 2"]);
  await page.keyboard.press("ControlOrMeta+Alt+Shift+z");
  await expect(page.getByRole("button", { name: "Chapter 2", exact: true })).toHaveCount(0);
  expect(await trashCount()).toBe(1);

  // Undoing an add trashes, never deletes.
  await page.getByRole("button", { name: "Add chapter" }).click();
  await expect(redo).toBeDisabled();
  await undo.click();
  await expect.poll(trashCount).toBe(2);
});

test("History compares an earlier version with the current text and restores it", async ({
  page,
}) => {
  await newProject(page);
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("Marta walked home");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved");
  const { file } = await seedSnapshot(page, "Ilse walked home");

  await chapterAction(page, "Chapter One", "History");
  const dialog = page.getByRole("dialog", { name: "History · Chapter One" });
  await expect(dialog.locator("ins", { hasText: "Ilse" })).toBeVisible();
  await expect(dialog.locator("del", { hasText: "Marta" })).toBeVisible();
  await expect(
    dialog.getByRole("list", { name: "Earlier versions" }).getByRole("button"),
  ).toHaveCount(1);

  await dialog.getByRole("button", { name: "Restore this version" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(".ProseMirror")).toContainText("Ilse walked home");
  const kept = await page.evaluate(
    (f) => window.__disk[`.cadabra/backups/20261027-2359-${f.replaceAll("/", "__")}`],
    file,
  );
  expect(kept).toContain("Marta walked home");
});

test("History says so when a page has no earlier versions", async ({ page }) => {
  await newProject(page);
  await chapterAction(page, "Chapter One", "History");
  await expect(page.getByRole("dialog", { name: "History · Chapter One" })).toContainText(
    "No earlier versions yet",
  );
});

test("a page with a newer snapshot than its saved text is offered for recovery when the book opens", async ({
  page,
}) => {
  await newProject(page);
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("older text on disk");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved");
  const { file, path } = await seedSnapshot(page, "the newer text");
  await page.evaluate((x) => sessionStorage.setItem("stale", JSON.stringify([x])), {
    path: file,
    snapshot: path,
  });
  await page.reload();
  await page.getByRole("button", { name: "Open folder" }).click();

  const dialog = page.getByRole("dialog", { name: "Recover newer text for “Chapter One”?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Keep saved text" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(".ProseMirror")).toContainText("older text on disk");

  await page.evaluate(() => sessionStorage.setItem("stale", sessionStorage.getItem("stale")!));
  await page.reload();
  await page.getByRole("button", { name: "Open folder" }).click();
  await page
    .getByRole("dialog", { name: "Recover newer text for “Chapter One”?" })
    .getByRole("button", { name: "Use newer text" })
    .click();
  await expect(page.locator(".ProseMirror")).toContainText("the newer text");
});
