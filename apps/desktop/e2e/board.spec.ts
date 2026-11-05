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
const scene = (id: string, title: string, text: string, attrs: Record<string, unknown> = {}) => ({
  type: "scene",
  attrs: { id, title, ...attrs },
  content: [para(text)],
});

/** A chapter file's document (the seed helper types only the content, the file needs the `doc` type too). */
const doc = (...content: unknown[]) =>
  ({ type: "doc", content }) as unknown as { content: never[] };

/** Chapter One: scenes a, b and c, then loose text. Chapter Two: scene d. Chapter Three has no scenes. */
async function book(page: Page) {
  await newProject(page);
  await seedChapters(page, [
    doc(
      heading("Chapter One"),
      scene("a", "Arrival", "Mara reaches the quay.", { synopsis: "Mara arrives." }),
      scene("b", "Bargain", "A deal is struck at dusk."),
      scene("c", "Chase", "Boots on wet stone."),
      para("Loose words after the last scene."),
    ),
    doc(heading("Chapter Two"), scene("d", "Dawn", "The harbour wakes.")),
    doc(heading("Chapter Three"), para("Nothing here yet.")),
  ]);
}

const openBoard = async (page: Page) => {
  await page.getByRole("button", { name: "Scene board" }).click();
  await expect(page.getByRole("heading", { name: "Scene board", level: 1 })).toBeVisible();
};
const list = (page: Page, chapter: string) =>
  page.getByRole("list", { name: `Scenes in ${chapter}` });
const cardTitles = (page: Page, chapter: string) =>
  list(page, chapter).locator("[data-scene-card] h3").allTextContents();
/** The synopsis button of a card: its name starts with the synopsis (or "Add a synopsis") and ends with the scene's title. */
const synopsis = (page: Page, title: string) =>
  page.getByRole("button", { name: new RegExp(`(synopsis of|Add a synopsis to) ${title}$`) });
const grip = (page: Page, title: string) => page.getByRole("button", { name: `Reorder ${title}` });
const back = (page: Page) => page.getByRole("button", { name: "Back", exact: true }).click();
const runCommand = (page: Page, id: string) =>
  page.evaluate(
    (c) =>
      (window as never as { __cadabraMenu: { run: (id: string) => void } }).__cadabraMenu.run(c),
    id,
  );

type Block = { type: string; attrs?: { id?: string }; content?: unknown[] };
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
const sceneIds = (blocks: Block[]) =>
  blocks.filter((b) => b.type === "scene").map((b) => b.attrs!.id);
/** Every scene id of the book appears once, and nothing but scenes moved (the loose text and headings are all still there). */
async function expectWhole(page: Page) {
  const all = await files(page);
  const ids = all.flatMap(sceneIds);
  expect(ids.sort()).toEqual(["a", "b", "c", "d"]);
  expect(JSON.stringify(all)).toContain("Loose words after the last scene.");
  expect(all.map((blocks) => blocks.filter((b) => b.type === "heading").length)).toEqual([1, 1, 1]);
}

test.describe("scene board", () => {
  test("shows every chapter as a column of cards, with the loose text as an Unsorted card", async ({
    page,
  }) => {
    await book(page);
    await openBoard(page);
    await expect
      .poll(() => cardTitles(page, "Chapter One"))
      .toEqual(["Arrival", "Bargain", "Chase"]);
    await expect.poll(() => cardTitles(page, "Chapter Two")).toEqual(["Dawn"]);
    await expect(list(page, "Chapter Three")).toContainText("No scenes yet.");
    const first = list(page, "Chapter One").locator("[data-scene-card]").first();
    await expect(first).toContainText("Mara arrives.");
    await expect(first).toContainText("4 words");
    await expect(list(page, "Chapter One").locator("[data-unsorted]")).toContainText("6 words");
    await expect(page).toHaveTitle(/^Scene board - E2E Book/);
    await back(page);
    await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter One");
  });

  test("opens from the View menu command", async ({ page }) => {
    await book(page);
    await runCommand(page, "view.board");
    await expect(page.getByRole("heading", { name: "Scene board", level: 1 })).toBeVisible();
  });

  test("edits the synopsis, point of view and status of a scene in a chapter that is not open", async ({
    page,
  }) => {
    await book(page);
    await openBoard(page);
    await synopsis(page, "Dawn").click();
    await page.getByLabel("Synopsis of Dawn").fill("The harbour wakes to bad news.");
    await page.getByLabel("Synopsis of Dawn").blur();
    await expect(synopsis(page, "Dawn")).toContainText("bad news");
    await page.getByLabel("Point of view of Dawn").fill("Mara");
    await page.getByLabel("Point of view of Dawn").blur();
    await page.getByLabel("Status of Dawn").selectOption("draft");
    await expect
      .poll(async () => (await files(page))[1]![1]!.attrs)
      .toMatchObject({
        id: "d",
        synopsis: "The harbour wakes to bad news.",
        pov: "Mara",
        status: "draft",
      });
    // Escape leaves the synopsis as it was.
    await synopsis(page, "Dawn").click();
    await page.getByLabel("Synopsis of Dawn").fill("never saved");
    await page.keyboard.press("Escape");
    await expect(synopsis(page, "Dawn")).toContainText("bad news");
    await expectWhole(page);
  });

  test("suggests the codex characters for the point of view", async ({ page }) => {
    await book(page);
    await page.evaluate(() => {
      window.__disk["codex.json"] = JSON.stringify({
        entries: [
          {
            id: "e1",
            kind: "character",
            name: "Mara Venn",
            aliases: [],
            summary: "",
            body: "",
            image: null,
            links: [],
          },
          {
            id: "e2",
            kind: "place",
            name: "The quay",
            aliases: [],
            summary: "",
            body: "",
            image: null,
            links: [],
          },
        ],
      });
      sessionStorage.setItem("disk", JSON.stringify(window.__disk));
    });
    await openBoard(page);
    await expect(page.locator("datalist option[value='Mara Venn']").first()).toBeAttached();
    await expect(page.locator("datalist option[value='The quay']")).toHaveCount(0);
  });

  test("moves a card with the grip's arrow keys within and across chapters and announces it", async ({
    page,
  }) => {
    await book(page);
    await openBoard(page);
    await expect.poll(() => cardTitles(page, "Chapter One")).toHaveLength(3);
    await grip(page, "Arrival").focus();
    await page.keyboard.press("ArrowDown");
    await expect
      .poll(() => cardTitles(page, "Chapter One"))
      .toEqual(["Bargain", "Arrival", "Chase"]);
    await expect(page.locator("[aria-live=polite]")).toContainText(
      "Moved Arrival to position 2 of 3 in Chapter One",
    );
    // The grip keeps the focus, so the next press carries on.
    await expect(grip(page, "Arrival")).toBeFocused();
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.getAttribute("aria-label")))
      .toBe("Reorder Arrival");
    await page.keyboard.press("ArrowUp");
    await expect
      .poll(() => cardTitles(page, "Chapter One"))
      .toEqual(["Arrival", "Bargain", "Chase"]);
    await page.keyboard.press("ArrowUp");
    await expect(page.locator("[aria-live=polite]")).toContainText("Arrival is already first");
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => cardTitles(page, "Chapter Two")).toEqual(["Arrival", "Dawn"]);
    await expect(grip(page, "Arrival")).toBeFocused();
    await expect
      .poll(async () => (await files(page)).map(sceneIds))
      .toEqual([["b", "c"], ["a", "d"], []]);
    await expectWhole(page);
  });

  test("moves a card to another chapter from its menu", async ({ page }) => {
    await book(page);
    await openBoard(page);
    await page.getByRole("button", { name: "Actions for Dawn" }).click();
    await expect(page.getByRole("menuitem", { name: "Move earlier" })).toBeDisabled();
    await page.getByRole("menuitem", { name: "Chapter Three" }).click();
    await expect.poll(() => cardTitles(page, "Chapter Three")).toEqual(["Dawn"]);
    await page.getByRole("button", { name: "Actions for Arrival" }).click();
    await page.getByRole("menuitem", { name: "Move later" }).click();
    await expect
      .poll(() => cardTitles(page, "Chapter One"))
      .toEqual(["Bargain", "Arrival", "Chase"]);
    await expectWhole(page);
  });

  test("drags a card within a chapter and into another, and each drop is one undo step", async ({
    page,
  }) => {
    await book(page);
    await openBoard(page);
    await expect.poll(() => cardTitles(page, "Chapter One")).toHaveLength(3);
    const drag = async (from: string, to: string, below: boolean) => {
      const g = (await grip(page, from).boundingBox())!;
      const target = (await page
        .locator("[data-scene-card]", { hasText: to })
        .first()
        .boundingBox())!;
      await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
      await page.mouse.down();
      await page.mouse.move(target.x + 30, target.y + target.height * (below ? 0.9 : 0.1), {
        steps: 6,
      });
      await expect(page.locator("[data-drop-line]")).toBeVisible();
      await page.mouse.up();
    };
    await drag("Chase", "Arrival", false);
    await expect
      .poll(() => cardTitles(page, "Chapter One"))
      .toEqual(["Chase", "Arrival", "Bargain"]);
    await drag("Bargain", "Dawn", true);
    await expect.poll(() => cardTitles(page, "Chapter Two")).toEqual(["Dawn", "Bargain"]);
    await expect
      .poll(async () => (await files(page)).map(sceneIds))
      .toEqual([["c", "a"], ["d", "b"], []]);
    await expectWhole(page);

    // Each drop is one step: the cross-chapter drop undoes in a single press, putting both files back.
    await back(page);
    await runCommand(page, "edit.bookUndo");
    await expect
      .poll(async () => (await files(page)).map(sceneIds))
      .toEqual([["c", "a", "b"], ["d"], []]);
    await runCommand(page, "edit.bookUndo");
    await expect
      .poll(async () => (await files(page)).map(sceneIds))
      .toEqual([["a", "b", "c"], ["d"], []]);
    await runCommand(page, "edit.bookRedo");
    await expect
      .poll(async () => (await files(page)).map(sceneIds))
      .toEqual([["c", "a", "b"], ["d"], []]);
    await expectWhole(page);
  });

  test("Escape cancels a drag and changes nothing", async ({ page }) => {
    await book(page);
    await openBoard(page);
    await expect.poll(() => cardTitles(page, "Chapter One")).toHaveLength(3);
    const g = (await grip(page, "Arrival").boundingBox())!;
    await page.mouse.move(g.x + 8, g.y + 8);
    await page.mouse.down();
    await page.mouse.move(g.x + 8, g.y + 200, { steps: 4 });
    await expect(page.locator("[data-drop-line]")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect(page.locator("[data-drop-line]")).toHaveCount(0);
    expect(await cardTitles(page, "Chapter One")).toEqual(["Arrival", "Bargain", "Chase"]);
  });

  test("wraps the loose text of a chapter into a scene", async ({ page }) => {
    await book(page);
    await openBoard(page);
    const unsorted = list(page, "Chapter One").locator("[data-unsorted]");
    await unsorted.getByRole("button", { name: "Wrap into a scene" }).click();
    await expect.poll(() => cardTitles(page, "Chapter One")).toHaveLength(4);
    await expect(unsorted).toHaveCount(0);
    await expect(page.locator("[aria-live=polite]")).toContainText("Made 1 scenes");
    await expect
      .poll(async () => (await files(page))[0]!.filter((b) => b.type === "scene").length)
      .toBe(4);
    expect(JSON.stringify(await files(page))).toContain("Loose words after the last scene.");
  });

  test("opens a scene in the editor from its card", async ({ page }) => {
    await book(page);
    await openBoard(page);
    await page.getByRole("button", { name: "Open scene Dawn in Chapter Two" }).click();
    await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter Two");
    await expect(page.getByRole("region", { name: "Scene" })).toContainText("Dawn");
  });
});

test.describe("scene board on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("shows one chapter at a time, chosen from a picker", async ({ page }) => {
    await book(page);
    await runCommand(page, "view.board");
    await expect(page.getByRole("heading", { name: "Scene board", level: 1 })).toBeVisible();
    await expect(list(page, "Chapter One")).toBeVisible();
    await expect(list(page, "Chapter Two")).toBeHidden();
    await page.getByLabel("Chapter", { exact: true }).selectOption({ label: "Chapter Two" });
    await expect(list(page, "Chapter Two")).toBeVisible();
    await expect(list(page, "Chapter One")).toBeHidden();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  });
});

test.describe("scene board on a tablet", () => {
  test.use({ viewport: { width: 820, height: 1180 } });

  test("keeps the columns side by side and scrolls them sideways", async ({ page }) => {
    await book(page);
    await runCommand(page, "view.board");
    await expect(list(page, "Chapter One")).toBeVisible();
    const region = page.getByRole("region", { name: "Chapters and their scenes" });
    await expect(region).toBeVisible();
    const [one, two] = await Promise.all([
      page.getByRole("region", { name: "Chapter One" }).boundingBox(),
      page.getByRole("region", { name: "Chapter Two" }).boundingBox(),
    ]);
    expect(two!.x).toBeGreaterThan(one!.x);
    expect(Math.abs(two!.y - one!.y)).toBeLessThan(2);
  });
});
