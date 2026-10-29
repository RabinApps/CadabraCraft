import { expect, test } from "./support/coverage";
import { menu } from "./support/cov";
import { fakeTauri } from "./support/fakeTauri";

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
  await page.goto("/");
});

test("Help > Licenses shows each bundled document and closes with Escape", async ({ page }) => {
  await menu(page, "help.licenses");
  const dialog = page.getByRole("dialog", { name: "Licenses" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("pre")).toHaveText("Fake license text");
  for (const [label, id] of [
    ["Clarifications", "clarifications"],
    ["Notice", "notice"],
    ["Programs and fonts", "programs"],
    ["Rust libraries", "rust"],
    ["JavaScript libraries", "npm"],
  ] as const) {
    await dialog.getByRole("radio", { name: label }).click();
    await expect(dialog.locator("pre")).toHaveText(`Fake ${id} text`);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("a document that cannot be read shows the reason", async ({ page }) => {
  await page.evaluate(() => {
    window.__failLicense = true;
  });
  await menu(page, "help.licenses");
  await expect(page.getByRole("dialog", { name: "Licenses" }).getByRole("alert")).toContainText(
    "the file is missing",
  );
});
