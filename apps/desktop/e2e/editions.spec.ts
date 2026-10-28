import { expect, test } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { newProject, manifestOf, sidebar } from "./support/helpers";

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

test("add a French edition, write it, switch back and forth", async ({ page }) => {
  await newProject(page);
  await page.getByRole("button", { name: /Edition: English/ }).click();
  await page.getByRole("menuitem", { name: "Add language" }).click();
  const dialog = page.getByRole("dialog", { name: "Add language" });
  await dialog.getByLabel("Language", { exact: true }).selectOption("fr");
  await dialog.getByRole("button", { name: "Add language", exact: true }).click();

  await expect(page.getByRole("button", { name: /Edition: Français/ })).toBeVisible();
  await expect(sidebar(page).getByText("Not translated yet")).toBeVisible();
  await page.locator(".ProseMirror").click();
  await page.keyboard.type(" Bonjour");
  await expect(page.getByRole("status")).toContainText("Saved");
  await expect(sidebar(page).getByText("Not translated yet")).toHaveCount(0);

  const m = await manifestOf(page);
  expect(m.editions.map((e: { language: string }) => e.language)).toEqual(["en", "fr"]);
  expect(m.chapters[0].files.fr).toBe("manuscript/fr/001-chapter-one.json");

  await page.getByRole("button", { name: /Edition: Français/ }).click();
  await page.getByRole("menuitem", { name: /English/ }).click();
  await expect(page.locator(".ProseMirror")).not.toContainText("Bonjour");
  await page.getByRole("button", { name: /Edition: English/ }).click();
  await page.getByRole("menuitem", { name: /Français/ }).click();
  await expect(page.locator(".ProseMirror")).toContainText("Bonjour");
});

test("export editions: a French edition is blocked until its untranslated chapters are skipped, and several editions export together", async ({
  page,
}) => {
  await newProject(page);
  await page.getByRole("button", { name: /Edition: English/ }).click();
  await page.getByRole("menuitem", { name: "Add language" }).click();
  const dialog = page.getByRole("dialog", { name: "Add language" });
  await dialog.getByLabel("Language", { exact: true }).selectOption("fr");
  await dialog.getByRole("button", { name: "Add language", exact: true }).click();
  await expect(page.getByRole("button", { name: /Edition: Français/ })).toBeVisible();

  await page.getByRole("button", { name: "Export", exact: true }).click();
  const ex = page.getByRole("dialog", { name: "Export book" });
  await ex.getByRole("radio", { name: "EPUB 3" }).click();
  // The open edition starts checked and tagged Current; its untranslated chapter stops the export.
  await expect(ex.getByLabel("Français")).toBeChecked();
  await expect(ex.getByText("Current")).toBeVisible();
  await expect(ex.getByText("Choose how to handle Français to export it.")).toBeVisible();
  const submit = ex.getByRole("button", { name: "Export", exact: true });
  await expect(submit).toBeDisabled();

  await ex.getByLabel("Skip untranslated chapters").check();
  await expect(submit).toBeEnabled();
  await ex.getByLabel("English").check();
  await submit.click();
  await expect(ex).toHaveCount(0);
  const disk = await page.evaluate(() => Object.keys(window.__disk));
  expect(disk).toContain("exports/fr/book.epub");
  expect(disk).toContain("exports/en/book.epub");
});

test("book details belong to the open edition", async ({ page }) => {
  await newProject(page);
  await page.getByRole("button", { name: /Edition: English/ }).click();
  await page.getByRole("menuitem", { name: "Add language" }).click();
  const add = page.getByRole("dialog", { name: "Add language" });
  await add.getByLabel("Language", { exact: true }).selectOption("fr");
  await add.getByRole("button", { name: "Add language", exact: true }).click();
  await expect(page.getByRole("button", { name: /Edition: Français/ })).toBeVisible();

  await page.getByRole("button", { name: "Book details" }).click();
  const dialog = page.getByRole("dialog", { name: /Book details/ });
  await expect(dialog.getByLabel("Language")).toBeDisabled();
  await dialog.getByLabel("Title").fill("Le livre");
  await dialog.getByRole("button", { name: "Save details" }).click();
  await expect(dialog).toHaveCount(0);

  const m = await manifestOf(page);
  expect(m.editions[1].title).toBe("Le livre");
  expect(m.editions[0].title).not.toBe("Le livre");
});
