// Which parts of CI a change can affect, from the list of changed files. Pure (`select`) so the rules are tested with
// fixture diffs; the command line at the bottom reads `git diff` and the workspace's package.json files.
//
// Rule of thumb, as in the research behind docs/architecture.md ("Selecting tests"): when unsure, run more. A file the
// rules do not know, a global trigger (lockfile, workflows, test setup) and any error all select everything.
import { execFileSync } from "node:child_process";
import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Files that can change what every test does: a change to one runs everything. */
const GLOBAL = [
  /^package\.json$/,
  /^pnpm-(lock|workspace)\.yaml$/,
  /^\.npmrc$/,
  /^tsconfig[^/]*\.json$/,
  /^vitest[^/]*\.(ts|mjs)$/,
  /^eslint\.config\.mjs$/,
  /^\.github\/workflows\//,
  /^scripts\//,
  /^apps\/desktop\/playwright\.config\.ts$/,
  /^apps\/desktop\/vite\.config\.[^/]+$/,
  /^apps\/desktop\/e2e\/support\//,
  /^apps\/desktop\/(coverageScopes|vitest\.[^/]+|tsconfig[^/]*)\.[^/]+$/,
];

/** Files no test reads: documentation, designs and agent settings. */
const INERT = [
  /^docs\//,
  /^design\//,
  /^\.claude\//,
  /^[^/]+\.md$/,
  /^LICENSE/,
  /^\.gitignore$/,
  /^\.prettier[^/]*$/,
];

const desktopBuild = /^apps\/desktop\/(index\.html|public\/|src\/|e2e\/)/;
const rust = /^apps\/desktop\/src-tauri\//;
const native = /^apps\/desktop\/e2e-native\//;

/** The workspace: `{ dirs: { "packages/format": "@scope/format" }, deps: { "@scope/format": ["@scope/shared"] } }`. */
export function readWorkspace(root) {
  const dirs = {};
  const deps = {};
  for (const parent of ["apps", "packages"]) {
    for (const entry of readdirSync(join(root, parent), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      let pkg;
      try {
        pkg = JSON.parse(readFileSync(join(root, parent, entry.name, "package.json"), "utf8"));
      } catch {
        continue;
      }
      dirs[`${parent}/${entry.name}`] = pkg.name;
      const all = { ...pkg.dependencies, ...pkg.devDependencies };
      deps[pkg.name] = Object.keys(all).filter((d) => String(all[d]).startsWith("workspace:"));
    }
  }
  return { dirs, deps };
}

/** `names` and everything that depends on them, directly or not. */
export function withDependents(names, deps) {
  const out = new Set(names);
  for (let grew = true; grew;) {
    grew = false;
    for (const [pkg, uses] of Object.entries(deps)) {
      if (!out.has(pkg) && uses.some((u) => out.has(u))) {
        out.add(pkg);
        grew = true;
      }
    }
  }
  return out;
}

const none = () => ({
  full: false,
  reasons: [],
  packages: [],
  rust: false,
  e2e: false,
  a11y: false,
  webdriver: false,
});

const everything = (reasons, ws) => ({
  full: true,
  reasons,
  packages: Object.values(ws.dirs).sort(),
  rust: true,
  e2e: true,
  a11y: true,
  webdriver: true,
});

/**
 * @param {string[]} files changed files, relative to the repository root, with `/`
 * @param {{ dirs: Record<string, string>, deps: Record<string, string[]> }} ws
 * @param {{ forceFull?: boolean }} [options]
 */
export function select(files, ws, { forceFull = false } = {}) {
  if (forceFull) return everything(["forced (full-ci)"], ws);
  if (files.length === 0)
    return everything(["no changed files found (so nothing can be skipped safely)"], ws);
  const out = none();
  const touched = new Set();
  const dirOf = (f) => Object.keys(ws.dirs).find((d) => f.startsWith(`${d}/`));
  for (const file of files) {
    const hit = GLOBAL.find((re) => re.test(file));
    if (hit) return everything([`${file}: a global trigger`], ws);
    if (INERT.some((re) => re.test(file))) continue;
    const dir = dirOf(file);
    if (rust.test(file)) {
      out.rust = true;
      out.webdriver = true;
    } else if (native.test(file)) {
      out.webdriver = true;
    } else if (dir) {
      touched.add(ws.dirs[dir]);
      if (desktopBuild.test(file)) {
        out.e2e = true;
        out.a11y = true;
      }
    } else {
      return everything([`${file}: not covered by any rule`], ws);
    }
  }
  const affected = withDependents(touched, ws.deps);
  out.packages = [...affected].sort();
  // A change in a package the desktop app depends on reaches the app's pages.
  if (affected.has(ws.dirs["apps/desktop"])) {
    out.e2e = true;
    out.a11y = true;
  }
  out.reasons = [
    ...(touched.size ? [`packages: ${[...touched].sort().join(", ")}`] : []),
    ...(out.rust ? ["Rust sources"] : []),
    ...(out.e2e ? ["the app's pages"] : []),
  ];
  return out;
}

/** The selection as a Markdown summary, so a shadow run shows what it would have done. */
export function summarize(sel, files) {
  const yn = (b) => (b ? "run" : "skip");
  return [
    "### Test selection (shadow: everything still runs)",
    "",
    `${files.length} changed file(s). ${sel.full ? "**Everything** would run" : "Selected"}: ${sel.reasons.join("; ") || "nothing needs a test"}.`,
    "",
    "| Part | Would |",
    "| --- | --- |",
    `| Unit tests | ${sel.full ? "all packages" : sel.packages.length ? sel.packages.join(", ") : "none"} |`,
    `| Rust | ${yn(sel.rust)} |`,
    `| Playwright e2e | ${yn(sel.e2e)} |`,
    `| Accessibility sweeps | ${yn(sel.a11y)} |`,
    `| WebDriver | ${yn(sel.webdriver)} |`,
    "",
  ].join("\n");
}

function main() {
  const base = process.env.AFFECTED_BASE || "origin/main";
  let sel;
  let files = [];
  const ws = readWorkspace(process.cwd());
  try {
    files = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], { encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
    sel = select(files, ws, { forceFull: process.env.FORCE_FULL === "1" });
  } catch (e) {
    sel = everything([`selection failed (${e.message.split("\n")[0]})`], ws);
  }
  const summary = summarize(sel, files);
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  if (process.env.GITHUB_OUTPUT) {
    const lines = [
      `full=${sel.full}`,
      `rust=${sel.rust}`,
      `e2e=${sel.e2e}`,
      `a11y=${sel.a11y}`,
      `webdriver=${sel.webdriver}`,
      `packages=${sel.packages.join(",")}`,
    ];
    appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
