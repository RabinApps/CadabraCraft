import { expect, test } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { newProject } from "./support/helpers";

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

test.describe("codex", () => {
  test("adds an entry, keeps it in codex.json and lists the scenes that name it", async ({
    page,
  }) => {
    await newProject(page);

    // A scene whose point of view is Mara, written before the codex entry exists.
    const scenes = page.getByRole("list", { name: "Scenes in Chapter One" });
    await scenes.getByRole("button", { name: "Scene", exact: true }).click();
    await page.keyboard.type("Mara waits on the quay.");
    const rail = page.getByRole("region", { name: "Scene" });
    await rail.getByLabel("Point of view").fill("Mara");
    await rail.getByLabel("Point of view").blur();
    await expect(page.getByRole("status")).toContainText("Saved");

    await page.getByRole("button", { name: "Codex", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Codex" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Nothing here yet.");

    await dialog.getByRole("button", { name: "New entry" }).click();
    const name = dialog.getByLabel("Name");
    await name.fill("Mara");
    await name.blur();

    // The entry's name matches the scene's POV, so the book says where she appears.
    const appearsIn = dialog.getByRole("region", { name: "Appears in" });
    await expect(appearsIn).toContainText("Chapter One · Untitled scene");

    await expect(dialog.getByRole("button", { name: /^Mara/ })).toBeVisible();
    const saved = await page.evaluate(() => window.__disk["codex.json"]);
    const file = JSON.parse(saved as string);
    expect(file.entries).toHaveLength(1);
    expect(file.entries[0].name).toBe("Mara");
    expect(file.entries[0].kind).toBe("character");

    // Deleting the entry leaves the file with none, and the list empty again.
    await dialog.getByRole("button", { name: "Delete Mara" }).click();
    await expect(dialog).toContainText("Nothing here yet.");
    await dialog.getByRole("button", { name: "Close codex" }).click();
    await expect(dialog).toBeHidden();
    const after = await page.evaluate(() => window.__disk["codex.json"]);
    expect(JSON.parse(after as string).entries).toEqual([]);
  });
});
