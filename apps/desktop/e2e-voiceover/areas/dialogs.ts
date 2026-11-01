import { expect, type Locator } from "@playwright/test";
import { fakeImportSources } from "../../e2e/support/fakeImport";
import { chapterAction, newProject } from "../../e2e/support/helpers";
import { bareRole, type Area, type Ctx } from "../support";

/**
 * The dialogs reachable from an open book. Each area opens its own screen, moves VoiceOver into the page BEFORE any dialog
 * is open (`navigateToWebContent` cannot run while a modal traps focus), opens the dialog with a page click, steps through
 * it, and closes it with Escape. The VoiceOver commands are kept to about 30 per area.
 */

/** What the page behind a dialog says: none of it may be read while the dialog is open. */
const BEHIND = /\bChapters\b|Add chapter|Show chapters/;

/** Waits for the dialog to be announced, then steps back to its heading. VoiceOver must hear the heading. */
async function hearHeading({ page, walk }: Ctx, heading: RegExp) {
  await page.waitForTimeout(4000);
  const before = await walk("previous", 12, heading);
  expect(before.join("\n"), "VoiceOver did not reach the dialog heading").toMatch(heading);
  expect(before.join("\n")).not.toMatch(BEHIND);
}

/** Steps forward through a dialog and checks that every control has a name and none comes from the page behind. */
async function readControls({ walk }: Ctx, steps: number, expected: RegExp[]) {
  const said = await walk("next", steps);
  const text = said.join("\n");
  for (const name of expected) expect(text, `VoiceOver never said ${name}`).toMatch(name);
  expect(bareRole(said), "controls read without a name").toEqual([]);
  expect(text).not.toMatch(BEHIND);
  return said;
}

/**
 * Escape closes the dialog, focus goes back to the control that opened it (WCAG 2.4.3), and VoiceOver is on that control:
 * one step on and one step back lands on it again, so the phrase after the step back names the opener.
 */
async function escapeBackTo({ page, walk }: Ctx, opener: Locator, name: RegExp) {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(opener).toBeFocused();
  await page.waitForTimeout(1500);
  await walk("next", 1);
  const back = await walk("previous", 1);
  expect(back.join("\n"), "VoiceOver is not on the control that opened the dialog").toMatch(name);
}

const toolbarButton = (ctx: Ctx, name: string) =>
  ctx.page.getByRole("toolbar", { name: "Formatting" }).getByRole("button", { name, exact: true });

const exportDialog: Area = {
  name: "Export dialog and its PDF options",
  run: async (ctx) => {
    const { page, find } = ctx;
    await newProject(page);
    await ctx.enter();

    const opener = page.getByRole("button", { name: "Export", exact: true });
    await opener.click();
    const dialog = page.getByRole("dialog", { name: "Export book" });
    await expect(dialog).toBeVisible();
    await hearHeading(ctx, /Export book/);

    // The formats are one group named Format with six named radios, then the three buttons.
    const said = await readControls(ctx, 18, [
      /Format/,
      /EPUB 3/,
      /Print PDF/,
      /Markdown/,
      /Word/,
      /Rich Text/,
      /Audiobook/,
      /Cancel/,
      /Export/,
    ]);
    expect(said.join("\n")).toMatch(/radio/i);

    // Switching to Print PDF adds named options; VoiceOver follows the focus to the radio first.
    const radio = dialog.getByRole("radio", { name: "Print PDF" });
    await radio.click();
    await radio.focus();
    await expect(radio).toBeChecked();
    await page.waitForTimeout(1000);
    const pdf = await find(/Print preview/, 18);
    const text = pdf.join("\n");
    for (const name of [
      /Template/,
      /Body font/,
      /Heading font/,
      /PDF\/A/,
      /PDF\/UA/,
      /bleed/i,
      /Crop marks/,
      /Print preview/,
    ])
      expect(text, `VoiceOver never said ${name}`).toMatch(name);
    expect(bareRole(pdf), "controls read without a name").toEqual([]);
    expect(text).not.toMatch(BEHIND);

    await escapeBackTo(ctx, opener, /Export/);
  },
};

const bookDetails: Area = {
  name: "Book details dialog",
  run: async (ctx) => {
    const { page } = ctx;
    await newProject(page);
    await ctx.enter();

    const opener = page.getByRole("button", { name: "Book details" }).first();
    await opener.click();
    await expect(page.getByRole("dialog", { name: "Book details" })).toBeVisible();
    await hearHeading(ctx, /Book details/);

    await readControls(ctx, 22, [
      /Choose image/,
      /Title/,
      /Author/,
      /Language/,
      /ISBN/,
      /Trim size/,
    ]);

    await escapeBackTo(ctx, opener, /Book details/);
  },
};

const history: Area = {
  name: "History dialog for a chapter",
  run: async (ctx) => {
    const { page } = ctx;
    await newProject(page);
    await ctx.enter();

    // The dialog opens from the chapter's Actions menu; focus goes back to that Actions button.
    const opener = page.getByRole("button", { name: "Actions for Chapter One" });
    await chapterAction(page, "Chapter One", "History");
    await expect(page.getByRole("dialog", { name: /History · Chapter One/ })).toBeVisible();
    await hearHeading(ctx, /History/);

    await readControls(ctx, 10, [/This page/, /Whole book/, /Close/]);

    await escapeBackTo(ctx, opener, /Actions for Chapter One/);
  },
};

const importIntoBook: Area = {
  name: "Import into this book dialog",
  run: async (ctx) => {
    const { page } = ctx;
    // The open-book import lives in the header's "More actions" menu, which only the phone layout shows.
    const size = page.viewportSize();
    await fakeImportSources(page, "md3", false);
    await page.setViewportSize({ width: 390, height: 844 });
    try {
      await newProject(page);
      await ctx.enter();

      const opener = page.getByRole("button", { name: "More actions" });
      await opener.click();
      await page.getByRole("menuitem", { name: "Import into this book" }).click();
      await expect(page.getByRole("dialog", { name: "Import into this book" })).toBeVisible();
      await hearHeading(ctx, /Import into this book/);

      await readControls(ctx, 10, [/File/, /Choose file/, /Cancel/, /Next/]);

      await escapeBackTo(ctx, opener, /More actions/);
    } finally {
      if (size) await page.setViewportSize(size);
    }
  },
};

const imageDetails: Area = {
  name: "Image details dialog",
  run: async (ctx) => {
    const { page } = ctx;
    await newProject(page);

    // Put a described picture in the chapter and select it, so the toolbar enables "Image details".
    await page.locator(".ProseMirror p").last().click();
    await toolbarButton(ctx, "Image").click();
    const add = page.getByRole("dialog", { name: "Add image" });
    await add.getByLabel("Description (alt text)").fill("A single pixel");
    await add.getByRole("button", { name: "Insert" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.locator(".ProseMirror figure img").click();
    const opener = toolbarButton(ctx, "Image details");
    await expect(opener).toBeEnabled();
    await ctx.enter();

    await opener.click();
    await expect(page.getByRole("dialog", { name: "Image details" })).toBeVisible();
    await hearHeading(ctx, /Image details/);

    await readControls(ctx, 12, [/Description/, /decorative/, /Cancel/]);

    // A click on a WebKit toolbar button does not focus it, so focus returns to the editor, not the button.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  },
};

export const dialogs: Area[] = [exportDialog, bookDetails, history, importIntoBook, imageDetails];
