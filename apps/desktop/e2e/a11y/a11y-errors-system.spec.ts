import { expect, test, type Page } from "../support/coverage";
import { answer, covBackend, failOn, menu, stopFailing } from "../support/cov";
import { fakeImportSources } from "../support/fakeImport";
import { fakeTauri } from "../support/fakeTauri";
import { addPage, newProject, sidebar } from "../support/helpers";
import { pm, contains, expectAlert, expectFieldError } from "../support/a11yErrors";

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
  await covBackend(page);
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
