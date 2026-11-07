// Shared by the A11yLens test files: runs the installed CLI and builds throwaway fixture projects.
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const BIN = join(ROOT, "node_modules/@eleven-hits/a11ylens/bin/a11ylens.js");

/** Runs `a11ylens` with args in `cwd`; returns { status, stdout, stderr }. Never throws. */
export function lens(args, cwd = ROOT) {
  const r = spawnSync(process.execPath, [BIN, "--no-color", ...args], {
    cwd,
    encoding: "utf8",
    timeout: 120_000,
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** Runs a scan with `-f json` and returns { status, report, stderr }. */
export function scanJson(args, cwd = ROOT) {
  const r = lens([...args, "-f", "json"], cwd);
  let report = null;
  try {
    report = JSON.parse(r.stdout);
  } catch {
    /* leave null so the test fails with the stderr */
  }
  return { status: r.status, report, stderr: r.stderr };
}

/** Creates a temp project from { "relative/path": "contents" } and returns its directory. */
export function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), "a11ylens-"));
  for (const [rel, body] of Object.entries(files)) {
    const p = join(dir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
  return dir;
}
