import { expect, test } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { chapterDoc, newProject, seedChapters } from "./support/helpers";

// Read aloud in the editor: the bar plays the chapter with the book's local voice (the fake engine returns silence),
// highlights the sentence being read as a decoration, and stops when the text changes. See architecture.md, "Read aloud in the editor".

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

// Thirty one-sentence paragraphs: long enough that the reading is still running when the test acts.
const longChapter = () => chapterDoc("Reading", 30, 12);

test("play starts reading, highlights the sentence, and typing stops it", async ({ page }) => {
  await newProject(page);
  await seedChapters(page, [longChapter()]);
  const bar = page.getByRole("group", { name: "Read aloud" });
  const play = bar.getByRole("button", { name: "Play" });
  await play.click();

  await expect(bar.locator("[aria-live=polite]")).toHaveText("Reading aloud");
  await expect(bar.getByRole("button", { name: "Pause" })).toBeVisible();
  await expect(page.locator(".ProseMirror .read-aloud-current")).toHaveCount(1);
  // The highlight is a decoration: the button keeps the focus and the text is unchanged.
  await expect(bar.getByRole("button", { name: "Pause" })).toBeFocused();
  expect(
    await page.evaluate(
      () => (window as unknown as { __sampleCalls?: unknown[] }).__sampleCalls?.length ?? 0,
    ),
  ).toBeGreaterThan(0);

  await page.locator(".ProseMirror").first().click();
  await page.keyboard.type("x");

  await expect(bar.locator("[aria-live=polite]")).toHaveText(
    "Read aloud stopped because the text changed",
  );
  await expect(page.locator(".ProseMirror .read-aloud-current")).toHaveCount(0);
  await expect(bar.getByRole("button", { name: "Play" })).toBeVisible();
});

test("Stop ends reading and clears the highlight", async ({ page }) => {
  await newProject(page);
  await seedChapters(page, [longChapter()]);
  const bar = page.getByRole("group", { name: "Read aloud" });
  await bar.getByRole("button", { name: "Play" }).click();
  await expect(page.locator(".ProseMirror .read-aloud-current")).toHaveCount(1);

  await bar.getByRole("button", { name: "Stop" }).click();

  await expect(bar.locator("[aria-live=polite]")).toHaveText("Read aloud stopped");
  await expect(page.locator(".ProseMirror .read-aloud-current")).toHaveCount(0);
});
