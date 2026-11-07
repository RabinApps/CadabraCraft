import { expect, test, type Page } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { manifestOf, newProject, seedChapters } from "./support/helpers";
import {
  count,
  facetButton,
  filterBar,
  filterBook,
  openBoard as openFilterBoard,
  openTimeline,
  pick,
  search,
} from "./support/sceneFilterBook";

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

test.describe("scene board filters", () => {
  const titles = (page: Page) => page.locator("[data-scene-card] h3").allTextContents();
  const colourBy = (page: Page) => page.getByRole("radiogroup", { name: "Colour by" });

  test("filters by POV (spellings merged), counts the scenes, and leaves the chapter files alone", async ({
    page,
  }) => {
    await filterBook(page);
    await openFilterBoard(page);
    await expect(count(page)).toHaveText("4 scenes");
    const before = await files(page);
    await facetButton(page, "POV").click();
    // "Mara" and "mara" are one value with two scenes; scenes without a POV are the "none" value.
    await expect(page.getByRole("menuitemcheckbox", { name: "Mara 2" })).toBeVisible();
    await expect(page.getByRole("menuitemcheckbox", { name: "Ada 1" })).toBeVisible();
    await expect(page.getByRole("menuitemcheckbox", { name: "No POV 1" })).toBeVisible();
    await page.getByRole("menuitemcheckbox", { name: "Mara 2" }).click();
    // The menu stays open to tick more values.
    await expect(page.getByRole("menuitemcheckbox", { name: "Mara 2" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await page.keyboard.press("Escape");
    expect(await titles(page)).toEqual(["Arrival", "Chase"]);
    await expect(count(page)).toHaveText("2 of 4 scenes");
    await expect(page.getByRole("button", { name: /^POV 1 selected/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^POV: Mara/ })).toBeVisible();
    // OR within a facet.
    await pick(page, "POV", ["Ada"]);
    expect(await titles(page)).toEqual(["Arrival", "Bargain", "Chase"]);
    expect(await files(page)).toEqual(before);
  });

  test("combines facets with AND and the none value, and removes a value from its chip", async ({
    page,
  }) => {
    await filterBook(page);
    await openFilterBoard(page);
    await pick(page, "POV", ["Mara"]);
    await pick(page, "Status", ["Draft"]);
    expect(await titles(page)).toEqual(["Arrival"]);
    await page.getByRole("button", { name: /^Status: Draft/ }).click();
    expect(await titles(page)).toEqual(["Arrival", "Chase"]);
    await pick(page, "Label", ["No label"]);
    expect(await titles(page)).toEqual([]);
    await page.getByRole("button", { name: /^POV: Mara/ }).click();
    expect(await titles(page)).toEqual(["Dawn"]);
    await expect(count(page)).toHaveText("1 of 4 scenes");
  });

  test("the facet menu works from the keyboard and has a Clear footer", async ({ page }) => {
    await filterBook(page);
    await openFilterBoard(page);
    await facetButton(page, "Status").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menuitemcheckbox", { name: "Draft 1" })).toBeFocused();
    await page.keyboard.press("Space");
    await expect(page.getByRole("menuitemcheckbox", { name: "Draft 1" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(page.getByRole("menu")).toBeVisible();
    await page.getByRole("menuitem", { name: "Clear status" }).click();
    await expect(count(page)).toHaveText("4 scenes");
  });

  test("searches the title and synopsis, and Clear brings everything back", async ({ page }) => {
    await filterBook(page);
    await openFilterBoard(page);
    await search(page).fill("quay");
    expect(await titles(page)).toEqual(["Arrival"]);
    await search(page).fill("dwn");
    expect(await titles(page)).toEqual(["Dawn"]);
    await page.getByRole("button", { name: "Clear all filters" }).click();
    await expect(search(page)).toHaveValue("");
    expect(await titles(page)).toHaveLength(4);
    await expect(page.getByRole("button", { name: "Clear all filters" })).toHaveCount(0);
  });

  test("says when nothing matches, and Clear filters restores the board", async ({ page }) => {
    await filterBook(page);
    await openFilterBoard(page);
    await search(page).fill("zzzzq");
    await expect(page.getByText("No scenes match these filters.")).toBeVisible();
    await expect(count(page)).toHaveText("0 of 4 scenes");
    await expect(page.getByRole("region", { name: "Chapters and their scenes" })).toHaveCount(0);
    await page.getByRole("button", { name: "Clear filters", exact: true }).click();
    expect(await titles(page)).toHaveLength(4);
  });

  test("turns moving off while a filter is on, then back on", async ({ page }) => {
    await filterBook(page);
    await openFilterBoard(page);
    await expect(grip(page, "Arrival")).toBeVisible();
    await expect(page.getByText("Moving scenes is off while a filter is on")).toHaveCount(0);
    await pick(page, "POV", ["Mara"]);
    await expect(page.getByText("Moving scenes is off while a filter is on")).toBeVisible();
    await expect(page.locator("[data-grip]")).toHaveCount(0);
    await page.getByRole("button", { name: "Actions for Arrival" }).click();
    await expect(page.getByRole("menuitem", { name: "Open scene" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Move later" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    // The Unsorted card is not a scene: it waits until the filter is off.
    await expect(page.locator("[data-unsorted]")).toHaveCount(0);
    await page.getByRole("button", { name: "Clear all filters" }).click();
    await expect(page.locator("[data-grip]")).toHaveCount(4);
    await expect(page.locator("[data-unsorted]")).toHaveCount(1);
  });

  test("prints the label on a chip and colours by label or status on request", async ({ page }) => {
    await filterBook(page);
    await openFilterBoard(page);
    await expect(page.locator("[data-colour-bar]")).toHaveCount(0);
    await expect(page.locator("[data-label-chip]")).toHaveText(["Past", "Past", "Dream"]);
    await colourBy(page).getByRole("radio", { name: "Label" }).click();
    await expect(page.locator('[data-colour-bar="label"]')).toHaveCount(3);
    // The same label always has the same colour.
    const classes = await page
      .locator('[data-colour-bar="label"]')
      .evaluateAll((els) => els.map((e) => e.className));
    expect(classes[0]).toBe(classes[1]);
    await colourBy(page).getByRole("radio", { name: "Status" }).click();
    await expect(page.locator('[data-colour-bar="status"]')).toHaveCount(3);
    await colourBy(page).getByRole("radio", { name: "None" }).click();
    await expect(page.locator("[data-colour-bar]")).toHaveCount(0);
  });

  test("keeps the filter for the book when the board is closed and opened again", async ({
    page,
  }) => {
    await filterBook(page);
    await openFilterBoard(page);
    await pick(page, "Label", ["Past"]);
    await colourBy(page).getByRole("radio", { name: "Label" }).click();
    await back(page);
    await openFilterBoard(page);
    expect(await titles(page)).toEqual(["Arrival", "Bargain"]);
    await expect(page.locator('[data-colour-bar="label"]')).toHaveCount(2);
    const saved = await page.evaluate(() => localStorage.getItem("cadabracraft.sceneFilters"));
    expect(JSON.parse(saved!)["/proj"].filter.label).toEqual(["past"]);
    // The timeline shows the same filter.
    await back(page);
    await openTimeline(page);
    await expect(filterBar(page)).toBeVisible();
    await expect(count(page)).toHaveText("2 of 4 scenes");
  });
});

test.describe("scene board filters on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("folds the controls under a Filters button", async ({ page }) => {
    await filterBook(page);
    await openFilterBoard(page);
    const toggle = page.getByRole("button", { name: "Filters", exact: true });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(search(page)).toBeHidden();
    await expect(count(page)).toBeVisible();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await search(page).fill("arr");
    await expect(page.getByRole("button", { name: /^Filters 1 selected/ })).toBeVisible();
    await expect(count(page)).toHaveText("1 of 4 scenes");
    await pick(page, "POV", ["Mara"]);
    await expect(page.getByRole("button", { name: /^POV: Mara/ })).toBeVisible();
    await expect(page.getByText("Moving scenes is off while a filter is on")).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
    await page.getByRole("button", { name: /^Filters/ }).click();
    await expect(search(page)).toBeHidden();
    await expect(page.getByRole("button", { name: "Clear all filters" })).toBeVisible();
  });
});

test.describe("scene board filters, right to left", () => {
  test("mirrors the bar and does not overflow", async ({ page }) => {
    await filterBook(page);
    await page.evaluate(() => {
      document.documentElement.dir = "rtl";
      document.documentElement.lang = "he";
    });
    await openFilterBoard(page);
    await pick(page, "POV", ["Mara"]);
    await page
      .getByRole("radiogroup", { name: "Colour by" })
      .getByRole("radio", { name: "Label" })
      .click();
    const [card, stripe] = await Promise.all([
      page.locator("[data-scene-card]").first().boundingBox(),
      page.locator('[data-colour-bar="label"]').first().boundingBox(),
    ]);
    // The colour bar sits on the start edge, which is the right in a right-to-left layout.
    expect(stripe!.x + stripe!.width).toBeGreaterThan(card!.x + card!.width - 8);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(overflow).toBe(false);
  });
});
