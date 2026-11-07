import { expect, test } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { manifestOf, newProject } from "./support/helpers";

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

  test("puts a codex entry in a scene's cast from the scene rail", async ({ page }) => {
    await newProject(page);
    await page.getByRole("button", { name: "Codex", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Codex" });
    await dialog.getByRole("button", { name: "New entry" }).click();
    const name = dialog.getByLabel("Name");
    await name.fill("Mara");
    await name.blur();
    await dialog.getByRole("button", { name: "Close codex" }).click();

    const scenes = page.getByRole("list", { name: "Scenes in Chapter One" });
    await scenes.getByRole("button", { name: "Scene", exact: true }).click();
    await page.keyboard.type("Mara waits on the quay.");
    const rail = page.getByRole("region", { name: "Scene" });
    await rail.getByLabel("Add to cast").selectOption({ label: "Mara" });
    await expect(rail.getByRole("list", { name: "Cast" })).toContainText("Mara");
    await expect(page.getByRole("status")).toContainText("Saved");

    const m = await manifestOf(page);
    const files = m.chapters[0].files as Record<string, string>;
    const file = files[String(Object.keys(files)[0])] as string;
    const doc = await page.evaluate((f) => JSON.parse(window.__disk[f] as string), file);
    const scene = doc.content.find((n: { type: string }) => n.type === "scene");
    expect(scene.attrs.cast).toHaveLength(1);
    expect(scene.attrs.cast[0]).toMatch(/^cd-[0-9a-f]{8}$/);

    // The entry says where it appears, without a POV.
    await page.getByRole("button", { name: "Codex", exact: true }).click();
    await expect(dialog.getByRole("region", { name: "Appears in" })).toContainText(
      "Chapter One · Untitled scene",
    );
    await dialog.getByRole("button", { name: "Close codex" }).click();

    // Taking her out of the cast takes the scene away again.
    await rail.getByRole("button", { name: "Remove Mara from the cast" }).click();
    await expect(rail.getByRole("list", { name: "Cast" })).toHaveCount(0);
    await page.getByRole("button", { name: "Codex", exact: true }).click();
    await expect(dialog).toContainText("No scene names it yet.");
  });
});
