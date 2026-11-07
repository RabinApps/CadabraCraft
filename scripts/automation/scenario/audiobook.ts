import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { assert, type Context } from "./context.ts";

type Text = () => Promise<string>;

/** Opens the audiobook dialog; with --download-voices, fetches the voice pack through the real panel. Returns the dialog text. */
async function openAudiobookDialog({ app, dlg, runMenu, args }: Context, text: Text) {
  await runMenu("file.exportAudiobook");
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
  return first;
}

/** Chapters select limits the chapters, and a sample plays without writing into the project. */
async function limitChaptersAndHearSample({ app, book, shot, dlg }: Context, text: Text) {
  await dlg(
    `const s = [...d.querySelectorAll("select")].find((e) => [...e.options].some((o) => o.value === "some")); if (!s) throw new Error("no chapters select"); s.value = "some"; s.dispatchEvent(new Event("change", { bubbles: true })); return "some";`,
  );
  await app.sleep(300);
  assert(
    (await dlg<number>(`return d.querySelectorAll('fieldset input[type=checkbox]').length;`)) >= 1,
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
  assert(!existsSync(join(book, "exports/en/audio")), "the sample wrote into exports/en/audio");
}

/** A real render fills the chapter cache; returns the audio files and when they were written. */
async function renderIntoCache({ app, book, dlg }: Context, text: Text) {
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
  const files = readdirSync(audioDir).map((f) => [f, statSync(join(audioDir, f)).mtimeMs] as const);
  return { audioDir, files };
}

/** A second export of the unchanged book reuses the cached chapters. */
async function exportAgainFromCache(
  { app, dlg, runMenu }: Context,
  text: Text,
  rendered: { audioDir: string; files: (readonly [string, number])[] },
) {
  await app.click("Done");
  await app.sleep(600);
  await runMenu("file.exportAudiobook");
  for (let i = 0; i < 20 && !/Chapters/.test(await text()); i++) await app.sleep(500);
  await dlg(`d.querySelector('button[type="submit"]').click(); return "submitted";`);
  for (let i = 0; i < 120 && !/Your audiobook is ready/.test(await text()); i++)
    await app.sleep(500);
  for (const [f, m] of rendered.files)
    assert(
      statSync(join(rendered.audioDir, f)).mtimeMs === m,
      `${f} was rendered again although nothing changed`,
    );
}

/** M4B: one book file with chapters and the cover, built from the chapters' lossless parts by the bundled ffmpeg. */
async function exportM4b({ app, repo, book, dlg, runMenu }: Context, text: Text, audioDir: string) {
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
  assert(existsSync(m4b) && statSync(m4b).size > 1000, "no M4B was written to exports/en/audio");
  const host = /host: (.*)/.exec(execFileSync("rustc", ["-vV"], { encoding: "utf8" }))?.[1];
  const ffmpeg = join(repo, "apps/desktop/src-tauri/binaries", `ffmpeg-${host}`);
  const info = spawnSync(ffmpeg, ["-hide_banner", "-i", m4b], { encoding: "utf8" }).stderr;
  assert(info.includes("Audio: aac"), `the M4B has no AAC audio:\n${info}`);
  assert(info.includes("Chapter #0:0"), `the M4B has no chapter markers:\n${info}`);
  assert(info.includes("(attached pic)"), `the M4B has no cover picture:\n${info}`);
  assert(info.includes("title           : Scenario Book"), `the M4B has no title:\n${info}`);
  assert(existsSync(join(book, ".cadabra/audio/parts")), "no chapter parts were kept");
}

/** The whole installed-voices path: chapters, sample, render, cache reuse, M4B. Returns the step's detail. */
async function installedAudiobook(ctx: Context, text: Text, first: string): Promise<string> {
  assert(first.includes("All chapters"), `no Chapters select: ${first.slice(0, 200)}`);
  await limitChaptersAndHearSample(ctx, text);
  const rendered = await renderIntoCache(ctx, text);
  await exportAgainFromCache(ctx, text, rendered);
  await exportM4b(ctx, text, rendered.audioDir);
  return `a sample played without writing files; ${rendered.files.length} file(s) rendered once; the second export reused them from the cache; the M4B has AAC, chapters, a cover and a title`;
}

/** Audiobook: the menu opens the dialog (or the download panel when no voices are installed), then Settings > Audio lists the voices. */
export async function audiobookStep(ctx: Context): Promise<string> {
  const { app, shot, dlg, runMenu } = ctx;
  const text: Text = () => dlg<string>(`return d.textContent;`);
  const first = await openAudiobookDialog(ctx, text);
  let detail =
    "voices not installed on this computer: the download panel shows and nothing is downloaded";
  if (!first.includes("Voices are not installed")) {
    detail = await installedAudiobook(ctx, text, first);
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
}
