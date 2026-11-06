import { expect, test, type Page } from "../support/coverage";
import { covBackend, failOn, reopen, stopFailing } from "../support/cov";
import { fakeTauri } from "../support/fakeTauri";
import { addPage, chapterAction, newProject, seedSnapshot, sidebar } from "../support/helpers";
import { contains, expectAlert, expectFieldError } from "../support/a11yErrors";

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
  await covBackend(page);
});

test.describe("contents", () => {
  const open = async (page: Page) => {
    await newProject(page);
    await addPage(page, "Contents");
    const contents = page.getByRole("region", { name: "Contents", exact: true });
    await contents.getByRole("button", { name: "Add custom entry" }).click();
    return { contents, dialog: page.getByRole("dialog", { name: "Add custom entry" }) };
  };

  test("Add custom entry: an empty title is an alert tied to the field, which takes focus and says what to type", async ({
    page,
  }) => {
    const { contents, dialog } = await open(page);
    const field = dialog.getByLabel("Entry title");
    await expect(field).not.toHaveAttribute("aria-invalid", "true");
    // The button is not dead: pressing it explains what is missing.
    await expect(dialog.getByRole("button", { name: "Add entry" })).toBeEnabled();
    await dialog.getByLabel("Place after").focus();
    await dialog.getByRole("button", { name: "Add entry" }).click();
    await expectFieldError(
      field,
      dialog.getByRole("alert"),
      "The entry has no title.",
      "Type the name that should appear in the contents.",
    );
    // Spaces are no title either.
    await field.fill("   ");
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    await page.keyboard.press("Enter");
    await expectFieldError(
      field,
      dialog.getByRole("alert"),
      "The entry has no title.",
      "Type the name that should appear in the contents.",
    );
    await expect(contents.getByRole("listitem").filter({ hasText: "Custom" })).toHaveCount(0);
    // Typing clears the error, and the entry is added.
    await field.fill("Afterword");
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    await expect(field).not.toHaveAttribute("aria-invalid", "true");
    await page.keyboard.press("Enter");
    await expect(dialog).toHaveCount(0);
    await expect(contents.getByRole("listitem").filter({ hasText: "Afterword" })).toBeVisible();
  });

  test("Add custom entry: a cancelled form starts empty the next time", async ({ page }) => {
    const { contents, dialog } = await open(page);
    await dialog.getByLabel("Entry title").fill("Draft");
    await dialog.getByRole("button", { name: "Add entry" }).focus();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await contents.getByRole("button", { name: "Add custom entry" }).click();
    await expect(dialog.getByLabel("Entry title")).toHaveValue("");
    await dialog.getByRole("button", { name: "Add entry" }).click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await page.keyboard.press("Escape");
    await contents.getByRole("button", { name: "Add custom entry" }).click();
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    await expect(dialog.getByLabel("Entry title")).not.toHaveAttribute("aria-invalid", "true");
  });

  test("Contents preview: a preview that cannot be drawn is an alert with a Retry button", async ({
    page,
  }) => {
    await newProject(page);
    await page.evaluate(() => {
      window.__compileError = { kind: "compile", message: "main.typ:4:2: error: boom" };
    });
    await addPage(page, "Contents");
    const alert = page.getByRole("region", { name: "Preview", exact: true }).getByRole("alert");
    await expect(alert).toContainText("Could not draw the preview", { timeout: 15_000 });
    await expect(alert).toContainText("boom");
    await expect(alert.getByRole("button", { name: "Retry" })).toBeVisible();
    // The status line next to the title is a polite live region, so the failure is also spoken there.
    await expect(
      page.getByTestId("toc-preview-status").locator("xpath=ancestor::*[@aria-live][1]"),
    ).toHaveAttribute("aria-live", "polite");
  });
});

test.describe("home and settings", () => {
  test("New book: the folder picker failing is an alert, and Create stays unavailable until the book has a title and folder", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "New project" }).click();
    const dialog = page.getByRole("dialog", { name: "New book" });
    await expect(dialog.getByRole("button", { name: "Create book" })).toBeDisabled();
    await failOn(page, "pick_folder", "The folder cannot be used");
    await dialog.getByRole("button", { name: "Choose…" }).click();
    await expectAlert(dialog.getByRole("alert"), "The folder cannot be used");
    await expect(dialog.getByRole("alert")).toContainText("Try again.");
  });

  test("Home: a book whose folder is gone says so on its card and offers the way out", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        "cadabracraft.recents",
        JSON.stringify([
          { root: "/gone", title: "Moved Book", openedAt: 2 },
          { root: "/proj", title: "E2E Book", openedAt: 1 },
        ]),
      );
    });
    await page.goto("/");
    const recent = page.getByRole("region", { name: "Recent projects" });
    await recent
      .getByRole("button", { name: /Moved Book/ })
      .first()
      .click();
    await expectAlert(recent.getByRole("alert"), "Remove it from the list or move it back.");
    await expect(
      page.getByRole("button", { name: "Remove Moved Book from recent projects" }),
    ).toBeVisible();
  });

  test("Settings, Fonts: a font that cannot be read is an alert that names the file types to choose", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Settings" }).click();
    await page
      .getByRole("navigation", { name: "Settings sections" })
      .getByRole("button", { name: "Fonts" })
      .click();
    await page.evaluate(() => {
      window.__fontImportError = { kind: "invalid_font", message: "no family name" };
    });
    await page.getByRole("button", { name: "Choose file…" }).click();
    await expectAlert(page.getByRole("alert"), "Choose a .ttf or .otf file.");
  });

  test("Settings, Fonts: a failed download is an alert in the catalog and the button can be used again", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Settings" }).click();
    await page
      .getByRole("navigation", { name: "Settings sections" })
      .getByRole("button", { name: "Fonts" })
      .click();
    await page.evaluate(() => {
      window.__fontError = { kind: "network", message: "offline" };
    });
    await page.getByRole("button", { name: "Browse fonts…" }).click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByRole("button", { name: /^Download/ })
      .first()
      .click();
    await expectAlert(dialog.getByRole("alert"), /\w+ \w+ \w+/);
    await expect(dialog.getByRole("button", { name: /^(Download|Retry)/ }).first()).toBeEnabled();
  });
});

test.describe("history, trash, recover and language", () => {
  const diskFull = { kind: "disk_full", path: "chapters/chapter-1.json" };

  test("Settings, Interface language: a language that cannot be loaded is an alert tied to the picker, and the old language stays", async ({
    page,
  }) => {
    await page.route(/locales\/de\/messages\.po/, (route) => route.abort());
    await page.goto("/");
    await page.getByRole("button", { name: "Settings" }).click();
    const picker = page.getByLabel("Interface language");
    await expect(picker).not.toHaveAttribute("aria-invalid", "true");
    await picker.selectOption("de");
    const alert = page.getByRole("alert").filter({ hasText: "Could not load" });
    await expectAlert(alert, "Could not load Deutsch.");
    await expect(alert).toContainText("Choose it again, or pick another language.");
    await expect(picker).toHaveAttribute("aria-invalid", "true");
    await expect(picker).toHaveAccessibleDescription(contains("Could not load Deutsch."));
    // The language did not change, and the picker still shows the one in use.
    await expect(picker).toHaveValue("en");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    // A language that loads clears the message.
    await picker.selectOption("pseudo");
    await expect(page.getByRole("alert").filter({ hasText: "Could not load" })).toHaveCount(0);
    await expect(picker).not.toHaveAttribute("aria-invalid", "true");
  });

  test("History: a version that cannot be restored is an alert that says the text is unchanged and what to try, and the button stays focused", async ({
    page,
  }) => {
    await newProject(page);
    await seedSnapshot(page, "older words");
    await chapterAction(page, "Chapter One", "History");
    const dialog = page.getByRole("dialog", { name: "History · Chapter One" });
    const restore = dialog.getByRole("button", { name: "Restore this version" });
    await expect(restore).toBeEnabled();
    await failOn(page, "restore_page_snapshot", diskFull);
    await restore.focus(); // Safari does not focus a button on click, so activate it from the keyboard
    await page.keyboard.press("Enter");
    const alert = dialog.getByRole("alert");
    await expectAlert(alert, "Could not restore this version");
    await expect(alert).toContainText("There is no space left on the disk");
    await expect(alert).toContainText("Your current text was not changed.");
    await expect(alert).toContainText("Try again, or pick another version.");
    await expect(restore).toHaveAccessibleDescription(contains("Could not restore this version"));
    await expect(restore).toBeFocused();
    await stopFailing(page, "restore_page_snapshot");
    await restore.click();
    await expect(dialog).toHaveCount(0);
  });

  test("History: a list that cannot be read is an alert that says how to retry", async ({
    page,
  }) => {
    await newProject(page);
    await failOn(page, "list_page_snapshots", { kind: "io", message: "listing broke" });
    await chapterAction(page, "Chapter One", "History");
    const dialog = page.getByRole("dialog", { name: "History · Chapter One" });
    await expectAlert(
      dialog.getByRole("alert"),
      "Could not load the earlier versions (listing broke)",
    );
    await expect(dialog.getByRole("alert")).toContainText("open History again to retry");
  });

  test("Trash: a page that cannot be restored is an alert tied to its button that says it is still in the trash", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await newProject(page);
    await page.getByRole("button", { name: "Add chapter" }).click();
    await chapterAction(page, "Chapter 2", "Move to trash");
    await page.getByRole("dialog").getByRole("button", { name: "Move to trash" }).click();
    await page.getByRole("button", { name: "Trash", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Trash" });
    const restore = dialog.getByRole("button", { name: "Restore Chapter 2" });
    await failOn(page, "restore_project_trash", { kind: "cannot_restore", path: "x" });
    await restore.focus();
    await page.keyboard.press("Enter");
    const alert = dialog.getByRole("alert");
    await expectAlert(alert, "Could not restore Chapter 2");
    await expect(alert).toContainText(
      "It is still in the trash. Try again, or restore another page.",
    );
    await expect(restore).toHaveAccessibleDescription(contains("Could not restore Chapter 2"));
    await expect(restore).toBeFocused();
    await stopFailing(page, "restore_project_trash");
    await restore.click();
    await expect(dialog).toHaveCount(0);
    await expect(
      sidebar(page).getByRole("button", { name: "Chapter 2", exact: true }),
    ).toBeVisible();
  });

  test("Trash: a trash that cannot be read is an alert that says how to retry", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await newProject(page);
    await failOn(page, "list_project_trash", { kind: "io", message: "Trash unreadable" });
    await page.getByRole("button", { name: "Trash", exact: true }).click();
    const alert = page.getByRole("dialog", { name: "Trash" }).getByRole("alert");
    await expectAlert(alert, "Could not read the trash (Trash unreadable)");
    await expect(alert).toContainText("open the trash again to retry");
  });

  test("Recover: newer text that cannot be used is an alert tied to the button that says the saved text is unchanged", async ({
    page,
  }) => {
    await newProject(page);
    const { file, path } = await seedSnapshot(page, "the newer text");
    await page.evaluate((x) => sessionStorage.setItem("stale", JSON.stringify([x])), {
      path: file,
      snapshot: path,
    });
    await reopen(page, () => {}, null);
    const dialog = page.getByRole("dialog", { name: "Recover newer text for “Chapter One”?" });
    const use = dialog.getByRole("button", { name: "Use newer text" });
    await failOn(page, "restore_page_snapshot", diskFull);
    await use.focus();
    await page.keyboard.press("Enter");
    const alert = dialog.getByRole("alert");
    await expectAlert(alert, "Could not use the newer text");
    await expect(alert).toContainText("Your saved text was not changed.");
    await expect(alert).toContainText("Try again, or choose Keep saved text.");
    await expect(use).toHaveAccessibleDescription(contains("Could not use the newer text"));
    await expect(use).toBeFocused();
    await stopFailing(page, "restore_page_snapshot");
    await use.click();
    await expect(dialog).toHaveCount(0);
  });
});
