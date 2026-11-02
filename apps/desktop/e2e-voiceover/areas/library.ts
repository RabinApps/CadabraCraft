import { expect, type Locator } from "@playwright/test";
import { fakeImportSources } from "../../e2e/support/fakeImport";
import {
  chapterAction,
  focusEnd,
  newProject,
  seedSnapshot,
  sidebar,
} from "../../e2e/support/helpers";
import { bareRole, type Area, type Ctx } from "../support";

/**
 * The library side of the app: snapshots, trash, recovery, references, editions, the import preview, focus mode and the
 * status bar. Same rules as the other areas: `enter` once before any modal is open, open things with page clicks, listen
 * with VoiceOver, never activate with VoiceOver except where noted.
 */

const SETTLE_MS = 3000;

/** Waits for a freshly opened dialog, then steps back to its heading (VoiceOver starts wherever the last item was). */
async function hearHeading({ page, walk }: Ctx, heading: RegExp) {
  await page.waitForTimeout(SETTLE_MS);
  const before = await walk("previous", 10, heading);
  expect(before.join("\n"), `VoiceOver did not reach ${heading}`).toMatch(heading);
}

/** Steps forward and checks every expected name was said and no control came without a name. */
async function readNames({ walk }: Ctx, steps: number, expected: RegExp[]) {
  const said = await walk("next", steps);
  const text = said.join("\n");
  for (const name of expected) expect(text, `VoiceOver never said ${name}`).toMatch(name);
  expect(bareRole(said), "controls read without a name").toEqual([]);
  return said;
}

/** A page-side focus change that VoiceOver follows (the proven way to reach a control far down the page). */
async function focusAndSettle({ page }: Ctx, target: Locator) {
  await target.focus();
  await page.waitForTimeout(SETTLE_MS);
}

const snapshotDialog = async (ctx: Ctx) => {
  const { page } = ctx;
  await sidebar(page).getByRole("button", { name: "Book snapshots" }).click();
  const dialog = page.getByRole("dialog", { name: "History · Whole book" });
  await expect(dialog).toBeVisible();
  return dialog;
};

export const bookSnapshots: Area = {
  name: "Book snapshots dialog and its two confirmations",
  run: async (ctx) => {
    const { page, enter, find } = ctx;
    await newProject(page);
    await enter();

    const dialog = await snapshotDialog(ctx);
    await hearHeading(ctx, /History/);
    // Empty list: the name field is labelled, "Take snapshot" is dimmed until a name is typed.
    const empty = await readNames(ctx, 8, [/Snapshot name/, /Take snapshot/]);
    expect(empty.join("\n")).toMatch(/dimmed|unavailable|disabled/i);

    // Take one snapshot and hear its row and its two action buttons by name.
    await dialog.getByLabel("Snapshot name").fill("Before the rewrite");
    await dialog.getByRole("button", { name: "Take snapshot" }).click();
    const list = dialog.getByRole("list", { name: "Book snapshots" });
    await expect(list.getByRole("listitem")).toHaveCount(1);
    // The dialog has more below the name field: keep walking from where VoiceOver stopped until the Restore button.
    await page.waitForTimeout(SETTLE_MS);
    const row = await find(/Restore whole book/, 30);
    expect(row.join("\n")).toMatch(/Before the rewrite/);
    expect(row.join("\n")).toMatch(/Delete snapshot/);
    expect(bareRole(row), "controls read without a name").toEqual([]);

    // Restore confirmation: heading, the snapshot's name in the text, Cancel and the destructive button.
    await dialog.getByRole("button", { name: "Restore whole book" }).click();
    const restore = page.getByRole("dialog", { name: "Restore the whole book?" });
    await expect(restore).toBeVisible();
    await hearHeading(ctx, /Restore the whole book/);
    await readNames(ctx, 5, [/Before the rewrite/, /Cancel/, /Restore whole book/]);
    await restore.getByRole("button", { name: "Cancel" }).click();
    await expect(restore).toBeHidden();

    // Delete confirmation.
    await dialog.getByRole("button", { name: "Delete snapshot" }).click();
    const del = page.getByRole("dialog", { name: "Delete this snapshot?" });
    await expect(del).toBeVisible();
    await hearHeading(ctx, /Delete this snapshot/);
    await readNames(ctx, 5, [/Cancel/, /Delete snapshot/]);
    await del.getByRole("button", { name: "Cancel" }).click();
    await expect(del).toBeHidden();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  },
};

export const trash: Area = {
  name: "Move to trash confirmation and the Trash dialog",
  run: async (ctx) => {
    const { page, enter } = ctx;
    await newProject(page);
    await page.getByRole("button", { name: "Add chapter" }).click();
    await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter 2");
    await enter();

    await chapterAction(page, "Chapter 2", "Move to trash");
    const confirm = page.getByRole("dialog", { name: /Move .*Chapter 2.* to trash\?/ });
    await expect(confirm).toBeVisible();
    await hearHeading(ctx, /Move .*Chapter 2.* to trash/);
    await readNames(ctx, 5, [/Cancel/, /Move to trash/]);
    await confirm.getByRole("button", { name: "Move to trash" }).click();
    await expect(page.getByRole("button", { name: "Chapter 2", exact: true })).toHaveCount(0);

    await sidebar(page).getByRole("button", { name: "Trash", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Trash" });
    // The fake backend keeps the trash of earlier areas, so more than one page may be called "Chapter 2".
    await expect(dialog.getByRole("button", { name: "Restore Chapter 2" }).first()).toBeVisible();
    await hearHeading(ctx, /Trash/);
    // The trashed page is listed, and its button names the page it restores.
    await readNames(ctx, 6, [/Chapter 2/, /Restore Chapter 2/]);

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  },
};

export const recover: Area = {
  name: "Recover newer text dialog",
  run: async (ctx) => {
    const { page, enter } = ctx;
    await newProject(page);
    const { file, path } = await seedSnapshot(page, "the newer text");
    await page.evaluate((x) => sessionStorage.setItem("stale", JSON.stringify([x])), {
      path: file,
      snapshot: path,
    });
    await page.waitForFunction(() =>
      Boolean((window as never as { __cadabraMenu?: unknown }).__cadabraMenu),
    );
    await page.evaluate(() =>
      (window as never as { __cadabraMenu: { run: (id: string) => void } }).__cadabraMenu.run(
        "file.close",
      ),
    );
    const open = page.getByRole("button", { name: "Open folder" });
    await expect(open).toBeVisible();
    // Enter on the start screen, where no modal is open yet; the dialog appears when the book opens.
    await enter();

    await open.click();
    const dialog = page.getByRole("dialog", { name: /Recover newer text for/ });
    await expect(dialog).toBeVisible();
    await hearHeading(ctx, /Recover newer text/);
    await readNames(ctx, 6, [/History|newer version/i, /Keep saved text/, /Use newer text/]);

    // Escape keeps the saved text.
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  },
};

const PICKED = {
  "/refs/notes.md": Array.from("# Log\nStorm.", (c) => c.charCodeAt(0)),
  "/refs/dusk.mp4": [1, 2],
};

export const references: Area = {
  name: "References panel, sort menu and removed references",
  run: async (ctx) => {
    const { page, enter, walk } = ctx;
    await newProject(page);
    await page.evaluate(
      ([paths, contents]) => {
        const w = window as never as {
          __pickedRefs: string[];
          __refFiles: Record<string, number[]>;
        };
        w.__pickedRefs = paths as string[];
        w.__refFiles = contents as Record<string, number[]>;
      },
      [Object.keys(PICKED), PICKED] as const,
    );
    await page.getByRole("button", { name: "References", exact: true }).first().click();
    const panel = page.getByRole("region", { name: "References" });
    await page.getByRole("button", { name: "Add files" }).click();
    await expect(panel.getByRole("list").getByRole("listitem")).toHaveCount(2);
    // Remove one so the "Removed references (1)" button exists.
    await panel.getByRole("button", { name: "Actions for dusk" }).click();
    await page.getByRole("menuitem", { name: "Remove from book" }).click();
    await expect(panel.getByRole("list").getByRole("listitem")).toHaveCount(1);
    await enter();

    // From the panel's first button down: search, sort, filters and the row. The removed-list button sits far below
    // (VoiceOver also reads the reorder and per-row controls), so the page is the authority for that one.
    await focusAndSettle(ctx, panel.getByRole("button", { name: "Add files" }));
    const down = await walk("next", 20);
    const text = down.join("\n");
    for (const name of [/Search references/, /Sort references/, /Images/, /Video/, /notes/])
      expect(text, `VoiceOver never said ${name}`).toMatch(name);
    expect(bareRole(down), "controls read without a name").toEqual([]);
    await expect(panel.getByRole("button", { name: "Removed references (1)" })).toBeVisible();

    // The sort menu: radios named with their state.
    await panel.getByRole("button", { name: "Sort references" }).click();
    await expect(page.getByRole("menuitemradio", { name: "Manual order" })).toBeVisible();
    await page.waitForTimeout(SETTLE_MS);
    await walk("previous", 8, /Manual order/);
    const sorts = await walk("next", 5);
    expect(sorts.join("\n")).toMatch(/Title A-Z/);
    expect(sorts.join("\n")).toMatch(/Newest first/);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menuitemradio", { name: "Manual order" })).toHaveCount(0);

    // The removed list.
    await panel.getByRole("button", { name: "Removed references (1)" }).click();
    const dialog = page.getByRole("dialog", { name: "Removed references" });
    await expect(dialog).toBeVisible();
    await hearHeading(ctx, /Removed references/);
    await readNames(ctx, 6, [/dusk/, /Restore dusk/]);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  },
};

export const editions: Area = {
  name: "Edition switcher menu and Add language dialog",
  run: async (ctx) => {
    const { page, enter, walk } = ctx;
    await newProject(page);
    await enter();

    const opener = page.getByRole("button", { name: /Edition: English/ });
    // Entering the page leaves VoiceOver (and focus) on the skip link, which unfolds over this button at the top left.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await opener.click();
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitem", { name: "Add language" })).toBeVisible();
    await page.waitForTimeout(SETTLE_MS);
    const top = await walk("previous", 6, /English/);
    expect(top.join("\n")).toMatch(/English/);
    const items = await walk("next", 4, /Add language/);
    expect(items.join("\n")).toMatch(/Add language/);
    expect(items.join("\n")).toMatch(/menu item|menu/i);

    await menu.getByRole("menuitem", { name: "Add language" }).click();
    const dialog = page.getByRole("dialog", { name: "Add language" });
    await expect(dialog).toBeVisible();
    await hearHeading(ctx, /Add language/);
    const said = await walk("next", 30, /Cancel/);
    for (const name of [/Language/, /Start from a copy/, /Start empty/, /Cancel/])
      expect(said.join("\n"), `VoiceOver never said ${name}`).toMatch(name);
    expect(bareRole(said), "controls read without a name").toEqual([]);
    expect(said.join("\n")).toMatch(/pop up button|combo ?box/i);
    expect(said.join("\n")).toMatch(/radio/i);

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  },
};

export const importChapterList: Area = {
  name: "Import preview chapter list and keyboard reorder",
  run: async (ctx) => {
    const { page, enter, walk, find } = ctx;
    // fakeTauri is already installed by the suite. The import fake stays in the page's init scripts for the rest of the
    // run, so it must not change the folder picker: that is done below on the live page only, which the next `goto` drops.
    await fakeImportSources(page, "md3", false);
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Import…" })).toBeVisible();
    await page.evaluate(() => {
      const w = window as never as {
        __TAURI_INTERNALS__: { invoke: (...a: unknown[]) => Promise<unknown> };
      };
      const base = w.__TAURI_INTERNALS__.invoke;
      w.__TAURI_INTERNALS__.invoke = (cmd, ...rest) =>
        cmd === "pick_folder" ? Promise.resolve("/newbook") : base(cmd, ...rest);
    });
    await enter();

    await page.getByRole("button", { name: "Import…" }).click();
    const dialog = page.getByRole("dialog", { name: "Import a manuscript" });
    await expect(dialog).toBeVisible();
    await hearHeading(ctx, /Import a manuscript/);
    await readNames(ctx, 4, [/Choose file/]);
    await dialog.getByRole("button", { name: "Choose file…" }).click();
    await expect(dialog.getByLabel("File")).not.toHaveValue("");
    await dialog.getByRole("button", { name: "Choose…" }).click();
    await expect(dialog.getByLabel("New book folder")).toHaveValue("/newbook");
    await dialog.getByRole("button", { name: "Next" }).click();
    await expect(dialog.getByLabel("Title of chapter 1")).toBeVisible();

    const grip = dialog.getByRole("button", { name: "Reorder chapter 1" });
    // The keyboard instruction is the grip's title and its aria-keyshortcuts: VoiceOver reads titles as help text, which
    // the web build does not always expose, so the page is the authority here.
    await expect(grip).toHaveAttribute("title", /arrow keys/);
    await expect(grip).toHaveAttribute("aria-keyshortcuts", "ArrowUp ArrowDown");

    // The first chapter cannot move up (VoiceOver skips that dimmed button), so chapter 1 offers Move down and chapter 2
    // offers Move up. The page says the rest.
    await expect(dialog.getByRole("button", { name: "Move chapter 1 up" })).toBeDisabled();
    await focusAndSettle(ctx, dialog.getByLabel("Title of chapter 1"));
    const row = await find(/Move chapter 1 down/, 8);
    const two = await find(/Move chapter 2 up/, 10);
    expect(bareRole([...row, ...two])).toEqual([]);

    // Move the first chapter down with the arrow key on its grip, and hear the grip of chapter 2 take focus.
    await grip.focus();
    await page.keyboard.press("ArrowDown");
    await expect(dialog.getByRole("button", { name: "Reorder chapter 2" })).toBeFocused();
    const titles = await dialog
      .getByRole("list", { name: "Chapters" })
      .locator("input:not([type=checkbox])")
      .evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
    expect(titles).toEqual(["Two", "One", "Three"]);
    await page.waitForTimeout(SETTLE_MS);
    const after = await walk("previous", 1);
    after.push(...(await walk("next", 1)));
    expect(after.join("\n")).toMatch(/Reorder chapter 2/);

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  },
};

export const focusMode: Area = {
  name: "Focus mode hides the chrome and keeps the text reachable",
  run: async (ctx) => {
    const { page, enter, walk, find } = ctx;
    await newProject(page);
    await enter();

    await page.getByRole("button", { name: "Focus mode", exact: true }).click();
    const exit = page.getByRole("button", { name: "Exit focus mode" });
    await expect(exit).toBeVisible();
    // The chrome is gone from the page, not just hidden by colour.
    await expect(sidebar(page)).toBeHidden();
    await expect(page.getByRole("banner")).toHaveCount(0);
    // The footer sits inside main, so it is not a contentinfo landmark: find it by its element.
    await expect(page.locator("footer")).toBeHidden();
    await expect(page.locator(".ProseMirror")).toBeVisible();

    // VoiceOver follows focus to the exit button, then reaches the page text box (a text box needs interact to read in).
    await focusAndSettle(ctx, exit);
    const heard = [await ctx.cap("lastSpokenPhrase", ctx.vo.lastSpokenPhrase())];
    heard.push(...(await find(/Page text|text/i, 12)));
    // The exit button is the first element of the page, before main: VoiceOver's cursor did not follow focus to it, so
    // step back from the text until it is heard.
    heard.push(...(await walk("previous", 12, /Exit focus mode/)));
    const text = heard.join("\n");
    expect(text).toMatch(/Exit focus mode/);
    expect(text).toMatch(/Page text|text/i);
    expect(text, "the sidebar chapter list is still read").not.toMatch(/Add chapter|Trash/);
    expect(bareRole(heard)).toEqual([]);
    // Nothing after the text: the footer and the sidebar are not there to be read.
    const rest = await walk("next", 3);
    expect(rest.join("\n")).not.toMatch(/words in this chapter|Book snapshots/);

    // Leave focus mode with the button: the chrome returns.
    await exit.click();
    await expect(sidebar(page)).toBeVisible();
    await expect(page.getByRole("button", { name: "Focus mode", exact: true })).toBeVisible();
  },
};

export const statusBar: Area = {
  name: "Status bar counts, session goal and book undo and redo",
  run: async (ctx) => {
    const { page, walk, find, enter } = ctx;
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await page.evaluate(() =>
      localStorage.setItem(
        "cadabracraft.settings",
        JSON.stringify({ sessionGoal: 500, typewriterScroll: false }),
      ),
    );
    try {
      await newProject(page);
      await focusEnd(page);
      await page.keyboard.type(" a few more words for the count");
      await expect(page.getByTestId("session-goal")).toBeVisible({ timeout: 10_000 });
      const bar = page.getByRole("progressbar", { name: "Session goal" });
      await expect(bar).toHaveAttribute("aria-valuemax", "500");
      await expect(page.getByText(/words in this chapter/)).toBeVisible();
      await expect(page.locator("footer").getByText(/in the book/)).toBeVisible();
      await enter();

      // Book history before any change: Undo and Redo are dimmed, by their names.
      const side = sidebar(page);
      await focusAndSettle(ctx, side.getByRole("button", { name: "Book snapshots" }));
      const dimmed = await find(/Redo book change/, 6);
      const dimText = dimmed.join("\n");
      expect(dimText).toMatch(/Undo book change/);
      expect(dimText).toMatch(/dimmed|unavailable|disabled/i);
      await expect(page.getByRole("button", { name: "Undo book change" })).toBeDisabled();

      // A book change (a new chapter) enables Undo, and its name says what it undoes.
      await page.getByRole("button", { name: "Add chapter" }).click();
      await expect(page.locator(".ProseMirror h1")).toHaveText("Chapter 2");
      const undo = page.getByRole("button", { name: /^Undo: / });
      await expect(undo).toBeEnabled();
      await focusAndSettle(ctx, side.getByRole("button", { name: "Book snapshots" }));
      const live = await find(/Undo: /, 6);
      expect(live.join("\n")).not.toMatch(/dimmed|unavailable|disabled/i);
      await undo.click();
      await expect(page.getByRole("button", { name: /^Redo: / })).toBeEnabled();

      // The footer follows the page text box in reading order: focus the box, then step out of it into the footer.
      await focusAndSettle(ctx, page.locator(".ProseMirror"));
      const goal = page.getByTestId("session-goal");
      await expect(goal).toContainText("words this session");
      const bars = await page.evaluate(() => {
        const el = document.querySelector('[role="progressbar"][aria-label="Session goal"]');
        return el?.getAttribute("aria-valuenow");
      });
      // Undoing the new chapter reloads the book, which can restart the session count: only a number is required.
      expect(bars).toMatch(/^\d+$/);
      const footer = await find(/Session goal|words this session/, 10);
      const more = await walk("next", 4);
      const text = [...footer, ...more].join("\n");
      expect(text).toMatch(/Session goal|words this session/);
      expect(text).toMatch(/words in this chapter|in the book/);
      expect(bareRole([...footer, ...more])).toEqual([]);
    } finally {
      await page.evaluate(() => localStorage.removeItem("cadabracraft.settings")).catch(() => {});
    }
  },
};

export const library: Area[] = [
  bookSnapshots,
  trash,
  recover,
  references,
  editions,
  importChapterList,
  focusMode,
  statusBar,
];
