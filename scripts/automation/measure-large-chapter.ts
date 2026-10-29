#!/usr/bin/env node
// Measures a 20,000-word chapter in the REAL app (not part of the normal scenario):
//   open to editable, per-key latency of a burst of typed characters, autosave duration, process memory.
// Usage: node scripts/automation/measure-large-chapter.ts [--launch] [--out <dir>] [--words 20000] [--keys 120] [--opens 3]
// Generates the book in a scratch folder (deterministic text, headings, footnotes), prints a JSON report.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { bigChapter } from "../../apps/desktop/src/test/bigBook.ts";
import { assert, createContext } from "./scenario/context.ts";

const args = process.argv.slice(2);
const flag = (name: string, dflt: string) =>
  args.includes(name) ? (args[args.indexOf(name) + 1] ?? dflt) : dflt;
const words = Number(flag("--words", "20000"));
const keys = Number(flag("--keys", "120"));
const opens = Number(flag("--opens", "3"));
const ctx = await createContext(args);
const { app, child, out, book, runMenu } = ctx;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pct = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
const round = (n: number, d = 1) => Number(n.toFixed(d));
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/** RSS in MB per process: the app, and every WebKit WebContent process (the webview is the one that grows while we work). */
function rssNow() {
  const txt = execFileSync("ps", ["-axo", "pid=,rss=,comm="], { encoding: "utf8" });
  const rows = txt
    .split("\n")
    .map((l) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ pid: Number(m[1]), mb: Number(m[2]) / 1024, comm: m[3] ?? "" }));
  return {
    appMb: Math.round(
      rows.filter((r) => /\/cadabracraft$/.test(r.comm)).reduce((a, r) => a + r.mb, 0),
    ),
    web: new Map(rows.filter((r) => /WebKit\.WebContent/.test(r.comm)).map((r) => [r.pid, r.mb])),
  };
}
const baseline = { current: rssNow() };
/** The webview's RSS now and its growth since `baseline` (the WebContent process whose RSS grew most is ours). */
function memory() {
  const now = rssNow();
  let best = { mb: 0, growth: -Infinity };
  for (const [pid, mb] of now.web) {
    const growth = mb - (baseline.current.web.get(pid) ?? 0);
    if (growth > best.growth) best = { mb, growth };
  }
  return {
    appMb: now.appMb,
    webviewMb: Math.round(best.mb),
    webviewGrowthMb: Math.round(best.growth),
  };
}

/** Runs a long async script in the page without holding one bridge call open (the bridge times out a single call). */
async function jsLong(body: string, maxMs = 120000): Promise<string> {
  await app.js(
    `window.__job = null; (async () => { ${body} })().then((r) => { window.__job = { ok: true, r }; }, (e) => { window.__job = { ok: false, r: String(e) }; }); 1`,
  );
  for (const t0 = performance.now(); performance.now() - t0 < maxMs;) {
    await sleep(300);
    const j = JSON.parse(await app.js<string>(`JSON.stringify(window.__job)`)) as {
      ok: boolean;
      r: string;
    } | null;
    if (j) {
      assert(j.ok, `page script failed: ${j.r}`);
      return j.r;
    }
  }
  throw new Error("the page script did not finish");
}

async function sendHome() {
  await app.js("location.reload()").catch(() => {});
  await sleep(3000);
  await app.js(`localStorage.setItem("cadabracraft.sponsor", "hidden")`);
  await app.js("location.reload()").catch(() => {});
  await sleep(3000);
}

async function createBook() {
  await app.queueDialogs([book]);
  await app.click("New project");
  await sleep(500);
  await app.click("Choose…");
  await sleep(500);
  await app.fill(0, "Large Chapter Book");
  await app.fill(1, "Agent");
  await app.click("Create book");
  await sleep(3000);
  assert((await app.snapshot()).headings.includes("Large Chapter Book"), "project did not open");
}

const editorReady = `(() => { const e = document.querySelector(".ProseMirror"); return !!e && e.getAttribute("contenteditable") === "true" && e.querySelector("h1")?.textContent === "Long" && e.textContent.length > 100000; })()`;

/** Time from asking the app to open the book to a populated, editable editor (polled every 20 ms over the bridge). */
async function openTimed() {
  const t0 = performance.now();
  await app.js(`window.__cadabraMenu.run("file.openRecent", ${JSON.stringify(book)})`);
  while (performance.now() - t0 < 60000) {
    if (await app.js<boolean>(editorReady)) {
      const editable = performance.now() - t0;
      await app.js(
        `new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))`,
      );
      return { editable, painted: performance.now() - t0 };
    }
    await sleep(20);
  }
  throw new Error("the chapter did not become editable within 60 s");
}

const report: Record<string, unknown> = {
  date: new Date().toISOString(),
  machine: {
    chip: execFileSync("sysctl", ["-n", "machdep.cpu.brand_string"], { encoding: "utf8" }).trim(),
    macos: execFileSync("sw_vers", ["-productVersion"], { encoding: "utf8" }).trim(),
  },
};

try {
  await sendHome();
  await createBook();
  const manuscript = join(book, "manuscript");
  const file = readdirSync(manuscript).filter((f) => f.endsWith(".json"))[0];
  assert(file, "no chapter file");
  const chapterFile = join(manuscript, file);
  const doc = bigChapter(words, 99, "Long");
  writeFileSync(chapterFile, JSON.stringify(doc, null, 2));
  report.chapter = {
    words,
    bytes: statSync(chapterFile).size,
    footnotes: JSON.stringify(doc).split('"type":"footnote"').length - 1,
    blocks: doc.content.length,
  };
  await runMenu("file.close");
  await sleep(1000);
  baseline.current = rssNow();
  const idle = memory();

  const openMs: number[] = [];
  const paintedMs: number[] = [];
  for (let i = 0; i < opens; i++) {
    const t = await openTimed();
    openMs.push(round(t.editable, 0));
    paintedMs.push(round(t.painted, 0));
    if (i < opens - 1) {
      await runMenu("file.close");
      await sleep(500);
    }
  }
  await sleep(1500);
  report.openToEditableMs = {
    runs: openMs,
    first: openMs[0],
    median: median(openMs),
    paintedRuns: paintedMs,
    paintedMedian: median(paintedMs),
    note: "from asking the app to open the book until the editor is editable with the whole chapter in the DOM (polled every 20 ms over the bridge, so about +-25 ms); painted = two animation frames later",
  };
  const afterOpen = memory();
  await app.screenshot(join(out, "large-chapter-open.png"));

  // Type a burst at the end of the chapter (shorter than the 10 s autosave ceiling, so the 2 s debounce is what saves it).
  await app.js(
    `(() => { const e = document.querySelector(".ProseMirror"); e.focus(); const r = document.createRange(); r.selectNodeContents(e); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); e.scrollIntoView(false); return "caret at end"; })()`,
  );
  const mtimeBefore = statSync(chapterFile).mtimeMs;
  const lat = JSON.parse(
    await jsLong(`const lat = []; const raf = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      for (let i = 0; i < ${keys}; i++) { const t = performance.now(); document.execCommand("insertText", false, "x"); await raf(); lat.push(performance.now() - t); await new Promise((r) => setTimeout(r, 20)); }
      window.__lastKeyEpoch = Date.now(); return JSON.stringify(lat);`),
  ) as number[];
  const sorted = [...lat].sort((a, b) => a - b);
  report.typing = {
    keys,
    medianMs: round(pct(sorted, 50)),
    p95Ms: round(pct(sorted, 95)),
    worstMs: round(sorted[sorted.length - 1] ?? 0),
    note: "document.execCommand insertText in the focused editor at the end of a 20k-word chapter; time from the call to the second animation frame after it",
  };
  const typed = await app.js<string>(
    `document.querySelector(".ProseMirror").textContent.slice(-${keys})`,
  );
  assert(typed === "x".repeat(keys), "the editor does not show the typed characters");

  // Autosave: the file on disk changes about 2 s (the debounce) plus the save itself after the last key.
  const lastKeyEpoch = await app.js<number>(`window.__lastKeyEpoch`);
  let savedAt = 0;
  for (const t0 = performance.now(); performance.now() - t0 < 20000 && !savedAt;) {
    const st = statSync(chapterFile);
    if (st.mtimeMs > mtimeBefore) savedAt = st.mtimeMs;
    else await sleep(5);
  }
  assert(savedAt, "autosave did not write the typed text within 20 s");
  assert(
    readFileSync(chapterFile, "utf8").includes("x".repeat(keys)),
    "the saved chapter does not contain the typed burst",
  );
  const lastKeyToDisk = savedAt - lastKeyEpoch;
  report.autosave = {
    lastKeyToOnDiskMs: round(lastKeyToDisk, 0),
    debounceMs: 2000,
    saveMs: round(lastKeyToDisk - 2000, 0),
    note: "from the last typed character to the new file's mtime (same machine clock); saveMs = that minus the 2000 ms debounce: serialise 20k words, IPC, backup, temp file and rename",
  };
  report.memoryMb = {
    closedBook: idle,
    afterOpen,
    afterTyping: memory(),
    note: "RSS from ps; webviewGrowth is relative to the app with the book closed (the WebContent process that grew most)",
  };
  await app.screenshot(join(out, "large-chapter-typed.png"));
  console.log(JSON.stringify(report, null, 2));
  writeFileSync(join(out, "measure-large-chapter.json"), JSON.stringify(report, null, 2));
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  console.log(`Report and screenshots: ${out}`);
  app.close();
  if (child && child.pid !== undefined) {
    try {
      process.kill(-child.pid);
    } catch {
      // the app and its process group may already be gone
    }
  }
}
