import { expect, test } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { newProject } from "./support/helpers";

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

const manifest = (page: import("@playwright/test").Page) =>
  page.evaluate(() => JSON.parse(window.__disk["cadabra.json"] as string));

test("Book details: picking a scene-break ornament saves sceneBreak, and the template default removes it", async ({
  page,
}) => {
  await newProject(page);
  await page.getByRole("button", { name: "Book details" }).click();
  const dialog = page.getByRole("dialog", { name: "Book details" });
  const scene = dialog.getByRole("button", { name: /^Scene break/ });
  await expect(scene).toContainText("Template default");
  await scene.click();
  const menu = page.getByRole("menu");
  await expect(menu.getByText("Ornament by template")).toBeVisible();
  await menu.getByRole("menuitemradio", { name: "Fleuron" }).click();
  await expect(menu).toBeHidden();
  await dialog.getByRole("button", { name: "Save details" }).click();
  await expect(dialog).toBeHidden();
  expect((await manifest(page)).sceneBreak).toBe("fleuron");

  await page.getByRole("button", { name: "Book details" }).click();
  await expect(dialog.getByRole("button", { name: /^Scene break/ })).toContainText("Fleuron");
  await dialog.getByRole("button", { name: /^Scene break/ }).click();
  await expect(page.getByRole("menuitemradio", { name: "Fleuron" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await page.getByRole("menuitemradio", { name: "Template default" }).click();
  await dialog.getByRole("button", { name: "Save details" }).click();
  await expect(dialog).toBeHidden();
  expect(await manifest(page)).not.toHaveProperty("sceneBreak");
});
