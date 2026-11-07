import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assert, type Context } from "./context.ts";
import { diskHelpers, featureBookRoot, typeAtEnd, until } from "./feature-book.ts";

/** Smart typography (Settings, typing, Format > Convert Quotes and Dashes) and the Saved notice. */
export async function typographySteps(ctx: Context) {
  await smartTypingStep(ctx);
  await convertStep(ctx);
  await savedNoticeStep(ctx);
}

/** The open chapter's text as the editor shows it, and as its file holds it. */
function chapterViews(ctx: Context) {
  const root = featureBookRoot(ctx);
  const disk = diskHelpers(root);
  const file = () => disk.chapterNamed("Chapter One").files.en!;
  const onDisk = () => readFileSync(join(root, file()), "utf8");
  const shown = () =>
    ctx.app.js<string>(`document.querySelector(".ProseMirror")?.textContent ?? ""`);
  return { file, onDisk, shown };
}

/** Selects the whole text of the open chapter, as the author would with Select All. */
const selectAll = (ctx: Context) =>
  ctx.app.js(
    `(() => { const ed = document.querySelector(".ProseMirror"); ed.focus(); const s = getSelection(); s.selectAllChildren(ed); return "selected"; })()`,
  );

async function setSmartTypography(ctx: Context, on: boolean) {
  const { app, runMenu } = ctx;
  await runMenu("app.settings");
  const state = await app.js<string>(
    `(() => { const s = [...document.querySelectorAll('[role="switch"]')].find((e) => (e.getAttribute("aria-label") ?? e.textContent).trim() === "Smart quotes and dashes"); if (!s) throw new Error("no Smart quotes and dashes switch"); if ((s.getAttribute("aria-checked") === "true") !== ${on}) s.click(); return "ok"; })()`,
  );
  assert(state === "ok", "the switch was not found");
  await app.sleep(400);
  const now = await app.js<string>(
    `[...document.querySelectorAll('[role="switch"]')].find((e) => (e.getAttribute("aria-label") ?? e.textContent).trim() === "Smart quotes and dashes").getAttribute("aria-checked")`,
  );
  assert(now === String(on), `the switch is ${now}, expected ${on}`);
  await app.click("Back");
  await app.sleep(1000);
}

async function smartTypingStep(ctx: Context) {
  const { app, step } = ctx;
  const { shown } = chapterViews(ctx);
  await step(
    "smart typography: with Settings > Editor switched on, characters typed through the bridge (execCommand insertText) - records whether the typing rules fire natively",
    async () => {
      await app.click("Chapter One").catch(() => {});
      await app.sleep(800);
      await setSmartTypography(ctx, true);
      // One piece at a time, the way keys arrive: the rules look at the text just typed, so a whole string at once is only
      // checked at its end (which is why a trailing "..." alone would convert).
      for (const part of [
        " He said ",
        '"',
        "hello",
        '"',
        " ",
        "-",
        "-",
        " and left",
        ".",
        ".",
        ".",
      ])
        await typeAtEnd(ctx, part);
      await app.sleep(500);
      const text = await shown();
      const fired = text.includes("“hello”") && text.includes("–");
      // ProseMirror applies input rules on `handleTextInput`, which a real key press (keypress/beforeinput) reaches. The bridge can only
      // insert text through the editing API or dispatch synthetic events, so a straight result here is the bridge's limit, not an app bug.
      return fired
        ? "the typing rules fired on bridge-inserted text: curly quotes and an en dash"
        : `the typing rules did NOT fire for execCommand text (a real key event cannot be produced through the bridge); text stayed: ${text.slice(-40)}`;
    },
  );
}

async function convertStep(ctx: Context) {
  const { app, step, runMenu, shot } = ctx;
  const { onDisk, shown } = chapterViews(ctx);
  await step(
    "Format > Convert Quotes and Dashes (editor.convertQuotes): a selection gets curly quotes and an en dash in the editor and in the chapter file, and one Undo reverts it",
    async () => {
      await setSmartTypography(ctx, false);
      await app.click("Chapter One").catch(() => {});
      await app.sleep(800);
      await typeAtEnd(ctx, ' Then she said "go" -- it\'s 1939...');
      await until(ctx, () => onDisk().includes("1939"), "the typed text was not saved");
      const before = await shown();
      assert(
        before.includes(`"go"`),
        `straight quotes expected before converting: ${before.slice(-60)}`,
      );
      await selectAll(ctx);
      await runMenu("editor.convertQuotes");
      await app.sleep(600);
      const after = await shown();
      assert(
        after.includes("“go”") && after.includes("it’s") && after.includes("…"),
        `the editor does not show typographic quotes: ${after.slice(-60)}`,
      );
      assert(
        !after.includes(`"go"`) && !after.includes("--"),
        `straight quotes or -- are left: ${after.slice(-60)}`,
      );
      assert(after.includes("–") || after.includes("—"), "the -- did not become a dash");
      await until(
        ctx,
        () => onDisk().includes("“go”"),
        "the chapter file kept the straight quotes",
      );
      const json = onDisk();
      assert(
        json.includes("it’s 1939") && (json.includes("–") || json.includes("—")),
        "the chapter file lacks the dash or apostrophe",
      );
      await shot("27-convert-quotes");
      // One undo step: the editor's own Undo (Ctrl/Cmd+Z in the page) puts the whole selection back at once.
      await app.js(
        `(() => { const ed = document.querySelector(".ProseMirror"); ed.focus(); document.execCommand("undo"); return "undone"; })()`,
      );
      await app.sleep(600);
      const undone = await shown();
      assert(
        undone.includes(`"go"`) && undone.includes("it's 1939") && !undone.includes("“go"),
        `one Undo did not bring the straight quotes back: ${undone.slice(-70)}`,
      );
      return "straight quotes, -- and ... became curly quotes, an en dash and an ellipsis in the editor and the file; one Undo reverted all of it";
    },
  );
}

async function savedNoticeStep(ctx: Context) {
  const { app, step } = ctx;
  const { onDisk, file } = chapterViews(ctx);
  const root = featureBookRoot(ctx);
  /** The header's polite live region (the notice), not the "Saved" badge next to the title. */
  const notice = () =>
    app.js<string>(
      `[...document.querySelectorAll('[role="status"]')].map((s) => s.textContent.trim()).filter((t) => t).join(" | ")`,
    );
  await step(
    "Saved notice: appears after typing and is gone about two seconds later; a conflict notice (the file changed outside while text was unsaved) stays until dismissed",
    async () => {
      await app.click("Chapter One").catch(() => {});
      await app.sleep(800);
      // An earlier step's save may still be showing its own notice: wait for a quiet header first.
      await until(
        ctx,
        async () => !(await notice()).split(" | ").includes("Saved"),
        "an earlier 'Saved' notice never faded",
      );
      await typeAtEnd(ctx, " Typed for the saved notice.");
      let shownAt = 0;
      for (let i = 0; i < 40 && !shownAt; i++) {
        if ((await notice()).split(" | ").includes("Saved")) shownAt = Date.now();
        else await app.sleep(150);
      }
      assert(shownAt > 0, `no 'Saved' notice after typing: "${await notice()}"`);
      assert(onDisk().includes("Typed for the saved notice."), "the text is not on disk");
      let goneAt = 0;
      for (let i = 0; i < 60 && !goneAt; i++) {
        if (!(await notice()).split(" | ").includes("Saved")) goneAt = Date.now();
        else await app.sleep(100);
      }
      assert(goneAt > 0, "the 'Saved' notice never faded");
      const visibleMs = goneAt - shownAt;
      assert(
        visibleMs >= 1000 && visibleMs <= 4000,
        `'Saved' stayed ${visibleMs} ms, expected about 2000`,
      );

      // A conflict: text typed in the app, and the file rewritten from outside before the autosave runs.
      const path = join(root, file());
      await typeAtEnd(ctx, " Typed before the outside edit.");
      const doc = JSON.parse(readFileSync(path, "utf8"));
      doc.content.push({
        type: "paragraph",
        content: [{ type: "text", text: "Added from outside." }],
      });
      writeFileSync(path, JSON.stringify(doc));
      let conflict = "";
      // First the watcher's heads-up ("saving will keep both versions"), then the save's own notice naming the copy.
      for (let i = 0; i < 40 && !conflict.includes("kept as"); i++) {
        await app.sleep(250);
        conflict = await notice();
      }
      assert(
        conflict.includes("changed outside the app") && conflict.includes("kept as"),
        `no conflict notice: "${conflict}"`,
      );
      const copy = /kept as (\S+\.json)/.exec(conflict)?.[1];
      assert(copy, `the notice does not name the copy: ${conflict}`);
      assert(
        readFileSync(join(root, copy), "utf8").includes("Added from outside.") &&
          !readFileSync(join(root, copy), "utf8").includes("Typed before the outside edit."),
        "the conflict copy does not hold the outside version",
      );
      assert(
        onDisk().includes("Typed before the outside edit."),
        "the chapter file does not hold the text typed in the app",
      );
      await app.sleep(4000);
      assert(
        (await notice()).includes("kept as"),
        `the conflict notice faded away: "${await notice()}"`,
      );
      await app.click("Dismiss message");
      await app.sleep(400);
      assert(!(await notice()).includes("changed outside"), "Dismiss did not clear the notice");
      return `'Saved' was shown for ${visibleMs} ms; the conflict notice "${conflict.slice(0, 90)}" stayed past 4 s`;
    },
  );
}

// Not covered natively: dropping a picture on the editor. The drop is an operating-system drag that Tauri turns into a
// window event; Rust's `record_drop` (src-tauri/src/lib.rs, `remember_drop`) is only called from that event and is not a
// command, so neither the drag nor the Rust half can be driven from the bridge. Emitting the webview event from JS and
// queueing the path with a dialog answer would only imitate it, so there is no step. The pieces that are covered: a path
// nobody picked is refused by `import_asset` (editing.ts), and the picture dialog and `import_asset` run for real (editing.ts).
// Playwright covers the editor's drop handling against a fake backend (apps/desktop/e2e/editor-file-drop.spec.ts).
