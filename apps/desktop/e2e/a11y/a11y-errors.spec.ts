import { expect, test, type Locator, type Page } from "../support/coverage";
import { answer, covBackend, failOn, menu, reopen, stopFailing } from "../support/cov";
import { fakeImportSources } from "../support/fakeImport";
import { fakeTauri } from "../support/fakeTauri";
import { addPage, chapterAction, newProject, seedSnapshot, sidebar } from "../support/helpers";

// WCAG 3.3.1 Error Identification, 3.3.3 Error Suggestion and 4.1.3 Status Messages: when the app refuses input, the
// error is text (never colour alone), it is announced (role=alert/status), the field at fault is aria-invalid and
// described by the message, focus lands on that field, and the message (or the field's hint) says how to fix it.
// The Link dialog's alert is also covered in the VoiceOver run (e2e-voiceover/areas/writing.ts).

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
  await covBackend(page);
});

const pm = (page: Page) => page.locator(".ProseMirror");
const run = (page: Page, id: string) =>
  page.evaluate(async (c) => {
    (await import("/src/state/commands.ts" as string)).runCommand(c);
  }, id);

/** Types `text` in the last paragraph and selects it. */
async function typeAndSelect(page: Page, text: string) {
  await pm(page).locator("p").last().click();
  await page.keyboard.type(text);
  await page.evaluate(() => {
    const r = document.createRange();
    r.selectNodeContents([...document.querySelectorAll(".ProseMirror p")].pop()!);
    const sel = getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
  });
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
}

/** A text or pattern matched anywhere in an accessible description (which joins the message and the hint). */
const contains = (text: string | RegExp) =>
  typeof text === "string" ? new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) : text;

/** The message is words a person can read, announced as an alert. */
async function expectAlert(alert: Locator, message: string | RegExp) {
  await expect(alert).toBeVisible();
  await expect(alert).toContainText(message);
  expect((await alert.innerText()).trim().split(/\s+/).length).toBeGreaterThan(2);
}

/**
 * A refused field: the alert says what is wrong, the field is aria-invalid and described by the message (plus its hint,
 * which holds the fix when the message does not), and focus is on the field. `fix` is what the description must offer.
 */
async function expectFieldError(
  field: Locator,
  alert: Locator,
  message: string | RegExp,
  fix: string | RegExp,
) {
  await expectAlert(alert, message);
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(field).toHaveAccessibleDescription(contains(message));
  await expect(field).toHaveAccessibleDescription(contains(fix));
  await expect(field).toBeFocused();
}

test.describe("editor dialogs", () => {
  test("Link: a refused address is an alert tied to the field, which takes focus and says what to use", async ({
    page,
  }) => {
    await newProject(page);
    await typeAndSelect(page, "click me");
    await page
      .getByRole("toolbar", { name: "Formatting" })
      .getByRole("button", { name: "Link", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Add link" });
    const field = dialog.getByLabel("Address");
    await expect(field).not.toHaveAttribute("aria-invalid", "true");
    await field.fill("javascript:alert(1)");
    await dialog.getByRole("button", { name: "Apply" }).click();
    await expectFieldError(
      field,
      dialog.getByRole("alert"),
      "can't be used as a link",
      "Use http, https or mailto.",
    );
    await expect(dialog).toBeVisible();
    // Fixing the address clears the error and the invalid state.
    await field.fill("https://example.com");
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    await expect(field).not.toHaveAttribute("aria-invalid", "true");
  });

  test("Link: applying with nothing selected is an alert that says to select text", async ({
    page,
  }) => {
    await newProject(page);
    await pm(page).locator("p").last().click();
    await page
      .getByRole("toolbar", { name: "Formatting" })
      .getByRole("button", { name: "Link", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Add link" });
    await dialog.getByLabel("Address").fill("https://example.com");
    await dialog.getByRole("button", { name: "Apply" }).click();
    await expectAlert(dialog.getByRole("alert"), "Select the text you want to link first.");
  });

  test("Language of selection: a bad tag is an alert tied to the tag field, with an example", async ({
    page,
  }) => {
    await newProject(page);
    await typeAndSelect(page, "Bonjour");
    await run(page, "editor.lang");
    const dialog = page.getByRole("dialog", { name: "Language of selection" });
    const field = dialog.getByLabel("Language tag");
    await field.fill("not a tag!");
    await dialog.getByRole("button", { name: "Apply" }).click();
    await expectFieldError(
      field,
      dialog.getByRole("alert"),
      /Use letters, digits and single hyphens/,
      "for example fr-CA",
    );
    await field.fill("fr-CA");
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    await expect(field).not.toHaveAttribute("aria-invalid", "true");
  });

  test("Add image: no description is an alert tied to the description field, which says what to do", async ({
    page,
  }) => {
    await newProject(page);
    await pm(page).locator("p").last().click();
    await page
      .getByRole("toolbar", { name: "Formatting" })
      .getByRole("button", { name: "Image", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Add image" });
    const field = dialog.getByLabel("Description (alt text)");
    await dialog.getByLabel("Caption").focus();
    await dialog.getByRole("button", { name: "Insert" }).click();
    await expectFieldError(
      field,
      dialog.getByRole("alert"),
      /Describe the image, or tick/,
      "Describe what the picture shows.",
    );
    await dialog.getByRole("checkbox", { name: "This image is decorative" }).check();
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    await expect(field).not.toHaveAttribute("aria-invalid", "true");
  });

  test("Add image: a file that cannot be copied is announced as an alert with the reason", async ({
    page,
  }) => {
    await newProject(page);
    await page.evaluate(() => {
      window.__importError = "pic.png is larger than 25 MB";
    });
    await pm(page).locator("p").last().click();
    await page
      .getByRole("toolbar", { name: "Formatting" })
      .getByRole("button", { name: "Image", exact: true })
      .click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Could not add the image" }),
    ).toContainText("pic.png is larger than 25 MB");
  });

  test("Insert table: a size out of range is an alert tied to the field and says the range", async ({
    page,
  }) => {
    await newProject(page);
    await pm(page).locator("p").last().click();
    await run(page, "editor.table");
    const dialog = page.getByRole("dialog", { name: "Insert table" });
    const rows = dialog.getByLabel("Rows");
    await rows.fill("99");
    await dialog.getByRole("button", { name: "Insert" }).click();
    await expectFieldError(
      rows,
      dialog.getByRole("alert"),
      "Use a whole number from 1 to 50.",
      "Up to 50 rows.",
    );
    await expect(pm(page).locator("table")).toHaveCount(0);

    await rows.fill("4");
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    const columns = dialog.getByLabel("Columns");
    await columns.fill("0");
    await dialog.getByRole("button", { name: "Insert" }).click();
    await expectFieldError(
      columns,
      dialog.getByRole("alert"),
      "Use a whole number from 1 to 8.",
      "Up to 8 columns.",
    );
    await expect(rows).not.toHaveAttribute("aria-invalid", "true");

    await columns.fill("2");
    await dialog.getByRole("button", { name: "Insert" }).click();
    await expect(pm(page).locator("tr")).toHaveCount(4);
  });
});

test.describe("find and chapters", () => {
  test("Find: an invalid pattern is announced politely and describes the field", async ({
    page,
  }) => {
    await newProject(page);
    await page.keyboard.press("ControlOrMeta+f");
    const bar = page.getByRole("search", { name: "Find and replace" });
    const find = bar.getByLabel("Find", { exact: true });
    await bar.getByRole("button", { name: /Regular expression|Regex/i }).click();
    await find.fill("(");
    await expect(find).toHaveAttribute("aria-invalid", "true");
    await expect(find).toHaveAccessibleDescription(/^Invalid pattern$/);
    // The count sits in a live region, so the message is announced when it appears.
    await expect(
      bar.locator("[aria-live=polite]").filter({ hasText: "Invalid pattern" }),
    ).toBeVisible();
    await find.fill("a");
    await expect(find).not.toHaveAttribute("aria-invalid", "true");
  });

  test("Rename chapter: an empty title is kept as it was and the status says so", async ({
    page,
  }) => {
    await newProject(page);
    await chapterAction(page, "Chapter One", "Rename");
    await page.getByLabel("Chapter title").fill("   ");
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("status").filter({ hasText: "A title cannot be empty" }),
    ).toContainText("the old title was kept");
    await expect(
      sidebar(page).getByRole("button", { name: "Chapter One", exact: true }),
    ).toBeVisible();
  });
});

test.describe("book dialogs", () => {
  const openDetails = async (page: Page) => {
    await page.getByRole("button", { name: "Book details" }).first().click();
    return page.getByRole("dialog", { name: "Book details" });
  };

  test("Book details: each required field Save refuses is aria-invalid, described by the alert and focused", async ({
    page,
  }) => {
    await newProject(page);
    const dialog = await openDetails(page);
    const save = dialog.getByRole("button", { name: "Save details" });
    for (const [label, message] of [
      ["Title", "Give the book a title."],
      ["Author", "Give the book an author."],
      ["Identifier", "The identifier cannot be empty."],
    ] as const) {
      const field = dialog.getByLabel(label, { exact: true });
      const before = await field.inputValue();
      await field.fill("");
      await save.click();
      await expectFieldError(field, dialog.getByRole("alert"), message, message);
      await field.fill(before);
      await expect(field).not.toHaveAttribute("aria-invalid", "true");
    }
    await save.click();
    await expect(dialog).toHaveCount(0);
  });

  test("Book details: a bad publishing value is flagged on its field, even in the closed section", async ({
    page,
  }) => {
    await newProject(page);
    const dialog = await openDetails(page);
    const series = dialog.getByLabel("Series", { exact: true });
    const number = dialog.getByLabel("Number in series");
    await dialog.getByText("Publishing details").click();
    await series.fill("The Saga");
    await number.fill("one");
    // The message sits under the field as you type; it says what to enter.
    await expect(number).toHaveAttribute("aria-invalid", "true");
    await expect(number).toHaveAccessibleDescription(/^Use a number such as 1 or 2\.5\.$/);
    await series.focus();
    await dialog.getByText("Publishing details").click(); // close the section
    await dialog.getByRole("button", { name: "Save details" }).click();
    // Save refuses, opens the section and puts focus on the field.
    await expect(number).toBeVisible();
    await expect(number).toBeFocused();
    await expectAlert(dialog.getByRole("alert"), "Use a number such as 1 or 2.5.");
    await number.fill("2.5");
    await expect(number).not.toHaveAttribute("aria-invalid", "true");
  });

  test("Book details: a cover that cannot be copied is an alert with the reason", async ({
    page,
  }) => {
    await newProject(page);
    const dialog = await openDetails(page);
    await page.evaluate(() => {
      window.__importError = "image is too large";
    });
    await dialog.getByRole("button", { name: "Choose image…" }).click();
    await expectAlert(dialog.getByRole("alert"), "image is too large");
  });

  test("Book snapshots: an empty name is refused with focus on the field and a hint of what to type", async ({
    page,
  }) => {
    await newProject(page);
    await sidebar(page).getByRole("button", { name: "Book snapshots" }).click();
    const dialog = page.getByRole("dialog", { name: "History · Whole book" });
    const name = dialog.getByLabel("Snapshot name");
    const take = dialog.getByRole("button", { name: "Take snapshot" });
    await expect(name).not.toHaveAttribute("aria-invalid", "true");
    // The button is not dead: pressing it explains what is missing.
    await expect(take).toBeEnabled();
    await name.focus();
    await take.click();
    await expectFieldError(
      name,
      dialog.getByRole("alert"),
      "The snapshot has no name.",
      "Type one, for example",
    );
    // Spaces are no name either, and Enter in the field gives the same answer.
    await name.fill("   ");
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    await page.keyboard.press("Enter");
    await expectFieldError(
      name,
      dialog.getByRole("alert"),
      "The snapshot has no name.",
      "Type one",
    );
    await name.fill("v1");
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    await expect(name).not.toHaveAttribute("aria-invalid", "true");
    await take.click();
    await expect(dialog.getByRole("list", { name: "Book snapshots" })).toContainText("v1");
  });

  test("Book snapshots: a snapshot that cannot be taken is an alert that says what to do, tied to the button, and the name is kept", async ({
    page,
  }) => {
    await newProject(page);
    await sidebar(page).getByRole("button", { name: "Book snapshots" }).click();
    const dialog = page.getByRole("dialog", { name: "History · Whole book" });
    const name = dialog.getByLabel("Snapshot name");
    const take = dialog.getByRole("button", { name: "Take snapshot" });
    await name.fill("v1");
    await failOn(page, "create_book_snapshot", { kind: "disk_full", path: ".cadabra/snapshots" });
    await take.click();
    const alert = dialog.getByRole("alert");
    await expectAlert(alert, "Could not take the snapshot");
    await expect(alert).toContainText("There is no space left on the disk");
    await expect(alert).toContainText("Try again, or free some space");
    await expect(take).toHaveAccessibleDescription(contains("Could not take the snapshot"));
    await expect(name).toHaveValue("v1");
    // The name is fine, so the field is not marked invalid.
    await expect(name).not.toHaveAttribute("aria-invalid", "true");
    await stopFailing(page, "create_book_snapshot");
  });

  test("Book snapshots: a failed restore and a failed delete are alerts that say what is unchanged", async ({
    page,
  }) => {
    await newProject(page);
    await sidebar(page).getByRole("button", { name: "Book snapshots" }).click();
    const dialog = page.getByRole("dialog", { name: "History · Whole book" });
    await dialog.getByLabel("Snapshot name").fill("v1");
    await dialog.getByRole("button", { name: "Take snapshot" }).click();
    await expect(dialog.getByRole("list", { name: "Book snapshots" })).toContainText("v1");
    await failOn(page, "restore_book_snapshot", { kind: "io", message: "disk is read-only" });
    await dialog.getByRole("button", { name: "Restore whole book" }).click();
    await page
      .getByRole("dialog", { name: "Restore the whole book?" })
      .getByRole("button", { name: "Restore whole book" })
      .click();
    await expectAlert(dialog.getByRole("alert"), "Could not restore the book (disk is read-only)");
    await expect(dialog.getByRole("alert")).toContainText("pick another snapshot");
    await failOn(page, "delete_book_snapshot", { kind: "io", message: "disk is read-only" });
    await dialog.getByRole("button", { name: "Delete snapshot" }).click();
    await page
      .getByRole("dialog", { name: "Delete this snapshot?" })
      .getByRole("button", { name: "Delete snapshot" })
      .click();
    await expectAlert(dialog.getByRole("alert"), "It is still in the list. Try again.");
  });

  test("Add language: a failure is an alert inside the dialog", async ({ page }) => {
    await newProject(page);
    await page.getByRole("button", { name: /Edition: English/ }).click();
    await page.getByRole("menuitem", { name: "Add language" }).click();
    const dialog = page.getByRole("dialog", { name: "Add language" });
    await dialog.getByLabel("Language", { exact: true }).selectOption("fr");
    await failOn(page, "write_project_file", { kind: "io", message: "No space left on device" });
    await dialog.getByRole("button", { name: "Add language", exact: true }).click();
    await expectAlert(dialog.getByRole("alert"), "No space left on device");
    await stopFailing(page, "write_project_file");
  });

  test("Export: a book that cannot be written is an alert with the reason", async ({ page }) => {
    await newProject(page);
    await page.getByRole("button", { name: "Export", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Export book" });
    await failOn(page, "write_project_bytes", { kind: "io", message: "No space left on device" });
    await failOn(page, "write_project_file", { kind: "io", message: "No space left on device" });
    await dialog
      .getByRole("button", { name: /^Export/ })
      .last()
      .click();
    await expectAlert(page.getByRole("alert").first(), "No space left on device");
  });
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

test.describe("import", () => {
  const open = async (page: Page, pick: "md" | "broken" | "docx" = "md") => {
    await fakeImportSources(page, pick, false);
    await page.goto("/");
    await page.getByRole("button", { name: "Import…" }).click();
    const dialog = page.getByRole("dialog", { name: "Import a manuscript" });
    return {
      dialog,
      file: dialog.getByLabel("File", { exact: true }),
      title: dialog.getByLabel("Title"),
      folder: dialog.getByLabel("New book folder"),
      next: dialog.getByRole("button", { name: "Next" }),
    };
  };

  test("Import: Next names what is missing, marks that box and moves focus to it, in order", async ({
    page,
  }) => {
    const { dialog, file, title, folder, next } = await open(page);
    await expect(next).toBeEnabled();
    await next.click();
    await expectFieldError(
      file,
      dialog.getByRole("alert"),
      "No file is chosen.",
      "Choose the file to import.",
    );
    await dialog.getByRole("button", { name: "Choose file…" }).click();
    await expect(file).not.toHaveValue("");
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    await expect(file).not.toHaveAttribute("aria-invalid", "true");

    await next.click();
    await expectFieldError(
      folder,
      dialog.getByRole("alert"),
      "No folder is chosen.",
      "Pick or create an empty folder.",
    );
    await dialog.getByRole("button", { name: "Choose…" }).click();
    await expect(folder).toHaveValue(/\S/);

    await title.fill("  ");
    await next.click();
    await expectFieldError(title, dialog.getByRole("alert"), "The book has no title.", "Type one.");
    await title.fill("Mine");
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    await expect(title).not.toHaveAttribute("aria-invalid", "true");
    await next.click();
    await expect(dialog.getByRole("button", { name: "Import", exact: true })).toBeVisible();
  });

  test("Import: a folder chooser that fails is an alert tied to the folder box that says to try again", async ({
    page,
  }) => {
    const { dialog, folder } = await open(page);
    await failOn(page, "pick_folder", "no access", 1);
    await dialog.getByRole("button", { name: "Choose…" }).click();
    await expectFieldError(
      folder,
      dialog.getByRole("alert"),
      "Could not open the chooser (no access).",
      "Try again.",
    );
  });

  test("Import: a file that cannot be read is an alert tied to the file box that says what to choose instead", async ({
    page,
  }) => {
    const { dialog, file, next } = await open(page, "broken");
    await dialog.getByRole("button", { name: "Choose file…" }).click();
    await dialog.getByRole("button", { name: "Choose…" }).click();
    await next.click();
    await expectFieldError(
      file,
      dialog.getByRole("alert"),
      "Could not read this file",
      "Choose a different file (Word .docx, Markdown or HTML) and try again.",
    );
    await expect(dialog).toBeVisible();
  });

  test("Import: a book that cannot be written is an alert that says the original is unchanged and what to try", async ({
    page,
  }) => {
    const { dialog, next } = await open(page);
    await dialog.getByRole("button", { name: "Choose file…" }).click();
    await dialog.getByRole("button", { name: "Choose…" }).click();
    await next.click();
    await failOn(page, "create_project", { kind: "disk_full", path: "/newbook" });
    await failOn(page, "write_project_file", { kind: "disk_full", path: "/newbook" });
    await dialog.getByRole("button", { name: "Import", exact: true }).click();
    const alert = dialog.getByRole("alert");
    await expectAlert(alert, "Could not import");
    await expect(alert).toContainText("Your original file was not changed.");
    await expect(alert).toContainText("Try again, or go back and choose a different file.");
  });

  test("Import: a heading level the file cannot be split at is an alert that says what to pick instead", async ({
    page,
  }) => {
    const { dialog, next } = await open(page, "docx");
    await dialog.getByRole("button", { name: "Choose file…" }).click();
    await dialog.getByRole("button", { name: "Choose…" }).click();
    await next.click();
    await dialog.getByRole("radio", { name: "Heading 3" }).click();
    const alert = dialog.getByRole("alert");
    await expectAlert(alert, "Could not split the file at that heading level");
    await expect(alert).toContainText(
      "Pick another heading level, or go back and choose a different file.",
    );
    await expect(dialog.getByRole("button", { name: "Import", exact: true })).toBeEnabled();
  });

  test("Import report: an image that could not be read is a warning that names it and says what to do", async ({
    page,
  }) => {
    const { dialog, next } = await open(page, "md");
    await page.evaluate(() => {
      const w = window as unknown as {
        __TAURI_INTERNALS__: { invoke: (...a: unknown[]) => Promise<unknown> };
      };
      const base = w.__TAURI_INTERNALS__.invoke;
      w.__TAURI_INTERNALS__.invoke = (cmd, ...rest) =>
        cmd === "read_import_image" ? Promise.reject("the file is locked") : base(cmd, ...rest);
    });
    await dialog.getByRole("button", { name: "Choose file…" }).click();
    await dialog.getByRole("button", { name: "Choose…" }).click();
    await next.click();
    await dialog.getByRole("button", { name: "Import", exact: true }).click();
    const report = page.getByRole("dialog", { name: "Import report" });
    const warnings = report.getByRole("region", { name: "Import warnings" });
    await expect(warnings).toContainText("image-not-imported");
    await expect(warnings).toContainText("could not be imported: the file is locked.");
    await expect(warnings).toContainText("Add the picture to the page yourself after the import.");
  });
});

test.describe("system messages", () => {
  test("a notice is a polite status that can be dismissed", async ({ page }) => {
    await newProject(page);
    await page.evaluate(async () => {
      const { useProject } = await import("/src/state/project/index.ts" as string);
      useProject.setState({ notice: "Exported exports/en/book.md", alertNotice: "" });
    });
    await expect(
      page.getByRole("status").filter({ hasText: "Exported exports/en/book.md" }),
    ).toBeVisible();
    // The alert region stays in the tree (empty) so a failure put into it is announced; only one with text counts.
    await expect(page.getByRole("alert").filter({ hasText: /./ })).toHaveCount(0);
    await page.getByRole("button", { name: "Dismiss message" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Exported" })).toHaveCount(0);
  });

  test("a failed autosave is an assertive alert that says what to do, not a polite status", async ({
    page,
  }) => {
    await newProject(page);
    await failOn(page, "write_project_file", {
      kind: "disk_full",
      path: "manuscript/001-chapter-one.json",
    });
    await pm(page).locator("p").last().click();
    await page.keyboard.type("Unsaved words");
    const alert = page.getByRole("alert").filter({ hasText: "Could not save" });
    await expect(alert).toBeVisible({ timeout: 15_000 });
    await expectAlert(alert, "Free some space and try again");
    await expect(alert).toContainText("Your text is still in the editor");
    await expect(page.getByRole("status").filter({ hasText: "Could not save" })).toHaveCount(0);
    await stopFailing(page, "write_project_file");
    await page.getByRole("button", { name: "Dismiss message" }).click();
    await expect(alert).toHaveCount(0);
  });

  test("a chapter file that cannot be read is an alert that says how to recover it", async ({
    page,
  }) => {
    await newProject(page);
    await addPage(page, "Title page");
    await page.evaluate(() => {
      window.__disk["manuscript/001-chapter-one.json"] = "{ not json";
    });
    await sidebar(page).getByRole("button", { name: "Chapter One", exact: true }).click();
    const alert = page.getByRole("alert").filter({ hasText: "could not be opened" });
    await expectAlert(alert, "Restore an earlier version from History, or choose another page.");
    await expect(pm(page)).toHaveCount(0);
  });

  test("Update: a failed install says nothing was changed and Try again installs the same update", async ({
    page,
  }) => {
    await newProject(page);
    await answer(page, "updates_supported", true);
    await answer(page, "plugin:updater|check", {
      rid: 7,
      currentVersion: "0.1.0",
      version: "0.2.0",
    });
    await answer(page, "plugin:process|restart", null);
    await failOn(page, "plugin:updater|download_and_install", "disk full");
    await menu(page, "help.updates");
    const dialog = page.getByRole("dialog", { name: "Version 0.2.0 is available" });
    await dialog.getByRole("button", { name: "Install now" }).click();
    const alert = dialog.getByRole("alert");
    await expectAlert(alert, "Could not install the update: disk full.");
    await expect(alert).toContainText("Nothing was changed.");
    const retry = dialog.getByRole("button", { name: "Try again" });
    await expect(retry).toHaveAccessibleDescription(contains("disk full"));
    await stopFailing(page, "plugin:updater|download_and_install");
    await answer(page, "plugin:updater|download_and_install", null);
    await retry.click();
    await expect(dialog.getByRole("alert")).toHaveCount(0);
  });

  test("Add language: a failure marks the language picker invalid and described by the alert", async ({
    page,
  }) => {
    await newProject(page);
    await failOn(page, "write_project_file", { kind: "disk_full", path: "cadabra.json" });
    await page.getByRole("button", { name: /^Edition/ }).click();
    await page.getByRole("menuitem", { name: /Add language/ }).click();
    const dialog = page.getByRole("dialog", { name: "Add language" });
    await dialog.getByRole("button", { name: "Add language" }).click();
    const alert = dialog.getByRole("alert");
    await expectAlert(alert, "Could not add the language");
    await expect(dialog.getByLabel("Language")).toHaveAttribute("aria-invalid", "true");
    await expect(dialog.getByLabel("Language")).toHaveAccessibleDescription(
      contains("Could not add the language"),
    );
  });

  test("the error screen moves focus to its message and says what to do besides Reload", async ({
    page,
  }) => {
    await newProject(page);
    await page.evaluate(async () => {
      const { useProject } = await import("/src/state/project/index.ts" as string);
      useProject.setState({ manifest: { chapters: 1, pages: 1 } });
    });
    const alert = page.getByRole("alert");
    await expect(
      page.getByRole("heading", { name: "Something went wrong", level: 1 }),
    ).toBeVisible();
    await expect(alert).toBeFocused();
    await expect(alert).toContainText("restart CadabraCraft");
    await expect(alert.getByRole("button", { name: "Reload" })).toBeVisible();
  });
});
