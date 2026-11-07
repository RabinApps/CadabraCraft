import { expect, test, type Page } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { manifestOf, newProject } from "./support/helpers";

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

const sceneList = (page: Page, chapter = "Chapter One") =>
  page.getByRole("list", { name: `Scenes in ${chapter}` });
const rail = (page: Page) => page.getByRole("region", { name: "Scene" });
const addScene = (page: Page) =>
  sceneList(page).getByRole("button", { name: "Scene", exact: true });

/** The open chapter as it was last written to the fake disk. */
async function chapterDoc(page: Page) {
  const m = await manifestOf(page);
  const file = m.chapters[0].files[Object.keys(m.chapters[0].files)[0]!];
  return page.evaluate((f) => JSON.parse(window.__disk[f] as string), file);
}

test.describe("scenes", () => {
  test("adds a scene to the chapter, counts its words and lists it under the chapter", async ({
    page,
  }) => {
    await newProject(page);
    await expect(sceneList(page)).toBeVisible();
    await addScene(page).click();

    await expect(rail(page)).toBeVisible();
    await expect(rail(page)).toContainText("Untitled scene");
    // The caret is in the new scene, so typing goes into it.
    await page.keyboard.type("The salt wind came off the water.");
    await expect(page.getByRole("status")).toContainText("Saved");

    const row = sceneList(page).getByRole("listitem").first();
    await expect(row).toContainText("7");
    await expect(row.getByRole("button")).toHaveAttribute("aria-current", "true");
    await expect(rail(page)).toContainText("7 words");

    const doc = await chapterDoc(page);
    const scene = doc.content.find((n: { type: string }) => n.type === "scene");
    expect(scene.content[0].content[0].text).toBe("The salt wind came off the water.");

    // Going to a scene leaves the chapter on its page, with the text still there.
    await sceneList(page)
      .getByRole("button", { name: /Untitled scene/ })
      .click();
    await expect(page.locator(".ProseMirror h1")).toBeVisible();
    await expect(page.locator(".ProseMirror")).toContainText("The salt wind came off the water.");
  });

  test("keeps a scene's notes in the chapter and closes the rail", async ({ page }) => {
    await newProject(page);
    await addScene(page).click();
    await page.keyboard.type("Mara waits on the quay.");

    await rail(page).getByLabel("Scene title").fill("The quay at dusk");
    await rail(page).getByLabel("Scene title").blur();
    await rail(page).getByRole("button", { name: "Draft", exact: true }).click();
    await rail(page).getByLabel("Point of view").fill("Mara");
    await rail(page).getByLabel("Point of view").blur();
    await rail(page).getByLabel("Target words").fill("1000");
    await rail(page).getByLabel("Target words").blur();
    await rail(page).getByLabel("Synopsis").fill("Mara has not decided what to tell him.");
    await rail(page).getByLabel("Synopsis").blur();
    await rail(page).getByLabel("Label").fill("Act I");
    await rail(page).getByLabel("Label").blur();
    await expect(page.getByRole("status")).toContainText("Saved");

    await expect(sceneList(page).getByRole("listitem").first()).toContainText("5 / 1,000");
    await expect(rail(page)).toContainText("POV Mara · 5 of 1,000 words");

    const scene = (await chapterDoc(page)).content.find(
      (n: { type: string }) => n.type === "scene",
    );
    expect(scene.attrs).toMatchObject({
      title: "The quay at dusk",
      status: "draft",
      pov: "Mara",
      target: 1000,
      synopsis: "Mara has not decided what to tell him.",
      label: "Act I",
    });

    await rail(page).getByRole("button", { name: "Close scene" }).click();
    await expect(rail(page)).toHaveCount(0);
  });
});

test.describe("scenes of other chapters", () => {
  test("expands a chapter that is not open and lists its scenes", async ({ page }) => {
    await newProject(page);
    await addScene(page).click();
    await page.keyboard.type("A quay at dusk.");
    await expect(page.getByRole("status")).toContainText("Saved");

    await page.getByRole("button", { name: "Add chapter" }).click();
    await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter 2");
    await sceneList(page, "Chapter 2").getByRole("button", { name: "Scene", exact: true }).click();
    await page.keyboard.type("A storm warning.");
    await expect(page.getByRole("status")).toContainText("Saved");

    await page.getByRole("button", { name: "Chapter One", exact: true }).click();
    await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter One");
    // Chapter 2 was expanded when it was open, so it still shows its scenes; the chevron closes and opens them.
    await expect(sceneList(page, "Chapter 2")).toContainText("Untitled scene");
    await expect(sceneList(page, "Chapter 2")).toContainText("3");
    // Its own + Scene is not offered: a scene goes into the chapter being written.
    await expect(
      sceneList(page, "Chapter 2").getByRole("button", { name: "Scene", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Hide scenes of Chapter 2" }).click();
    await expect(sceneList(page, "Chapter 2")).toHaveCount(0);
  });
});

test.describe("scenes on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("opens the scenes sheet from the top bar and adds a scene there", async ({ page }) => {
    await newProject(page);
    await page.getByRole("button", { name: "Scenes", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "Scenes" });
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: "Scene", exact: true }).click();
    // A phone shows one thing at a time: the new scene's notes, with a way back to the list.
    const back = sheet.getByRole("button", { name: "Back to scenes" });
    await expect(back).toBeVisible();
    await expect(sheet.getByRole("list", { name: "Scenes" })).toBeHidden();
    await sheet.getByLabel("Scene title").fill("Storm warning");
    await sheet.getByLabel("Scene title").blur();
    await back.click();
    const row = sheet.getByRole("listitem").first();
    await expect(row).toBeVisible();
    await expect(row).toContainText("Storm warning");
    await sheet.getByRole("button", { name: "Close scenes" }).click();
    await expect(sheet).toHaveCount(0);
  });
});
