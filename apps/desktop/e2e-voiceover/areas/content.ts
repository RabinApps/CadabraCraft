import { expect, type Page } from "@playwright/test";
import { newProject, seedChapters } from "../../e2e/support/helpers";
import type { Area, Ctx } from "../support";

/**
 * Content the author writes beyond plain paragraphs: tables, footnotes, quotes, scene breaks, task and definition lists,
 * language marks, the inline marks and image alt text. Every area builds its content with page actions first, enters the
 * page once, then reads the page text (a `textbox` that needs `interact`) and checks names and meaning, never whole phrases.
 * What VoiceOver said is printed (`console.log`) so the author can read the real wording after a run.
 */
const pm = (page: Page) => page.locator(".ProseMirror");
const tb = (page: Page, name: string) =>
  page.getByRole("toolbar", { name: "Formatting" }).getByRole("button", { name, exact: true });

const runCommand = (page: Page, id: string) =>
  page.evaluate(async (c) => {
    (await import("/src/state/commands.ts" as string)).runCommand(c);
  }, id);

const PAGE_TEXT = /Page text/i;
const MAX_TO_EDITOR = 50;

async function typeInLastParagraph(page: Page, text: string) {
  await pm(page).locator("p").last().click();
  await page.keyboard.type(text);
}

async function selectLastParagraph(page: Page) {
  await pm(page).locator("p").last().click({ clickCount: 3 });
}

type Node = { type: string; attrs?: object; text?: string; marks?: object[]; content?: Node[] };
const text = (value: string, marks?: object[]): Node => ({
  type: "text",
  text: value,
  ...(marks ? { marks } : {}),
});
const para = (...content: Node[]): Node => ({ type: "paragraph", content });

/** Opens a chapter whose title is "Chapter One" followed by `blocks`. */
async function seed(page: Page, blocks: Node[]) {
  await newProject(page);
  const title: Node = { type: "heading", attrs: { level: 1 }, content: [text("Chapter One")] };
  await seedChapters(page, [{ type: "doc", content: [title, ...blocks] }] as never);
}

/** Moves to the page text box, interacts with it and reads on until `until` (or `max` steps). Returns what was said. */
async function readPage(ctx: Ctx, until: RegExp, max: number): Promise<string[]> {
  const { find, walk, cap, vo } = ctx;
  await find(PAGE_TEXT, MAX_TO_EDITOR);
  await cap("interact", vo.interact());
  const said = await walk("next", max, until);
  await cap("stopInteracting", vo.stopInteracting());
  console.log(`VoiceOver read:\n${said.join("\n")}`);
  return said;
}

/** True when a phrase shows VoiceOver has left the page text box (end of the box or the status bar). */
const LEFT_BOX = /end of|words? in this chapter|Page zoom|complementary/i;

/** Re-enters the page text box and steps through it (up to `max` steps) until `until` or until VoiceOver leaves the box. */
async function stepThroughBox(
  ctx: Ctx,
  max: number,
  until?: RegExp,
  /** After the forward walk, step back from where it stopped until this phrase, and add what was said. */
  backTo?: RegExp,
): Promise<string[]> {
  const { find, walk, cap, vo } = ctx;
  await find(PAGE_TEXT, MAX_TO_EDITOR);
  await cap("interact", vo.interact());
  const said: string[] = [];
  for (let i = 0; i < max; i++) {
    const [phrase] = await walk("next", 1);
    said.push(phrase ?? "");
    if (until?.test(phrase ?? "") || LEFT_BOX.test(phrase ?? "")) break;
  }
  if (backTo) said.push(...(await walk("previous", 30, backTo)));
  await cap("stopInteracting", vo.stopInteracting());
  return said;
}

const table: Area = {
  name: "content table with header row",
  run: async (ctx) => {
    const { page, enter } = ctx;
    await newProject(page);
    await pm(page).locator("p").last().click();
    await runCommand(page, "editor.table");
    const dialog = page.getByRole("dialog", { name: "Insert table" });
    await dialog.getByLabel("Rows").fill("3");
    await dialog.getByLabel("Columns").fill("2");
    await dialog.getByRole("button", { name: "Insert" }).click();
    for (const [i, cell] of ["Name", "Role", "Ada", "Author", "Bob", "Editor"].entries()) {
      await page.keyboard.type(cell);
      if (i < 5) await page.keyboard.press("Tab");
    }
    const grid = pm(page).locator("table");
    await expect(grid.locator("tr")).toHaveCount(3);
    // The first row is a header: two `th` cells that the accessibility tree calls column headers, the rest data cells.
    await expect(grid.locator("th")).toHaveCount(2);
    await expect(grid.getByRole("columnheader")).toHaveText(["Name", "Role"]);
    await expect(grid.getByRole("cell")).toHaveText(["Ada", "Author", "Bob", "Editor"]);
    await enter();

    const said = await readPage(ctx, /Editor/, 30);
    const heard = said.join("\n");
    expect(heard).toMatch(/table/i);
    for (const cell of ["Name", "Role", "Ada", "Author", "Bob", "Editor"])
      expect(heard, `the cell ${cell} was not read`).toMatch(new RegExp(cell));
  },
};

const footnote: Area = {
  name: "content footnote inline",
  run: async (ctx) => {
    const { page, enter } = ctx;
    await newProject(page);
    await typeInLastParagraph(page, "Before the note ");
    await tb(page, "Footnote").click();
    await expect(pm(page).locator("span.footnote")).toHaveText("Note");
    await enter();

    // The footnote is an inline `span.footnote` with no role, name or label: VoiceOver can only read its text in the flow of
    // the paragraph. VoiceOver may read only the footnote text ("Note"), so this asserts just that; whether anything marks it
    // as a footnote is printed for the author.
    const said = await readPage(ctx, /Note/, 12);
    expect(said.join("\n")).toMatch(/Note/);
    const marker = await pm(page)
      .locator("span.footnote")
      .evaluate((el) => ({
        role: el.getAttribute("role"),
        label: el.getAttribute("aria-label"),
        describedby: el.getAttribute("aria-describedby"),
      }));
    console.log(`footnote span semantics: ${JSON.stringify(marker)}`);
  },
};

const blocks: Area = {
  name: "content quote, scene break, task list and definition list",
  run: async (ctx) => {
    const { page, enter } = ctx;
    await seed(page, [
      para(text("Quote group.")),
      { type: "blockquote", content: [para(text("To be or not to be."))] },
      para(text("Break group.")),
      { type: "sceneBreak" },
      para(text("Task group.")),
      {
        type: "taskList",
        content: [
          { type: "taskItem", attrs: { checked: true }, content: [para(text("Draft done"))] },
          { type: "taskItem", attrs: { checked: false }, content: [para(text("Edit pending"))] },
        ],
      },
      para(text("Definition group.")),
      {
        type: "definitionList",
        content: [
          { type: "definitionTerm", content: [text("Quill")] },
          { type: "definitionDescription", content: [para(text("A pen made from a feather."))] },
        ],
      },
      para(text("The end.")),
    ]);
    await expect(pm(page).locator("blockquote")).toHaveText("To be or not to be.");
    await expect(pm(page).locator("hr.scene-break")).toHaveCount(1);
    await expect(pm(page).locator("dl dt")).toHaveText("Quill");
    await expect(pm(page).locator("dl dd")).toHaveText("A pen made from a feather.");
    await expect(pm(page).locator('li[data-type="taskItem"]')).toHaveCount(2);
    const boxes = pm(page).locator('li[data-type="taskItem"] input[type="checkbox"]');
    await expect(boxes).toHaveCount(2);
    await expect(boxes.nth(0)).toBeChecked();
    await expect(boxes.nth(1)).not.toBeChecked();
    await enter();

    // The forward walk left the box after the scene break; the backward walk shows whether the blocks after it can be read.
    const said = await stepThroughBox(ctx, 25, /The end/, /Task group/);
    console.log(`VoiceOver read the blocks:\n${said.join("\n")}`);
    const heard = said.join("\n");
    expect(heard).toMatch(/To be or not to be/);
    expect(heard).toMatch(/Draft done/);
    expect(heard).toMatch(/Edit pending/);
    expect(heard).toMatch(/Quill/);
    expect(heard).toMatch(/feather/);
    // Open question for the author: is the scene break announced (separator or rule)? Recorded, not asserted.
    const from = said.findIndex((p) => /To be or not to be/.test(p));
    const to = said.findIndex((p) => /Task group|Draft done/.test(p));
    const between = from >= 0 && to > from ? said.slice(from + 1, to) : [];
    console.log(
      `scene break: between the quote and the task list VoiceOver said ${JSON.stringify(between)}; separator announced: ${/separator|rule|divider|line/i.test(between.join(" "))}`,
    );
  },
};

const language: Area = {
  name: "content language mark",
  run: async (ctx) => {
    const { page, enter } = ctx;
    await newProject(page);
    await typeInLastParagraph(page, "Bonjour tout le monde");
    await selectLastParagraph(page);
    await runCommand(page, "editor.lang");
    const dialog = page.getByRole("dialog", { name: "Language of selection" });
    await dialog.getByLabel("Language tag").fill("fr");
    await dialog.getByRole("button", { name: "Apply" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(pm(page).locator('span[lang="fr"]')).toHaveText("Bonjour tout le monde");
    await enter();

    const said = await readPage(ctx, /Bonjour tout le monde/, 12);
    expect(said.join("\n")).toMatch(/Bonjour tout le monde/);

    // Clear Language removes the mark again.
    await selectLastParagraph(page);
    await runCommand(page, "editor.clearLang");
    await expect(pm(page).locator("[lang]")).toHaveCount(0);
    await expect(pm(page).locator("p").last()).toHaveText("Bonjour tout le monde");
  },
};

const inline: Area = {
  name: "content inline formats pressed state",
  run: async (ctx) => {
    const { page, vo, enter, find, walk, cap } = ctx;
    await newProject(page);
    // Code excludes every other mark and Subscript excludes Superscript, so they go on their own paragraphs. The last
    // paragraph, which is selected when VoiceOver arrives, carries the toolbar marks.
    // Strikethrough, Code, Superscript and Subscript are Format menu commands only (no toolbar button), so they are
    // applied through their commands and checked in the DOM.
    const paragraphs = pm(page).locator("p");
    await typeInLastParagraph(page, "Code words");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Sub words");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Marked words");
    const pick = (n: number) => paragraphs.nth(n).click({ clickCount: 3 });
    await pick(0);
    await runCommand(page, "editor.code");
    await pick(1);
    await runCommand(page, "editor.subscript");
    await pick(2);
    for (const name of ["Italic", "Underline", "Small caps"]) await tb(page, name).click();
    for (const id of ["strike", "superscript"]) await runCommand(page, `editor.${id}`);
    const word = paragraphs.last();
    await expect(paragraphs.filter({ has: page.locator("code") })).toHaveText("Code words");
    await expect(paragraphs.filter({ has: page.locator("sub") })).toHaveText("Sub words");
    await expect(word.locator("em")).toHaveCount(1);
    await expect(word.locator("u")).toHaveCount(1);
    await expect(word.locator("s")).toHaveCount(1);
    await expect(word.locator("sup")).toHaveCount(1);
    for (const name of ["Italic", "Underline", "Small caps"])
      await expect(tb(page, name)).toHaveAttribute("aria-pressed", "true");
    await enter();

    await find(/Formatting toolbar/, MAX_TO_EDITOR);
    await cap("interact", vo.interact());
    const toItalic = await find(/Italic/, 12);
    expect(toItalic.at(-1) ?? "").toMatch(/pressed|\bon\b|selected|checked|1/i);
    const rest = await walk("next", 3, /Small caps/);
    const heard = [...toItalic, ...rest].join("\n");
    expect(heard).toMatch(/Underline/);
    expect(heard).toMatch(/Small caps/);
    console.log(`VoiceOver read the inline buttons:\n${heard}`);
    for (const phrase of rest.filter((p) => /Underline|Small caps/.test(p)))
      expect(phrase, "a pressed button is announced as on").toMatch(
        /pressed|\bon\b|selected|checked|1/i,
      );

    // Back to Italic and toggle it with VoiceOver last: the state flips and a different phrase is spoken.
    const before = toItalic.at(-1) ?? "";
    await walk("previous", 4, /^Italic/);
    await cap("act", vo.act());
    await expect(tb(page, "Italic")).toHaveAttribute("aria-pressed", "false");
    await page.waitForTimeout(1000);
    const after = await cap("lastSpokenPhrase", vo.lastSpokenPhrase());
    expect(after, "the new state is announced").not.toEqual(before);
  },
};

const alt: Area = {
  name: "content image alt text",
  run: async (ctx) => {
    const { page, enter, walk, find, cap, vo } = ctx;
    await newProject(page);
    await pm(page).locator("p").last().click();
    await enter();

    await tb(page, "Image").click();
    const dialog = page.getByRole("dialog", { name: "Add image" });
    await expect(dialog.getByLabel("Image file")).toHaveValue("assets/pic.png");
    await page.waitForTimeout(4000);
    const before = await walk("previous", 10, /Add image/i);
    expect(before.join("\n")).toMatch(/Add image/i);

    // Insert without a description: an alert (live region) names the problem and nothing is inserted.
    await dialog.getByRole("button", { name: "Insert" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Describe the image");
    await expect(pm(page).locator("figure")).toHaveCount(0);

    // The controls are reachable by name.
    const fields = await walk("next", 14);
    const heard = fields.join("\n");
    expect(heard).toMatch(/Description|alt text/i);
    expect(heard).toMatch(/decorative/i);
    console.log(`VoiceOver read the Add image dialog:\n${heard}`);

    // Decorative disables the description.
    await dialog.getByLabel("This image is decorative").check();
    await expect(dialog.getByLabel("Description (alt text)")).toBeDisabled();
    await dialog.getByLabel("This image is decorative").uncheck();
    await expect(dialog.getByLabel("Description (alt text)")).toBeEnabled();
    await dialog.getByLabel("Description (alt text)").fill("A single pixel");
    await dialog.getByRole("button", { name: "Insert" }).click();
    await expect(dialog).toHaveCount(0);
    const img = pm(page).locator("figure img");
    await expect(img).toHaveAttribute("alt", "A single pixel");

    // The inserted image reads with its description. Focus went back to the editor and VoiceOver left the text box, so
    // re-enter it (looking back first if the cursor sits past it) and step through.
    await page.waitForTimeout(1500);
    const back = await walk("previous", 12, PAGE_TEXT);
    if (!PAGE_TEXT.test(back.at(-1) ?? "")) await find(PAGE_TEXT, MAX_TO_EDITOR);
    await cap("interact", vo.interact());
    const said = await walk("next", 15, /single pixel|pixel|image/i);
    await cap("stopInteracting", vo.stopInteracting());
    console.log(`VoiceOver read the image area:\n${said.join("\n")}`);
    // The DOM side is asserted above (img alt). Whether VoiceOver reads the alt text is recorded, not asserted.
    console.log(`alt text heard: ${/single pixel|pixel|image/i.test(said.join(" "))}`);
  },
};

export const content: Area[] = [table, footnote, blocks, language, inline, alt];
