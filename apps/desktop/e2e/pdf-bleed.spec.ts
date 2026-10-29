import { expect, test } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { newProject } from "./support/helpers";

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

test("Export PDF with bleed grows the page and the checks follow", async ({ page }) => {
  await newProject(page);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export book" });
  await dialog.getByRole("radio", { name: "Print PDF" }).click();
  const bleed = dialog.getByLabel("Add bleed (0.125 in)");
  const marks = dialog.getByLabel("Crop marks");
  await expect(bleed).not.toBeChecked();
  // Crop marks are drawn outside the bleed, so turning them on turns the bleed on.
  await marks.check();
  await expect(bleed).toBeChecked();
  await expect(dialog.getByRole("list", { name: "Print checks" })).toContainText(
    "KDP does not accept",
  );
  // And turning the bleed off turns them off.
  await bleed.uncheck();
  await expect(marks).not.toBeChecked();
  await bleed.check();
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect(dialog).toHaveCount(0);

  const call = await page.evaluate(() => window.__typstCalls[0]!);
  // Classic Novel is 5.5 x 8.5: the bleed adds 0.125 in to the width and 0.25 in to the height.
  expect(call.source).toMatch(/#set page\(width: 5\.625in, height: 8\.75in/);
  expect(call.source).not.toContain("foreground:");
});

test("Export PDF with crop marks writes the marks into the page", async ({ page }) => {
  await newProject(page);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export book" });
  await dialog.getByRole("radio", { name: "Print PDF" }).click();
  await dialog.getByLabel("Crop marks").check();
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const call = await page.evaluate(() => window.__typstCalls[0]!);
  expect(call.source).toMatch(/#set page\(width: 6\.25in, height: 9\.25in/);
  expect(call.source).toContain("foreground:");
});
