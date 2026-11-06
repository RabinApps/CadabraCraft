import { expect, type Page } from "@playwright/test";
import { newProject } from "../../e2e/support/helpers";
import { bareRole, type Area } from "../support";

/**
 * The editor screen. The page text is a `textbox` ("Page text") that holds the chapter's headings and paragraphs, so
 * VoiceOver reaches them only after it interacts with that box. Every area sets up its page first and calls `enter`
 * once; dialogs are opened after `enter`, because `navigateToWebContent` cannot run with a modal open. Assertions are
 * on names and roles, never whole phrases, because the wording changes between macOS versions.
 */
const pm = (page: Page) => page.locator(".ProseMirror");
const tb = (page: Page, name: string) =>
  page.getByRole("toolbar", { name: "Formatting" }).getByRole("button", { name, exact: true });

async function typeInLastParagraph(page: Page, text: string) {
  // The new chapter ends with an empty paragraph; click it rather than rely on platform-specific End shortcuts.
  await pm(page).locator("p").last().click();
  await page.keyboard.type(text);
}

/** Triple-click selects the paragraph, and the toolbar buttons keep that selection when they are pressed. */
async function selectLastParagraph(page: Page) {
  await pm(page).locator("p").last().click({ clickCount: 3 });
}

const runCommand = (page: Page, id: string) =>
  page.evaluate(async (c) => {
    (await import("/src/state/app/commands.ts" as string)).runCommand(c);
  }, id);

const PAGE_TEXT = /Page text/i;
const MAX_TO_EDITOR = 50;

const landmarks: Area = {
  name: "editor landmarks and chapter navigation",
  run: async ({ page, enter, find, cap, vo }) => {
    await newProject(page);
    await enter();

    // The sidebar comes first: the Chapters navigation with its heading and the chapter, then the toolbar, then the text.
    const said = await find(PAGE_TEXT, MAX_TO_EDITOR);
    const heard = said.join("\n");
    expect(heard).toMatch(/Chapters/);
    expect(heard).toMatch(/Chapter One/);
    expect(heard).toMatch(/Formatting|Bold/);
    expect(bareRole(said)).toEqual([]);

    // The chapter heading is a heading inside the page text, read after interacting with it.
    await cap("interact", vo.interact());
    const inside: string[] = [];
    for (let i = 0; i < 4; i++) {
      await cap("next", vo.next());
      inside.push(await cap("lastSpokenPhrase", vo.lastSpokenPhrase()));
      if (/heading/i.test(inside.at(-1) ?? "") && /Chapter One/.test(inside.at(-1) ?? "")) break;
    }
    expect(inside.join("\n")).toMatch(/heading/i);
    expect(inside.join("\n")).toMatch(/Chapter One/);
    await cap("stopInteracting", vo.stopInteracting());
  },
};

const toolbar: Area = {
  name: "editor formatting toolbar",
  run: async ({ page, vo, enter, find, walk, cap }) => {
    await newProject(page);
    // Bold is on for the selected text before VoiceOver arrives, so it has a pressed state to announce.
    await typeInLastParagraph(page, "Some bold words");
    await selectLastParagraph(page);
    await tb(page, "Bold").click();
    await expect(tb(page, "Bold")).toHaveAttribute("aria-pressed", "true");
    await enter();

    // VoiceOver announces the toolbar as a group and skips over its buttons until it interacts with the group.
    const toToolbar = await find(/Formatting toolbar/, MAX_TO_EDITOR);
    await cap("interact", vo.interact());
    const toBold = [...toToolbar, ...(await find(/Bold/, 20))];
    expect(toBold.join("\n")).toMatch(/Undo/);
    expect(toBold.join("\n")).toMatch(/Redo/);
    const boldOn = toBold.at(-1) ?? "";
    expect(boldOn).toMatch(/pressed|\bon\b|selected|checked|1/i);

    // The rest of the toolbar: every button has a name, none is a bare role.
    const rest = await walk("next", 16, /Footnote/);
    const all = [...toBold, ...rest];
    for (const name of [
      "Italic",
      "Underline",
      "Small caps",
      "Link",
      "Heading 1",
      "Heading 2",
      "Heading 3",
      "Block quote",
      "Bulleted list",
      "Numbered list",
      "Scene break",
      "Image",
      "Footnote",
    ]) {
      expect(rest.join("\n"), `${name} was not read`).toMatch(new RegExp(name, "i"));
    }
    expect(all.join("\n")).toMatch(/button/i);
    expect(bareRole(all)).toEqual([]);

    // Back to Bold, then activate it with VoiceOver itself (VO+Space). Activating a toolbar button gives focus back to
    // the text, so VoiceOver leaves the toolbar: do this last.
    await walk("previous", 20, /^Bold/);
    await cap("act", vo.act());
    await expect(tb(page, "Bold")).toHaveAttribute("aria-pressed", "false");
    await page.waitForTimeout(1000);
    const boldOff = await cap("lastSpokenPhrase", vo.lastSpokenPhrase());
    expect(boldOff, "the new state is announced").not.toEqual(boldOn);
  },
};

const typing: Area = {
  name: "editor typing, headings and lists",
  run: async ({ page, enter, find, cap, vo, walk }) => {
    await newProject(page);
    await typeInLastParagraph(page, "The fox jumped over the fence.");
    await page.keyboard.press("Enter");
    await page.keyboard.type("## Second heading");
    await page.keyboard.press("Enter");
    await page.keyboard.type("- First item");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Second item");
    await expect(pm(page).locator("h2")).toHaveText("Second heading");
    await expect(pm(page).locator("ul > li")).toHaveCount(2);
    await enter();

    await find(PAGE_TEXT, MAX_TO_EDITOR);
    await cap("interact", vo.interact());
    // VoiceOver starts at the caret (the last line) and does not reliably reach the first paragraph going back: the
    // paragraph text is not required, only the heading and list that follow.
    const said: string[] = await walk("previous", 8, /fox jumped over the fence/);
    for (let i = 0; i < 12; i++) {
      await cap("next", vo.next());
      said.push(await cap("lastSpokenPhrase", vo.lastSpokenPhrase()));
      if (/Second item/.test(said.at(-1) ?? "")) break;
    }
    const heard = said.join("\n");
    console.log(`typing, headings and lists heard:\n${heard}`);
    expect(heard).toMatch(/heading/i);
    expect(heard).toMatch(/Second heading/);
    expect(heard).toMatch(/First item/);
    expect(heard).toMatch(/Second item/);
    expect(heard).toMatch(/list|bullet|•/i);
    await cap("stopInteracting", vo.stopInteracting());
  },
};

/** After the dialog opens: step back to its name, then forward through its fields and buttons. */
async function readDialog(
  { page, walk }: Pick<Parameters<Area["run"]>[0], "page" | "walk">,
  name: string,
  fields: RegExp[],
  buttons: RegExp[],
) {
  await expect(page.getByRole("dialog", { name })).toBeVisible();
  await page.waitForTimeout(4000);
  const before = await walk("previous", 8, new RegExp(name, "i"));
  expect(before.join("\n")).toMatch(new RegExp(name, "i"));
  const walked = await walk("next", 12);
  const heard = walked.join("\n");
  for (const field of fields) expect(heard).toMatch(field);
  for (const button of buttons) expect(heard).toMatch(button);
  expect(bareRole(walked)).toEqual([]);
  // Focus stays inside the dialog: nothing from the editor is read.
  expect(heard).not.toMatch(/Page text|Formatting|Chapters/);
}

const language: Area = {
  name: "editor language of selection dialog",
  run: async (ctx) => {
    const { page, enter } = ctx;
    await newProject(page);
    await typeInLastParagraph(page, "Bonjour tout le monde");
    await selectLastParagraph(page);
    await enter();

    await runCommand(page, "editor.lang");
    await readDialog(
      ctx,
      "Language of selection",
      [/Language/, /Language tag/],
      [/Apply/, /Cancel|Close/],
    );
  },
};

const link: Area = {
  name: "editor link dialog",
  run: async (ctx) => {
    const { page, enter } = ctx;
    await newProject(page);
    await typeInLastParagraph(page, "click me");
    await selectLastParagraph(page);
    await enter();

    await tb(page, "Link").click();
    await readDialog(ctx, "Add link", [/Address/], [/Apply/, /Cancel/]);
  },
};

export const editor: Area[] = [landmarks, toolbar, typing, language, link];
