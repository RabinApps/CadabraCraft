import { expect, test, type Page } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { chapterDoc, newProject, seedChapters } from "./support/helpers";

// Typewriter scrolling: the caret line stays in the middle of the writing area while typing. See architecture.md, "Typewriter mode".

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

type MenuRun = { run: (id: string) => boolean };
const menu = async (page: Page, id: string) => {
  await page.waitForFunction(() =>
    Boolean((window as unknown as { __cadabraMenu?: MenuRun }).__cadabraMenu),
  );
  return page.evaluate(
    (i) => (window as unknown as { __cadabraMenu: MenuRun }).__cadabraMenu.run(i),
    id,
  );
};
const stored = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("cadabracraft.settings") ?? "{}"));
const turnOn = (page: Page) =>
  page.evaluate(async () => {
    (await import("/src/state/view/editorPrefs.ts" as string)).useSettings
      .getState()
      .set({ typewriterScroll: true });
  });

const scrollerSel = "[data-testid=page-scroll], [data-testid=reflow-scroll]";
const scrollTop = (page: Page) =>
  page.evaluate((s) => document.querySelector<HTMLElement>(s)!.scrollTop, scrollerSel);
/** How far the line of the caret is from the middle of the scroller, in px (positive: below). The caret sits in a one-line paragraph. */
const offMiddle = (page: Page) =>
  page.evaluate((s) => {
    const box = document.querySelector<HTMLElement>(s)!.getBoundingClientRect();
    const node = getSelection()!.anchorNode!;
    const block = (node instanceof Element ? node : node.parentElement)!.closest("p")!;
    const r = block.getBoundingClientRect();
    return (r.top + r.bottom) / 2 - (box.top + box.bottom) / 2;
  }, scrollerSel);

/** A long chapter, the caret at its end, then new short paragraphs typed there. */
async function writeAtEnd(page: Page, lines = 12) {
  await seedChapters(page, [chapterDoc("Long", 60, 70)]);
  // The caret at the end of the last paragraph, put there without a key or a click (neither may scroll to the middle).
  await page.evaluate((sel) => {
    const el = document.querySelector<HTMLElement>(sel)!;
    el.scrollTop = el.scrollHeight;
    const pm = document.querySelector<HTMLElement>(".ProseMirror")!;
    pm.focus();
    const last = [...pm.querySelectorAll("p")].at(-1)!;
    const r = document.createRange();
    r.selectNodeContents(last);
    r.collapse(false);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(r);
  }, scrollerSel);
  for (let i = 0; i < lines; i++) {
    await page.keyboard.press("Enter");
    await page.keyboard.type(`line ${i}`);
  }
}

const TOLERANCE = 30; // a line is about 25 px; the scroll runs a frame after the key

test.describe("with typewriter scrolling on", () => {
  test("Page view keeps the caret line in the middle at the end of a long chapter", async ({
    page,
  }) => {
    await newProject(page);
    await turnOn(page);
    await writeAtEnd(page);
    await expect.poll(() => offMiddle(page).then(Math.abs)).toBeLessThan(TOLERANCE);
    // The end slack: the scroller can scroll past the last line, so the last line can reach the middle.
    await expect(page.getByTestId("page-scroll")).toHaveCSS("padding-bottom", /^[1-9]\d{2,}/);
  });

  test("the narrow reflow keeps the caret line in the middle too", async ({ page }) => {
    await newProject(page);
    await turnOn(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId("reflow-scroll")).toBeVisible();
    await writeAtEnd(page);
    await expect.poll(() => offMiddle(page).then(Math.abs)).toBeLessThan(TOLERANCE);
  });

  test("arrow keys follow the caret, and with reduced motion the move is immediate", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await newProject(page);
    await turnOn(page);
    await writeAtEnd(page, 4);
    // The exact page breaks can land after the typing and move everything: measure from the settled, centred state.
    await expect.poll(() => offMiddle(page).then(Math.abs)).toBeLessThan(TOLERANCE);
    const before = await scrollTop(page);
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    await expect.poll(() => offMiddle(page).then(Math.abs)).toBeLessThan(TOLERANCE);
    expect(await scrollTop(page)).toBeLessThan(before);
  });

  test("a wheel scroll by the author is not undone", async ({ page }) => {
    await newProject(page);
    await turnOn(page);
    await writeAtEnd(page, 6);
    await expect.poll(() => offMiddle(page).then(Math.abs)).toBeLessThan(TOLERANCE);
    const box = (await page.getByTestId("page-scroll").boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -500);
    await page.waitForTimeout(600);
    const after = await scrollTop(page);
    await page.waitForTimeout(600);
    expect(await scrollTop(page)).toBe(after);
    expect(Math.abs(await offMiddle(page))).toBeGreaterThan(TOLERANCE);
  });

  test("the caret and focus stay where they were", async ({ page }) => {
    await newProject(page);
    await turnOn(page);
    await writeAtEnd(page, 3);
    await expect(page.locator(".ProseMirror")).toBeFocused();
    await expect(page.locator(".ProseMirror p").last()).toHaveText("line 2");
    await page.keyboard.type("!");
    await expect(page.locator(".ProseMirror p").last()).toHaveText("line 2!");
  });
});

test("with it off nothing scrolls to the middle and no slack is added", async ({ page }) => {
  await newProject(page);
  await writeAtEnd(page);
  // The editor's own keep-in-view still works, but the line is not held in the middle: it rests near the bottom edge.
  expect(await offMiddle(page)).toBeGreaterThan(TOLERANCE);
  await expect(page.getByTestId("page-scroll")).toHaveCSS("padding-bottom", "48px");
});

test("the menu command toggles it, ticks, and the setting survives a reload", async ({ page }) => {
  await newProject(page);
  expect((await stored(page)).typewriterScroll ?? false).toBe(false);
  expect(await menu(page, "view.typewriter")).toBe(true);
  await expect.poll(async () => (await stored(page)).typewriterScroll).toBe(true);
  await page.reload();
  await page.getByRole("button", { name: "Open folder" }).click();
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("switch", { name: "Typewriter scrolling" })).toBeChecked();
  await page.getByRole("switch", { name: "Typewriter scrolling" }).click();
  await expect.poll(async () => (await stored(page)).typewriterScroll).toBe(false);
});

test("Settings has a named switch that is reachable by keyboard and turns it on", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  const sw = page.getByRole("switch", { name: "Typewriter scrolling" });
  await sw.focus();
  await expect(sw).not.toBeChecked();
  await page.keyboard.press("Space");
  await expect(sw).toBeChecked();
  expect((await stored(page)).typewriterScroll).toBe(true);
});

test("it is listed in Settings > Shortcuts with its key", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  await page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("button", { name: "Shortcuts" })
    .click();
  const row = page.locator("#shortcuts").getByRole("listitem").filter({
    hasText: "Typewriter Scrolling",
  });
  await expect(row.getByRole("img", { name: /^(Option Command|Control Alt) T$/ })).toBeVisible();
});
