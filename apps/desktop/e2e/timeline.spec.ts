import { expect, test, type Page } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { manifestOf, newProject, seedChapters } from "./support/helpers";
import {
  count,
  filterBook,
  openTimeline as openFilterTimeline,
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
const scene = (id: string, title: string, attrs: Record<string, unknown> = {}) => ({
  type: "scene",
  attrs: { id, title, ...attrs },
  content: [para(`${title} words here`)],
});
const doc = (...content: unknown[]) =>
  ({ type: "doc", content }) as unknown as { content: never[] };

/** Chapter One: Arrival (Sep 3, 6:40 PM), Bargain (no date), Chase (Sep 2). Chapter Two: Dawn (Sep 4). */
async function book(page: Page) {
  await newProject(page);
  await seedChapters(page, [
    doc(
      heading("Chapter One"),
      scene("a", "Arrival", { date: "1893-09-03T18:40", pov: "Mara", status: "draft" }),
      scene("b", "Bargain", { synopsis: "A deal is struck." }),
      scene("c", "Chase", { date: "1893-09-02" }),
    ),
    doc(heading("Chapter Two"), scene("d", "Dawn", { date: "1893-09-04" })),
  ]);
}

const openTimeline = async (page: Page) => {
  await page.getByRole("button", { name: "Timeline" }).click();
  await expect(page.getByRole("heading", { name: "Timeline", level: 1 })).toBeVisible();
};
const runCommand = (page: Page, id: string) =>
  page.evaluate(
    (c) =>
      (window as never as { __cadabraMenu: { run: (id: string) => void } }).__cadabraMenu.run(c),
    id,
  );
const order = (page: Page) =>
  page
    .getByRole("list", { name: "Scenes on the timeline" })
    .locator("[data-timeline-item] h3")
    .allTextContents();
const orderBy = (page: Page, name: "Book order" | "Story date") =>
  page.getByRole("radiogroup", { name: "Order" }).getByRole("radio", { name }).click();
const sceneAttrs = async (page: Page, chapter: number, id: string) => {
  const m = await manifestOf(page);
  return page.evaluate(
    ([file, sceneId]) => {
      const blocks = JSON.parse(window.__disk[file as string] as string).content as {
        type: string;
        attrs: Record<string, unknown>;
      }[];
      return blocks.find((b) => b.type === "scene" && b.attrs.id === sceneId)!.attrs;
    },
    [Object.values((m.chapters[chapter] as { files: Record<string, string> }).files)[0]!, id],
  );
};

test.describe("timeline", () => {
  test("lists every scene in book order from the header button, and Back returns to the editor", async ({
    page,
  }) => {
    await book(page);
    await openTimeline(page);
    await expect.poll(() => order(page)).toEqual(["Arrival", "Bargain", "Chase", "Dawn"]);
    await expect(page).toHaveTitle(/^Timeline - E2E Book/);
    const arrival = page.locator('[data-scene-id="a"]');
    await expect(arrival).toContainText("Sep 3, 1893");
    await expect(arrival).toContainText("Chapter One");
    await expect(arrival).toContainText("POV Mara");
    await expect(arrival).toContainText("Draft");
    await expect(page.locator('[data-scene-id="b"]')).toContainText("No date");
    await expect(page.locator('[data-scene-id="b"] [data-marker="undated"]')).toHaveCount(1);
    await expect(page.locator('[data-scene-id="a"] [data-marker="dated"]')).toHaveCount(1);
    await expect(page.getByText("1 without a story date.")).toBeVisible();
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter One");
  });

  test("story date order sorts dated scenes and keeps an undated one behind the scene before it", async ({
    page,
  }) => {
    await book(page);
    await openTimeline(page);
    await orderBy(page, "Story date");
    await expect.poll(() => order(page)).toEqual(["Chase", "Arrival", "Bargain", "Dawn"]);
    await expect(page.locator('[data-scene-id="b"]')).toContainText("Follows Arrival");
    await orderBy(page, "Book order");
    await expect.poll(() => order(page)).toEqual(["Arrival", "Bargain", "Chase", "Dawn"]);
  });

  test("sets, changes and clears a story date in a chapter that is not open, and the order follows", async ({
    page,
  }) => {
    await book(page);
    await openTimeline(page);
    await orderBy(page, "Story date");
    const day = page.getByLabel("Story date of Bargain", { exact: true });
    await day.fill("1893-09-01");
    await day.blur();
    await expect.poll(async () => (await sceneAttrs(page, 0, "b")).date).toBe("1893-09-01");
    await expect.poll(() => order(page)).toEqual(["Bargain", "Chase", "Arrival", "Dawn"]);
    await expect(page.locator("[aria-live=polite]")).toContainText(
      "Story date of Bargain set to Sep 1, 1893",
    );
    await expect(page.getByLabel("Story date of Bargain", { exact: true })).toBeFocused();
    // A time joins the day; it is written as THH:MM.
    const time = page.getByLabel("Story time of Bargain", { exact: true });
    await time.fill("07:15");
    await time.blur();
    await expect.poll(async () => (await sceneAttrs(page, 0, "b")).date).toBe("1893-09-01T07:15");
    await expect(page.locator('[data-scene-id="b"]')).toContainText("7:15");
    // Clearing the date drops the time with it.
    await page.getByRole("button", { name: "Clear the story date of Bargain" }).click();
    await expect.poll(async () => (await sceneAttrs(page, 0, "b")).date).toBe("");
    await expect(page.getByLabel("Story time of Bargain", { exact: true })).toBeDisabled();
    await expect.poll(() => order(page)).toEqual(["Chase", "Arrival", "Bargain", "Dawn"]);
  });

  test("a date field left empty clears the date, and Enter saves", async ({ page }) => {
    await book(page);
    await openTimeline(page);
    const day = page.getByLabel("Story date of Dawn", { exact: true });
    await day.fill("");
    await day.blur();
    await expect.poll(async () => (await sceneAttrs(page, 1, "d")).date).toBe("");
    const bargain = page.getByLabel("Story date of Bargain", { exact: true });
    await bargain.fill("2000-02-29");
    await bargain.press("Enter");
    await expect.poll(async () => (await sceneAttrs(page, 0, "b")).date).toBe("2000-02-29");
  });

  test("opens from the View menu command and the command palette", async ({ page }) => {
    await book(page);
    await runCommand(page, "view.timeline");
    await expect(page.getByRole("heading", { name: "Timeline", level: 1 })).toBeVisible();
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await page.keyboard.press("ControlOrMeta+k");
    await page.getByRole("combobox", { name: "Command palette" }).fill("Timeline");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Timeline", level: 1 })).toBeVisible();
  });

  test("opens a scene in the editor from its row", async ({ page }) => {
    await book(page);
    await openTimeline(page);
    await page.getByRole("button", { name: "Open scene Dawn in Chapter Two" }).click();
    await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter Two");
    await expect(page.getByRole("region", { name: "Scene" })).toContainText("Dawn");
  });

  test("says so when the book has no scenes", async ({ page }) => {
    await newProject(page);
    await seedChapters(page, [doc(heading("Chapter One"), para("No scenes."))]);
    await openTimeline(page);
    await expect(page.getByText("This book has no scenes yet.")).toBeVisible();
  });
});

test.describe("timeline on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("stacks the date above each card without sideways scrolling", async ({ page }) => {
    await book(page);
    await runCommand(page, "view.timeline");
    await expect(page.getByRole("heading", { name: "Timeline", level: 1 })).toBeVisible();
    await expect.poll(() => order(page)).toEqual(["Arrival", "Bargain", "Chase", "Dawn"]);
    const [date, card] = await Promise.all([
      page.locator('[data-scene-id="a"] time').boundingBox(),
      page.locator('[data-scene-id="a"] [data-scene-card]').boundingBox(),
    ]);
    expect(card!.y).toBeGreaterThan(date!.y);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  });
});

test.describe("timeline on a tablet", () => {
  test.use({ viewport: { width: 820, height: 1180 } });

  test("puts the date at the side of the axis", async ({ page }) => {
    await book(page);
    await runCommand(page, "view.timeline");
    await expect.poll(() => order(page)).toHaveLength(4);
    const [date, card] = await Promise.all([
      page.locator('[data-scene-id="a"] time').boundingBox(),
      page.locator('[data-scene-id="a"] [data-scene-card]').boundingBox(),
    ]);
    expect(card!.x).toBeGreaterThan(date!.x + date!.width);
  });
});

test.describe("timeline filters", () => {
  const rows = (page: Page) => page.locator("[data-timeline-item] h3").allTextContents();
  const colourBy = (page: Page) => page.getByRole("radiogroup", { name: "Colour by" });

  test("filters after the axis is built: an undated scene still follows the scene before it", async ({
    page,
  }) => {
    await filterBook(page);
    await openTimeline(page);
    await orderBy(page, "Story date");
    await expect.poll(() => rows(page)).toEqual(["Chase", "Arrival", "Bargain", "Dawn"]);
    await expect(count(page)).toHaveText("4 scenes");
    await pick(page, "POV", ["Ada"]);
    await expect.poll(() => rows(page)).toEqual(["Bargain"]);
    await expect(count(page)).toHaveText("1 of 4 scenes");
    // Arrival is hidden, yet Bargain keeps its place behind it.
    await expect(page.locator('[data-scene-id="b"]')).toContainText("Follows Arrival");
    // No "moving" caption on the timeline: it moves nothing.
    await expect(page.getByText("Moving scenes is off while a filter is on")).toHaveCount(0);
    await page.getByRole("button", { name: "Clear all filters" }).click();
    await expect.poll(() => rows(page)).toEqual(["Chase", "Arrival", "Bargain", "Dawn"]);
  });

  test("filters by status and label and searches, with OR within a facet", async ({ page }) => {
    await filterBook(page);
    await openTimeline(page);
    await pick(page, "Status", ["Draft", "Final"]);
    await expect.poll(() => rows(page)).toEqual(["Arrival", "Dawn"]);
    await pick(page, "Label", ["No label"]);
    await expect.poll(() => rows(page)).toEqual(["Dawn"]);
    await search(page).fill("zzzzq");
    await expect(page.getByText("No scenes match these filters.")).toBeVisible();
    await expect(page.getByRole("list", { name: "Scenes on the timeline" })).toHaveCount(0);
    await page.getByRole("button", { name: "Clear filters", exact: true }).click();
    await expect.poll(() => rows(page)).toEqual(["Arrival", "Bargain", "Chase", "Dawn"]);
  });

  test("shows the label chip and colours by label or status", async ({ page }) => {
    await filterBook(page);
    await openTimeline(page);
    await expect(page.locator("[data-label-chip]")).toHaveText(["Past", "Past", "Dream"]);
    await expect(page.locator("[data-colour-bar]")).toHaveCount(0);
    await colourBy(page).getByRole("radio", { name: "Label" }).click();
    await expect(page.locator('[data-colour-bar="label"]')).toHaveCount(3);
    await colourBy(page).getByRole("radio", { name: "Status" }).click();
    await expect(page.locator('[data-colour-bar="status"]')).toHaveCount(3);
  });

  test("still edits a date on a filtered row", async ({ page }) => {
    await filterBook(page);
    await openTimeline(page);
    await pick(page, "POV", ["Ada"]);
    const day = page.getByLabel("Story date of Bargain", { exact: true });
    await day.fill("1893-09-01");
    await day.blur();
    await expect.poll(() => rows(page)).toEqual(["Bargain"]);
    await expect(page.locator('[data-scene-id="b"]')).toContainText("Sep 1, 1893");
  });
});

test.describe("timeline filters on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("folds the controls under a Filters button", async ({ page }) => {
    await filterBook(page);
    await openFilterTimeline(page);
    await expect(search(page)).toBeHidden();
    await page.getByRole("button", { name: "Filters", exact: true }).click();
    await pick(page, "Status", ["Draft"]);
    await expect(count(page)).toHaveText("1 of 4 scenes");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  });
});

test.describe("timeline filters, right to left", () => {
  test("mirrors and does not overflow", async ({ page }) => {
    await filterBook(page);
    await page.evaluate(() => {
      document.documentElement.dir = "rtl";
      document.documentElement.lang = "he";
    });
    await openFilterTimeline(page);
    await pick(page, "Label", ["Past"]);
    await expect(count(page)).toHaveText("2 of 4 scenes");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(overflow).toBe(false);
  });
});
