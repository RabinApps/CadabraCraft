import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { audiobookStep } from "./audiobook.ts";
import { assert, type Context } from "./context.ts";

/** Reads the open book's first chapter file and its backups folder. */
function chapterHelpers(book: string) {
  const chapterFile = () =>
    JSON.parse(readFileSync(join(book, "cadabra.json"), "utf8")).chapters[0].files.en as string;
  const backups = () => {
    const d = join(book, ".cadabra/backups");
    return existsSync(d) ? readdirSync(d) : [];
  };
  const flat = () => chapterFile().replaceAll("/", "__");
  const backupHolding = (needle: string) =>
    backups().some(
      (f) =>
        f.endsWith(`-${flat()}`) &&
        readFileSync(join(book, ".cadabra/backups", f), "utf8").includes(needle),
    );
  return { chapterFile, flat, backupHolding };
}

export async function findAndHistorySteps(ctx: Context) {
  await ctx.step(
    "audiobook: the menu opens the dialog, Chapters select limits the chapters, a real render fills the cache, M4B packs chapters and the cover; Settings > Audio lists the voices",
    () => audiobookStep(ctx),
  );
  await historyStep(ctx);
  await recoveryStep(ctx);
}

async function historyStep(ctx: Context) {
  const { app, book, shot, openMenu, pickItem, dlg, step } = ctx;
  const { chapterFile, flat, backupHolding } = chapterHelpers(book);
  await step(
    "History: lists earlier versions, compares word by word, restores and keeps the replaced text",
    async () => {
      // An older version, as an earlier save would have left it (the stamp is the oldest in the folder).
      mkdirSync(join(book, ".cadabra/backups"), { recursive: true });
      const now = readFileSync(join(book, chapterFile()), "utf8");
      assert(
        now.includes("Typed by an bot-ro."),
        "the chapter does not hold the text this step expects",
      );
      writeFileSync(
        join(book, ".cadabra/backups", `20260101-1000-${flat()}`),
        now.replace("Typed by an bot-ro.", "Typed by an old."),
      );
      await openMenu("Actions for Chapter One");
      await app.sleep(300);
      await pickItem("History");
      await app.sleep(1500);
      const d = (await app.snapshot()).dialogs.find((x) => x.startsWith("History · Chapter One"));
      assert(d, `no History dialog: ${JSON.stringify((await app.snapshot()).dialogs)}`);
      assert(
        (await app.snapshot()).buttons.includes("Restore this version"),
        "the dialog has no Restore button",
      );
      // The list is newest first, so the seeded 2026-01-01 version is the last one.
      const count = Number(
        await dlg(
          `const items = d.querySelectorAll('ul[aria-label="Earlier versions"] button'); items[items.length - 1].click(); return String(items.length);`,
        ),
      );
      assert(count >= 1, "no versions listed");
      await app.sleep(600);
      const marks = JSON.parse(
        await dlg(
          `const c = d.querySelector('[aria-label="Comparison"]'); return JSON.stringify({ added: [...c.querySelectorAll("ins")].map((e) => e.textContent), removed: [...c.querySelectorAll("del")].map((e) => e.textContent) });`,
        ),
      );
      assert(
        marks.added.join(" ").includes("old.") && marks.removed.join(" ").includes("bot-ro."),
        `diff wrong: ${JSON.stringify(marks)}`,
      );
      await shot("07-history");
      await app.click("Restore this version");
      await app.sleep(1800);
      assert(
        !(await app.snapshot()).dialogs.some((x) => x.startsWith("History")),
        "the dialog did not close after Restore",
      );
      assert(
        (await app.snapshot()).editor?.includes("Typed by an old.") === true,
        "the editor does not show the restored text",
      );
      assert(
        readFileSync(join(book, chapterFile()), "utf8").includes("Typed by an old."),
        "the chapter file does not hold the restored text",
      );
      assert(
        backupHolding("Typed by an bot-ro."),
        "the text a restore replaced was not kept as a snapshot",
      );
      return `${count} version(s) listed; diff showed old. added and bot-ro. removed; restored, and the replaced text is in .cadabra/backups`;
    },
  );
}

async function recoveryStep(ctx: Context) {
  const { app, book, shot, step } = ctx;
  const { chapterFile, flat, backupHolding } = chapterHelpers(book);
  await step(
    "recovery offer: a newer snapshot than the saved chapter is offered on open; Keep leaves it, Use restores it",
    async () => {
      // A snapshot stamped far in the future stands for "newer than the saved file", and its text differs from the chapter.
      const now = readFileSync(join(book, chapterFile()), "utf8");
      writeFileSync(
        join(book, ".cadabra/backups", `20991231-2359-${flat()}`),
        now.replace("Typed by an old.", "Newer text from a snapshot."),
      );
      const reopen = async () => {
        await app.js("location.reload()").catch(() => {});
        await app.sleep(3000);
        await app.queueDialogs([book]);
        await app.click("Open folder");
        await app.sleep(2500);
      };
      await reopen();
      const title = "Recover newer text for “Chapter One”?";
      assert(
        (await app.snapshot()).dialogs.some((x) => x.includes(title)),
        `no recovery offer: ${JSON.stringify((await app.snapshot()).dialogs)}`,
      );
      await shot("08-recover");
      await app.click("Keep saved text");
      await app.sleep(800);
      assert(
        !(await app.snapshot()).dialogs.some((x) => x.includes(title)),
        "Keep saved text did not close the offer",
      );
      assert(
        (await app.snapshot()).editor?.includes("Typed by an old.") === true &&
          readFileSync(join(book, chapterFile()), "utf8").includes("Typed by an old."),
        "Keep saved text changed the chapter",
      );
      await reopen();
      assert(
        (await app.snapshot()).dialogs.some((x) => x.includes(title)),
        "the offer should come back the next time the book opens",
      );
      await app.click("Use newer text");
      await app.sleep(1800);
      assert(
        (await app.snapshot()).editor?.includes("Newer text from a snapshot.") === true,
        "the editor does not show the newer text",
      );
      assert(
        readFileSync(join(book, chapterFile()), "utf8").includes("Newer text from a snapshot."),
        "the chapter file does not hold the newer text",
      );
      assert(
        backupHolding("Typed by an old."),
        "the saved text a recovery replaced was not kept as a snapshot",
      );
      return "offered on open; Keep saved text left the chapter alone; Use newer text restored it and kept the saved text";
    },
  );
}
