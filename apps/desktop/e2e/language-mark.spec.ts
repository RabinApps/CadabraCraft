import { expect, test, type Page } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { LINE_END, LINE_START, newProject } from "./support/helpers";

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

const pm = (page: Page) => page.locator(".ProseMirror");
const dialog = (page: Page) => page.getByRole("dialog", { name: "Language of selection" });
const pick = (page: Page) => dialog(page).getByLabel("Language", { exact: true });
const run = (page: Page, id: string) =>
  page.evaluate(async (c) => {
    (await import("/src/state/commands.ts" as string)).runCommand(c);
  }, id);

/** Whether the editor's selection is in a language mark, as the Language command sees it (the editor's own state). */
const langChecked = (page: Page) =>
  page.evaluate(async () =>
    Boolean(
      (await import("/src/state/commands.ts" as string)).getCommands()["editor.lang"]?.checked,
    ),
  );

/** Types `text` in the last (single-line) paragraph and selects it. */
async function typeAndSelect(page: Page, text: string) {
  await pm(page).locator("p").last().click();
  await page.keyboard.type(text);
  await expect(pm(page).locator("p").last()).toHaveText(text);
  // A triple click makes ProseMirror select the paragraph in its own mousedown handler, so its state is updated at once.
  // A DOM range or Shift+Arrow only moves the browser's selection, which ProseMirror reads on a later selectionchange.
  await pm(page).locator("p").last().click({ clickCount: 3 });
}

async function savedChapter(page: Page) {
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved");
  const text = await page.evaluate(
    () => window.__disk["manuscript/001-chapter-one.json"] as string,
  );
  return JSON.stringify(JSON.parse(text));
}

test.describe("language of a passage", () => {
  test("marks the selection with a language picked from the list, shows it, saves it and clears it", async ({
    page,
  }) => {
    await newProject(page);
    await typeAndSelect(page, "Bonjour tout le monde");
    await run(page, "editor.lang");
    await pick(page).selectOption("fr");
    await expect(dialog(page).getByLabel("Language tag")).toHaveValue("fr");
    await dialog(page).getByRole("button", { name: "Apply" }).click();
    await expect(dialog(page)).toHaveCount(0);

    await expect(pm(page).locator('span[lang="fr"]')).toHaveText("Bonjour tout le monde");
    expect(await savedChapter(page)).toContain('"marks":[{"type":"lang","attrs":{"lang":"fr"}}]');

    // Put the caret in the passage again, so the dialog opens on its language and offers to clear it. (WebKit may put the
    // caret back at the start of the editor when the dialog closes, so the earlier selection is not something to rely on.)
    await expect(dialog(page)).toHaveCount(0);
    await pm(page).locator('span[lang="fr"]').click();
    await expect.poll(() => langChecked(page)).toBe(true);
    await run(page, "editor.lang");
    await expect(dialog(page).getByLabel("Language tag")).toHaveValue("fr");
    await dialog(page).getByRole("button", { name: "Clear language" }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(pm(page).locator("span[lang]")).toHaveCount(0);
  });

  test("takes any BCP 47 tag, refuses a bad one, and needs a selection", async ({ page }) => {
    await newProject(page);
    // Nothing selected.
    await pm(page).locator("p").last().click();
    await run(page, "editor.lang");
    await dialog(page).getByLabel("Language tag").fill("fr-CA");
    await dialog(page).getByRole("button", { name: "Apply" }).click();
    await expect(dialog(page).getByRole("alert")).toHaveText("Select the text first.");
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);

    await typeAndSelect(page, "Salut");
    await run(page, "editor.lang");
    await dialog(page).getByLabel("Language tag").fill("fr CA");
    await dialog(page).getByRole("button", { name: "Apply" }).click();
    await expect(dialog(page).getByRole("alert")).toContainText(
      "letters, digits and single hyphens",
    );
    await dialog(page).getByLabel("Language tag").fill("fr-CA");
    await expect(dialog(page).getByRole("alert")).toHaveCount(0);
    // A tag that is not in the list leaves the list on "Other".
    await expect(pick(page)).toHaveValue("");
    await dialog(page).getByRole("button", { name: "Apply" }).click();
    await expect(pm(page).locator('span[lang="fr-CA"]')).toHaveText("Salut");
    expect(await savedChapter(page)).toContain('"lang":"fr-CA"');
  });

  test("changes a passage's language from inside it, and Clear Language removes it; Cancel keeps it", async ({
    page,
  }) => {
    await newProject(page);
    await typeAndSelect(page, "Guten Tag");
    await run(page, "editor.lang");
    await dialog(page).getByLabel("Language tag").fill("de");
    await dialog(page).getByRole("button", { name: "Apply" }).click();
    await expect(pm(page).locator('span[lang="de"]')).toHaveCount(1);

    // Put the caret inside the passage (no selection) and change it.
    await pm(page).locator("p").last().click();
    await page.keyboard.press(LINE_START);
    await page.keyboard.press("ArrowRight");
    await run(page, "editor.lang");
    await expect(pick(page)).toHaveValue("de");
    await pick(page).selectOption("it");
    await dialog(page).getByRole("button", { name: "Cancel" }).click();
    await expect(pm(page).locator('span[lang="de"]')).toHaveCount(1);

    await run(page, "editor.lang");
    await pick(page).selectOption("it");
    await dialog(page).getByRole("button", { name: "Apply" }).click();
    await expect(pm(page).locator('span[lang="it"]')).toHaveText("Guten Tag");
    await expect(pm(page).locator('span[lang="de"]')).toHaveCount(0);

    // Wait for the dialog to finish closing and hand focus back, then for ProseMirror to read the restored selection.
    await expect(dialog(page)).toHaveCount(0);
    await expect(pm(page)).toBeFocused();
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    );
    await run(page, "editor.clearLang");
    await expect(pm(page).locator("span[lang]")).toHaveCount(0);
    await expect(pm(page).locator("p").last()).toHaveText("Guten Tag");
  });

  test("typing after the passage goes back to the book's language", async ({ page }) => {
    await newProject(page);
    await typeAndSelect(page, "Ciao");
    await run(page, "editor.lang");
    await dialog(page).getByLabel("Language tag").fill("it");
    await dialog(page).getByRole("button", { name: "Apply" }).click();
    await expect(pm(page).locator('span[lang="it"]')).toHaveText("Ciao");
    // The dialog hands focus (and the selection) back to the editor after it closes; clicking before that lets the
    // restore overwrite the caret and the typed text replace the passage.
    await expect(dialog(page)).toHaveCount(0);
    await expect(pm(page)).toBeFocused();
    await pm(page).locator("p").last().click();
    await page.keyboard.press(LINE_END);
    await page.keyboard.type(" amici");
    await expect(pm(page).locator("p").last()).toHaveText("Ciao amici");
    await expect(pm(page).locator('span[lang="it"]')).toHaveText("Ciao");
  });
});
