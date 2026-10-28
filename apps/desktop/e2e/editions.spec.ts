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
