#!/usr/bin/env node
// Measures reference files in the REAL app (not part of the normal scenario, it writes ~1 GB of scratch files):
//   (a) <video> seeking through a blob URL (the way the viewer plays a video),
//   (b) importing a file near the 500 MB video cap: time, bytes/s, UI responsiveness, progress, memory, sha256.
// Usage: node scripts/automation/measure-references.ts [--launch] [--out <dir>] [--big-mb 495] [--keep]
//   needs ffmpeg on PATH (or the repo's sidecar in apps/desktop/src-tauri/binaries); nothing is downloaded.
// Prints a JSON report and deletes the generated files unless --keep is given.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  appendFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  openSync,
  writeSync,
  closeSync,
} from "node:fs";
import { join } from "node:path";
import { assert, createContext } from "./scenario/context.ts";
import type { App } from "./client.ts";

const args = process.argv.slice(2);
const flag = (name: string, dflt: string) =>
  args.includes(name) ? (args[args.indexOf(name) + 1] ?? dflt) : dflt;
const MB = 1024 * 1024;
const bigMb = Number(flag("--big-mb", "495")); // video cap is 500 MB; stay a little under it
const ctx = await createContext(args);
const { app, child, out, repo, book } = ctx;
const work = join(out, "media");
mkdirSync(work, { recursive: true });
const report: Record<string, unknown> = { date: new Date().toISOString(), bigMb };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sha256 = (file: string) =>
  new Promise<string>((resolve, reject) => {
    const h = createHash("sha256");
    createReadStream(file)
      .on("data", (d) => h.update(d))
      .on("end", () => resolve(h.digest("hex")))
      .on("error", reject);
  });

// ---- memory: peak RSS of the app process and of the WebKit WebContent process that grows most ----
type Proc = { pid: number; rssMb: number; comm: string };
function procs(): Proc[] {
  const txt = execFileSync("ps", ["-axo", "pid=,rss=,comm="], { encoding: "utf8" });
  return txt
    .split("\n")
    .map((l) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ pid: Number(m[1]), rssMb: Number(m[2]) / 1024, comm: m[3] ?? "" }))
    .filter((p) => /cadabracraft|WebKit\.WebContent|WebKit\.Networking/i.test(p.comm));
}
function sampler() {
  const base = new Map(procs().map((p) => [p.pid, p.rssMb]));
  const peak = new Map<number, Proc>();
  const tick = () => {
    for (const p of procs()) if (p.rssMb > (peak.get(p.pid)?.rssMb ?? 0)) peak.set(p.pid, p);
  };
  tick();
  const timer = setInterval(tick, 150);
  return () => {
    clearInterval(timer);
    tick();
    const rows = [...peak.values()].map((p) => ({
      pid: p.pid,
      kind: p.comm.includes("cadabracraft")
        ? "app"
        : /Networking/.test(p.comm)
          ? "networking"
          : "webcontent",
      baseMb: Math.round(base.get(p.pid) ?? 0),
      peakMb: Math.round(p.rssMb),
      growthMb: Math.round(p.rssMb - (base.get(p.pid) ?? 0)),
    }));
    // WebContent processes of other apps stay flat, so the one that grows is ours; the app process is the one named cadabracraft.
    const grew = rows.filter((r) => r.kind !== "app").sort((a, b) => b.growthMb - a.growthMb)[0];
    return { app: rows.find((r) => r.kind === "app"), webview: grew };
  };
}

// ---- responsiveness: frame gaps inside the webview and the round trip of a trivial script ----
async function installFrameMonitor() {
  await app.js(`(() => { const m = window.__frames = { last: performance.now(), max: 0, n: 0 };
    const f = (t) => { m.max = Math.max(m.max, t - m.last); m.last = t; m.n++; requestAnimationFrame(f); };
    requestAnimationFrame(f); return "ok"; })()`);
}
const resetFrames = () =>
  app.js(
    `(() => { window.__frames.max = 0; window.__frames.n = 0; window.__frames.last = performance.now(); return 1; })()`,
  );
const readFrames = () =>
  app.js<{ max: number; n: number }>(`({ max: window.__frames.max, n: window.__frames.n })`);
function probe() {
  const lat: number[] = [];
  let go = true;
  const loop = (async () => {
    while (go) {
      const t = performance.now();
      try {
        await app.js("1");
        lat.push(performance.now() - t);
      } catch {
        lat.push(Infinity);
      }
      await sleep(200);
    }
  })();
  return async () => {
    go = false;
    await loop;
    const finite = lat.filter(Number.isFinite).sort((a, b) => a - b);
    return {
      probes: lat.length,
      medianMs: Math.round(finite[Math.floor(finite.length / 2)] ?? 0),
      maxMs: Math.round(finite[finite.length - 1] ?? 0),
    };
  };
}

// ---- test files ----
function ffmpegPath() {
  if (spawnSync("ffmpeg", ["-version"]).status === 0) return "ffmpeg";
  const side = join(repo, "apps/desktop/src-tauri/binaries/ffmpeg-aarch64-apple-darwin");
  if (existsSync(side)) return side;
  throw new Error("ffmpeg is not installed and the sidecar is missing; nothing is downloaded");
}
function makeVideo(file: string, extra: string[]) {
  execFileSync(
    ffmpegPath(),
    [
      "-y",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=1280x720:rate=30:duration=30",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=30",
      ...extra,
      "-c:a",
      "aac",
      "-g",
      "30",
      "-keyint_min",
      "30",
      "-sc_threshold",
      "0",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-shortest",
      file,
    ],
    { stdio: "inherit" },
  );
}
/** Appends a top-level `free` box (ignored by players) so the file is `mb` MB while staying a valid mp4. */
function padMp4(file: string, mb: number) {
  const need = mb * MB - statSync(file).size - 8;
  assert(need > 0 && need < 2 ** 32, "cannot pad to that size");
  const fd = openSync(file, "a");
  const hdr = Buffer.alloc(8);
  hdr.writeUInt32BE(need + 8, 0);
  hdr.write("free", 4, "latin1");
  writeSync(fd, hdr);
  const block = randomBytes(MB);
  for (let left = need; left > 0; left -= block.length)
    writeSync(fd, block, 0, Math.min(left, block.length));
  closeSync(fd);
}

const small = join(work, "clip-small.mp4");
const real = join(work, "clip-real.mp4");
const big = join(work, "clip-big.mp4");
const other = join(work, "data-99mb.dat");

/** Runs a long async script in the page without holding one bridge call open (the bridge times out a single call). */
async function jsLong(body: string, maxMs = 600000): Promise<string> {
  await app.js(
    `window.__job = null; (async () => { ${body} })().then((r) => { window.__job = { ok: true, r }; }, (e) => { window.__job = { ok: false, r: String(e) }; }); 1`,
  );
  for (const t0 = performance.now(); performance.now() - t0 < maxMs;) {
    await sleep(300);
    const j = await app
      .js<string>(`JSON.stringify(window.__job)`)
      .then((x) => JSON.parse(x) as { ok: boolean; r: string } | null)
      .catch(() => null);
    if (j) {
      assert(j.ok, `page script failed: ${j.r}`);
      return j.r;
    }
  }
  throw new Error("page script did not finish");
}
const log = (m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

async function openBook() {
  await app.js("location.reload()").catch(() => {});
  await sleep(3000);
  await app.js(`localStorage.setItem("cadabracraft.sponsor", "hidden")`);
  await app.js("location.reload()").catch(() => {});
  await sleep(3000);
  await app.queueDialogs([book]);
  await app.click("New project");
  await sleep(500);
  await app.click("Choose…");
  await sleep(500);
  await app.fill(0, "Measure Book");
  await app.fill(1, "Agent");
  await app.click("Create book");
  await sleep(3000);
  const s = await app.snapshot();
  assert(s.headings.includes("Measure Book"), "project did not open");
  const shown = await app.js<boolean>(
    `!!document.querySelector('section[aria-label="References"]')`,
  );
  if (!shown) await app.click("References");
  await sleep(500);
}

const manifest = () => JSON.parse(readFileSync(join(book, "cadabra.json"), "utf8"));
const refsDir = join(book, "references");
const clickLabelled = (a: App, label: string) =>
  a.js(`(() => { const want = ${JSON.stringify(label)};
    const bs = [...document.querySelectorAll("button")];
    const b = bs.find((b) => b.getAttribute("aria-label") === want || b.textContent.trim() === want) ?? bs.find((b) => (b.getAttribute("aria-label") ?? b.textContent).includes(want));
    if (!b) throw new Error("no button: " + want + " in " + (document.querySelector('section[aria-label="References"]')?.textContent ?? "(no panel)").slice(0, 400));
    b.click(); return "clicked"; })()`);

/** Imports `file` through the real "Add files" button and times it. */
async function importMeasured(file: string, name: string) {
  const before = manifest().references?.length ?? 0;
  const srcHash = sha256(file);
  const size = statSync(file).size;
  const stopMem = sampler();
  await resetFrames();
  const stopProbe = probe();
  await app.queueDialogs([file]);
  const t0 = performance.now();
  await clickLabelled(app, "Add files");
  let progressSeen = false;
  let progressText = "";
  let tmpPeak = 0;
  let tmpFirstMs: number | undefined;
  let doneMs: number | undefined;
  const tmpSamples: { ms: number; mb: number }[] = [];
  // A deadline (a call to a busy webview can itself take 30 s), and a refusal ends the wait instead of waiting for a row that never comes.
  while (performance.now() - t0 < 10 * 60 * 1000) {
    const ms = performance.now() - t0;
    const tmp = existsSync(refsDir)
      ? readdirSync(refsDir).find((f) => f.startsWith(".") && f.endsWith(".tmp"))
      : undefined;
    if (tmp) {
      try {
        tmpPeak = Math.max(tmpPeak, statSync(join(refsDir, tmp)).size);
        tmpFirstMs ??= ms;
        tmpSamples.push({ ms: Math.round(ms), mb: Math.round(tmpPeak / MB) });
      } catch {
        /* renamed between readdir and stat */
      }
    }
    try {
      const ui = await app.js<string>(
        `document.querySelector('section[aria-label="References"] [role=status]')?.textContent ?? ""`,
      );
      if (ui && /\d+ \/ \d+/.test(ui)) {
        progressSeen = true;
        progressText = ui;
      }
    } catch {
      /* the webview was too busy to answer in time; the probe records it */
    }
    const refused = await app
      .js<string>(
        `document.querySelector('section[aria-label="References"] [role=alert]')?.textContent ?? ""`,
      )
      .catch(() => "");
    assert(!refused, `the app refused ${name}: ${refused}`);
    if ((manifest().references?.length ?? 0) > before) {
      doneMs = performance.now() - t0;
      break;
    }
    await sleep(100);
  }
  assert(doneMs !== undefined, "import did not finish");
  // How long until the UI itself shows the new row and drops the progress box.
  let uiMs: number | undefined;
  for (let i = 0; i < 200; i++) {
    const gone = await app.js<boolean>(
      `!document.querySelector('section[aria-label="References"] [role=status] progress, section[aria-label="References"] [role=progressbar]') && document.body.textContent.includes(${JSON.stringify(name)})`,
    );
    if (gone) {
      uiMs = performance.now() - t0;
      break;
    }
    await sleep(100);
  }
  const responsiveness = await stopProbe();
  const frames = await readFrames();
  const mem = stopMem();
  const m = manifest();
  const ref = m.references[m.references.length - 1];
  const copy = join(book, ref.file);
  const [a, b] = await Promise.all([srcHash, sha256(copy)]);
  return {
    file: ref.file,
    sizeMb: Math.round(size / MB),
    manifestWrittenMs: Math.round(doneMs),
    uiShowsRowMs: uiMs === undefined ? null : Math.round(uiMs),
    mbPerSecond: Number((size / MB / (doneMs / 1000)).toFixed(1)),
    tmpFileFirstSeenMs: tmpFirstMs === undefined ? null : Math.round(tmpFirstMs),
    progressBoxShown: progressSeen,
    progressText,
    progressGranularity: "per file (index / total), no byte progress",
    tmpGrowthSamples: tmpSamples.filter(
      (_, i) => i % Math.max(1, Math.floor(tmpSamples.length / 8)) === 0,
    ),
    responsiveness: { ...responsiveness, maxFrameGapMs: Math.round(frames.max), frames: frames.n },
    memory: mem,
    sha256Match: a === b,
    sha256: a,
    sizeMatches: statSync(copy).size === size,
  };
}

/** Opens the viewer for a reference title and measures video load and seeks inside the webview. */
async function seekMeasured(title: string) {
  const stopMem = sampler();
  await resetFrames();
  const stopProbe = probe();
  const t0 = performance.now();
  await clickLabelled(app, title);
  let ready = false;
  let loadMs = 0;
  let last = "no dialog";
  // A deadline, not an iteration count: a call to a busy webview can itself take 30 s, so counting loops can run for hours.
  while (performance.now() - t0 < 30000) {
    const r = await app
      .js<string>(
        `(() => { const v = document.querySelector('[role=dialog] video'); return v ? JSON.stringify({ rs: v.readyState, ns: v.networkState, err: v.error && v.error.code, msg: v.error && v.error.message, src: v.src.slice(0, 5) }) : "no video"; })()`,
      )
      .catch((e: Error) => `bridge: ${e.message}`);
    last = r;
    if (r.startsWith("{") && (JSON.parse(r) as { rs: number }).rs >= 1) {
      ready = true;
      loadMs = performance.now() - t0;
      break;
    }
    await sleep(200);
  }
  assert(ready, `video never reported metadata within 30 s; last state: ${last}`);
  const responsivenessLoad = await stopProbe();
  const framesLoad = await readFrames();
  const info =
    await app.js<string>(`(() => { const v = document.querySelector('[role=dialog] video');
    return JSON.stringify({ src: v.src.slice(0, 5), duration: v.duration, w: v.videoWidth, h: v.videoHeight, error: v.error && v.error.code }); })()`);
  // Seeks run in the page: each waits for `seeked`, then waits for a decoded frame and checks that the picture changed.
  const seeks = await jsLong(`
    const v = document.querySelector('[role=dialog] video');
    v.muted = true;
    const c = document.createElement("canvas"); c.width = 64; c.height = 36;
    const g = c.getContext("2d", { willReadFrequently: true });
    const grab = () => { g.drawImage(v, 0, 0, 64, 36); const d = g.getImageData(0, 0, 64, 36).data; let h = 0; for (let i = 0; i < d.length; i += 4) h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) | 0; return h; };
    const wait = (ev, ms) => new Promise((res) => { const t = setTimeout(() => res(false), ms); v.addEventListener(ev, () => { clearTimeout(t); res(true); }, { once: true }); });
    const targets = [10, 25, 3.5, 29.5, 0.2, 15, 15.04, 7.7, 22, 1];
    const rows = [];
    for (const target of targets) {
      const t = performance.now();
      v.currentTime = target;
      const ok = await wait("seeked", 15000);
      const seekMs = performance.now() - t;
      // A hidden or unfocused window never presents a frame, so the callback may never run: never wait on it alone.
      await new Promise((r) => { setTimeout(r, 400); if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(() => r()); });
      rows.push({ target, ok, seekMs: Math.round(seekMs), at: Number(v.currentTime.toFixed(2)), state: v.readyState, hash: grab() });
    }
    // Play a second from the middle to prove decoding works from the blob after seeking.
    v.currentTime = 12; await wait("seeked", 15000);
    const t = v.currentTime; await Promise.race([v.play().catch(() => {}), new Promise((r) => setTimeout(r, 3000))]); await new Promise((r) => setTimeout(r, 1200)); const moved = v.currentTime - t; v.pause();
    return JSON.stringify({ rows, playedSeconds: Number(moved.toFixed(2)) });
  `);
  const parsed = JSON.parse(seeks) as {
    rows: { ok: boolean; seekMs: number; target: number; at: number; hash: number }[];
    playedSeconds: number;
  };
  const ms = parsed.rows.map((r) => r.seekMs).sort((a, b) => a - b);
  const mem = stopMem();
  await app.js(
    `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); 1`,
  );
  await sleep(600);
  return {
    openToMetadataMs: Math.round(loadMs),
    loadResponsiveness: { ...responsivenessLoad, maxFrameGapMs: Math.round(framesLoad.max) },
    video: JSON.parse(info),
    seeksOk: parsed.rows.filter((r) => r.ok).length + "/" + parsed.rows.length,
    seekMs: { min: ms[0], median: ms[Math.floor(ms.length / 2)], max: ms[ms.length - 1] },
    landedWithin50ms: parsed.rows.every((r) => Math.abs(r.at - r.target) < 0.5),
    distinctFrames: new Set(parsed.rows.map((r) => r.hash)).size,
    playedSecondsIn1_2s: parsed.playedSeconds,
    seeks: parsed.rows,
    memory: mem,
  };
}

const watchdog = setTimeout(
  () => {
    console.error("measurement watchdog: still running after 20 minutes, stopping");
    process.exit(2);
  },
  20 * 60 * 1000,
);
watchdog.unref();
try {
  report.disk = execFileSync("df", ["-h", out], { encoding: "utf8" }).split("\n")[1];
  log(`generating test files in ${work}`);
  makeVideo(small, ["-c:v", "libx264", "-preset", "veryfast", "-crf", "28"]);
  // A heavy stream (noise defeats compression) so the seek test also covers a big real file, not only padding.
  makeVideo(real, [
    "-vf",
    "noise=alls=30:allf=t",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-b:v",
    "60M",
    "-maxrate",
    "60M",
    "-bufsize",
    "30M",
  ]);
  log("videos done");
  copyAndPad();
  function copyAndPad() {
    writeFileSync(big, readFileSync(small));
    padMp4(big, bigMb);
    appendFileSync(other, randomBytes(MB));
    for (let i = 0; i < 98; i++) appendFileSync(other, randomBytes(MB));
  }
  report.files = Object.fromEntries(
    [small, real, big, other].map((f) => [
      f.split("/").pop(),
      `${(statSync(f).size / MB).toFixed(1)} MB`,
    ]),
  );

  await openBook();
  await installFrameMonitor();

  const imports: Record<string, unknown> = {};
  const seeks: Record<string, unknown> = {};
  log("imports.small");
  imports.small = await importMeasured(small, "clip-small");
  log("seeks.small");
  seeks.small = await seekMeasured("clip-small");
  log("imports.real");
  imports.real = await importMeasured(real, "clip-real");
  log("seeks.real");
  seeks.real = await seekMeasured("clip-real");
  log("imports.other99");
  imports.other99 = await importMeasured(other, "data-99mb");
  log("imports.big");
  imports.big = await importMeasured(big, "clip-big");
  log("seeks.big");
  seeks.big = await seekMeasured("clip-big");
  report.imports = imports;
  report.seeks = seeks;

  // Raw IPC throughput of read_reference by chunk size on the big file (chunks are dropped, not kept).
  const chunkMb = [4, 8, 16];
  const raw: Record<string, unknown> = {};
  const bigRef = manifest().references.find((r: { file: string }) =>
    r.file.includes("clip-big"),
  )?.file;
  for (const c of chunkMb) {
    await resetFrames();
    const r = await jsLong(`
      const root = ${JSON.stringify(book)}, path = ${JSON.stringify(bigRef)}, len = ${c} * 1024 * 1024;
      const { size } = await window.__TAURI__.core.invoke("stat_reference", { root, path });
      const t = performance.now(); let off = 0, calls = 0, worst = 0;
      while (off < size) { const t1 = performance.now(); const b = await window.__TAURI__.core.invoke("read_reference", { root, path, offset: off, length: len });
        worst = Math.max(worst, performance.now() - t1); off += b.byteLength; calls++; }
      return JSON.stringify({ ms: Math.round(performance.now() - t), calls, worstCallMs: Math.round(worst) });
    `);
    const parsed = JSON.parse(r) as { ms: number; calls: number; worstCallMs: number };
    raw[`${c}MB`] = {
      ...parsed,
      mbPerSecond: Number((statSync(join(book, bigRef)).size / MB / (parsed.ms / 1000)).toFixed(1)),
      maxFrameGapMs: Math.round((await readFrames()).max),
    };
  }
  report.rawReadChunkSizes = raw;
  report.integrityAfterReads = (await sha256(big)) === (await sha256(join(book, bigRef)));
  await app.screenshot(join(out, "measure-end.png"));
  console.log(JSON.stringify(report, null, 2));
  writeFileSync(join(out, "measure-references.json"), JSON.stringify(report, null, 2));
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  if (!args.includes("--keep")) rmSync(work, { recursive: true, force: true });
  console.log(`Report and screenshot: ${out}`);
  app.close();
  if (child && child.pid !== undefined) {
    try {
      process.kill(-child.pid);
    } catch {
      // the app and its process group may already be gone
    }
  }
}
