import { expect, test, type Page } from "./support/coverage";
import { menu } from "./support/a11yScreenHelpers";
import { fakeTauri } from "./support/fakeTauri";
import { newProject, seedChapters } from "./support/helpers";

// File > Analysis… (also in the command palette): the local report over the book and over the open chapter (Q06).

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

const GARDEN = "The garden grew. The garden bloomed. The garden faded. The garden slept.";
const MIXED = 'She felt quietly tired. "Hi," she said.';

/** A chapter document: a heading, then one paragraph per text. */
const chapter = (title: string, ...paragraphs: string[]) =>
  ({
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: title }] },
      ...paragraphs.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
    ],
  }) as unknown as { content: never[] };

/** Chapter one: a heading and GARDEN. Chapter two: a heading and MIXED. */
const seed = (page: Page) =>
  seedChapters(page, [chapter("Chapter One", GARDEN), chapter("Chapter Two", MIXED)]);

const report = (page: Page) => page.getByRole("dialog", { name: "Analysis" });

test("File > Analysis opens the report for the whole book with known counts", async ({ page }) => {
  await newProject(page);
  await seed(page);
  await menu(page, "file.analysis");
  const dialog = report(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("tab", { name: "Book" })).toHaveAttribute("aria-selected", "true");
  // Book: 2 headings and 2 paragraphs, 23 words in 8 sentences (heading text counts too).
  await expect(dialog.locator("dd", { hasText: /^23$/ })).toBeVisible();
  await expect(dialog.locator("dd", { hasText: /^8$/ })).toBeVisible();
  // "garden" is used four times in chapter one.
  await expect(
    dialog.getByRole("table", { name: "Repeated words" }).getByRole("row", { name: /garden/ }),
  ).toContainText("4");
  // One dialogue tag ("she said") in chapter two.
  await expect(
    dialog
      .getByRole("table", { name: "Dialogue tags" })
      .getByRole("row", { name: /Dialogue tags/ }),
  ).toContainText("1");
  // Dale-Chall is pending, and clichés say there is no list yet.
  await expect(dialog.getByText("List pending")).toBeVisible();
  await expect(dialog.getByText("No list bundled yet, so clichés are not counted.")).toBeVisible();
});

test("the Book and Chapter tabs switch with the arrow keys and show the open chapter", async ({
  page,
}) => {
  await newProject(page);
  await seed(page);
  await page.getByRole("button", { name: "Chapter One", exact: true }).click();
  await menu(page, "file.analysis");
  const dialog = report(page);
  await expect(dialog).toBeVisible();
  const book = dialog.getByRole("tab", { name: "Book" });
  await book.focus();
  await page.keyboard.press("ArrowRight");
  const chapterTab = dialog.getByRole("tab", { name: "Chapter" });
  await expect(chapterTab).toHaveAttribute("aria-selected", "true");
  await expect(chapterTab).toBeFocused();
  // Chapter one is open: its 14 words, and no dialogue tag.
  await expect(dialog.locator("dd", { hasText: /^14$/ })).toBeVisible();
  await expect(dialog.getByText("No dialogue tags found.")).toBeVisible();
  await page.keyboard.press("Home");
  await expect(book).toHaveAttribute("aria-selected", "true");
});

test("the command palette opens the same report", async ({ page }) => {
  await newProject(page);
  await seed(page);
  const palette = page.getByRole("combobox", { name: "Command palette" });
  await expect(async () => {
    if ((await palette.count()) === 0) await page.keyboard.press("ControlOrMeta+k");
    await expect(palette).toBeFocused({ timeout: 1500 });
  }).toPass({ timeout: 10_000 });
  await page.keyboard.type("Analysis");
  await page.keyboard.press("Enter");
  await expect(report(page)).toBeVisible();
});
