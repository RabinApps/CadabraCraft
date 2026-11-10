import { expect, test, type Page } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { manifestOf, newProject, seedChapters } from "./support/helpers";

test.use({ viewport: { width: 1280, height: 1000 } });

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

/** The slice of TipTap's editor the spec reads and moves. */
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

const SHORTCUT = "ControlOrMeta+Shift+G";
const panel = (page: Page) => page.getByRole("region", { name: "Glossary" });
const glossaryButton = (page: Page) =>
  page.getByRole("button", { name: "Glossary", exact: true }).first();
const dialog = (page: Page, name: string) => page.getByRole("dialog", { name });
const text = (t: string, marks?: unknown[]) => ({
  type: "text" as const,
  text: t,
  ...(marks ? { marks } : {}),
});
const chapter = (title: string, ...body: string[]) => ({
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: title }] },
    ...body.map((b) => ({ type: "paragraph", content: [text(b)] })),
  ],
});

/** Selects the first `words` in the open page, the way the mouse would, and waits until the editor has read it. */
async function select(page: Page, words: string) {
  await page.evaluate((w) => {
    const e = (document.querySelector(".ProseMirror") as unknown as { editor: Editor }).editor;
    let at = -1;
    e.state.doc.descendants((node, pos) => {
      const i = at < 0 && node.isText ? (node.text ?? "").indexOf(w) : -1;
      if (i >= 0) at = pos + i;
    });
    e.commands.setTextSelection({ from: at, to: at + w.length });
    e.commands.focus();
  }, words);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const e = (document.querySelector(".ProseMirror") as unknown as { editor: Editor }).editor;
        const { from, to } = e.state.selection;
        return e.state.doc.textBetween(from, to);
      }),
    )
    .toBe(words);
}

const chapterFile = (page: Page, i: number) =>
  page.evaluate((n) => {
    const m = JSON.parse(window.__disk["cadabra.json"] as string);
    const file = Object.values(m.chapters[n].files)[0] as string;
    return window.__disk[file] as string;
  }, i);

test.describe("glossary", () => {
  test("shows an empty glossary and saves its settings in the book", async ({ page }) => {
    await newProject(page);
    await glossaryButton(page).click();
    await expect(panel(page).getByText(/No glossary terms yet/)).toBeVisible();
    await panel(page).getByRole("button", { name: "Glossary settings" }).click();
    const d = dialog(page, "Glossary settings");
    await d.getByLabel("Add a glossary to the book").check();
    await d.getByLabel("Heading", { exact: true }).fill("");
    await d.getByRole("button", { name: "Save" }).click();
    await expect(d.getByText("The glossary needs a heading.")).toBeVisible();
    await d.getByLabel("Heading", { exact: true }).fill("Terms");
    await d.getByRole("radio", { name: "Order added" }).click();
    await d.getByLabel("List glossary terms in the index").check();
    await d.getByLabel("Mark first use", { exact: true }).uncheck();
    await d.getByLabel("Show terms with no definition").check();
    await d.getByRole("button", { name: "Save" }).click();
    await expect(d).toHaveCount(0);
    expect((await manifestOf(page)).glossary).toMatchObject({
      enabled: true,
      heading: "Terms",
      order: "added",
      inIndex: true,
      markFirstUse: false,
      showUndefined: true,
    });
    await panel(page).getByRole("button", { name: "Close glossary" }).click();
    await expect(panel(page)).toHaveCount(0);
  });

  test("adds a term with the shortcut, marks the words and lists the entry with its definition", async ({
    page,
  }) => {
    await newProject(page);
    await seedChapters(page, [chapter("One", "A glass orb sat on the shelf.")]);
    await glossaryButton(page).click();
    await select(page, "orb");
    await page.keyboard.press(SHORTCUT);
    const d = dialog(page, "Glossary term");
    await expect(d.getByLabel("Term")).toHaveValue("orb");
    await d.getByLabel("Term").fill("");
    await d.getByRole("button", { name: "Add and mark" }).click();
    await expect(d.getByText("A glossary term needs a name.")).toBeVisible();
    await d.getByLabel("Term").fill("Orb");
    await d.getByLabel("Also called").fill("orbs, globe");
    await d.getByLabel("Definition").fill("A sphere of glass.");
    await d.getByRole("button", { name: "Add and mark" }).click();
    await expect(d).toHaveCount(0);
    await expect(page.locator(".ProseMirror [data-glossary]")).toHaveText("orb");
    await expect(
      page.locator('.ProseMirror [title^="Glossary: Orb. A sphere of glass."]'),
    ).toHaveCount(1);
    const card = panel(page).getByRole("listitem").first();
    await expect(card).toContainText("Orb");
    await expect(card).toContainText("A sphere of glass.");
    await expect(card).toContainText("1 use");
    expect((await manifestOf(page)).glossary.entries[0]).toMatchObject({
      term: "Orb",
      aliases: ["orbs", "globe"],
      definition: "A sphere of glass.",
    });
    await expect.poll(() => chapterFile(page, 0)).toContain('"glossaryTerm"');
    // The same words, chosen from the glossary this time.
    await select(page, "glass");
    await page.keyboard.press(SHORTCUT);
    await d.getByLabel("Glossary entry").selectOption({ label: "Orb" });
    await expect(d.getByRole("button", { name: "Mark", exact: true })).toBeVisible();
    await d.getByRole("button", { name: "Mark", exact: true }).click();
    await expect(card).toContainText("2 uses");
  });

  test("lists terms with no definition under their own filter, and the unused ones", async ({
    page,
  }) => {
    await newProject(page);
    await glossaryButton(page).click();
    await panel(page).getByRole("button", { name: "Add term" }).click();
    const d = dialog(page, "Glossary term");
    await d.getByLabel("Term").fill("Gloom");
    await d.getByRole("button", { name: "Add term" }).click();
    // Terms with no definition stay out of the list until the author asks for them, or filters for them.
    await expect(panel(page).getByText("Gloom")).toHaveCount(0);
    await panel(page).getByRole("button", { name: "No definition" }).click();
    await expect(panel(page).getByRole("listitem").first()).toContainText("Needs a definition");
    await panel(page).getByRole("button", { name: "Unused" }).click();
    await expect(panel(page).getByRole("listitem")).toHaveCount(1);
    await panel(page).getByRole("button", { name: "All" }).click();
    await panel(page).getByLabel("Search the glossary").fill("zzz");
    await expect(panel(page).getByText("No terms match.")).toBeVisible();
  });

  test("edits an entry, marks its first use in each chapter, jumps to it and deletes it", async ({
    page,
  }) => {
    await newProject(page);
    await seedChapters(page, [
      chapter("One", "The lantern burns. The lantern again."),
      chapter("Two", "Nothing here.", "A lantern in chapter two."),
    ]);
    await glossaryButton(page).click();
    await select(page, "lantern");
    await page.keyboard.press(SHORTCUT);
    const add = dialog(page, "Glossary term");
    await add.getByLabel("Definition").fill("A light.");
    await add.getByRole("button", { name: "Add and mark" }).click();
    const rail = panel(page);
    await rail.getByRole("button", { name: "Edit glossary entry lantern" }).click();
    const d = dialog(page, "Glossary entry");
    await expect(d.getByText("Used 1 time in 1 chapter")).toBeVisible();
    await d.getByLabel("Definition").fill("A light you carry.");
    await d.getByLabel("Mark first use in each chapter").check();
    await d.getByRole("button", { name: "Save" }).click();
    await expect(rail.getByRole("listitem").first()).toContainText("A light you carry.");
    await expect(rail.getByRole("listitem").first()).toContainText("2 uses");
    await expect
      .poll(async () => (await chapterFile(page, 1)).includes('"glossaryTerm"'))
      .toBe(true);
    // Jump to the first use in the second chapter by closing the first chapter's use... the first use is in chapter one.
    await rail.getByRole("button", { name: "Edit glossary entry lantern" }).click();
    await d.getByRole("button", { name: "Go to first use" }).click();
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe("lantern");
    // Delete: the entry and its marks go, the words stay.
    await rail.getByRole("button", { name: "Edit glossary entry lantern" }).click();
    await d.getByRole("button", { name: "Delete term" }).click();
    await dialog(page, "Delete this glossary term?")
      .getByRole("button", { name: "Delete term" })
      .click();
    await expect(rail.getByText(/No glossary terms yet/)).toBeVisible();
    await expect(page.locator(".ProseMirror [data-glossary]")).toHaveCount(0);
    await expect(page.locator(".ProseMirror")).toContainText("The lantern burns.");
    expect((await manifestOf(page)).glossary.entries).toEqual([]);
  });

  test("works by keyboard alone and draws its marker in dark mode", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await newProject(page);
    await seedChapters(page, [chapter("One", "A quiet harbour.")]);
    await select(page, "harbour");
    await page.keyboard.press(SHORTCUT);
    const d = dialog(page, "Glossary term");
    await expect(d.getByLabel("Term")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(d).toHaveCount(0);
    await expect(page.locator(".ProseMirror")).toBeFocused();
    const border = await page
      .locator(".ProseMirror [data-glossary]")
      .evaluate(
        (el) =>
          getComputedStyle(el).borderBottomStyle + " " + getComputedStyle(el).borderBottomWidth,
      );
    expect(border).toBe("dotted 2px");
  });

  test("opens as a sheet on a narrow window", async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 1100 });
    await newProject(page);
    await glossaryButton(page).click();
    await expect(dialog(page, "Glossary")).toBeVisible();
    await dialog(page, "Glossary").getByRole("button", { name: "Close glossary" }).click();
    await expect(dialog(page, "Glossary")).toHaveCount(0);
  });
});
