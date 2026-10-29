import { expect, test, type Page } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";

// Settings > Shortcuts: a read-only, searchable list of every key the app answers to.

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

const openShortcuts = async (page: Page) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  await page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("button", { name: "Shortcuts" })
    .click();
  await expect(page.getByRole("heading", { name: "Shortcuts", level: 2 })).toBeVisible();
};

test("the Shortcuts nav entry is enabled and lists keys by menu", async ({ page }) => {
  await openShortcuts(page);
  const section = page.locator("#shortcuts");
  for (const group of ["File", "Edit", "Format"])
    await expect(section.getByRole("heading", { name: group, level: 3 })).toBeVisible();
  await expect(section.getByRole("listitem").filter({ hasText: "Bold" })).toBeVisible();
  // Keycaps are announced as words, not as symbols.
  await expect(section.getByRole("img", { name: /^(Control|Command) B$/ })).toBeVisible();
});

test("search matches the action and the key, and says when nothing matches", async ({ page }) => {
  await openShortcuts(page);
  const section = page.locator("#shortcuts");
  const search = section.getByRole("searchbox", { name: "Search shortcuts" });
  await search.fill("bold");
  await expect(section.getByRole("listitem")).toHaveCount(1);
  await expect(section.getByRole("heading", { name: "File", level: 3 })).toHaveCount(0);
  await search.fill("shift+s");
  await expect(section.getByRole("listitem").filter({ hasText: "Strikethrough" })).toBeVisible();
  await search.fill("zzzz");
  await expect(section.getByRole("status")).toHaveText(/No shortcut matches “zzzz”/);
  await search.fill("");
  await expect(section.getByRole("heading", { name: "File", level: 3 })).toBeVisible();
});
