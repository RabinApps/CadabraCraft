import { expect, test } from "./support/coverage";
import { answer, covBackend, failOn, stopFailing } from "./support/cov";
import { seedBookSnapshots } from "./support/bookSnapshots";
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
  await items.first().getByRole("button").first().click();
  await dialog.getByRole("button", { name: "Restore whole book" }).click();
  await page
    .getByRole("dialog", { name: "Restore the whole book?" })
    .getByRole("button", { name: "Restore whole book" })
    .click();
  await expect(page.getByRole("button", { name: "Chapter 2", exact: true })).toBeVisible();

  // Delete the named snapshot; the confirmation can be cancelled first.
  dialog = await openBookSnapshots(page);
  await items.last().getByRole("button").first().click();
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

const MB = 1024 * 1024;
const snapshotList = (dialog: import("@playwright/test").Locator) =>
  dialog.getByRole("list", { name: "Book snapshots" });

test("the list shows how many snapshots there are and their size, with Named, Automatic and Pinned badges", async ({
  page,
}) => {
  await newProject(page);
  const names = Array.from({ length: 12 }, (_, i) => `Snapshot ${i + 1}`);
  await seedBookSnapshots(
    page,
    names.map((name, i) => ({
      name,
      automatic: i === 3,
      pinned: i === 5,
      padBytes: i === 11 ? 10 * MB : 30 * MB,
    })),
  );
  const dialog = await openBookSnapshots(page);
  await expect(dialog.getByText("12 snapshots · 340 MB")).toBeVisible();
  const items = snapshotList(dialog).getByRole("listitem");
  await expect(items).toHaveCount(12);
  await expect(items.nth(0)).toContainText("Named");
  await expect(items.nth(8)).toContainText("Automatic"); // Snapshot 4, the 4th oldest
  await expect(items.nth(8)).not.toContainText("Named");
  await expect(items.nth(6)).toContainText("Pinned"); // Snapshot 6
  await expect(items.nth(6)).toContainText("Named");
  await expect(items.nth(0)).not.toContainText("Pinned");
});

test("pinning a snapshot toggles Pinned, is kept on disk and a failure is shown", async ({
  page,
}) => {
  await newProject(page);
  const [path] = await seedBookSnapshots(page, [{ name: "Keep me" }]);
  const dialog = await openBookSnapshots(page);
  const pin = dialog.getByRole("button", { name: "Pin Keep me" });
  await expect(pin).toHaveAttribute("aria-pressed", "false");
  await pin.click();
  await expect(pin).toHaveAttribute("aria-pressed", "true");
  await expect(snapshotList(dialog)).toContainText("Pinned");
  expect(await page.evaluate((k) => window.__disk[k], path!)).toContain('"pinned":true');
  await pin.click();
  await expect(pin).toHaveAttribute("aria-pressed", "false");
  await expect(snapshotList(dialog)).not.toContainText("Pinned");
  await failOn(page, "pin_book_snapshot", { kind: "permission_denied", path: "x" });
  await pin.click();
  await expect(dialog.getByRole("alert")).toContainText("Could not change the pin");
});

test("Rename: Enter saves, Escape cancels without closing the dialog, focus returns, errors are shown", async ({
  page,
}) => {
  await newProject(page);
  const [path] = await seedBookSnapshots(page, [{ name: "Draft one", automatic: true }]);
  const dialog = await openBookSnapshots(page);
  await expect(snapshotList(dialog)).toContainText("Automatic");
  const rename = dialog.getByRole("button", { name: "Rename Draft one" });
  await rename.click();
  const field = dialog.getByLabel("New name");
  await expect(field).toBeFocused();
  await expect(field).toHaveValue("Draft one");

  // Escape cancels the edit only.
  await field.fill("Throwaway");
  await page.keyboard.press("Escape");
  await expect(field).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(rename).toBeFocused();
  await expect(snapshotList(dialog)).toContainText("Draft one");

  // An empty name is refused in place.
  await rename.click();
  await field.fill("   ");
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("alert")).toContainText("The snapshot has no name");
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute("aria-invalid", "true");

  // A failure from the backend keeps the field and the typed name.
  await field.fill("Final draft");
  await failOn(page, "rename_book_snapshot", { kind: "invalid_file_name" });
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("alert")).toContainText("Could not rename the snapshot");
  await expect(field).toHaveValue("Final draft");
  await stopFailing(page, "rename_book_snapshot");

  // Enter saves; an automatic snapshot becomes a named one.
  await page.keyboard.press("Enter");
  await expect(field).toHaveCount(0);
  await expect(snapshotList(dialog)).toContainText("Final draft");
  await expect(snapshotList(dialog)).toContainText("Named");
  await expect(snapshotList(dialog)).not.toContainText("Automatic");
  await expect(dialog.getByRole("button", { name: "Rename Final draft" })).toBeFocused();
  expect(await page.evaluate((k) => window.__disk[k], path!)).toContain('"name":"Final draft"');

  // Save and Cancel are buttons too.
  await dialog.getByRole("button", { name: "Rename Final draft" }).click();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(field).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Rename Final draft" })).toBeFocused();
});

test("taking a snapshot passes the limits from Settings and tells the author what moved to the trash", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "cadabracraft.settings",
      JSON.stringify({ typewriterScroll: false, bookSnapshotKeep: 5, bookSnapshotMaxMb: 200 }),
    ),
  );
  await newProject(page);
  await seedBookSnapshots(
    page,
    ["Auto A", "Auto B", "Mine", "Pinned one", "Auto C"].map((name, i) => ({
      name,
      automatic: name.startsWith("Auto"),
      pinned: i === 3,
    })),
  );
  const dialog = await openBookSnapshots(page);
  await dialog.getByLabel("Snapshot name").fill("Sixth");
  await dialog.getByRole("button", { name: "Take snapshot" }).click();
  await expect(dialog.getByRole("status")).toHaveText("1 older snapshot moved to .cadabra/trash");
  await expect(snapshotList(dialog).getByRole("listitem")).toHaveCount(5);
  await expect(snapshotList(dialog)).not.toContainText("Auto A"); // the oldest automatic one went first
  await expect(snapshotList(dialog)).toContainText("Pinned one");
  expect(await keys(page, ".cadabra/trash/")).toHaveLength(1);
  expect(await keys(page, ".cadabra/snapshots/")).toHaveLength(5);

  // Taking another one clears the earlier notice, and the plural form is used.
  await dialog.getByLabel("Snapshot name").fill("Seventh");
  await dialog.getByRole("button", { name: "Take snapshot" }).click();
  await expect(dialog.getByRole("status")).toHaveText("1 older snapshot moved to .cadabra/trash");
  await expect(snapshotList(dialog)).toContainText("Seventh");
});

test("a pinned snapshot that moved to the trash is a warning of its own", async ({ page }) => {
  await newProject(page);
  const [path] = await seedBookSnapshots(page, [{ name: "Big pinned", pinned: true }]);
  const dialog = await openBookSnapshots(page);
  await answer(page, "create_book_snapshot", {
    path,
    pruned: { moved: 3, pinned_moved: [".cadabra/snapshots/a.json"] },
  });
  await dialog.getByLabel("Snapshot name").fill("Another");
  await dialog.getByRole("button", { name: "Take snapshot" }).click();
  await expect(dialog.getByRole("status")).toHaveText("2 older snapshots moved to .cadabra/trash");
  await expect(dialog.getByRole("alert")).toContainText(
    "1 pinned snapshot moved to .cadabra/trash",
  );
  await expect(dialog.getByRole("alert")).toContainText("raise the size limit in Settings");
});

test("on a phone the rows and the rename field fit the dialog", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await newProject(page);
  await seedBookSnapshots(page, [
    { name: "A snapshot with quite a long name that has to wrap on a narrow screen", pinned: true },
    { name: "Second", automatic: true },
  ]);
  await page.getByRole("button", { name: "Show chapters" }).click();
  await page
    .getByRole("dialog", { name: "Chapters" })
    .getByRole("button", { name: "Book snapshots" })
    .click();
  const dialog = page.getByRole("dialog", { name: "History · Whole book" });
  await expect(dialog.getByRole("button", { name: /^Rename A snapshot/ })).toBeVisible();
  const fits = () =>
    page.evaluate(() => {
      const d = document.querySelector("[role=dialog]")!;
      return (
        d.scrollWidth <= d.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth + 1
      );
    });
  expect(await fits()).toBe(true);
  await dialog.getByRole("button", { name: /^Rename A snapshot/ }).click();
  await expect(dialog.getByLabel("New name")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Save" })).toBeVisible();
  expect(await fits()).toBe(true);
  const box = await dialog.getByRole("button", { name: "Save" }).boundingBox();
  expect(box && box.height >= 44).toBe(true); // a touch target
});

test("RTL: the rows mirror, with the pin and rename buttons at the end of the row", async ({
  page,
}) => {
  await newProject(page);
  await seedBookSnapshots(page, [{ name: "Mirror" }]);
  const dialog = await openBookSnapshots(page);
  await page.evaluate(() => {
    document.documentElement.dir = "rtl";
  });
  const pick = await dialog.getByRole("button", { name: /^Mirror/ }).boundingBox();
  const pin = await dialog.getByRole("button", { name: "Pin Mirror" }).boundingBox();
  const rename = await dialog.getByRole("button", { name: "Rename Mirror" }).boundingBox();
  // Right to left: the name first (rightmost), then Pin, then Rename.
  expect(pick && pin && rename && pick.x > pin.x && pin.x > rename.x).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
});
