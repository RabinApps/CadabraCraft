import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assert, type Context } from "./context.ts";

export async function findAndHistorySteps({
  app,
  repo,
  book,
  shot,
  openMenu,
  pickItem,
  dlg,
  runMenu,
  step,
  args,
}: Context) {
  await step(
    "audiobook: the menu opens the dialog, Chapters select limits the chapters, a real render fills the cache, M4B packs chapters and the cover; Settings > Audio lists the voices",
    async () => {
      await runMenu("file.exportAudiobook");
      const text = () => dlg<string>(`return d.textContent;`);
      for (let i = 0; i < 20 && !/Voices are not installed|Chapters/.test(await text()); i++)
        await app.sleep(500);
      let first = await text();
      // Only with --download-voices: the 148 MB Piper pack is fetched through the real panel (the only network use of this step).
      if (first.includes("Voices are not installed") && args.includes("--download-voices")) {
        await dlg(`d.querySelector('button[type="submit"]').click(); return "download";`);
        for (let i = 0; i < 600 && (await text()).includes("Voices are not installed"); i++)
          await app.sleep(1000);
        first = await text();
        assert(
          !first.includes("Voices are not installed"),
          `the voice download did not finish: ${first.slice(0, 300)}`,
        );
      }
      const installed = !first.includes("Voices are not installed");
      let detail =
        "voices not installed on this computer: the download panel shows and nothing is downloaded";
      if (installed) {
        assert(first.includes("All chapters"), `no Chapters select: ${first.slice(0, 200)}`);
        await dlg(
          `const s = [...d.querySelectorAll("select")].find((e) => [...e.options].some((o) => o.value === "some")); if (!s) throw new Error("no chapters select"); s.value = "some"; s.dispatchEvent(new Event("change", { bubbles: true })); return "some";`,
        );
        await app.sleep(300);
        assert(
          (await dlg<number>(
            `return d.querySelectorAll('fieldset input[type=checkbox]').length;`,
          )) >= 1,
          "no chapter checkboxes after choosing Selected chapters",
        );
        await shot("07-audiobook-dialog");
        // Hear a sample: the real engine renders a few sentences, the page plays them; nothing is written to the project.
        await dlg(
          `const b = [...d.querySelectorAll("button")].find((e) => e.textContent.trim() === "Hear a sample"); if (!b) throw new Error("no Hear a sample button"); b.click(); return "clicked";`,
        );
        for (let i = 0; i < 120 && /Making sample/.test(await text()); i++) await app.sleep(500);
        const afterSample = await text();
        assert(!/Making sample/.test(afterSample), "the sample never finished");
        assert(
          (await dlg(`return d.querySelectorAll('[role=alert]').length;`)) === 0,
          `the sample failed: ${afterSample.slice(-300)}`,
        );
        assert(
          !existsSync(join(book, "exports/en/audio")),
          "the sample wrote into exports/en/audio",
        );
        const audioDir = join(book, "exports/en/audio");
        const cache = join(book, ".cadabra/audio/cache.json");
        await dlg(`d.querySelector('button[type="submit"]').click(); return "submitted";`);
        for (
          let i = 0;
          i < 240 && !(existsSync(cache) && /Your audiobook is ready/.test(await text()));
          i++
        )
          await app.sleep(500);
        assert(
          existsSync(audioDir) && readdirSync(audioDir).length > 0,
          "no audio file was written to exports/en/audio",
        );
        assert(
          Object.keys(JSON.parse(readFileSync(cache, "utf8"))).length >= 1,
          "the chapter cache is empty",
        );
        const files = readdirSync(audioDir).map(
          (f) => [f, statSync(join(audioDir, f)).mtimeMs] as const,
        );
        await app.click("Done");
        await app.sleep(600);
        await runMenu("file.exportAudiobook");
        for (let i = 0; i < 20 && !/Chapters/.test(await text()); i++) await app.sleep(500);
        await dlg(`d.querySelector('button[type="submit"]').click(); return "submitted";`);
        for (let i = 0; i < 120 && !/Your audiobook is ready/.test(await text()); i++)
          await app.sleep(500);
        for (const [f, m] of files)
          assert(
            statSync(join(audioDir, f)).mtimeMs === m,
            `${f} was rendered again although nothing changed`,
          );
        // M4B: one book file with chapters and the cover, built from the chapters' lossless parts by the bundled ffmpeg.
        await app.click("Done");
        await app.sleep(600);
        await runMenu("file.exportAudiobook");
        for (let i = 0; i < 20 && !/Chapters/.test(await text()); i++) await app.sleep(500);
        await dlg(
          `const l = [...d.querySelectorAll("label")].find((e) => e.textContent.trim() === "M4B audiobook"); const c = l && document.getElementById(l.htmlFor); if (!c) throw new Error("no M4B checkbox"); c.click(); return "ticked";`,
        );
        await dlg(`d.querySelector('button[type="submit"]').click(); return "submitted";`);
        const m4b = join(audioDir, "scenario-book.m4b");
        for (
          let i = 0;
          i < 240 && !(existsSync(m4b) && /Your audiobook is ready/.test(await text()));
          i++
        )
          await app.sleep(500);
        assert(
          existsSync(m4b) && statSync(m4b).size > 1000,
          "no M4B was written to exports/en/audio",
        );
        const host = /host: (.*)/.exec(execFileSync("rustc", ["-vV"], { encoding: "utf8" }))?.[1];
        const ffmpeg = join(repo, "apps/desktop/src-tauri/binaries", `ffmpeg-${host}`);
        const info = spawnSync(ffmpeg, ["-hide_banner", "-i", m4b], { encoding: "utf8" }).stderr;
        assert(info.includes("Audio: aac"), `the M4B has no AAC audio:\n${info}`);
        assert(info.includes("Chapter #0:0"), `the M4B has no chapter markers:\n${info}`);
        assert(info.includes("(attached pic)"), `the M4B has no cover picture:\n${info}`);
        assert(info.includes("title           : Scenario Book"), `the M4B has no title:\n${info}`);
        assert(existsSync(join(book, ".cadabra/audio/parts")), "no chapter parts were kept");
        detail = `a sample played without writing files; ${files.length} file(s) rendered once; the second export reused them from the cache; the M4B has AAC, chapters, a cover and a title`;
      } else {
        assert(
          first.includes("only time CadabraCraft uses the network"),
          "the download panel does not say it is the only network use",
        );
        await shot("07-audiobook-voices");
      }
      await app.js(
        `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`,
      );
      await app.sleep(600);
      await runMenu("app.settings");
      const page = await app.js<string>(`document.body.innerText`);
      for (const needle of ["Default voice", "Default formats"])
        assert(page.includes(needle), `Settings > Audio lacks ${needle}`);
      await shot("08-settings-audio");
      await app.click("Back").catch(() => {});
      await app.sleep(800);
      return detail;
    },
  );

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
