import { expect, test } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { answer, calls, covBackend, failOn, menu } from "./support/cov";
import { newProject, sidebar } from "./support/helpers";

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
  await covBackend(page);
});

test("the update dialog also opens on the start screen, where no book is open", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Write your first book" })).toBeVisible();
  await answer(page, "updates_supported", true);
  await answer(page, "plugin:updater|check", {
    rid: 7,
    currentVersion: "0.1.0",
    version: "0.2.0",
  });
  await menu(page, "help.updates");
  await expect(page.getByRole("dialog", { name: "Version 0.2.0 is available" })).toBeVisible();
});

test("Add language starts fresh each time and names the source language", async ({ page }) => {
  await newProject(page);
  const open = async () => {
    await page.getByRole("button", { name: /Edition: English/ }).click();
    await page.getByRole("menuitem", { name: "Add language" }).click();
    return page.getByRole("dialog", { name: "Add language" });
  };
  let dialog = await open();
  const select = dialog.getByLabel("Language", { exact: true });
  const first = await select.inputValue();
  await expect(dialog.getByText("Chapters start as English copies")).toBeVisible();
  await select.selectOption("fr");
  await dialog.getByRole("radio", { name: /Start empty/ }).check();
  await dialog.getByRole("button", { name: "Cancel" }).click();

  dialog = await open();
  await expect(dialog.getByLabel("Language", { exact: true })).toHaveValue(first);
  await expect(dialog.getByRole("radio", { name: /Start from a copy/ })).toBeChecked();
});

test("a recent book that exists but cannot be read shows the real reason, not 'Folder not found'", async ({
  page,
}) => {
  await newProject(page);
  await page.evaluate(() =>
    localStorage.setItem(
      "cadabracraft.recents",
      JSON.stringify([{ root: "/proj", title: "E2E Book", openedAt: 1 }]),
    ),
  );
  await page.reload();
  await failOn(page, "read_project_file", { kind: "permission_denied", path: "cadabra.json" });
  const recent = page.getByRole("region", { name: "Recent projects" });
  await recent
    .getByRole("button", { name: /E2E Book/ })
    .first()
    .click();
  await expect(recent.getByRole("alert")).toContainText("Could not open this book");
  await expect(recent.getByRole("alert")).toContainText("does not have permission");
  await expect(recent.getByText("Folder not found.")).toHaveCount(0);
});

test("after a chapter menu action focus returns to the menu button, except where a dialog or field takes it", async ({
  page,
}) => {
  await newProject(page);
  await page.getByRole("button", { name: "Add chapter" }).click();
  const trigger = page.getByRole("button", { name: "Actions for Chapter One" });
  await trigger.click();
  await page.getByRole("menuitem", { name: "Move down" }).click();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await expect(sidebar(page).getByRole("textbox")).toBeFocused();
});

test("Quit writes unsaved typing before the window is destroyed, and works with a dialog open", async ({
  page,
}) => {
  // The fake backend has no native window; give it one so the app can ask to destroy it.
  await page.addInitScript(() => {
    (window.__TAURI_INTERNALS__ as unknown as { metadata: unknown }).metadata = {
      currentWindow: { label: "main" },
      currentWebview: { windowLabel: "main", label: "main" },
    };
  });
  await newProject(page);
  await page.locator(".ProseMirror").click();
  await page.keyboard.type(" last words");
  await page.getByRole("button", { name: "Book details" }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await menu(page, "app.quit");
  await expect
    .poll(() => page.evaluate(() => window.__disk["manuscript/001-chapter-one.json"]))
    .toContain("last words");
  await expect.poll(() => calls(page, "plugin:window|destroy")).toBe(1);
});
