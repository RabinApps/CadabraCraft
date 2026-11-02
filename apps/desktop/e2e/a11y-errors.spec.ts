import { expect, test, type Locator, type Page } from "./support/coverage";
import { covBackend, failOn, stopFailing } from "./support/cov";
import { fakeTauri } from "./support/fakeTauri";
import { chapterAction, newProject, sidebar } from "./support/helpers";

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

  test("Add image: a file that cannot be copied is announced as a status with the reason", async ({
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
      page.getByRole("status").filter({ hasText: "Could not add the image" }),
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

  test("Book snapshots: a snapshot that cannot be taken is an alert and the name is kept for a retry", async ({
    page,
  }) => {
    await newProject(page);
    await sidebar(page).getByRole("button", { name: "Book snapshots" }).click();
    const dialog = page.getByRole("dialog", { name: "History · Whole book" });
    const name = dialog.getByLabel("Snapshot name");
    await name.fill("v1");
    await failOn(page, "create_book_snapshot", { kind: "disk_full", path: ".cadabra/snapshots" });
    await dialog.getByRole("button", { name: "Take snapshot" }).click();
    await expectAlert(dialog.getByRole("alert"), /\w+ \w+ \w+/);
    await expect(name).toHaveValue("v1");
    await stopFailing(page, "create_book_snapshot");
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
