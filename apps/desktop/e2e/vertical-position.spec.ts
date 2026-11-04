import { expect, test, type Page } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { addPage, focusEnd, manifestOf, newProject, sidebar } from "./support/helpers";

// Vertically centred pages: the title page, dedication and epigraph sit between the margins by default, a page's menu can say Top or
// Centred, and a page that needs more than one page is never centred. The PDF and EPUB are covered by the package tests.

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

/** Where the content block of the first page stack in `scope` sits: its middle and the middle of the text box, at zoom 1. */
const placement = (page: Page, scope: string) =>
  page.evaluate((sel) => {
    const stack = document.querySelector(`${sel} .page-stack`) as HTMLElement;
    const cs = getComputedStyle(stack);
    const n = (name: string) => parseFloat(cs.getPropertyValue(name));
    const zoom = Number(stack.getAttribute("data-zoom"));
    const pm = stack.querySelector(".ProseMirror")!;
    const r = stack.getBoundingClientRect();
    const top = (pm.firstElementChild!.getBoundingClientRect().top - r.top) / zoom;
    const bottom = (pm.lastElementChild!.getBoundingClientRect().bottom - r.top) / zoom;
    return {
      mid: (top + bottom) / 2,
      boxMid: (n("--page-mt") + n("--page-h") - n("--page-mb")) / 2,
      top,
      mt: n("--page-mt"),
      centred: stack.querySelector(".page-centred") !== null,
      cards: stack.querySelectorAll(".page-card").length,
    };
  }, scope);

const TOLERANCE = 14; // px at zoom 1: the trailing paragraph spacing and line leading

test("the title page is centred between the margins in Page view and Read mode, and a Top choice and undo work", async ({
  page,
}) => {
  await newProject(page);
  await addPage(page, "Title page");
  await expect(page.locator(".ProseMirror h1")).toHaveText("E2E Book");
  await expect.poll(async () => (await placement(page, "body")).centred).toBe(true);
  let p = await placement(page, "body");
  expect(Math.abs(p.mid - p.boxMid)).toBeLessThan(TOLERANCE);
  expect(p.top).toBeGreaterThan(p.mt + 60); // not at the top

  // Read mode draws the same page.
  await page.getByRole("radio", { name: "Read" }).click();
  await expect(page.getByTestId("reading-section").first()).toBeVisible();
  await expect
    .poll(async () => (await placement(page, '[data-testid="reading-section"]')).centred)
    .toBe(true);
  p = await placement(page, '[data-testid="reading-section"]');
  expect(Math.abs(p.mid - p.boxMid)).toBeLessThan(TOLERANCE);
  await page.getByRole("radio", { name: "Write" }).click();
  await expect(page.locator(".page").first()).toBeVisible();

  // The row menu: Default is checked, Top moves the block to the top of the text box and is announced.
  await page.getByRole("button", { name: "Actions for Title Page" }).click();
  const group = page.getByRole("menu").getByRole("group", { name: "Vertical position" });
  await expect(group.getByRole("menuitemradio")).toHaveCount(3);
  await expect(group.getByRole("menuitemradio", { name: "Default" })).toBeChecked();
  await group.getByRole("menuitemradio", { name: "Top" }).click();
  await expect(page.getByText("Title Page: at the top of the page")).toBeAttached();
  await expect(page.getByRole("button", { name: "Actions for Title Page" })).toBeFocused();
  await expect.poll(async () => (await manifestOf(page)).frontMatter[0].verticalCenter).toBe(false);
  await expect.poll(async () => (await placement(page, "body")).centred).toBe(false);
  p = await placement(page, "body");
  expect(Math.abs(p.top - p.mt)).toBeLessThan(2);

  // Undo puts it back in the middle.
  await page.getByRole("button", { name: /^Undo: Change vertical position/ }).click();
  await expect
    .poll(async () => (await manifestOf(page)).frontMatter[0].verticalCenter)
    .toBeUndefined();
  await expect.poll(async () => (await placement(page, "body")).centred).toBe(true);
  p = await placement(page, "body");
  expect(Math.abs(p.mid - p.boxMid)).toBeLessThan(TOLERANCE);
});

test("a foreword starts at the top, Centred centres it, and Default follows the template again", async ({
  page,
}) => {
  await newProject(page);
  await addPage(page, "Foreword");
  await expect(page.locator(".ProseMirror h1")).toHaveText("Foreword");
  expect((await placement(page, "body")).centred).toBe(false);
  await page.getByRole("button", { name: "Actions for Foreword" }).click();
  await page.getByRole("menuitemradio", { name: "Centred" }).click();
  await expect(page.getByText("Foreword: centred on the page")).toBeAttached();
  await expect.poll(async () => (await placement(page, "body")).centred).toBe(true);
  const p = await placement(page, "body");
  expect(Math.abs(p.mid - p.boxMid)).toBeLessThan(TOLERANCE);
  await page.getByRole("button", { name: "Actions for Foreword" }).click();
  await page.getByRole("menuitemradio", { name: "Default" }).click();
  await expect(page.getByText("Foreword: vertical position follows the template")).toBeAttached();
  await expect.poll(async () => (await placement(page, "body")).centred).toBe(false);
  expect((await manifestOf(page)).frontMatter[0]).not.toHaveProperty("verticalCenter");
});

test("a centred page that grows past one page is not centred and not pushed down or clipped", async ({
  page,
}) => {
  await newProject(page);
  await addPage(page, "Foreword");
  await page.getByRole("button", { name: "Actions for Foreword" }).click();
  await page.getByRole("menuitemradio", { name: "Centred" }).click();
  await expect.poll(async () => (await placement(page, "body")).centred).toBe(true);
  await focusEnd(page);
  const words = "quiet garden river stone letter morning lantern orchard".split(" ");
  await page.keyboard.insertText(
    Array.from({ length: 700 }, (_, i) => words[i % words.length]).join(" "),
  );
  await expect.poll(async () => (await placement(page, "body")).cards).toBeGreaterThan(1);
  const p = await placement(page, "body");
  expect(p.centred).toBe(false);
  // The first block still starts at the top margin.
  expect(Math.abs(p.top - p.mt)).toBeLessThan(2);
});

test("a phone shows a matter page as plain reading text, never centred and never clipped", async ({
  page,
}) => {
  await newProject(page);
  await addPage(page, "Dedication");
  await page.setViewportSize({ width: 320, height: 640 });
  await expect(page.getByTestId("reflow-scroll")).toBeVisible();
  await expect(page.locator(".page-centred")).toHaveCount(0);
  const fits = await page.getByTestId("reflow-scroll").evaluate((el) => ({
    clipX: el.scrollWidth > el.clientWidth + 1,
  }));
  expect(fits.clipX).toBe(false);
  await expect(page.locator(".ProseMirror p").first()).toBeVisible();
});

test("the row menu has no Vertical position for chapters, the contents page or the copyright page", async ({
  page,
}) => {
  await newProject(page);
  await addPage(page, "Copyright page");
  await addPage(page, "Contents");
  for (const name of ["Chapter One", "Copyright", "Contents"]) {
    await sidebar(page)
      .getByRole("button", { name: `Actions for ${name}` })
      .click();
    await expect(page.getByRole("menu")).toBeVisible();
    await expect(page.getByRole("group", { name: "Vertical position" })).toHaveCount(0);
    await page.keyboard.press("Escape");
  }
});

test("the Templates page says which pages the template centres", async ({ page }) => {
  await newProject(page);
  await page.getByRole("button", { name: "Change template" }).click();
  const row = page.locator("dt", { hasText: "Pages centred on the page" });
  await expect(row).toBeVisible();
  await expect(row.locator("xpath=following-sibling::dd")).toHaveText(
    "Title page, Dedication, Epigraph",
  );
});
