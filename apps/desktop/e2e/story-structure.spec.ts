import { expect, test, type Page } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { manifestOf, newProject, seedChapters } from "./support/helpers";

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

const para = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const heading = (text: string) => ({
  type: "heading",
  attrs: { level: 1 },
  content: [{ type: "text", text }],
});
const scene = (id: string, title: string, text: string) => ({
  type: "scene",
  attrs: { id, title },
  content: [para(text)],
});
const doc = (...content: unknown[]) =>
  ({ type: "doc", content }) as unknown as { content: never[] };

/** Chapter One: scene a and loose text. Chapter Two: scene d. */
async function book(page: Page) {
  await newProject(page);
  await seedChapters(page, [
    doc(
      heading("Chapter One"),
      scene("a", "Arrival", "Mara reaches the quay."),
      para("Loose words."),
    ),
    doc(heading("Chapter Two"), scene("d", "Dawn", "The harbour wakes.")),
  ]);
}

const openBoard = async (page: Page) => {
  await page.getByRole("button", { name: "Scene board" }).click();
  await expect(page.getByRole("heading", { name: "Scene board", level: 1 })).toBeVisible();
};
const openDialog = async (page: Page) => {
  await page.getByRole("button", { name: "Story structure" }).click();
  return page.getByRole("dialog", { name: "Add a story structure" });
};
const cardTitles = (page: Page, chapter: string) =>
  page
    .getByRole("list", { name: `Scenes in ${chapter}` })
    .locator("[data-scene-card] h3")
    .allTextContents();
const runCommand = (page: Page, id: string) =>
  page.evaluate(
    (c) =>
      (window as never as { __cadabraMenu: { run: (id: string) => void } }).__cadabraMenu.run(c),
    id,
  );

type Block = { type: string; attrs?: Record<string, unknown>; content?: unknown[] };
/** Every chapter file as last written to the fake disk, in book order. */
const files = async (page: Page): Promise<Block[][]> => {
  const m = await manifestOf(page);
  return page.evaluate(
    (chapters) =>
      chapters.map(
        (c: { files: Record<string, string> }) =>
          JSON.parse(window.__disk[Object.values(c.files)[0]!] as string).content as Block[],
      ),
    m.chapters,
  );
};

test.describe("story structures", () => {
  test("adds a structure's beats as outline scenes at the end of the chosen chapter, keeping everything there", async ({
    page,
  }) => {
    await book(page);
    await openBoard(page);
    await expect.poll(() => cardTitles(page, "Chapter Two")).toEqual(["Dawn"]);
    const before = await files(page);
    const dialog = await openDialog(page);
    await expect(dialog.getByRole("radio", { name: /Three-act structure/ })).toBeChecked();
    await dialog.getByRole("radio", { name: /Hero's Journey/ }).check();
    await expect(dialog.getByText("Departure", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Ordinary world, Call to adventure")).toBeVisible();
    await dialog.getByLabel("Add to chapter").selectOption({ label: "Chapter Two" });
    await dialog.getByRole("button", { name: "Add 12 scenes" }).click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByText("Added 12 scenes from Hero's Journey to Chapter Two"),
    ).toBeAttached();

    await expect.poll(() => cardTitles(page, "Chapter Two")).toHaveLength(13);
    const titles = await cardTitles(page, "Chapter Two");
    expect(titles.slice(0, 4)).toEqual([
      "Dawn",
      "Ordinary world",
      "Call to adventure",
      "Refusal of the call",
    ]);
    expect(titles.at(-1)).toBe("Return with the elixir");
    await expect(
      page.getByRole("list", { name: "Scenes in Chapter Two" }).locator("[data-scene-card]").nth(1),
    ).toContainText("Show what they lack");

    const after = await files(page);
    expect(after[0]).toEqual(before[0]);
    expect(after[1]!.slice(0, before[1]!.length)).toEqual(before[1]);
    const added = after[1]!.slice(before[1]!.length);
    expect(added).toHaveLength(12);
    expect(added.every((b) => b.type === "scene" && b.attrs!.status === "outline")).toBe(true);
    expect(added[0]!.attrs).toMatchObject({ title: "Ordinary world", label: "Departure" });
    expect(added[0]!.content).toEqual([{ type: "paragraph" }]);
    expect(new Set(added.map((b) => b.attrs!.id)).size).toBe(12);

    // One undo step takes all twelve away.
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await runCommand(page, "edit.bookUndo");
    await expect.poll(async () => (await files(page))[1]).toEqual(before[1]);
  });

  test("goes after loose text in the chapter the board shows, and Cancel adds nothing", async ({
    page,
  }) => {
    await book(page);
    await openBoard(page);
    const before = await files(page);
    let dialog = await openDialog(page);
    await expect(dialog.getByLabel("Add to chapter")).toHaveValue(/.+/);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    expect(await files(page)).toEqual(before);

    dialog = await openDialog(page);
    await dialog.getByRole("radio", { name: /Story Circle/ }).check();
    await dialog.getByRole("button", { name: "Add 8 scenes" }).click();
    await expect.poll(() => cardTitles(page, "Chapter One")).toHaveLength(9);
    const after = await files(page);
    expect(after[0]!.slice(0, before[0]!.length)).toEqual(before[0]);
    expect(after[0]!.at(before[0]!.length - 1)).toMatchObject({ type: "paragraph" });
    expect(after[1]).toEqual(before[1]);
  });

  test("Escape closes the dialog and gives the focus back to its button", async ({ page }) => {
    await book(page);
    await openBoard(page);
    const dialog = await openDialog(page);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("button", { name: "Story structure" })).toBeFocused();
  });
});
