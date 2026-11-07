import { expect, type Locator, type Page } from "@playwright/test";
import { chapterDoc, newProject, noVoices, seedChapters } from "../../e2e/support/helpers";
import { bareRole, type Area, type Ctx } from "../support";

/**
 * Settings pages that hold controls with generated names (Shortcuts, Fonts, Audio, Backups, Editor) and the panels of the
 * Export dialog other than PDF. Settings is entered from the home screen; the Export panels from an open book. As in the
 * other areas, VoiceOver enters the page once with no modal open, dialogs are opened by clicking, and a control far down
 * the page is reached by moving keyboard focus to it and hearing VoiceOver follow. Live-region messages are asserted in the
 * DOM only.
 */

const SETTLE_MS = 2500;

const openSettings = async (page: Page) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
};

/** Moves keyboard focus to `target` and checks VoiceOver names it (the phrase after the move, or a step either way). */
async function hearFocus({ page, walk, cap, vo }: Ctx, target: Locator, name: RegExp) {
  await target.focus();
  await page.waitForTimeout(SETTLE_MS);
  const heard = [await cap("lastSpokenPhrase", vo.lastSpokenPhrase())];
  heard.push(...(await walk("next", 1)));
  heard.push(...(await walk("previous", 1)));
  const text = heard.join("\n");
  expect(text, `VoiceOver did not name ${name}:\n${text}`).toMatch(name);
  expect(bareRole(heard), "control read without a name").toEqual([]);
  return text;
}

/** Waits for a freshly opened dialog, then steps back to its heading so reading starts at the top. */
async function toHeading({ page, walk }: Ctx, heading: RegExp) {
  await page.waitForTimeout(4000);
  const before = await walk("previous", 14, heading);
  expect(before.join("\n"), "VoiceOver did not reach the dialog heading").toMatch(heading);
}

const settingsShortcutsPage: Area = {
  name: "settings: Change and Reset shortcut buttons and the recording message",
  run: async (ctx) => {
    const { page, enter } = ctx;
    await openSettings(page);
    await enter();

    const section = page.locator("#shortcuts");
    await section.getByRole("searchbox", { name: "Search shortcuts" }).fill("bold");
    const change = section.getByRole("button", { name: /^Change shortcut for .*Bold/i }).first();
    await expect(change).toBeVisible();
    await hearFocus(ctx, change, /Change shortcut for .*Bold/i);

    // Recording: the button is pressed, a plain key is refused with an alert, a good combo is saved.
    await change.click();
    await expect(change).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("j");
    await expect(section.getByRole("alert")).toContainText(/Hold .* together with the key/);
    await page.keyboard.press("Alt+Control+KeyJ");
    await expect(change).toHaveAttribute("aria-pressed", "false");
    const reset = section.getByRole("button", { name: /^Reset shortcut for .*Bold/i }).first();
    await expect(reset).toBeVisible();
    await hearFocus(ctx, reset, /Reset shortcut for .*Bold/i);

    await reset.click();
    await expect(reset).toHaveCount(0);
  },
};

const settingsFonts: Area = {
  name: "settings: Fonts list, Browse fonts and the Download fonts dialog",
  run: async (ctx) => {
    const { page, enter, walk } = ctx;
    await openSettings(page);
    await enter();

    const section = page.locator("#fonts");
    await expect(section.getByTestId("font-Newsreader")).toBeVisible();
    await hearFocus(ctx, section.getByRole("button", { name: "Choose file…" }), /Choose file/);
    const browse = section.getByRole("button", { name: "Browse fonts…" });
    await hearFocus(ctx, browse, /Browse fonts/);

    await browse.click();
    const dialog = page.getByRole("dialog", { name: "Download fonts" });
    await expect(dialog).toBeVisible();
    await toHeading(ctx, /Download fonts/);
    const said = await walk("next", 16, /Close/);
    const text = said.join("\n");
    expect(text).toMatch(/Download .*Lora|Lora/);
    expect(text).toMatch(/SIL Open Font Licence/);
    expect(text).toMatch(/Close/);
    expect(bareRole(said), "controls read without a name").toEqual([]);

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(browse).toBeFocused();
  },
};

const settingsAudio: Area = {
  name: "settings: Audio default voice, Default formats group and voice deletion",
  run: async (ctx) => {
    const { page, enter } = ctx;
    await openSettings(page);
    await enter();

    const section = page.locator("#audio");
    await expect(section.getByText("Piper voices: Amy and LibriTTS").first()).toBeVisible();
    const voice = await hearFocus(
      ctx,
      section.getByRole("combobox", { name: "Default voice" }),
      /Default voice/,
    );
    expect(voice).toMatch(/pop up button|combo ?box/i);

    // The formats are a fieldset whose legend is Default formats; each checkbox is named by its format.
    const group = section.getByRole("group", { name: "Default formats" });
    await expect(group).toBeVisible();
    const first = group.getByRole("checkbox").first();
    await hearFocus(ctx, first, /check ?box|MP3|M4B|audio|WAV/i);

    // Deleting asks first: Keep and Delete voices are named buttons, and Keep backs out.
    const remove = section.getByRole("button", { name: "Delete", exact: true }).first();
    await hearFocus(ctx, remove, /Delete/);
    await remove.click();
    const keep = section.getByRole("button", { name: "Keep", exact: true }).first();
    const confirm = section.getByRole("button", { name: "Delete voices" }).first();
    await expect(confirm).toBeVisible();
    await hearFocus(ctx, confirm, /Delete voices/);
    await keep.click();
    await expect(confirm).toHaveCount(0);
  },
};

const settingsBackupsEditor: Area = {
  name: "settings: Backups and Editor number and select fields",
  run: async (ctx) => {
    const { page, enter } = ctx;
    await openSettings(page);
    await enter();

    const goal = page.locator("#editor").getByRole("spinbutton", { name: "Session word goal" });
    await hearFocus(ctx, goal, /Session word goal/);
    const paste = page.locator("#editor").getByRole("combobox", { name: "When pasting HTML" });
    const pasteSaid = await hearFocus(ctx, paste, /When pasting HTML/);
    expect(pasteSaid).toMatch(/pop up button|combo ?box/i);

    const keep = page
      .locator("#backups")
      .getByRole("spinbutton", { name: "Snapshots to keep per chapter" });
    const said = await hearFocus(ctx, keep, /Snapshots to keep per chapter/);
    expect(said).toMatch(/\d/);
    // The two read-only rows are plain text in the page.
    await expect(page.locator("#backups")).toContainText("When snapshots are taken");
    await expect(page.locator("#backups")).toContainText(".cadabra/backups");
  },
};

/** Opens Export from an open book, picks a format by its radio and steps through the panel to the buttons. */
async function exportPanel(
  ctx: Ctx,
  radioName: string | RegExp,
  expected: RegExp[],
  extra?: (dialog: Locator) => Promise<void>,
) {
  const { page, walk } = ctx;
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export book" });
  await expect(dialog).toBeVisible();
  const radio = dialog.getByRole("radio", { name: radioName });
  await radio.click();
  await expect(radio).toBeChecked();
  await extra?.(dialog);
  await toHeading(ctx, /Export book/);

  // Forward from the heading: the six format radios, the panel, then Cancel and Export.
  const said = await walk("next", 28, /^Export,.*button|^Export\s*$|Export.*button/i);
  const text = said.join("\n");
  expect(text).toMatch(/radio/i);
  for (const name of expected) expect(text, `VoiceOver never said ${name}:\n${text}`).toMatch(name);
  expect(text).toMatch(/Cancel/);
  expect(bareRole(said), "controls read without a name").toEqual([]);

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  return dialog;
}

const exportEpub: Area = {
  name: "export dialog: EPUB 3 panel and its checks",
  run: async (ctx) => {
    await newProject(ctx.page);
    await ctx.enter();
    await exportPanel(ctx, "EPUB 3", [/EPUB 3/, /Export/], async (dialog) => {
      await expect(
        dialog.getByRole("list", { name: "Checks" }).getByRole("listitem"),
      ).not.toHaveCount(0);
    });
  },
};

const exportMarkdown: Area = {
  name: "export dialog: Markdown panel and the HTML marks option",
  run: async (ctx) => {
    await newProject(ctx.page);
    await ctx.enter();
    await exportPanel(
      ctx,
      /Markdown/,
      [/Keep underline and small caps/, /check ?box/i],
      async (dialog) => {
        const box = dialog.getByRole("checkbox", { name: "Keep underline and small caps" });
        await expect(box).not.toBeChecked();
        await box.check();
        await expect(box).toBeChecked();
        await box.uncheck();
      },
    );
  },
};

const exportWord: Area = {
  name: "export dialog: Word panel and its font choice",
  run: async (ctx) => {
    await newProject(ctx.page);
    await ctx.enter();
    await exportPanel(
      ctx,
      /Word/,
      [/Word/, /Font/, /pop up button|combo ?box/i],
      async (dialog) => {
        await expect(dialog.getByRole("combobox", { name: "Font" })).toHaveValue("times");
      },
    );
  },
};

const exportRtf: Area = {
  name: "export dialog: Rich Text panel and its font choice",
  run: async (ctx) => {
    await newProject(ctx.page);
    await ctx.enter();
    await exportPanel(
      ctx,
      /Rich Text/,
      [/Rich Text/, /Font/, /pop up button|combo ?box/i],
      async (dialog) => {
        await dialog.getByRole("combobox", { name: "Font" }).selectOption("courier");
        await expect(dialog.getByRole("combobox", { name: "Font" })).toHaveValue("courier");
      },
    );
  },
};

const exportAudiobookNoVoices: Area = {
  name: "export dialog: Audiobook without voices offers the packs",
  run: async (ctx) => {
    await newProject(ctx.page);
    await ctx.page.evaluate(noVoices);
    await ctx.enter();
    await exportPanel(
      ctx,
      "Audiobook",
      [/Piper voices/, /Kokoro/, /Download selected/, /check ?box/i],
      async (dialog) => {
        await expect(dialog.getByText("Voices are not installed")).toBeVisible();
        await expect(dialog.getByRole("group", { name: "Voices to download" })).toBeVisible();
        await expect(dialog.getByRole("checkbox", { name: /Piper voices/ })).toBeVisible();
        await expect(dialog.getByRole("checkbox", { name: /Kokoro/ })).toBeVisible();
      },
    );
  },
};

const exportAltText: Area = {
  name: "export dialog: image alt-text checks are a named list",
  run: async (ctx) => {
    const { page, walk } = ctx;
    await newProject(page);
    await seedChapters(page, [
      {
        type: "doc",
        content: [
          chapterDoc("Pics", 1).content[0]!,
          { type: "image", attrs: { src: "assets/pic.png", alt: "" } } as never,
        ],
      } as never,
    ]);
    await ctx.enter();

    await page.getByRole("button", { name: "Export", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Export book" });
    await dialog.getByRole("radio", { name: /Word/ }).click();
    const list = dialog.getByRole("list", { name: "Image checks" });
    await expect(list).toContainText("“Pics” has 1 image without alt text");
    await expect(list.getByRole("listitem")).toHaveCount(1);
    await toHeading(ctx, /Export book/);

    const said = await walk("next", 24, /without alt text/);
    const text = said.join("\n");
    expect(text, "VoiceOver never read the alt text warning").toMatch(/without alt text/);
    expect(text).toMatch(/Pics/);
    expect(bareRole(said), "controls read without a name").toEqual([]);
    // The list has no jump-to control in the app: the warning is text only (see report).
    await expect(list.getByRole("button")).toHaveCount(0);

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  },
};

export const settingsExport: Area[] = [
  settingsShortcutsPage,
  settingsFonts,
  settingsAudio,
  settingsBackupsEditor,
  exportEpub,
  exportMarkdown,
  exportWord,
  exportRtf,
  exportAudiobookNoVoices,
  exportAltText,
];
