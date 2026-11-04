import { unzipSync, strFromU8 } from "fflate";
import { expect, test, type Page } from "./support/coverage";
import { audit } from "./support/audit";
import { covBackend, failOn, stopFailing } from "./support/cov";
import { fakeTauri } from "./support/fakeTauri";
import {
  addPage,
  chapterDoc,
  exportBook,
  frenchWithOneChapter,
  manifestOf,
  newProject,
  seedChapters,
  sidebar,
} from "./support/helpers";

// The Contents page: a front-matter page whose list is generated from the outline, edited here (depth, hidden, renamed, moved and
// custom entries are overrides saved on the page) and shown with page numbers from Typst's report or the word-count estimate.

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

type Node = { type: string; attrs?: { level: number }; content?: { type: string; text: string }[] };
const heading = (level: number, text: string): Node => ({
  type: "heading",
  attrs: { level },
  content: [{ type: "text", text }],
});
/** A chapter document; `seedChapters` writes it as is, so it carries its own type. */
const doc = (...content: Node[]) => ({ type: "doc", content }) as unknown as { content: Node[] };
const para = (text: string): Node => ({ type: "paragraph", content: [{ type: "text", text }] });

/** Three chapters: the first and second have headings of levels 1 to 3. */
async function threeChapters(page: Page) {
  await newProject(page);
  await seedChapters(page, [
    doc(
      heading(1, "Arrival"),
      para("Words."),
      heading(2, "The harbour"),
      heading(3, "Gulls"),
      heading(2, "The inn"),
    ),
    doc(heading(1, "Storm"), para("More words."), heading(2, "The harbour")),
    chapterDoc("Calm", 1),
  ]);
}

const contents = (page: Page) => page.getByRole("region", { name: "Contents" });
const entries = (page: Page) => contents(page).getByRole("list", { name: "Contents entries" });
const entryTitles = async (page: Page) =>
  (await entries(page).locator("[data-toc-key] span.truncate").allTextContents()).map((s) =>
    s.trim(),
  );
const row = (page: Page, title: string) =>
  entries(page).locator("[data-toc-key]").filter({ hasText: title }).first();
const menuOf = (page: Page, title: string) =>
  contents(page)
    .getByRole("button", { name: `Actions for ${title}`, exact: true })
    .first();
const tocOf = async (page: Page) =>
  (await manifestOf(page)).frontMatter.find((e: { kind?: string }) => e.kind === "contents");
const depth = (page: Page, label: string) =>
  contents(page).getByRole("radio", { name: label, exact: true }).click();

async function sidebarAction(page: Page, chapter: string, item: string) {
  await sidebar(page)
    .getByRole("button", { name: `Actions for ${chapter}` })
    .click();
  await page.getByRole("menuitem", { name: item }).click();
}

async function openContents(page: Page) {
  await addPage(page, "Contents");
  await expect(contents(page)).toBeVisible();
}

test("Contents is a single-use front-matter page; selecting it shows the list instead of the editor", async ({
  page,
}) => {
  await threeChapters(page);
  await page.getByRole("button", { name: "Add page" }).click();
  await page.getByRole("menuitem", { name: "Contents", exact: true }).click();
  await expect(contents(page)).toBeVisible();
  await expect(page.locator(".ProseMirror")).toHaveCount(0);
  const m = await manifestOf(page);
  expect(m.formatVersion).toBe(9);
  expect(m.frontMatter.map((e: { kind: string }) => e.kind)).toEqual(["contents"]);
  expect(await entryTitles(page)).toEqual(["Arrival", "Storm", "Calm"]);
  // A second one cannot be added.
  await page.getByRole("button", { name: "Add page" }).click();
  await expect(page.getByRole("menuitem", { name: "Contents", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  // Open a chapter and come back: the editor shows for the chapter, the list for the contents page.
  await sidebar(page).getByRole("button", { name: "Arrival", exact: true }).click();
  await expect(page.locator(".ProseMirror h1")).toHaveText("Arrival");
  await expect(contents(page)).toHaveCount(0);
  await sidebar(page).getByRole("button", { name: "Contents", exact: true }).click();
  await expect(contents(page)).toBeVisible();
});

test("the list follows the book: added, renamed, moved and trashed chapters change it", async ({
  page,
}) => {
  await threeChapters(page);
  await openContents(page);
  await page.getByRole("button", { name: "Add chapter" }).click();
  await sidebar(page).getByRole("button", { name: "Contents", exact: true }).click();
  expect(await entryTitles(page)).toEqual(["Arrival", "Storm", "Calm", "Chapter 4"]);
  await sidebarAction(page, "Chapter 4", "Rename");
  await page.getByLabel("Chapter title").fill("Dawn");
  await page.keyboard.press("Enter");
  await sidebar(page).getByRole("button", { name: "Contents", exact: true }).click();
  expect(await entryTitles(page)).toEqual(["Arrival", "Storm", "Calm", "Dawn"]);
  await sidebarAction(page, "Dawn", "Move up");
  await sidebar(page).getByRole("button", { name: "Contents", exact: true }).click();
  expect(await entryTitles(page)).toEqual(["Arrival", "Storm", "Dawn", "Calm"]);
  await sidebarAction(page, "Storm", "Move to trash");
  await page.getByRole("dialog").getByRole("button", { name: "Move to trash" }).click();
  await sidebar(page).getByRole("button", { name: "Contents", exact: true }).click();
  expect(await entryTitles(page)).toEqual(["Arrival", "Dawn", "Calm"]);
});

test("depth lists headings: +H1, +H1-H2, +H1-H3, and back to chapters", async ({ page }) => {
  await threeChapters(page);
  await openContents(page);
  await depth(page, "+H1-H3");
  await expect(row(page, "Gulls")).toBeVisible();
  expect((await tocOf(page)).toc.depth).toBe(3);
  expect(await entryTitles(page)).toEqual([
    "Arrival",
    "Arrival",
    "The harbour",
    "Gulls",
    "The inn",
    "Storm",
    "Storm",
    "The harbour",
    "Calm",
    "Calm",
  ]);
  await depth(page, "+H1-H2");
  await expect(row(page, "Gulls")).toHaveCount(0);
  await expect(row(page, "The inn")).toBeVisible();
  await depth(page, "+H1");
  await expect(row(page, "The inn")).toHaveCount(0);
  await depth(page, "Chapters");
  expect(await entryTitles(page)).toEqual(["Arrival", "Storm", "Calm"]);
  expect((await tocOf(page)).toc.depth).toBe(0);
});

test("rename in place (double-click, menu, Enter, Escape) and revert to the generated title", async ({
  page,
}) => {
  await threeChapters(page);
  await openContents(page);
  await row(page, "Storm").getByText("Storm").dblclick();
  await page.getByLabel("Entry title").fill("The Great Storm");
  await page.keyboard.press("Enter");
  await expect(row(page, "The Great Storm")).toBeVisible();
  expect((await tocOf(page)).toc.titles).toEqual({ "chapter-2": { en: "The Great Storm" } });
  // The chapter itself keeps its title.
  await expect(sidebar(page).getByRole("button", { name: "Storm", exact: true })).toBeVisible();
  // Escape cancels.
  await menuOf(page, "Calm").click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await page.getByLabel("Entry title").fill("Nope");
  await page.keyboard.press("Escape");
  await expect(row(page, "Calm")).toBeVisible();
  expect(Object.keys((await tocOf(page)).toc.titles)).toEqual(["chapter-2"]);
  // Reset this entry brings the generated title back.
  await menuOf(page, "The Great Storm").click();
  await page.getByRole("menuitem", { name: "Reset this entry" }).click();
  await expect(row(page, "Storm")).toBeVisible();
  expect((await tocOf(page)).toc.titles).toEqual({});
  // An empty text also reverts.
  await menuOf(page, "Storm").click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await page.getByLabel("Entry title").fill("Squall");
  await page.keyboard.press("Enter");
  await expect(row(page, "Squall")).toBeVisible();
  await menuOf(page, "Squall").click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await page.getByLabel("Entry title").fill("  ");
  await page.keyboard.press("Enter");
  await expect(row(page, "Storm")).toBeVisible();
});

test("Enter that confirms an input-method candidate does not commit the rename", async ({
  page,
}) => {
  await threeChapters(page);
  await openContents(page);
  await row(page, "Storm").getByText("Storm").dblclick();
  const field = page.getByLabel("Entry title");
  await field.fill("あらし");
  // The Enter that picks a conversion candidate arrives with isComposing set: the field stays open and nothing is saved.
  await field.dispatchEvent("keydown", { key: "Enter", isComposing: true });
  await expect(field).toBeVisible();
  expect((await tocOf(page)).toc).toBeUndefined(); // nothing was saved: the page still has no settings
  // The Enter that follows, once the text is confirmed, commits it.
  await page.keyboard.press("Enter");
  await expect(row(page, "あらし")).toBeVisible();
  expect((await tocOf(page)).toc.titles).toEqual({ "chapter-2": { en: "あらし" } });
});

test("hide and show an entry", async ({ page }) => {
  await threeChapters(page);
  await openContents(page);
  await menuOf(page, "Storm").click();
  await page.getByRole("menuitem", { name: "Hide from contents" }).click();
  await expect(row(page, "Storm")).toContainText("Hidden");
  expect((await tocOf(page)).toc.hidden).toEqual(["chapter-2"]);
  await menuOf(page, "Storm").click();
  await page.getByRole("menuitem", { name: "Show in contents" }).click();
  await expect(row(page, "Storm")).not.toContainText("Hidden");
  expect((await tocOf(page)).toc.hidden).toEqual([]);
});

test("reorder by the actions menu (keyboard and touch alternative) and by dragging the grip", async ({
  page,
}) => {
  await threeChapters(page);
  await openContents(page);
  await menuOf(page, "Calm").click();
  await page.getByRole("menuitem", { name: "Move up" }).click();
  expect(await entryTitles(page)).toEqual(["Arrival", "Calm", "Storm"]);
  await menuOf(page, "Arrival").click();
  await expect(page.getByRole("menuitem", { name: "Move up" })).toBeDisabled();
  await page.getByRole("menuitem", { name: "Move down" }).click();
  expect(await entryTitles(page)).toEqual(["Calm", "Arrival", "Storm"]);
  expect((await tocOf(page)).toc.order).toEqual(["chapter-3", "chapter-1", "chapter-2"]);
  await menuOf(page, "Storm").click();
  await expect(page.getByRole("menuitem", { name: "Move down" })).toBeDisabled();
  await page.keyboard.press("Escape");
  // Drag Storm above Calm.
  const grip = row(page, "Storm").locator("[data-grip]");
  const target = await row(page, "Calm").boundingBox();
  const from = (await grip.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 10, target!.y + 2, { steps: 6 });
  await expect(page.locator("[data-drop-line]")).toHaveCount(1);
  await page.mouse.up();
  expect(await entryTitles(page)).toEqual(["Storm", "Calm", "Arrival"]);
  // The chapters themselves did not move.
  expect((await manifestOf(page)).chapters.map((c: { id: string }) => c.id)).toEqual([
    "chapter-1",
    "chapter-2",
    "chapter-3",
  ]);
});

test("a custom entry takes its page number from the entry it points at; it can be renamed and removed", async ({
  page,
}) => {
  await threeChapters(page);
  await openContents(page);
  await contents(page).getByRole("button", { name: "Add custom entry" }).click();
  const dialog = page.getByRole("dialog", { name: "Add custom entry" });
  // An empty title is refused with a message, not by a dead button (see a11y-errors.spec.ts).
  await dialog.getByRole("button", { name: "Add entry" }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog.getByLabel("Entry title").fill("Afterword");
  await dialog.getByLabel("Place after").selectOption({ label: "Storm" });
  await dialog.getByLabel("Points to").selectOption({ label: "Calm" });
  await dialog.getByRole("button", { name: "Add entry" }).click();
  expect(await entryTitles(page)).toEqual(["Arrival", "Storm", "Afterword", "Calm"]);
  await expect(row(page, "Afterword")).toContainText("Custom");
  expect((await tocOf(page)).toc.custom).toEqual([
    { id: "c-1", titles: { en: "Afterword" }, after: "chapter-2", target: "chapter-3" },
  ]);
  await row(page, "Afterword").getByText("Afterword").dblclick();
  await page.getByLabel("Entry title").fill("Closing words");
  await page.keyboard.press("Enter");
  await expect(row(page, "Closing words")).toBeVisible();
  await menuOf(page, "Closing words").click();
  await page.getByRole("menuitem", { name: "Remove entry" }).click();
  expect(await entryTitles(page)).toEqual(["Arrival", "Storm", "Calm"]);
  expect((await tocOf(page)).toc.custom).toEqual([]);
});

test("an entry whose chapter is gone shows as stale and can be removed", async ({ page }) => {
  await threeChapters(page);
  await openContents(page);
  await menuOf(page, "Storm").click();
  await page.getByRole("menuitem", { name: "Hide from contents" }).click();
  // A custom entry placed after Storm that points at Calm.
  await contents(page).getByRole("button", { name: "Add custom entry" }).click();
  const dialog = page.getByRole("dialog", { name: "Add custom entry" });
  await dialog.getByLabel("Entry title").fill("Interlude");
  await dialog.getByLabel("Place after").selectOption({ label: "Storm" });
  await dialog.getByLabel("Points to").selectOption({ label: "Storm" });
  await dialog.getByRole("button", { name: "Add entry" }).click();
  await expect(row(page, "Interlude")).not.toContainText("Stale");
  await sidebar(page).getByRole("button", { name: "Storm", exact: true }).click();
  await sidebarAction(page, "Storm", "Move to trash");
  await page.getByRole("dialog").getByRole("button", { name: "Move to trash" }).click();
  await sidebar(page).getByRole("button", { name: "Contents", exact: true }).click();
  await expect(row(page, "Interlude")).toContainText("Stale");
  const stale = contents(page).getByRole("region", { name: "Changes that no longer match" });
  await expect(stale).toBeVisible();
  await expect(stale.getByRole("listitem")).toHaveCount(1);
  expect((await tocOf(page)).toc.hidden).toEqual(["chapter-2"]); // kept on disk
  await stale.getByRole("button", { name: /Remove change for/ }).click();
  await expect(stale).toHaveCount(0);
  expect((await tocOf(page)).toc.hidden).toEqual([]);
  await menuOf(page, "Interlude").click();
  await page.getByRole("menuitem", { name: "Remove entry" }).click();
  await expect(row(page, "Interlude")).toHaveCount(0);
});

test("Reset to outline asks first; cancel keeps the changes, confirm clears them and keeps depth and numbers", async ({
  page,
}) => {
  await threeChapters(page);
  await openContents(page);
  const reset = contents(page).getByRole("button", { name: "Reset to outline" });
  await expect(reset).toBeDisabled();
  await depth(page, "+H1");
  await contents(page).getByRole("switch", { name: "Page numbers" }).click();
  await menuOf(page, "Calm").click();
  await page.getByRole("menuitem", { name: "Move up" }).click();
  await menuOf(page, "Storm").click();
  await page.getByRole("menuitem", { name: "Hide from contents" }).click();
  await reset.click();
  const confirm = page.getByRole("dialog", { name: "Reset the contents to the outline?" });
  await confirm.getByRole("button", { name: "Cancel" }).click();
  expect((await tocOf(page)).toc.hidden).toEqual(["chapter-2"]);
  await reset.click();
  await confirm.getByRole("button", { name: "Reset to outline" }).click();
  const toc = (await tocOf(page)).toc;
  expect(toc).toEqual({ depth: 1, pageNumbers: false, hidden: [], titles: {}, custom: [] });
  expect(await entryTitles(page)).toEqual(["Arrival", "Arrival", "Storm", "Storm", "Calm", "Calm"]);
});

test("page numbers: Typst's report when it has one, an estimate with ≈ otherwise, none when switched off", async ({
  page,
}) => {
  await threeChapters(page);
  await openContents(page);
  const pageOf = (title: string) => row(page, title).locator("[data-toc-page]");
  // No report (the fake Typst answers with an empty book): the word-count estimate, marked.
  await expect(pageOf("Arrival")).toContainText("≈ 1");
  await expect(pageOf("Calm")).toContainText("≈");
  const m = await manifestOf(page);
  const ids = m.chapters.map((c: { id: string }) => c.id) as string[];
  const contentsId = m.frontMatter[0].id as string;
  await page.evaluate(
    ([c, [a, b, d]]) => {
      window.__typstQueryResult = JSON.stringify({
        total: 40,
        starts: [
          { id: c, kind: "contents", page: 3, end: 3, number: "iii" },
          { id: a, kind: "chapter", page: 5, end: 12, number: "1" },
          { id: b, kind: "chapter", page: 13, end: 30, number: "9" },
          { id: d, kind: "chapter", page: 31, end: 40, number: "27" },
        ],
        // Typst's page marks, as [ "s", entry index in starts, block, kind, page ]: the headings of the three chapters.
        marks: [
          ["s", 1, 0, "h", 5],
          ["s", 1, 2, "h", 6],
          ["s", 1, 3, "h", 8],
          ["s", 1, 4, "h", 10],
          ["s", 2, 0, "h", 13],
          ["s", 2, 2, "h", 20],
          ["s", 3, 0, "h", 31],
        ],
      });
    },
    [contentsId, ids] as const,
  );
  // A change to the book asks Typst again once it has been still. The new chapter is not in the report: it keeps its estimate.
  await page.getByRole("button", { name: "Add chapter" }).click();
  await sidebar(page).getByRole("button", { name: "Contents", exact: true }).click();
  await expect(pageOf("Arrival")).toHaveText("1", { timeout: 15_000 });
  await expect(pageOf("Storm")).toHaveText("9");
  await expect(pageOf("Calm")).toHaveText("27");
  await expect(pageOf("Chapter 4")).toContainText("≈");
  await depth(page, "+H1-H2");
  // Headings: Arrival 1; The harbour (page 6 -> 2); The inn (page 10 -> 6).
  await expect(row(page, "The harbour").first().locator("[data-toc-page]")).toHaveText("2", {
    timeout: 15_000,
  });
  await expect(row(page, "The inn").locator("[data-toc-page]")).toHaveText("6");
  await contents(page).getByRole("switch", { name: "Page numbers" }).click();
  await expect(entries(page).locator("[data-toc-page]")).toHaveCount(0);
  expect((await tocOf(page)).toc.pageNumbers).toBe(false);
});

test("the settings and overrides survive a reload; Undo and Redo walk through them", async ({
  page,
}) => {
  await threeChapters(page);
  await openContents(page);
  await depth(page, "+H1");
  await menuOf(page, "Storm").click();
  await page.getByRole("menuitem", { name: "Hide from contents" }).click();
  await row(page, "Calm").getByText("Calm").first().dblclick();
  await page.getByLabel("Entry title").fill("Still water");
  await page.keyboard.press("Enter");
  await expect(row(page, "Still water")).toBeVisible();
  const undo = page.getByRole("button", { name: /^Undo: / });
  await expect(undo).toHaveAttribute("aria-label", "Undo: Rename contents entry");
  await undo.click();
  await expect(row(page, "Calm").first()).toBeVisible();
  await expect(row(page, "Still water")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Redo: / })).toHaveAttribute(
    "aria-label",
    "Redo: Rename contents entry",
  );
  await page.getByRole("button", { name: /^Undo: / }).click(); // hide
  await expect(row(page, "Storm").first()).not.toContainText("Hidden");
  await page.getByRole("button", { name: /^Redo: / }).click();
  await expect(row(page, "Storm").first()).toContainText("Hidden");
  await page.getByRole("button", { name: /^Redo: / }).click();
  await expect(row(page, "Still water")).toBeVisible();
  expect((await tocOf(page)).toc.hidden).toEqual(["chapter-2"]);
  await page.reload();
  await page.getByRole("button", { name: "Open folder" }).click();
  await sidebar(page).getByRole("button", { name: "Contents", exact: true }).click();
  await expect(row(page, "Still water")).toBeVisible();
  await expect(row(page, "Storm").first()).toContainText("Hidden");
  await expect(contents(page).getByRole("radio", { name: "+H1", exact: true })).toBeChecked();
});

test("an edition shows and saves its own titles", async ({ page }) => {
  await frenchWithOneChapter(page);
  await openContents(page);
  // French edition is open: the second chapter is not translated, the list falls back to the source title.
  await expect(row(page, "Chapter One")).toBeVisible();
  await row(page, "Chapter One").getByText("Chapter One").dblclick();
  await page.getByLabel("Entry title").fill("Premier chapitre");
  await page.keyboard.press("Enter");
  await expect(row(page, "Premier chapitre")).toBeVisible();
  const first = (await manifestOf(page)).chapters[0].id as string;
  expect((await tocOf(page)).toc.titles[first]).toEqual({ fr: "Premier chapitre" });
  await page.getByRole("button", { name: /Edition: Français/ }).click();
  await page.getByRole("menuitem", { name: /English/ }).click();
  await sidebar(page).getByRole("button", { name: "Contents", exact: true }).click();
  await expect(row(page, "Chapter One")).toBeVisible();
  await expect(row(page, "Premier chapitre")).toHaveCount(0);
});

test("a save failure shows the notice and leaves the list as it was", async ({ page }) => {
  await covBackend(page);
  await threeChapters(page);
  await openContents(page);
  await failOn(page, "write_project_file", { kind: "disk_full", path: "cadabra.json" });
  await menuOf(page, "Storm").click();
  await page.getByRole("menuitem", { name: "Hide from contents" }).click();
  await expect(page.getByText(/Could not change the contents page/)).toBeVisible();
  await expect(row(page, "Storm")).not.toContainText("Hidden");
  await stopFailing(page, "write_project_file");
  await menuOf(page, "Storm").click();
  await page.getByRole("menuitem", { name: "Hide from contents" }).click();
  await expect(row(page, "Storm")).toContainText("Hidden");
});

/** Renames Storm and hides Calm, lists headings to +H1, and adds a custom entry: the changes every export must show. */
async function arrange(page: Page) {
  await depth(page, "+H1");
  await row(page, "Storm").getByText("Storm").first().dblclick();
  await page.getByLabel("Entry title").fill("The Great Storm");
  await page.keyboard.press("Enter");
  // Calm is listed as a page and as its own H1 heading: hide both.
  for (const at of [0, 1]) {
    await contents(page)
      .getByRole("button", { name: "Actions for Calm", exact: true })
      .nth(at)
      .click();
    await page.getByRole("menuitem", { name: "Hide from contents" }).click();
  }
  await contents(page).getByRole("button", { name: "Add custom entry" }).click();
  const dialog = page.getByRole("dialog", { name: "Add custom entry" });
  await dialog.getByLabel("Entry title").fill("Afterword");
  await dialog.getByLabel("Place after").selectOption({ label: "The Great Storm" });
  await dialog.getByRole("button", { name: "Add entry" }).click();
  await expect(row(page, "Afterword")).toBeVisible();
}

test("the EPUB has the list on its Contents page and in its navigation, with the author's changes", async ({
  page,
}) => {
  await threeChapters(page);
  await openContents(page);
  await arrange(page);
  await exportBook(page, "EPUB 3");
  await expect(page.getByRole("status")).toHaveText("Exported exports/en/book.epub");
  const bytes = await page.evaluate(() => window.__disk["exports/en/book.epub"] as number[]);
  const files = unzipSync(Uint8Array.from(bytes));
  const id = (await tocOf(page)).id as string;
  const list = strFromU8(files[`OEBPS/${id}.xhtml`]!);
  const nav = strFromU8(files["OEBPS/nav.xhtml"]!);
  for (const xhtml of [list, nav]) {
    expect(xhtml).toContain("The Great Storm");
    expect(xhtml).toContain("Afterword");
    expect(xhtml).toContain("Arrival");
    expect(xhtml).not.toContain(">Calm<"); // hidden
    expect(xhtml.indexOf("The Great Storm")).toBeLessThan(xhtml.indexOf("Afterword"));
  }
  expect(list).toMatch(/<a href="chapter-1\.xhtml#[^"]+">Arrival<\/a>/); // headings link inside the page
});

test("the print PDF is typeset with the list: titles, renames, hidden entries and the page-number switch", async ({
  page,
}) => {
  await threeChapters(page);
  await openContents(page);
  await arrange(page);
  await exportBook(page, "Print PDF");
  await expect(page.getByRole("status")).toHaveText("Exported exports/en/book.pdf");
  const source = await page.evaluate(() => window.__typstCalls.at(-1)!.source);
  expect(source).toContain("toc-list(");
  expect(source).toContain('title: "The Great Storm"');
  expect(source).toContain('title: "Afterword"');
  expect(source).not.toContain('title: "Calm"'); // hidden entries are not listed
  expect(source).toContain("#let toc-numbers = true");
  await contents(page).getByRole("switch", { name: "Page numbers" }).click();
  await exportBook(page, "Print PDF");
  await expect(page.getByRole("status")).toHaveText("Exported exports/en/book.pdf");
  expect(await page.evaluate(() => window.__typstCalls.at(-1)!.source)).toContain(
    "#let toc-numbers = false",
  );
});

test("Markdown carries the list as nested links", async ({ page }) => {
  await threeChapters(page);
  await openContents(page);
  await arrange(page);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export book" });
  await dialog.getByRole("radio", { name: "Markdown" }).click();
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Exported exports/en/book.md");
  const md = await page.evaluate(() =>
    new TextDecoder().decode(new Uint8Array(window.__disk["exports/en/book.md"] as number[])),
  );
  expect(md).toContain("The Great Storm");
  expect(md).toContain("Afterword");
  expect(md).not.toContain("[Calm]"); // hidden
});

const typstMissing = (page: Page) =>
  page.evaluate(() => {
    window.__typstError = { kind: "not_found", message: "The typst program was not found." };
  });
const readMode = (page: Page) => page.getByRole("radio", { name: "Read" }).click();
const writeMode = (page: Page) => page.getByRole("radio", { name: "Write" }).click();
/** The first reading section: the Contents page. */
const readContents = (page: Page) => page.getByTestId("reading-contents");
/** The printed lines of the Contents page as drawn (the preview in Write mode, the reader in Read mode): title and number of each. */
const printed = (scope: ReturnType<Page["locator"]>) =>
  scope
    .locator("[data-preview-line]")
    .evaluateAll((els) =>
      els.map((el) => [
        el.querySelector("a, span")?.textContent?.trim() ?? "",
        el.querySelector("[data-number]")?.textContent?.trim() ?? null,
        el.getAttribute("data-preview-line"),
      ]),
    );

test("Read mode draws the Contents page as Write mode does: same entries, order, renames, hidden entries and numbers", async ({
  page,
}) => {
  await threeChapters(page);
  await typstMissing(page);
  await openContents(page);
  await depth(page, "+H1-H2");
  await row(page, "Storm").getByText("Storm").first().dblclick();
  await page.getByLabel("Entry title").fill("The Great Storm");
  await page.keyboard.press("Enter");
  await expect(row(page, "The Great Storm")).toBeVisible();
  await menuOf(page, "The inn").click();
  await page.getByRole("menuitem", { name: "Hide from contents" }).click();
  await expect(row(page, "The inn")).toContainText("Hidden");
  const preview = page.getByRole("region", { name: "Preview" });
  const titlesOf = () => printed(preview).then((l) => l.map((x) => x[0]));
  await expect.poll(titlesOf).toContain("The Great Storm");
  await expect.poll(titlesOf).not.toContain("The inn");
  const written = await printed(preview);
  expect(written.length).toBeGreaterThan(5);
  expect(written.every((l) => /^(≈\d+|–)$/.test(l[1] ?? ""))).toBe(true);
  await readMode(page);
  await expect(readContents(page)).toBeVisible();
  // The same lines (keys included), in the same order, with the same estimated numbers.
  expect(await printed(readContents(page))).toEqual(written);
  // One list with an accessible name, whose entries are links.
  await expect(page.getByRole("navigation", { name: "Contents entries" })).toBeVisible();
  await expect(readContents(page).getByRole("list", { name: "Printed entries" })).toBeVisible();
  await expect(readContents(page).getByRole("link", { name: "The Great Storm" })).toBeVisible();
  // Back in Write mode nothing has changed.
  await writeMode(page);
  await expect(row(page, "The Great Storm")).toBeVisible();
});

test("Read mode prints Typst's page numbers where the report has them, and none when they are switched off", async ({
  page,
}) => {
  await threeChapters(page);
  await openContents(page);
  const m = await manifestOf(page);
  const ids = m.chapters.map((c: { id: string }) => c.id) as string[];
  const contentsId = m.frontMatter[0].id as string;
  await page.evaluate(
    ([c, [a, b, d]]) => {
      window.__typstQueryResult = JSON.stringify({
        total: 40,
        starts: [
          { id: c, kind: "contents", page: 3, end: 3, number: "iii" },
          { id: a, kind: "chapter", page: 5, end: 12, number: "1" },
          { id: b, kind: "chapter", page: 13, end: 30, number: "9" },
          { id: d, kind: "chapter", page: 31, end: 40, number: "27" },
        ],
      });
    },
    [contentsId, ids] as const,
  );
  await page.getByRole("button", { name: "Add chapter" }).click();
  await sidebar(page).getByRole("button", { name: "Contents", exact: true }).click();
  await expect(row(page, "Calm").locator("[data-toc-page]")).toHaveText("27", {
    timeout: 15_000,
  });
  await readMode(page);
  const numbers = () => printed(readContents(page)).then((l) => l.map((x) => [x[0], x[1]]));
  await expect.poll(numbers, { timeout: 15_000 }).toEqual([
    ["Arrival", "1"],
    ["Storm", "9"],
    ["Calm", "27"],
    ["Chapter 4", expect.stringMatching(/^≈\d+$/)],
  ]);
  await writeMode(page);
  await contents(page).getByRole("switch", { name: "Page numbers" }).click();
  await readMode(page);
  await expect(readContents(page).locator("[data-preview-line]")).toHaveCount(4);
  await expect(readContents(page).locator("[data-number], [data-leader]")).toHaveCount(0);
});

test("Read mode: the entries are links that scroll the reader to the chapter and to the heading", async ({
  page,
}) => {
  await threeChapters(page);
  await typstMissing(page);
  await openContents(page);
  await depth(page, "+H1-H2");
  await readMode(page);
  // Where the target is: in the upper half of the reader (it was scrolled to, not just somewhere on a tall page).
  const nearTop = (el: ReturnType<Page["locator"]>) =>
    el.evaluate((node) => {
      const sc = document.querySelector('[data-testid="reading-scroll"]')!.getBoundingClientRect();
      const top = node.getBoundingClientRect().top;
      return top >= sc.top - 1 && top < sc.top + sc.height / 2;
    });
  const h = (tag: string, text: string) => page.locator(`.ProseMirror ${tag}`, { hasText: text });
  const toContents = () =>
    sidebar(page).getByRole("button", { name: "Contents", exact: true }).click();
  await readContents(page).getByRole("link", { name: "Calm", exact: true }).first().click();
  await expect.poll(() => nearTop(h("h1", "Calm"))).toBe(true);
  // The contents page again, then an entry for a heading: the reader lands on that heading, not the top of its chapter.
  await toContents();
  await expect(readContents(page)).toBeVisible();
  await readContents(page).getByRole("link", { name: "The inn" }).click();
  await expect.poll(() => nearTop(h("h2", "The inn"))).toBe(true);
  // Keyboard: a link takes focus and Enter follows it.
  await toContents();
  await expect(readContents(page)).toBeVisible();
  const storm = readContents(page).getByRole("link", { name: "Storm", exact: true }).first();
  await storm.focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => nearTop(h("h1", "Storm"))).toBe(true);
});

test("Read mode mirrors the Contents page in a right-to-left book", async ({ page }) => {
  await threeChapters(page);
  await openContents(page);
  await page.evaluate(() => {
    const disk = window.__disk;
    disk["cadabra.json"] = (disk["cadabra.json"] as string).replaceAll('"en"', '"he"');
    sessionStorage.setItem("disk", JSON.stringify(disk));
  });
  await page.reload();
  await page.getByRole("button", { name: "Open folder" }).click();
  await readMode(page);
  const nav = readContents(page);
  await expect(nav).toHaveAttribute("dir", "rtl");
  const line = nav.locator("[data-preview-line]").first();
  const [title, number] = await Promise.all([
    line.locator("a").boundingBox(),
    line.locator("[data-number]").boundingBox(),
  ]);
  // The title starts at the right edge and the number is at the far left.
  expect(title && number && number.x + number.width <= title.x).toBe(true);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
});

test("Read mode on a phone shows the plain Contents list with links", async ({ page }) => {
  await threeChapters(page);
  await typstMissing(page);
  await openContents(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await readMode(page);
  const nav = readContents(page);
  await expect(nav.getByRole("heading", { name: "Contents" })).toBeVisible();
  await expect(nav.getByRole("link")).toHaveCount(3);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
});

for (const size of [
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 820, height: 1180 },
]) {
  test(`${size.name} layout: no horizontal scroll, nothing clipped, touch targets and the dialog fit`, async ({
    page,
  }) => {
    await threeChapters(page);
    await openContents(page);
    await depth(page, "+H1-H2");
    await page.setViewportSize({ width: size.width, height: size.height });
    await expect(row(page, "The harbour").first()).toBeVisible();
    const phone = size.width < 768;
    const issues = async () =>
      (await audit(page)).filter((i) => phone || (i.kind !== "small" && i.kind !== "truncated"));
    expect(await issues()).toEqual([]);
    await contents(page).getByRole("button", { name: "Add custom entry" }).click();
    await expect(page.getByRole("dialog", { name: "Add custom entry" })).toBeVisible();
    expect(await issues()).toEqual([]);
  });
}

test("the contents page has no accessibility violations a screen reader would hit", async ({
  page,
}) => {
  await threeChapters(page);
  await openContents(page);
  await depth(page, "+H1");
  // Every control is named (the drag grip is a keyboard button, see a11y-dragging.spec.ts) and the list is a list.
  const unnamed = await contents(page).evaluate((root) =>
    [...root.querySelectorAll("button, [role=switch], [role=radio], input, select")]
      .filter(
        (el) =>
          !(el.getAttribute("aria-label") ?? "").trim() && !(el.textContent ?? "").trim() && !el.id,
      )
      .map((el) => el.outerHTML.slice(0, 80)),
  );
  expect(unnamed).toEqual([]);
  await expect(entries(page).getByRole("listitem")).toHaveCount(6);
  await expect(contents(page).getByRole("switch", { name: "Page numbers" })).toBeChecked();
  // The menu is reachable and operable by keyboard alone.
  await menuOf(page, "Calm").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menu")).toBeVisible();
  // Opening with the keyboard focuses the first item (Rename), so one ArrowDown reaches Move up.
  await expect(page.getByRole("menuitem", { name: "Rename" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Move up" })).toBeFocused();
  await page.keyboard.press("Enter");
  // Calm trades places with Storm's heading.
  expect(await entryTitles(page)).toEqual(["Arrival", "Arrival", "Storm", "Calm", "Storm", "Calm"]);
});

test("right-to-left: the grip and titles mirror, the numbers sit on the left, nothing overflows", async ({
  page,
}) => {
  await threeChapters(page);
  await openContents(page);
  await page.evaluate(() => {
    document.documentElement.dir = "rtl";
    document.documentElement.lang = "he";
  });
  const grip = (await row(page, "Arrival").locator("[data-grip]").boundingBox())!;
  const number = (await row(page, "Arrival").locator("[data-toc-page]").boundingBox())!;
  expect(grip.x).toBeGreaterThan(number.x);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
  await depth(page, "+H1-H3");
  const indent = async (title: string, nth: number) =>
    (await entries(page)
      .locator("[data-toc-key]")
      .filter({ hasText: title })
      .nth(nth)
      .locator("span.truncate")
      .boundingBox())!;
  // A deeper heading moves toward the left (away from the start edge) in RTL.
  expect((await indent("Gulls", 0)).x + (await indent("Gulls", 0)).width).toBeLessThan(
    (await indent("Arrival", 0)).x + (await indent("Arrival", 0)).width,
  );
});
