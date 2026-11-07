import { expect, test } from "./support/coverage";
import { covBackend, failOn, stopFailing } from "./support/cov";
import { fakeTauri } from "./support/fakeTauri";
import { chapterAction, manifestOf, newProject, sidebar, focusEnd } from "./support/helpers";

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
  await covBackend(page);
});

const openBookSnapshots = async (page: import("@playwright/test").Page) => {
  await sidebar(page).getByRole("button", { name: "Book snapshots" }).click();
  return page.getByRole("dialog", { name: "History · Whole book" });
};

const keys = (page: import("@playwright/test").Page, prefix: string) =>
  page.evaluate((p) => Object.keys(window.__disk).filter((k) => k.startsWith(p)), prefix);

test("a named snapshot is taken, listed, restored for the whole book and deleted", async ({
  page,
}) => {
  await newProject(page);
  await focusEnd(page);
  await page.keyboard.type(" and the first draft");
  let dialog = await openBookSnapshots(page);
  await expect(dialog).toContainText("No book snapshots yet");
  const take = dialog.getByRole("button", { name: "Take snapshot" });
  await expect(take).toBeEnabled();
  await dialog.getByLabel("Snapshot name").fill("Before the rewrite");
  await take.click();
  const list = dialog.getByRole("list", { name: "Book snapshots" });
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await expect(list).toContainText("Before the rewrite");
  await expect(list).toContainText("1 page · 0 images");
  await expect(dialog.getByLabel("Snapshot name")).toHaveValue("");
  // The unsaved typing was saved first, so the snapshot holds it.
  const snap = (await keys(page, ".cadabra/snapshots/"))[0]!;
  expect(await page.evaluate((k) => window.__disk[k], snap)).toContain("and the first draft");
  await page.keyboard.press("Escape");

  // Change the book: another chapter, and different text in the first.
  await page.getByRole("button", { name: "Add chapter" }).click();
  await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter 2");
  await page.getByRole("button", { name: "Chapter One", exact: true }).click();
  await focusEnd(page);
  await page.keyboard.type(" plus a rewrite");
  await expect(page.getByRole("button", { name: "Chapter 2", exact: true })).toBeVisible();

  dialog = await openBookSnapshots(page);
  await dialog.getByRole("button", { name: "Restore whole book" }).click();
  const confirm = page.getByRole("dialog", { name: "Restore the whole book?" });
  await expect(confirm).toContainText("“Before the rewrite”");
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toBeHidden();
  expect((await manifestOf(page)).chapters).toHaveLength(2); // cancelling changed nothing
  await dialog.getByRole("button", { name: "Restore whole book" }).click();
  await page
    .getByRole("dialog", { name: "Restore the whole book?" })
    .getByRole("button", { name: "Restore whole book" })
    .click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Chapter 2", exact: true })).toHaveCount(0);
  await expect(page.locator(".ProseMirror")).toContainText("and the first draft");
  await expect(page.locator(".ProseMirror")).not.toContainText("plus a rewrite");
  await expect(
    page.getByText("1 page that was not in the snapshot is in the trash."),
  ).toBeVisible();
  // The book as it was before the restore is an automatic snapshot, and the new chapter is in the trash.
  expect(await keys(page, ".cadabra/trash/")).toHaveLength(1);
  dialog = await openBookSnapshots(page);
  const items = dialog.getByRole("list", { name: "Book snapshots" }).getByRole("listitem");
  await expect(items).toHaveCount(2);
  await expect(items.first()).toContainText("Before restoring Before the rewrite");
  await expect(items.first()).toContainText("Automatic");
  await expect(items.first()).toContainText("2 pages");

  // Going back is a restore of that automatic snapshot.
  await items.first().getByRole("button").click();
  await dialog.getByRole("button", { name: "Restore whole book" }).click();
  await page
    .getByRole("dialog", { name: "Restore the whole book?" })
    .getByRole("button", { name: "Restore whole book" })
    .click();
  await expect(page.getByRole("button", { name: "Chapter 2", exact: true })).toBeVisible();

  // Delete the named snapshot; the confirmation can be cancelled first.
  dialog = await openBookSnapshots(page);
  await dialog.getByRole("list", { name: "Book snapshots" }).getByRole("button").last().click();
  await dialog.getByRole("button", { name: "Delete snapshot" }).click();
  await page
    .getByRole("dialog", { name: "Delete this snapshot?" })
    .getByRole("button", { name: "Cancel" })
    .click();
  expect(await keys(page, ".cadabra/snapshots/")).toHaveLength(3);
  await dialog.getByRole("button", { name: "Delete snapshot" }).click();
  await page
    .getByRole("dialog", { name: "Delete this snapshot?" })
    .getByRole("button", { name: "Delete snapshot" })
    .click();
  await expect(
    dialog.getByRole("list", { name: "Book snapshots" }).getByRole("listitem"),
  ).toHaveCount(2);
  expect(await keys(page, ".cadabra/snapshots/")).toHaveLength(2);
});

test("Enter in the name field takes the snapshot, and does nothing while the name is empty", async ({
  page,
}) => {
  await newProject(page);
  const dialog = await openBookSnapshots(page);
  const field = dialog.getByLabel("Snapshot name");
  await field.focus();
  await page.keyboard.press("Enter");
  await expect(dialog).toContainText("No book snapshots yet");
  await field.fill("By keyboard");
  await page.keyboard.press("Enter");
  const list = dialog.getByRole("list", { name: "Book snapshots" });
  await expect(list).toContainText("By keyboard");
  expect(await keys(page, ".cadabra/snapshots/")).toHaveLength(1);
});

test("History of a chapter has a Whole book view that restores just that chapter", async ({
  page,
}) => {
  await newProject(page);
  await focusEnd(page);
  await page.keyboard.type(" old words");
  await chapterAction(page, "Chapter One", "History");
  const dialog = page.getByRole("dialog", { name: "History · Chapter One" });
  await dialog.getByRole("radio", { name: "Whole book" }).click();
  await dialog.getByLabel("Snapshot name").fill("v1");
  await dialog.getByRole("button", { name: "Take snapshot" }).click();
  await expect(dialog.getByRole("list", { name: "Book snapshots" })).toContainText("v1");
  await dialog.getByRole("radio", { name: "This page" }).click();
  await expect(dialog).toContainText("No earlier versions yet");
  await dialog.getByRole("radio", { name: "Whole book" }).click();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Add chapter" }).click();
  await page.getByRole("button", { name: "Chapter One", exact: true }).click();
  await focusEnd(page);
  await page.keyboard.type(" new words");
  await chapterAction(page, "Chapter One", "History");
  await dialog.getByRole("radio", { name: "Whole book" }).click();
  await dialog.getByRole("button", { name: "Restore this page only" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(".ProseMirror")).toContainText("old words");
  await expect(page.locator(".ProseMirror")).not.toContainText("new words");
  await expect(page.getByRole("button", { name: "Chapter 2", exact: true })).toBeVisible(); // the rest of the book is as it was
  await expect(
    page.getByText("from a book snapshot. The text it replaced is kept in History."),
  ).toBeVisible();
});

test("a failed snapshot or restore is shown in the dialog and nothing else changes", async ({
  page,
}) => {
  await newProject(page);
  let dialog = await openBookSnapshots(page);
  await dialog.getByLabel("Snapshot name").fill("v1");
  await failOn(page, "create_book_snapshot", { kind: "disk_full", path: ".cadabra/snapshots" });
  await dialog.getByRole("button", { name: "Take snapshot" }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await stopFailing(page, "create_book_snapshot");
  await dialog.getByLabel("Snapshot name").press("Enter"); // the form submits
  await expect(
    dialog.getByRole("list", { name: "Book snapshots" }).getByRole("listitem"),
  ).toHaveCount(1);

  await failOn(page, "restore_book_snapshot", { kind: "cannot_restore", path: "x" });
  await dialog.getByRole("button", { name: "Restore whole book" }).click();
  await page
    .getByRole("dialog", { name: "Restore the whole book?" })
    .getByRole("button", { name: "Restore whole book" })
    .click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog).toBeVisible();
  await stopFailing(page, "restore_book_snapshot");
  await failOn(page, "list_book_snapshots", "listing broke");
  await page.keyboard.press("Escape");
  dialog = await openBookSnapshots(page);
  await expect(dialog.getByRole("alert")).toContainText(
    "Could not read the book snapshots (listing broke)",
  );
});
