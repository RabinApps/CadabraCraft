import { expect, test } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { newProject } from "./support/helpers";

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

const manifest = (page: import("@playwright/test").Page) =>
  page.evaluate(() => JSON.parse(window.__disk["cadabra.json"] as string));

test("Book details: a valid ISBN is saved in cadabra.json as 13 digits", async ({ page }) => {
  await newProject(page);
  await page.getByRole("button", { name: "Book details" }).click();
  const dialog = page.getByRole("dialog", { name: "Book details" });
  await dialog.getByLabel("ISBN").fill("978-3-16-148410-0");
  await dialog.getByRole("button", { name: "Save details" }).click();
  await expect(dialog).toBeHidden();
  expect(await manifest(page)).toMatchObject({ editions: [{ isbn: "9783161484100" }] });
});

test("Book details: an invalid ISBN shows a hint on blur and is not saved", async ({ page }) => {
  await newProject(page);
  await page.getByRole("button", { name: "Book details" }).click();
  const dialog = page.getByRole("dialog", { name: "Book details" });
  const isbn = dialog.getByLabel("ISBN");
  await isbn.fill("978-3-16-148410-1");
  await expect(dialog.getByText("Enter a valid ISBN")).toBeHidden(); // not before the field loses focus
  await dialog.getByLabel("Identifier").focus();
  await expect(dialog.getByText("Enter a valid ISBN")).toBeVisible();
  await expect(isbn).toHaveAttribute("aria-invalid", "true");
  await isbn.fill("978-3-16-148410-0"); // the hint follows the change and clears once it is valid
  await expect(dialog.getByText("Enter a valid ISBN")).toBeHidden();
  await isbn.fill("978-3-16-148410-1");
  await expect(dialog.getByText("Enter a valid ISBN")).toBeVisible();
  await dialog.getByRole("button", { name: "Save details" }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("alert")).toContainText("Enter a valid ISBN");
  expect((await manifest(page)).editions[0].isbn).toBeNull();
});
