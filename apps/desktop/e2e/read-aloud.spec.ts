import { expect, test } from "./support/coverage";
import { menu } from "./support/a11yScreenHelpers";
import { fakeTauri } from "./support/fakeTauri";
import { chapterDoc, newProject, seedChapters } from "./support/helpers";

// Read aloud in the editor: View > Read Aloud from Cursor plays the chapter with the book's local voice (the fake engine
// returns silence), highlights the sentence being read as a decoration, and stops when the text changes. The bar shows only
// while a run is active. See architecture.md, "Read aloud in the editor".

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

// Thirty one-sentence paragraphs: long enough that the reading is still running when the test acts.
const longChapter = () => chapterDoc("Reading", 30, 12);

test("the bar is hidden until reading starts, and typing stops it", async ({ page }) => {
  await newProject(page);
  await seedChapters(page, [longChapter()]);
  const bar = page.getByRole("group", { name: "Read aloud" });
  await expect(bar).toHaveCount(0);

  await menu(page, "view.readAloud");

  await expect(bar.locator("[aria-live=polite]")).toHaveText("Reading aloud");
  await expect(bar.getByRole("button", { name: "Pause" })).toBeVisible();
  await expect(page.locator(".ProseMirror .read-aloud-current")).toHaveCount(1);
  // The highlight is a decoration: it does not change the text.
  expect(
    await page.evaluate(
      () => (window as unknown as { __sampleCalls?: unknown[] }).__sampleCalls?.length ?? 0,
    ),
  ).toBeGreaterThan(0);

  await page.locator(".ProseMirror").first().click();
  await page.keyboard.type("x");

  await expect(bar).toHaveCount(0);
  await expect(page.locator(".ProseMirror .read-aloud-current")).toHaveCount(0);
});

test("Stop ends reading, hides the bar and clears the highlight", async ({ page }) => {
  await newProject(page);
  await seedChapters(page, [longChapter()]);
  const bar = page.getByRole("group", { name: "Read aloud" });
  await menu(page, "view.readAloud");
  await expect(page.locator(".ProseMirror .read-aloud-current")).toHaveCount(1);

  await bar.getByRole("button", { name: "Stop" }).click();

  await expect(bar).toHaveCount(0);
  await expect(page.locator(".ProseMirror .read-aloud-current")).toHaveCount(0);
});
