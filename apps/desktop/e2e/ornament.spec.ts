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
  const scene = dialog.getByLabel("Scene break");
  await expect(scene).toHaveValue("");
  await scene.selectOption("fleuron");
  await dialog.getByRole("button", { name: "Save details" }).click();
  await expect(dialog).toBeHidden();
  expect((await manifest(page)).sceneBreak).toBe("fleuron");

  await page.getByRole("button", { name: "Book details" }).click();
  await expect(dialog.getByLabel("Scene break")).toHaveValue("fleuron");
  await dialog.getByLabel("Scene break").selectOption("");
  await dialog.getByRole("button", { name: "Save details" }).click();
  await expect(dialog).toBeHidden();
  expect(await manifest(page)).not.toHaveProperty("sceneBreak");
});
