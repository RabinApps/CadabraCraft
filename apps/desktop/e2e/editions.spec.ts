import { expect, test } from "@playwright/test";
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

test("export a French edition: blocked while untranslated, then left out with skip", async ({
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
  const exportDialog = page.getByRole("dialog", { name: "Export book" });
  await exportDialog.getByRole("radio", { name: "EPUB 3" }).click();
  await expect(exportDialog.getByLabel("Language")).toHaveValue("fr");
  await exportDialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect(exportDialog.getByRole("alert")).toContainText("not translated");

  await exportDialog.getByLabel("Skip untranslated chapters").check();
  await exportDialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Exported exports/fr/book.epub");
  expect(await page.evaluate(() => "exports/fr/book.epub" in window.__disk)).toBe(true);
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
