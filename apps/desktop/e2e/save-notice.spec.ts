import { expect, test, type Page } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { newProject } from "./support/helpers";

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

const status = (page: Page) => page.getByRole("status");
const save = (page: Page) => page.getByRole("button", { name: "Save" }).click();

test.describe("the Saved notice", () => {
  test("shows after a save and fades by itself after about two seconds", async ({ page }) => {
    await newProject(page);
    await page.locator(".ProseMirror p").last().click();
    await page.keyboard.type("Salt on the wind.");
    await save(page);
    await expect(status(page)).toHaveText("Saved");
    await expect(status(page)).toHaveText("", { timeout: 6000 });
    // Nothing dismissable is left behind.
    await expect(page.getByRole("button", { name: "Dismiss message" })).toHaveCount(0);
  });

  test("a later save shows it again", async ({ page }) => {
    await newProject(page);
    await page.locator(".ProseMirror p").last().click();
    await page.keyboard.type("One");
    await save(page);
    await expect(status(page)).toHaveText("Saved");
    await expect(status(page)).toHaveText("", { timeout: 6000 });
    await page.locator(".ProseMirror p").last().click();
    await page.keyboard.type(" two");
    await save(page);
    await expect(status(page)).toHaveText("Saved");
  });

  test("a conflict-copy notice stays until it is dismissed and is not replaced by Saved", async ({
    page,
  }) => {
    await newProject(page);
    await page.evaluate(() => {
      window.__conflictCopy = (path) =>
        path.startsWith("manuscript/") ? path.replace(".json", ".conflict-1.json") : null;
    });
    await page.locator(".ProseMirror p").last().click();
    await page.keyboard.type("Mine.");
    await save(page);
    const notice = page.getByText(/changed outside the app; the other version was kept as/);
    await expect(notice).toBeVisible();
    // Past the time "Saved" would have faded, and through another save that finds no conflict.
    await page.waitForTimeout(3000);
    await expect(notice).toBeVisible();
    await page.evaluate(() => (window.__conflictCopy = undefined));
    await page.locator(".ProseMirror p").last().click();
    await page.keyboard.type(" More.");
    await save(page);
    await page.waitForTimeout(500);
    await expect(notice).toBeVisible();
    await expect(status(page)).not.toHaveText("Saved");
    // Dismissing it is what clears it; the next save then says Saved.
    await page.getByRole("button", { name: "Dismiss message" }).click();
    await expect(notice).toHaveCount(0);
    await page.locator(".ProseMirror p").last().click();
    await page.keyboard.type(" Again.");
    await save(page);
    await expect(status(page)).toHaveText("Saved");
  });
});
