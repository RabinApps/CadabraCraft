import { expect, test } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { chapterDoc, newProject, seedChapters } from "./support/helpers";

// The writing goal (M01): set in the Writing goal dialog from the status bar, shown as progress there, and saved in cadabra.json.

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

const manifest = (page: import("@playwright/test").Page) =>
  page.evaluate(() => JSON.parse(window.__disk["cadabra.json"] as string));

test("a goal is set, shows progress in the status bar, and is cleared", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await newProject(page);
  await seedChapters(page, [chapterDoc("Chapter One", 5, 40)]);

  // No goal yet: the status bar offers to set one.
  await page.getByRole("button", { name: "Set a writing goal" }).click();
  const dialog = page.getByRole("dialog", { name: "Writing goal" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Word goal").fill("500");
  await dialog.getByRole("button", { name: "Save goal" }).click();
  await expect(dialog).toBeHidden();

  // The goal row shows the words toward it, with a progress bar.
  const row = page.getByRole("button", { name: /of 500 words/ });
  await expect(row).toBeVisible();
  await expect(row).toContainText(/\d+ of 500 words/);
  const bar = page.getByRole("progressbar", { name: "Goal progress" });
  await expect(bar).toHaveAttribute("aria-valuemax", "100");
  expect(Number(await bar.getAttribute("aria-valuenow"))).toBeGreaterThan(0);
  expect(await manifest(page)).toMatchObject({ goal: { words: 500 } });
  expect(await manifest(page)).not.toHaveProperty("goal.deadline");

  // Reopen with a deadline: the plan line names the daily target.
  await row.click();
  const again = page.getByRole("dialog", { name: "Writing goal" });
  await expect(again.getByLabel("Word goal")).toHaveValue("500");
  await again.getByLabel("Deadline (optional)").fill("2099-12-31");
  await expect(again.locator("#goal-plan")).toContainText("words a day to 2099-12-31");
  await again.getByRole("button", { name: "Save goal" }).click();
  await expect(again).toBeHidden();
  expect(await manifest(page)).toMatchObject({
    goal: { words: 500, deadline: "2099-12-31" },
  });

  // A word count that is not a whole number is refused and nothing is saved.
  await row.click();
  const bad = page.getByRole("dialog", { name: "Writing goal" });
  await bad.getByLabel("Word goal").fill("0");
  await bad.getByRole("button", { name: "Save goal" }).click();
  await expect(bad.getByRole("alert")).toContainText("Enter a whole number of words");
  await expect(bad.getByLabel("Word goal")).toHaveAttribute("aria-invalid", "true");
  expect(await manifest(page)).toMatchObject({ goal: { words: 500 } });
  await bad.getByRole("button", { name: "Cancel" }).click();
  await expect(bad).toBeHidden();

  // Clear the goal: the row goes back to offering one, and focus stays on that control.
  await row.click();
  const clear = page.getByRole("dialog", { name: "Writing goal" });
  await clear.getByRole("button", { name: "Clear goal" }).click();
  await expect(clear).toBeHidden();
  const set = page.getByRole("button", { name: "Set a writing goal" });
  await expect(set).toBeVisible();
  await expect(set).toBeFocused();
  expect(await manifest(page)).not.toHaveProperty("goal");
});
