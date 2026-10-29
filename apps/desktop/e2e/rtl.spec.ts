import { expect, test } from "./support/coverage";
import { fakeTauri } from "./support/fakeTauri";
import { frenchWithOneChapter, newProject, seedChapters, sidebar } from "./support/helpers";
import type { Page } from "@playwright/test";

// No Hebrew or Arabic catalog exists yet, so the layout is checked with the direction forced (English text, mirrored layout).
const forceRtl = (page: Page) =>
  page.evaluate(() => {
    document.documentElement.dir = "rtl";
    document.documentElement.lang = "he";
  });

const noOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

const shot = (page: Page, name: string) =>
  page.screenshot({ path: `test-results/rtl-${name}.png`, fullPage: false });

test.beforeEach(async ({ page }) => {
  await fakeTauri(page);
});

test("RTL: Home mirrors and does not overflow", async ({ page }) => {
  await page.goto("/");
  const button = page.getByRole("button", { name: "New project" });
  await expect(button).toBeVisible();
  await forceRtl(page);
  // The logo is at the right edge and the settings button at the left.
  const logo = await page.getByText("CadabraCraft").first().boundingBox();
  const gear = await page.getByRole("button", { name: "Settings" }).boundingBox();
  expect(logo && gear && logo.x > gear.x).toBe(true);
  expect(await noOverflow(page)).toBe(true);
  await shot(page, "home");
});

test("RTL: editor, chapter list, toolbar, details and dialogs mirror", async ({ page }) => {
  await newProject(page);
  await forceRtl(page);
  const vw = page.viewportSize()?.width ?? 1280;

  // The chapter list sits at the right edge, the editor to its left.
  const sb = await sidebar(page).boundingBox();
  const ed = await page.locator(".ProseMirror").boundingBox();
  expect(sb && sb.x + sb.width / 2 > vw / 2).toBe(true);
  expect(sb && ed && ed.x + ed.width / 2 < sb.x + sb.width / 2).toBe(true);

  // The details panel moves to the left edge.
  const details = page.getByRole("complementary", { name: "Details" });
  if (await details.count()) {
    const box = await details.boundingBox();
    if (box) expect(box.x + box.width / 2).toBeLessThan(vw / 2);
  }

  // The toolbar starts at the right: Undo is to the right of Redo, and its arrows are mirrored.
  const undo = await page.getByRole("button", { name: "Undo", exact: true }).first().boundingBox();
  const redo = await page.getByRole("button", { name: "Redo", exact: true }).first().boundingBox();
  expect(undo && redo && undo.x > redo.x).toBe(true);
  const flipped = await page
    .getByRole("button", { name: "Undo", exact: true })
    .first()
    .locator("svg")
    .evaluate((el) => getComputedStyle(el).scale);
  expect(flipped).toMatch(/^-1/);
  // Roving focus: ArrowLeft moves to the next button in RTL (Undo and Redo are disabled on a fresh book).
  await page.getByRole("button", { name: "Bold", exact: true }).first().focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("button", { name: "Italic", exact: true }).first()).toBeFocused();
  expect(await noOverflow(page)).toBe(true);
  await shot(page, "editor");

  // Book details: the Publishing details chevron is mirrored, and the action row runs from the right.
  await page.getByRole("button", { name: "Book details" }).first().click();
  const bd = page.getByRole("dialog", { name: /Book details/ });
  await expect(bd).toBeVisible();
  const chevron = bd.locator("summary svg").first();
  expect(await chevron.evaluate((el) => getComputedStyle(el).scale)).toMatch(/^-1/);
  await shot(page, "book-details");
  const box = await bd.boundingBox();
  expect(box && Math.abs(box.x + box.width / 2 - vw / 2) < 2).toBe(true);
  expect(await noOverflow(page)).toBe(true);
  await page.keyboard.press("Escape");

  // Export dialog: Cancel is at the left edge of the action row and the primary button at the right? No: the row
  // is justified to the end, so in RTL the primary button (last in the DOM) is the leftmost.
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const ex = page.getByRole("dialog", { name: "Export book" });
  await expect(ex).toBeVisible();
  const primary = await ex.getByRole("button", { name: "Export", exact: true }).boundingBox();
  const cancel = await ex.getByRole("button", { name: "Cancel" }).boundingBox();
  expect(primary && cancel && primary.x < cancel.x).toBe(true);
  expect(await noOverflow(page)).toBe(true);
  await shot(page, "export");
  await page.keyboard.press("Escape");

  // Settings: the back arrow is mirrored and sits at the right edge.
  await page.getByRole("button", { name: "Settings" }).first().click();
  const back = page.getByRole("button", { name: "Back" }).first();
  await expect(back).toBeVisible();
  expect(await back.locator("svg").evaluate((el) => getComputedStyle(el).scale)).toMatch(/^-1/);
  const bb = await back.boundingBox();
  expect(bb && bb.x > vw / 2).toBe(true);
  expect(await noOverflow(page)).toBe(true);
  await shot(page, "settings");
});

test("RTL: the book snapshots dialog mirrors and does not overflow", async ({ page }) => {
  await newProject(page);
  await forceRtl(page);
  const vw = page.viewportSize()?.width ?? 1280;
  await sidebar(page).getByRole("button", { name: "Book snapshots" }).click();
  const dialog = page.getByRole("dialog", { name: "History · Whole book" });
  await dialog.getByLabel("Snapshot name").fill("Before the rewrite");
  await dialog.getByRole("button", { name: "Take snapshot" }).click();
  const list = dialog.getByRole("list", { name: "Book snapshots" });
  await expect(list).toContainText("Before the rewrite");
  // The Take snapshot button sits to the left of the name field, and the list text starts at the right edge of its row.
  const field = await dialog.getByLabel("Snapshot name").boundingBox();
  const take = await dialog.getByRole("button", { name: "Take snapshot" }).boundingBox();
  expect(field && take && take.x < field.x).toBe(true);
  const item = await list.getByRole("button").first().boundingBox();
  const name = await list.getByRole("button").first().locator("span").first().boundingBox();
  expect(item && name && name.x + name.width > item.x + item.width - 20).toBe(true);
  const box = await dialog.boundingBox();
  expect(box && Math.abs(box.x + box.width / 2 - vw / 2) < 2).toBe(true);
  expect(await noOverflow(page)).toBe(true);
  await shot(page, "book-snapshots");
});

test("RTL: command palette and outline navigator mirror, indent from the right and do not overflow", async ({
  page,
}) => {
  await newProject(page);
  const h = (level: number, text: string) => ({
    type: "heading",
    attrs: { level },
    content: [{ type: "text", text }],
  });
  await seedChapters(page, [
    { type: "doc", content: [h(1, "Top"), h(2, "Middle"), h(3, "Deep")] } as unknown as {
      content: never[];
    },
  ]);
  await forceRtl(page);
  const vw = page.viewportSize()?.width ?? 1280;

  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();
  await page.keyboard.type("focus mode");
  const row = palette.getByRole("option", { name: /Focus Mode/ });
  await expect(row).toBeVisible();
  // Centered, and the shortcut keys sit at the left end of the row, after the label that starts at the right.
  const box = await palette.boundingBox();
  expect(box && Math.abs(box.x + box.width / 2 - vw / 2) < 2).toBe(true);
  const label = await row.locator("span").first().boundingBox();
  const keys = await row.getByRole("img").boundingBox();
  const rowBox = await row.boundingBox();
  expect(
    label &&
      keys &&
      rowBox &&
      keys.x < label.x &&
      label.x + label.width > rowBox.x + rowBox.width / 2,
  ).toBe(true);
  expect(await noOverflow(page)).toBe(true);
  await shot(page, "palette");
  await page.keyboard.press("Escape");

  await page.keyboard.press("ControlOrMeta+Shift+o");
  const outline = page.getByRole("dialog", { name: "Outline" });
  await expect(outline).toBeVisible();
  const right = async (name: string) => {
    const b = await outline
      .getByRole("option", { name })
      .first()
      .locator("span")
      .first()
      .boundingBox();
    return b ? b.x + b.width : 0;
  };
  // Deeper headings are indented from the start edge, which is the right one: their text ends further left.
  const top = await right("Top");
  const middle = await right("Middle");
  const deep = await right("Deep");
  expect(top).toBeGreaterThan(middle);
  expect(middle).toBeGreaterThan(deep);
  expect(await noOverflow(page)).toBe(true);
  await shot(page, "outline");
});

test("RTL: the audiobook dialog with two editions mirrors and does not overflow", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.__audioVoices = [
      { id: "piper-amy", engine: "piper", installed: true, languages: ["en"] },
      { id: "piper-fr", engine: "piper", installed: true, languages: ["fr"] },
    ];
  });
  await frenchWithOneChapter(page);
  await forceRtl(page);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const ex = page.getByRole("dialog", { name: "Export book" });
  await ex.getByRole("radio", { name: "Audiobook" }).click();
  await expect(ex.getByLabel("Edition")).toBeVisible();
  const warn = ex.getByText(/Not translated yet in Français/);
  await expect(warn).toBeVisible();
  // Text starts at the right edge of its box in RTL.
  expect(await warn.evaluate((el) => getComputedStyle(el).direction)).toBe("rtl");
  const box = await ex.boundingBox();
  const vw = page.viewportSize()?.width ?? 1280;
  expect(box && Math.abs(box.x + box.width / 2 - vw / 2) < 2).toBe(true);
  expect(await noOverflow(page)).toBe(true);
  // The primary action is the leftmost button, like the other formats.
  const primary = await ex.getByRole("button", { name: "Export audiobook" }).boundingBox();
  const cancel = await ex.getByRole("button", { name: "Cancel" }).boundingBox();
  expect(primary && cancel && primary.x < cancel.x).toBe(true);
  await shot(page, "audiobook");
});
