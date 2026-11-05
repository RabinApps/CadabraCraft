#!/usr/bin/env node
// Structure guard: file length and folder size (CLAUDE.md, "Code organization").
//
//   node scripts/check-size.mjs                  check; exit 1 on any violation
//   node scripts/check-size.mjs --update-baseline  lower baseline entries / drop fixed ones (never raises)
//   node scripts/check-size.mjs --init-baseline    write a fresh baseline from the current violations (one-off)
//
// Limits: source 400 non-blank lines, test files 800, at most 20 source files per folder.
// ESLint's max-lines covers .ts/.tsx source; this script covers Rust, CSS, tests and folder size.
// Grandfathered offenders live in scripts/size-baseline.json. An entry may only shrink, and
// must be deleted once the file or folder is back under the limit (a stale entry fails the check).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const LIMITS = { source: 400, test: 800, folder: 20 };
const EXTENSIONS = /\.(ts|tsx|mts|rs|css)$/;
const SKIP =
  /(^|\/)(vendor|node_modules|target|dist|coverage|locales|gen|licenses|tmp-office-samples|fixtures|tools\/verapdf|apps\/website)(\/|$)/;
const TEST_PATH =
  /(^|\/)(__tests__|e2e|e2e-voiceover|tests|test)\/|\.(test|spec)\.[a-z]+$|(^|\/)[a-z_]*tests\.rs$/;

export const isTest = (path) => TEST_PATH.test(path);

export const countLines = (text) => text.split("\n").filter((l) => l.trim() !== "").length;

/** Returns [{ key, value, limit, kind }] for everything over its limit. */
export function findViolations(files, readLines) {
  const out = [];
  const perFolder = new Map();
  for (const path of files) {
    if (isTest(path)) {
      const n = readLines(path);
      if (n > LIMITS.test) out.push({ key: path, value: n, limit: LIMITS.test, kind: "test file" });
      continue;
    }
    // ESLint owns .ts/.tsx source length (it skips comments); count only Rust and CSS here.
    if (/\.(rs|css)$/.test(path)) {
      const n = readLines(path);
      if (n > LIMITS.source)
        out.push({ key: path, value: n, limit: LIMITS.source, kind: "source file" });
    }
    const dir = dirname(path);
    perFolder.set(dir, (perFolder.get(dir) ?? 0) + 1);
  }
  for (const [dir, n] of perFolder) {
    if (n > LIMITS.folder)
      out.push({ key: `dir:${dir}`, value: n, limit: LIMITS.folder, kind: "folder" });
  }
  return out;
}

/** Compares violations to the baseline. Returns human-readable problems. */
export function compare(violations, baseline) {
  const problems = [];
  const seen = new Set();
  for (const v of violations) {
    seen.add(v.key);
    const allowed = baseline[v.key];
    if (allowed === undefined) {
      problems.push(
        `${v.key}: ${v.value} > ${v.limit} (${v.kind}). Split it or move files into subfolders.`,
      );
    } else if (v.value > allowed) {
      problems.push(
        `${v.key}: grew to ${v.value} (baseline ${allowed}). Baselined files may only shrink.`,
      );
    }
  }
  for (const key of Object.keys(baseline)) {
    if (!seen.has(key))
      problems.push(
        `${key}: now within the limit, delete its entry from scripts/size-baseline.json.`,
      );
  }
  return problems;
}

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const baselinePath = join(root, "scripts", "size-baseline.json");
  const args = process.argv.slice(2);
  const files = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\n")
    .filter((p) => p && EXTENSIONS.test(p) && !SKIP.test(p) && existsSync(join(root, p)));
  const violations = findViolations(files, (p) => countLines(readFileSync(join(root, p), "utf8")));

  if (args.includes("--init-baseline")) {
    writeFileSync(
      baselinePath,
      JSON.stringify(Object.fromEntries(violations.map((v) => [v.key, v.value]).sort()), null, 2) +
        "\n",
    );
    console.log(`Wrote ${violations.length} baseline entries.`);
    return;
  }
  const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, "utf8")) : {};
  if (args.includes("--update-baseline")) {
    const next = {};
    for (const v of violations) {
      if (baseline[v.key] !== undefined) next[v.key] = Math.min(baseline[v.key], v.value);
    }
    writeFileSync(
      baselinePath,
      JSON.stringify(Object.fromEntries(Object.entries(next).sort()), null, 2) + "\n",
    );
    console.log(`Baseline now has ${Object.keys(next).length} entries.`);
    return;
  }
  const problems = compare(violations, baseline);
  if (problems.length > 0) {
    console.error(`check-size failed:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    process.exit(1);
  }
  console.log(`check-size ok (${Object.keys(baseline).length} grandfathered).`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
