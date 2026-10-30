#!/usr/bin/env node
// Performance and memory under huge books: generates a real project folder (or reuses one), times the app's Rust project
// layer on it with `perfprobe` (open, list, chapter read and write with a base hash, atomic writes, snapshots, images,
// references, an optional .docx import), records CPU time and peak RSS, writes perf-results/huge-book.json and compares it
// with scripts/perf/baseline.json. Exits 1 on a regression.
//
// Usage: node scripts/perf/huge-book.ts [--preset huge|giant-chapter|media|small] [--dir <existing book>] [--regen]
//          [--docx-paragraphs 20000] [--out perf-results/huge-book.json] [--update-baseline] [--require-baseline]
// Environment: PERF_FACTOR (default 3) = allowed slowdown of CPU time against the baseline; PERF_RSS_FACTOR (default =
//   PERF_FACTOR) the same for peak RSS.
//
// TODO (not done): an `--app` mode that opens the generated book in the real Tauri window and measures open, typing and
//   autosave through the dev-automation bridge, in the style of scripts/automation/measure-large-chapter.ts. It needs a
//   display and a built app with the sidecar binaries, so it cannot run in the scheduled workflow; for now use
//   `pnpm automation:measure-large-chapter` for app-level numbers and point it at a book from `pnpm perf:bookgen`.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const manifest = join(root, "apps/desktop/src-tauri/tools/perf/Cargo.toml");
const bin = (name: string) =>
  join(
    root,
    "apps/desktop/src-tauri/tools/perf/target/release",
    name + (process.platform === "win32" ? ".exe" : ""),
  );
const args = process.argv.slice(2);
const has = (n: string) => args.includes(n);
const flag = (n: string, d: string) => (has(n) ? (args[args.indexOf(n) + 1] ?? d) : d);

const preset = flag("--preset", "huge");
const out = resolve(root, flag("--out", "perf-results/huge-book.json"));
const baselinePath = join(root, "scripts/perf/baseline.json");
const factor = Number(process.env.PERF_FACTOR ?? 3);
const rssFactor = Number(process.env.PERF_RSS_FACTOR ?? factor);
/** Steps whose baseline CPU time is below this are compared against this floor instead, so timer noise never fails a run. */
const FLOOR_MS = 25;
if (!(factor > 1)) throw new Error("PERF_FACTOR must be a number above 1");

function run(cmd: string, cmdArgs: string[], opts: { quiet?: boolean } = {}) {
  const r = spawnSync(cmd, cmdArgs, { encoding: "utf8", maxBuffer: 1 << 28 });
  if (r.status !== 0) {
    process.stderr.write(`${cmd} ${cmdArgs.join(" ")}\n${r.stdout}${r.stderr}`);
    throw new Error(`${cmd} exited with ${r.status}`);
  }
  if (!opts.quiet) process.stderr.write(r.stderr);
  return r;
}

// 1. Build the tools (a standalone crate: no sidecar binaries needed) and generate or reuse the book.
run("cargo", ["build", "--release", "--manifest-path", manifest], { quiet: true });
const books = join(root, "perf-results/books");
mkdirSync(books, { recursive: true });
const book = flag("--dir", join(books, `${preset}-seed1`));
if (has("--regen") || !existsSync(join(book, "cadabra.json"))) {
  if (existsSync(join(book, "cadabra.json")) && !has("--dir")) {
    rmSync(book, { recursive: true, force: true });
  }
  run(bin("bookgen"), ["--out", book, "--preset", preset, "--seed", "1"]);
} else {
  process.stderr.write(`reusing ${book}\n`);
}
const docxParagraphs = flag("--docx-paragraphs", "20000");
const docx = join(books, `big-${docxParagraphs}.docx`);
if (!existsSync(docx))
  run(bin("bookgen"), ["--docx", docx, "--paragraphs", docxParagraphs, "--seed", "1"]);

// 2. Measure. macOS: /usr/bin/time -l gives the whole process's peak RSS; Linux: perfprobe reads VmHWM itself.
const probeArgs = ["--root", book, "--copy", "--docx", docx, "--iters", "5"];
let rssFromTime: number | null = null;
let probeOut: string;
if (process.platform === "darwin" && existsSync("/usr/bin/time")) {
  const r = spawnSync("/usr/bin/time", ["-l", bin("perfprobe"), ...probeArgs], {
    encoding: "utf8",
    maxBuffer: 1 << 28,
  });
  if (r.status !== 0) throw new Error(`perfprobe failed\n${r.stdout}${r.stderr}`);
  probeOut = r.stdout;
  const m = /(\d+)\s+maximum resident set size/.exec(r.stderr);
  if (m) rssFromTime = Math.round(Number(m[1]) / 1024); // bytes on macOS
} else {
  probeOut = run(bin("perfprobe"), probeArgs).stdout;
}
const probe = JSON.parse(probeOut) as {
  os: string;
  pages: number;
  page_bytes: number;
  files: number;
  cpu_ms: number;
  peak_rss_kb: number;
  steps: Record<string, { cpu_ms?: number; wall_ms?: number; p95_ms?: number; max_ms?: number }>;
};
const result = {
  preset,
  book,
  date: new Date().toISOString(),
  os: process.platform,
  arch: process.arch,
  pages: probe.pages,
  pageBytes: probe.page_bytes,
  files: probe.files,
  cpuMs: probe.cpu_ms,
  peakRssKb: rssFromTime ?? probe.peak_rss_kb,
  steps: probe.steps,
};
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(result, null, 2) + "\n");

// 3. Report.
const f = (n: number) => n.toFixed(n < 10 ? 2 : 0);
console.log(
  `preset ${preset}: ${probe.pages} pages, ${(probe.page_bytes / 1048576).toFixed(1)} MiB of text, ${probe.files} files`,
);
console.log(
  `  total CPU ${f(result.cpuMs)} ms, peak RSS ${(result.peakRssKb / 1024).toFixed(0)} MiB`,
);
for (const [name, s] of Object.entries(probe.steps)) {
  if (typeof s !== "object" || s === null || s.wall_ms === undefined) continue;
  const tail = s.p95_ms === undefined ? "" : `  p95 ${f(s.p95_ms)} ms  max ${f(s.max_ms ?? 0)} ms`;
  console.log(
    `  ${name.padEnd(30)} wall ${f(s.wall_ms).padStart(7)} ms  cpu ${f(s.cpu_ms ?? 0).padStart(7)} ms${tail}`,
  );
}
console.log(`wrote ${out}`);

// 4. Baseline.
type Entry = { cpuMs: number; peakRssKb: number; steps: Record<string, number> };
const stepCpu = Object.fromEntries(
  Object.entries(probe.steps).flatMap(([k, s]) =>
    typeof s === "object" && s !== null && s.cpu_ms !== undefined ? [[k, s.cpu_ms]] : [],
  ),
);
const current: Entry = { cpuMs: result.cpuMs, peakRssKb: result.peakRssKb, steps: stepCpu };
const baselines: Record<string, Record<string, Entry>> = existsSync(baselinePath)
  ? JSON.parse(readFileSync(baselinePath, "utf8"))
  : {};
const key = `${process.platform}-${process.arch}`;

if (has("--update-baseline")) {
  baselines[preset] = { ...baselines[preset], [key]: current };
  writeFileSync(baselinePath, JSON.stringify(baselines, null, 2) + "\n");
  console.log(`baseline for ${preset}/${key} updated in ${baselinePath}`);
  process.exit(0);
}
const base = baselines[preset]?.[key];
if (!base) {
  console.log(
    `no baseline for ${preset}/${key}: reporting only (record one with --update-baseline)`,
  );
  process.exit(has("--require-baseline") ? 1 : 0);
}
const failures: string[] = [];
const check = (what: string, now: number, was: number, allowed: number, floor: number) => {
  const limit = Math.max(was, floor) * allowed;
  if (now > limit)
    failures.push(`${what}: ${f(now)} > ${f(limit)} (baseline ${f(was)} x ${allowed})`);
};
check("total CPU ms", current.cpuMs, base.cpuMs, factor, FLOOR_MS * 4);
check("peak RSS KiB", current.peakRssKb, base.peakRssKb, rssFactor, 0);
for (const [name, was] of Object.entries(base.steps)) {
  const now = current.steps[name];
  if (now !== undefined) check(`step ${name} CPU ms`, now, was, factor, FLOOR_MS);
}
if (failures.length > 0) {
  console.error(
    `PERFORMANCE REGRESSION against ${baselinePath} (factor ${factor}):\n  ${failures.join("\n  ")}`,
  );
  process.exit(1);
}
console.log(`within ${factor}x of the baseline (${key})`);
