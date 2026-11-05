import { expect, test, type Page } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { addPage, chapterAction, manifestOf, newProject, sidebar } from "./support/helpers";

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

const partTitles = async (page: Page) =>
  (await manifestOf(page)).chapters.map((c: { kind?: string; titles: { en: string } }) =>
    c.kind === "part" ? `part:${c.titles.en}` : c.titles.en,
  );

/** A part after Chapter One with Chapter 2 grouped under it. */
async function withPart(page: Page) {
  await newProject(page);
  await page.getByRole("button", { name: "Add part" }).click();
  await expect(page.locator(".ProseMirror h1")).toHaveText("Part 1");
  await page.getByRole("button", { name: "Add chapter" }).click();
}

test("a part groups the chapters after it and opens its own page", async ({ page }) => {
  await withPart(page);
  expect(await partTitles(page)).toEqual(["Chapter One", "part:Part 1", "Chapter 2"]);

  const part = sidebar(page).getByRole("button", { name: /^Part 1/ });
  await expect(part).toBeVisible();
  await expect(sidebar(page).getByText("1 chapter")).toBeVisible();

  await part.click();
  await expect(page.locator(".ProseMirror h1")).toHaveText("Part 1");
});

test("Start part here begins a part at that chapter", async ({ page }) => {
  await newProject(page);
  await page.getByRole("button", { name: "Add chapter", exact: true }).click();
  await page.getByRole("button", { name: "Add chapter", exact: true }).click();
  await chapterAction(page, "Chapter 2", "Start part here");

  await expect(page.locator(".ProseMirror h1")).toHaveText("Part 1");
  expect(await partTitles(page)).toEqual(["Chapter One", "part:Part 1", "Chapter 2", "Chapter 3"]);
  await expect(sidebar(page).getByText("2 chapters")).toBeVisible();
});

test("renaming and moving a part keeps its chapters together, and trashing it keeps them in the book", async ({
  page,
}) => {
  await withPart(page);
  await chapterAction(page, "Part 1", "Rename");
  await page.getByLabel("Chapter title").fill("Part One");
  await page.keyboard.press("Enter");
  await expect(sidebar(page).getByRole("button", { name: /^Part One/ })).toBeVisible();

  // A second part after Chapter 2, then move the first part down past it.
  await sidebar(page).getByRole("button", { name: "Chapter 2", exact: true }).click();
  await page.getByRole("button", { name: "Add part" }).click();
  await expect(page.locator(".ProseMirror h1")).toHaveText("Part 2");
  await sidebar(page)
    .getByRole("button", { name: /^Part One/ })
    .click();
  await chapterAction(page, "Part One", "Move part down");
  expect(await partTitles(page)).toEqual([
    "Chapter One",
    "part:Part 2",
    "part:Part One",
    "Chapter 2",
  ]);
  await chapterAction(page, "Part One", "Move part up");
  expect(await partTitles(page)).toEqual([
    "Chapter One",
    "part:Part One",
    "Chapter 2",
    "part:Part 2",
  ]);

  await chapterAction(page, "Part One", "Move to trash");
  await page.getByRole("dialog").getByRole("button", { name: "Move to trash" }).click();
  expect(await partTitles(page)).toEqual(["Chapter One", "Chapter 2", "part:Part 2"]);
  const trashed = await page.evaluate(() =>
    Object.keys(window.__disk).filter(
      (k) => k.startsWith(".cadabra/trash/") && k.includes("part-"),
    ),
  );
  expect(trashed).toHaveLength(1);
});

test("the Contents page lists parts by default and can leave them out", async ({ page }) => {
  await withPart(page);
  await addPage(page, "Contents");
  const contents = page.getByRole("region", { name: "Contents" });
  const titles = () =>
    contents
      .getByRole("list", { name: "Contents entries" })
      .locator("[data-toc-key] span.truncate")
      .allTextContents();
  const indentOf = (id: string) =>
    contents
      .locator(`[data-toc-key="${id}"] span.truncate`)
      .locator("..")
      .evaluate((el) => getComputedStyle(el).paddingInlineStart);
  expect(await titles()).toContain("Part 1");
  // Chapter 2 belongs to Part 1, so it sits one step in; the chapter before the part stays at the top.
  const chapters = (await manifestOf(page)).chapters;
  const partId = chapters.find((c: { kind?: string }) => c.kind === "part").id;
  const groupedId = chapters.find(
    (c: { kind?: string; titles: { en: string } }) =>
      c.kind !== "part" && c.titles.en === "Chapter 2",
  ).id;
  expect(await indentOf(partId)).toBe("0px");
  expect(await indentOf("ch-1")).toBe("0px");
  expect(await indentOf(groupedId)).toBe("16px");

  await contents.getByRole("switch", { name: "Include parts" }).click();
  await expect.poll(async () => (await titles()).includes("Part 1")).toBe(false);
  expect(await indentOf(groupedId)).toBe("0px");
  expect(
    (await manifestOf(page)).frontMatter.find((e: { kind?: string }) => e.kind === "contents").toc
      .parts,
  ).toBe(false);

  await contents.getByRole("switch", { name: "Include parts" }).click();
  expect(await titles()).toContain("Part 1");
  expect(await indentOf(groupedId)).toBe("16px");
});

test("the Contents page moves a part together with its chapters", async ({ page }) => {
  await withPart(page);
  await chapterAction(page, "Part 1", "Rename");
  await page.getByLabel("Chapter title").fill("Part One");
  await page.keyboard.press("Enter");

  // A second part after Chapter 2, with Chapter 3 grouped under it.
  await page.getByRole("button", { name: "Add part" }).click();
  await page.getByRole("button", { name: "Add chapter" }).click();
  await addPage(page, "Contents");
  const contents = page.getByRole("region", { name: "Contents", exact: true });
  const titles = () =>
    contents
      .getByRole("list", { name: "Contents entries" })
      .locator("[data-toc-key] span.truncate")
      .allTextContents();
  await expect
    .poll(titles)
    .toEqual(["Chapter One", "Part One", "Chapter 2", "Part 2", "Chapter 3"]);

  const move = async (name: string, item: string) => {
    await contents.getByRole("button", { name: `Actions for ${name}` }).click();
    await page.getByRole("menuitem", { name: item }).click();
  };
  await move("Part One", "Move down");
  await expect
    .poll(titles)
    .toEqual(["Chapter One", "Part 2", "Chapter 3", "Part One", "Chapter 2"]);
  await move("Part One", "Move up");
  await expect
    .poll(titles)
    .toEqual(["Chapter One", "Part One", "Chapter 2", "Part 2", "Chapter 3"]);

  // A top-level row dropped on a part row does not split the part from its chapter.
  await move("Chapter One", "Move down");
  await expect
    .poll(titles)
    .toEqual(["Part One", "Chapter 2", "Chapter One", "Part 2", "Chapter 3"]);
});

test("the Contents page drags a part block with its chapters", async ({ page }) => {
  await withPart(page);
  await page.getByRole("button", { name: "Add part" }).click();
  await page.getByRole("button", { name: "Add chapter" }).click();
  await addPage(page, "Contents");
  const contents = page.getByRole("region", { name: "Contents", exact: true });
  const titles = () =>
    contents
      .getByRole("list", { name: "Contents entries" })
      .locator("[data-toc-key] span.truncate")
      .allTextContents();
  await expect.poll(titles).toEqual(["Chapter One", "Part 1", "Chapter 2", "Part 2", "Chapter 3"]);

  const grip = (await contents.getByRole("button", { name: "Reorder Part 1" }).boundingBox())!;
  const target = (await contents.locator('[data-toc-key="ch-3"]').boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + 10, target.y + 2, { steps: 6 });
  await expect(page.locator("[data-drop-line]")).toHaveCount(1);
  await page.mouse.up();
  await expect.poll(titles).toEqual(["Chapter One", "Part 2", "Chapter 3", "Part 1", "Chapter 2"]);

  // The drag moves the part row and its chapter as one block, so the nesting survives the drop.
  const indent = await contents
    .locator('[data-toc-key="ch-2"] span.truncate')
    .locator("..")
    .evaluate((el) => getComputedStyle(el).paddingInlineStart);
  expect(indent).toBe("16px");
});

test("the Contents page drags a part block up around the neighbouring part", async ({ page }) => {
  await withPart(page);
  await page.getByRole("button", { name: "Add part" }).click();
  await page.getByRole("button", { name: "Add chapter" }).click();
  await addPage(page, "Contents");
  const contents = page.getByRole("region", { name: "Contents", exact: true });
  const titles = () =>
    contents
      .getByRole("list", { name: "Contents entries" })
      .locator("[data-toc-key] span.truncate")
      .allTextContents();
  const indentOf = (id: string) =>
    contents
      .locator(`[data-toc-key="${id}"] span.truncate`)
      .locator("..")
      .evaluate((el) => getComputedStyle(el).paddingInlineStart);
  await expect.poll(titles).toEqual(["Chapter One", "Part 1", "Chapter 2", "Part 2", "Chapter 3"]);

  // Drop Part 2 on a row inside Part 1's block: it lands above the whole Part 1 block, not between Part 1 and Chapter 2.
  const grip = (await contents.getByRole("button", { name: "Reorder Part 2" }).boundingBox())!;
  const target = (await contents.locator('[data-toc-key="ch-2"]').boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + 10, target.y + 2, { steps: 6 });
  await expect(page.locator("[data-drop-line]")).toHaveCount(1);
  await page.mouse.up();
  await expect.poll(titles).toEqual(["Chapter One", "Part 2", "Chapter 3", "Part 1", "Chapter 2"]);
  expect(await indentOf("ch-3")).toBe("16px");
  expect(await indentOf("ch-2")).toBe("16px");
});
