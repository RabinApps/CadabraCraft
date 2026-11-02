import { expect, test } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { newProject } from "./support/helpers";

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
  await newProject(page);
});

test("a footnote in the page is a named note, numbered in order", async ({ page }) => {
  const ed = page.locator(".ProseMirror");
  await ed.locator("p").last().click();
  const insert = page
    .getByRole("toolbar", { name: "Formatting" })
    .getByRole("button", { name: "Footnote", exact: true });
  await page.keyboard.type("first");
  await page.keyboard.press("Enter");
  await insert.click();
  await ed.locator("p").first().click();
  await insert.click();

  const notes = ed.getByRole("note");
  await expect(notes).toHaveCount(2);
  await expect(notes.nth(0)).toHaveAccessibleName("Footnote 1");
  await expect(notes.nth(1)).toHaveAccessibleName("Footnote 2");
  await expect(notes.nth(0)).toContainText("Note");
  await expect(ed.locator("span.footnote")).toHaveCount(2);
});
