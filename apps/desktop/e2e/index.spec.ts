import { expect, test, type Page } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { manifestOf, newProject, seedChapters } from "./support/helpers";

test.use({ viewport: { width: 1280, height: 1000 } });

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

/** The slice of TipTap's editor the spec reads. */
interface Editor {
  state: {
    selection: { from: number; to: number };
    doc: {
      textBetween: (a: number, b: number) => string;
      descendants: (f: (node: { isText: boolean; text?: string }, pos: number) => void) => void;
    };
  };
  commands: { setTextSelection: (r: { from: number; to: number }) => void; focus: () => void };
}

const SHORTCUT = "ControlOrMeta+Alt+X";
const panel = (page: Page) => page.getByRole("region", { name: "Index" });
const indexButton = (page: Page) =>
  page.getByRole("button", { name: "Index", exact: true }).first();
const dialog = (page: Page, name: string) => page.getByRole("dialog", { name });

const mark = (id: string, term: string, extra: Record<string, string> = {}) => ({
  type: "indexEntry",
  attrs: { id, term, ...extra },
});
const para = (...content: { type: "text"; text: string; marks?: unknown[] }[]) => ({
  type: "paragraph",
  content,
});
const text = (t: string, marks?: unknown[]) => ({
  type: "text" as const,
  text: t,
  ...(marks ? { marks } : {}),
});
const chapter = (title: string, ...body: ReturnType<typeof para>[]) => ({
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: title }] },
    ...body,
  ],
});

/** Waits until the editor itself (not only the page) has `words` selected: it reads the selection a moment after it changes. */
const selected = (page: Page, words: string) =>
  expect
    .poll(() =>
      page.evaluate(() => {
        const e = (document.querySelector(".ProseMirror") as unknown as { editor: Editor }).editor;
        const { from, to } = e.state.selection;
        return e.state.doc.textBetween(from, to);
      }),
    )
    .toBe(words);

/** Selects the first `words` in the open page, the way the mouse would. */
const selectFirst = (page: Page, words: string) =>
  page.evaluate((w) => {
    const e = (document.querySelector(".ProseMirror") as unknown as { editor: Editor }).editor;
    let at = -1;
    e.state.doc.descendants((node, pos) => {
      const i = at < 0 && node.isText ? (node.text ?? "").indexOf(w) : -1;
      if (i >= 0) at = pos + i;
    });
    e.commands.setTextSelection({ from: at, to: at + w.length });
    e.commands.focus();
  }, words);

/** Types " magic" at the end of the page and selects it with the keyboard. */
async function selectMagic(page: Page) {
  await page.locator(".ProseMirror").focus();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" magic");
  await expect(page.locator(".ProseMirror")).toContainText(" magic");
  await page.keyboard.press("Shift+ArrowLeft", { delay: 20 });
  for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+ArrowLeft", { delay: 20 });
  await selected(page, "magic");
}

const chapterFile = (page: Page, i: number) =>
  page.evaluate((n) => {
    const m = JSON.parse(window.__disk["cadabra.json"] as string);
    const file = Object.values(m.chapters[n].files)[0] as string;
    return window.__disk[file] as string;
  }, i);

test.describe("back-of-book index", () => {
  test("shows an empty index and explains what to do", async ({ page }) => {
    await newProject(page);
    await indexButton(page).click();
    await expect(panel(page)).toBeVisible();
    await expect(panel(page).getByText(/No index entries yet/)).toBeVisible();
    await expect(panel(page).getByRole("button", { name: "Add selection" })).toBeDisabled();
    await panel(page).getByRole("button", { name: "Close index" }).click();
    await expect(panel(page)).toHaveCount(0);
  });

  test("adds an entry with the shortcut, marks the words and lists the term", async ({ page }) => {
    await newProject(page);
    await indexButton(page).click();
    await selectMagic(page);
    await page.keyboard.press(SHORTCUT);
    const d = dialog(page, "Index entry");
    await expect(d.getByLabel("Term")).toHaveValue("magic");
    await d.getByLabel("Term").fill("Magic");
    await d.getByLabel("Sub-entry (optional)").fill("spells");
    await d.getByRole("button", { name: "Add", exact: true }).click();
    await expect(d).toHaveCount(0);
    // The words stay, with a bar under them and a tooltip.
    const marked = page.locator(".ProseMirror [data-index-entry]");
    await expect(marked).toHaveText("magic");
    await expect(page.locator('.ProseMirror [title^="Index: Magic, spells"]')).toHaveCount(1);
    await expect(page.locator(".ProseMirror")).toContainText("magic");
    const card = panel(page).getByRole("listitem").first();
    await expect(card).toContainText("Magic");
    await expect(card).toContainText("spells");
    await expect.poll(() => chapterFile(page, 0)).toContain('"term": "Magic"');
    // One Undo takes the mark back and keeps the text.
    await page.locator(".ProseMirror").focus();
    await page.keyboard.press("ControlOrMeta+z");
    await expect(marked).toHaveCount(0);
    await expect(page.locator(".ProseMirror")).toContainText("magic");
  });

  test("refuses an empty term and a cross-reference to itself, and asks for a selection first", async ({
    page,
  }) => {
    await newProject(page);
    await page.locator(".ProseMirror").focus();
    await page.keyboard.press(SHORTCUT);
    await expect(
      page.getByText("Select the words you want to list in the index first."),
    ).toBeVisible();
    await selectMagic(page);
    await page.keyboard.press(SHORTCUT);
    const d = dialog(page, "Index entry");
    await d.getByLabel("Term").fill("");
    await d.getByRole("button", { name: "Add", exact: true }).click();
    await expect(d.getByText("Write a term first.")).toBeVisible();
    await d.getByLabel("Term").fill("Magic");
    await d.getByRole("radio", { name: "See", exact: true }).click();
    await d.getByLabel("Target term").fill("magic");
    await d.getByRole("button", { name: "Add", exact: true }).click();
    await expect(d.getByText("Point to a different term.")).toBeVisible();
    await d.getByLabel("Target term").fill("Sorcery");
    await d.getByRole("button", { name: "Add", exact: true }).click();
    await expect(d).toHaveCount(0);
    await indexButton(page).click();
    await expect(panel(page).getByText("See Sorcery")).toBeVisible();
    await expect(panel(page).getByText("“Sorcery” is not in the index")).toBeVisible();
    await panel(page).getByRole("button", { name: "Needs attention" }).click();
    await expect(panel(page).getByRole("listitem")).toHaveCount(1);
    await panel(page).getByRole("button", { name: "Cross-refs" }).click();
    await expect(panel(page).getByRole("listitem")).toHaveCount(1);
    await panel(page).getByLabel("Search the index").fill("zzz");
    await expect(panel(page).getByText("No terms match.")).toBeVisible();
  });

  test("marks all occurrences across the book, once", async ({ page }) => {
    await newProject(page);
    await seedChapters(page, [
      chapter("One", para(text("Some magic here, and Magic again."))),
      chapter("Two", para(text("More magic, and magical things stay unmarked."))),
    ]);
    await selectFirst(page, "magic");
    await selected(page, "magic");
    await page.keyboard.press(SHORTCUT);
    const d = dialog(page, "Index entry");
    await expect(d.getByLabel("Term")).toHaveValue("magic");
    await expect(d.getByText(/found in the book/)).toContainText("3");
    await d.getByLabel("Mark all occurrences").check();
    await d.getByRole("button", { name: "Add", exact: true }).click();
    await indexButton(page).click();
    await expect(panel(page).getByRole("button", { name: "Edit index entry magic" })).toBeVisible();
    await expect(panel(page).getByRole("listitem").first()).toContainText("3");
    await expect(page.locator(".ProseMirror [data-index-entry]")).toHaveCount(2);
    await expect.poll(async () => (await chapterFile(page, 1)).includes('"indexEntry"')).toBe(true);
    expect(await chapterFile(page, 1)).not.toContain('"text": "magical"');
    // A second round has nothing left to mark.
    await selectMagic(page);
    await page.keyboard.press(SHORTCUT);
    await expect(d.getByText(/found in the book/)).toBeVisible();
  });

  test("edits a term: rename, merge, remove a place, hide, delete", async ({ page }) => {
    await newProject(page);
    await seedChapters(page, [
      chapter(
        "One",
        para(
          text("magic", [mark("a1", "Magic")]),
          text(" and "),
          text("sorcery", [mark("a2", "Sorcery")]),
        ),
      ),
      chapter("Two", para(text("more sorcery", [mark("a3", "Sorcery")]))),
    ]);
    await indexButton(page).click();
    const rail = panel(page);
    await expect(rail.getByRole("listitem")).toHaveCount(2);
    await rail.getByRole("button", { name: "Edit index entry Sorcery" }).click();
    const d = dialog(page, "Edit index entry");
    await expect(d.getByRole("listitem")).toHaveCount(2);
    // Remove one place: the words stay.
    await d.getByRole("button", { name: /Remove more sorcery/ }).click();
    await expect(d.getByRole("listitem")).toHaveCount(1);
    await d.getByLabel("Merge into another term").selectOption("Magic");
    await d.getByRole("button", { name: "Merge" }).click();
    await expect(d).toHaveCount(0);
    await expect(rail.getByRole("listitem")).toHaveCount(1);
    await expect(rail.getByRole("listitem").first()).toContainText("Magic");
    await expect(rail.getByRole("listitem").first()).toContainText("2");
    // Rename, then hide from the book's index, then show again from the settings.
    await rail.getByRole("button", { name: "Edit index entry Magic" }).click();
    await d.getByLabel("Term").fill("Sorcery");
    await d.getByRole("button", { name: "Rename" }).click();
    await expect(rail.getByRole("button", { name: "Edit index entry Sorcery" })).toBeVisible();
    await rail.getByRole("button", { name: "Edit index entry Sorcery" }).click();
    await d.getByRole("button", { name: "Leave out of the book's index" }).click();
    await expect(rail.getByText("Left out of the book's index")).toBeVisible();
    expect((await manifestOf(page)).index.hidden).toEqual(["Sorcery"]);
    await rail.getByRole("button", { name: "Index settings" }).click();
    const settings = dialog(page, "Index settings");
    await settings.getByRole("button", { name: "Show Sorcery in the index again" }).click();
    await expect(settings.getByText(/No terms are hidden/)).toBeVisible();
    await settings.getByRole("button", { name: "Cancel" }).click();
    // Delete takes every place out and keeps the words.
    await rail.getByRole("button", { name: "Edit index entry Sorcery" }).click();
    await d.getByRole("button", { name: "Delete term" }).click();
    await dialog(page, "Delete this term?").getByRole("button", { name: "Delete term" }).click();
    await expect(rail.getByText(/No index entries yet/)).toBeVisible();
    await expect(page.locator(".ProseMirror")).toContainText("magic and sorcery");
  });

  test("jumps from the panel to the marked words in another chapter", async ({ page }) => {
    await newProject(page);
    await seedChapters(page, [
      chapter("One", para(text("nothing marked here"))),
      chapter(
        "Two",
        para(text("the "), text("lighthouse keeper", [mark("k1", "Keeper")]), text(" waits")),
      ),
    ]);
    await indexButton(page).click();
    await panel(page).getByRole("button", { name: "Go to the first place of Keeper" }).click();
    await expect(page.locator(".ProseMirror h1")).toHaveText("Two");
    await expect
      .poll(() => page.evaluate(() => window.getSelection()?.toString()))
      .toBe("lighthouse keeper");
  });

  test("saves the settings in the book and reads them back", async ({ page }) => {
    await newProject(page);
    await indexButton(page).click();
    await panel(page).getByRole("button", { name: "Index settings" }).click();
    const d = dialog(page, "Index settings");
    await d.getByLabel("Add an index to the book").check();
    await d.getByLabel("Heading", { exact: true }).fill("");
    await d.getByRole("button", { name: "Save" }).click();
    await expect(d.getByText("The index needs a heading.")).toBeVisible();
    await d.getByLabel("Heading", { exact: true }).fill("Names");
    await d.getByRole("radio", { name: "One column" }).click();
    await d.getByLabel("Show page ranges").uncheck();
    await d.getByLabel("Hide terms used once").check();
    await d.getByRole("button", { name: "Save" }).click();
    await expect(d).toHaveCount(0);
    expect((await manifestOf(page)).index).toMatchObject({
      enabled: true,
      heading: "Names",
      columns: 1,
      ranges: false,
      hideSingles: true,
    });
  });

  test("works by keyboard alone, from selecting to the entry in the panel", async ({ page }) => {
    await newProject(page);
    await selectMagic(page);
    await page.keyboard.press(SHORTCUT);
    const d = dialog(page, "Index entry");
    await expect(d.getByLabel("Term")).toBeFocused();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("Wonders");
    await page.keyboard.press("Enter");
    await expect(d).toHaveCount(0);
    // Focus is back in the text.
    await expect(page.locator(".ProseMirror")).toBeFocused();
    await indexButton(page).focus();
    await page.keyboard.press("Enter");
    await expect(
      panel(page).getByRole("button", { name: "Edit index entry Wonders" }),
    ).toBeVisible();
    await panel(page).getByRole("button", { name: "Edit index entry Wonders" }).focus();
    await page.keyboard.press("Enter");
    await expect(dialog(page, "Edit index entry")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog(page, "Edit index entry")).toHaveCount(0);
  });

  test("draws the marker in dark mode too, as a bar and not only a colour", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await newProject(page);
    await selectMagic(page);
    await page.keyboard.press(SHORTCUT);
    await dialog(page, "Index entry").getByRole("button", { name: "Add", exact: true }).click();
    const style = await page
      .locator(".ProseMirror [data-index-entry]")
      .evaluate((el) => getComputedStyle(el).boxShadow);
    expect(style).toContain("inset");
    expect(style).toContain("0px -2px");
    expect(style).toContain("110, 162, 255");
  });

  test("opens as a sheet on a narrow window and closes after a jump", async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 1100 });
    await newProject(page);
    await seedChapters(page, [chapter("One", para(text("a "), text("b", [mark("z1", "Zed")])))]);
    await indexButton(page).click();
    await expect(dialog(page, "Index")).toBeVisible();
    await dialog(page, "Index")
      .getByRole("button", { name: "Go to the first place of Zed" })
      .click();
    await expect(dialog(page, "Index")).toHaveCount(0);
  });
});
