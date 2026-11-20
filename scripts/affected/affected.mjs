// Which parts of CI a change can affect, from the list of changed files. ci.yml runs only what the outputs select. Pure (`select`) so the rules are tested with
// fixture diffs; the command line at the bottom reads `git diff` and the workspace's package.json files.
//
// Rule of thumb, as in the research behind docs/architecture.md ("Selecting tests"): when unsure, run more. A file the
// rules do not know, a global trigger (lockfile, workflows, test setup) and any error all select everything.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createSpecIndex,
  readImportGraph,
  readSpecMap,
  shardsFor,
  specsForAll,
} from "./e2e-specs.mjs";

/** Files that can change what every test does: a change to one runs everything. */
const GLOBAL = [
  /^package\.json$/,
  /^pnpm-(lock|workspace)\.yaml$/,
  /^\.npmrc$/,
  /^tsconfig[^/]*\.json$/,
  /^vitest[^/]*\.(ts|mjs)$/,
  /^eslint\.config\.mjs$/,
  // The CI and release workflows and the shared actions decide what every job does. The other workflows (pages, perf-fuzz) are INERT.
  /^\.github\/workflows\/(ci|release)\.yml$/,
  /^\.github\/actions\//,
  // Scripts the test jobs run. The ones below with a narrower reach (A11Y_ONLY, A11Y_TOOLS_ONLY, INERT) are excluded.
  /^scripts\/(?!(perf|audio-spike|design)\/|a11ylens\/|(a11y|validate-pdf|fetch-ace|fetch-verapdf|set-version|build-jre|sign-jre)[.-])/,
  /^apps\/desktop\/playwright\.config\.ts$/,
  /^apps\/desktop\/vite\.config\.[^/]+$/,
  // Loaded by playwright.config.ts for every run. The other e2e helpers narrow by the specs that import them.
  /^apps\/desktop\/e2e\/support\/coverage[^/]*\.ts$/,
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
  /^\.editorconfig$/,
  /^\.gitattributes$/,
  /^\.githooks\//,
  /^brand\//,
  /^\.github\/(dependabot|FUNDING)\.yml$/,
  // Deployed or run on a schedule, never by the pull request run: the website deploy, the weekly perf and fuzz run, and the
  // scripts only those and the release use.
  /^\.github\/workflows\/(pages|perf-fuzz)\.yml$/,
  /^scripts\/(perf|audio-spike|design)\//,
  /^scripts\/(set-version\.mjs|build-jre\.sh|sign-jre\.sh)$/,
];

/** Scripts only the `a11y` job runs: the whole job, or just its validator tools (veraPDF, Ace). */
const A11Y_ONLY = [/^scripts\/a11ylens\//, /^scripts\/(a11y|validate-pdf)\.sh$/];
const A11Y_TOOLS_ONLY = [/^scripts\/(fetch-ace|fetch-verapdf)\.sh$/];

/**
 * The packages whose tests drive an external tool (EPUBCheck, Ace, veraPDF and Typst, LibreOffice, enwik8): the `unit` job
 * installs the tools only when the change reaches one of them. The desktop app is not one: its tests use fakes.
 */
const TOOL_PACKAGES = [
  "packages/export-epub",
  "packages/export-pdf",
  "packages/export-docx",
  "packages/export-rtf",
  "packages/import-docx",
  "packages/mcp",
];
/** The exporters the accessibility validators (veraPDF, Ace, LibreOffice, the output tests) check. */
const A11Y_PACKAGES = TOOL_PACKAGES.filter((d) => d.includes("/export-"));

/** Files only the unit tests (or no test) read: the app's pages cannot observe them, so they select no e2e spec. */
const unitOnly = /(^|\/)__tests__\/|\.test\.tsx?$|\.md$/;
const rust = /^apps\/desktop\/src-tauri\//;
/** Standalone crates the app's `cargo test --lib` does not build: the perf probe and the fuzz targets (the weekly perf-fuzz run checks them). */
const rustStandalone = /^apps\/desktop\/src-tauri\/(tools\/perf|fuzz)\//;
const native = /^apps\/desktop\/e2e-native\//;
/** Files the dependency license and advisory checks read (`pnpm licenses:check`): manifests, lockfiles and the cargo-deny and cargo-about setup. */
const licenseInput =
  /(^|\/)(package\.json|Cargo\.(toml|lock)|deny\.toml|about\.(hbs|toml))$|^apps\/desktop\/src-tauri\/licenses\//;

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
  /** The specs to run when the change only touches spec files; empty means the whole suite. */
  e2eSpecs: [],
  a11y: false,
  /** The part of `a11y` that checks the exporters' output with veraPDF, Ace and LibreOffice (the rest is the page sweeps). */
  a11yTools: false,
  /** The part of `a11y` that sweeps the app's pages (WebKit). */
  a11yPages: false,
  /** Whether the unit tests need the external tools installed. */
  tools: false,
  webdriver: false,
  licenses: false,
  /** `next build` of the website. */
  website: false,
});

const everything = (reasons, ws) => ({
  full: true,
  reasons,
  packages: Object.values(ws.dirs).sort(),
  rust: true,
  e2e: true,
  e2eSpecs: [],
  a11y: true,
  a11yTools: true,
  a11yPages: true,
  tools: true,
  webdriver: true,
  licenses: true,
  website: true,
});

/** A script only the `a11y` job (or its validators) runs: marks that part and says whether `file` was one. */
function markA11yScript(file, out) {
  if (A11Y_ONLY.some((re) => re.test(file))) {
    out.a11yTools = true;
    out.a11yPages = true;
    return true;
  }
  if (A11Y_TOOLS_ONLY.some((re) => re.test(file))) {
    out.a11yTools = true;
    return true;
  }
  return false;
}

/** What the packages a change reaches (the touched ones and their dependents) select. */
function applyReach(out, affected, ws) {
  out.packages = [...affected].sort();
  out.website = affected.has(ws.dirs["apps/website"]);
  const reaches = (dirs) => dirs.some((d) => ws.dirs[d] && affected.has(ws.dirs[d]));
  out.tools = reaches(TOOL_PACKAGES);
  out.a11yTools = out.a11yTools || reaches(A11Y_PACKAGES);
}

/**
 * The e2e specs the changed files that can reach the app's pages select (all of them when one is unknown to `specsFor`).
 * A file counts when its package is the desktop app or one the app depends on, and it is not a unit test.
 */
function applyPages(out, pageFiles, ws, specsFor) {
  const desktop = ws.dirs["apps/desktop"];
  const reaching = pageFiles
    .filter(({ pkg }) => withDependents([pkg], ws.deps).has(desktop))
    .map(({ file }) => file);
  out.e2e = reaching.length > 0;
  out.a11yPages = out.a11yPages || out.e2e;
  out.e2eSpecs = specsForAll(reaching, specsFor);
  out.a11y = out.a11yTools || out.a11yPages;
}

/**
 * @param {string[]} files changed files, relative to the repository root, with `/`
 * @param {{ dirs: Record<string, string>, deps: Record<string, string[]> }} ws
 * @param {{ forceFull?: boolean, specsFor?: (file: string) => string[] | null }} [options] `specsFor`: see createSpecIndex
 */
export function select(
  files,
  ws,
  { forceFull = false, specsFor = createSpecIndex({}, null) } = {},
) {
  if (forceFull) return everything(["forced (full-ci)"], ws);
  if (files.length === 0)
    return everything(["no changed files found (so nothing can be skipped safely)"], ws);
  const out = none();
  const touched = new Set();
  const pageFiles = [];
  const dirOf = (f) => Object.keys(ws.dirs).find((d) => f.startsWith(`${d}/`));
  for (const file of files) {
    const hit = GLOBAL.find((re) => re.test(file));
    if (hit) return everything([`${file}: a global trigger`], ws);
    if (INERT.some((re) => re.test(file))) continue;
    if (licenseInput.test(file)) out.licenses = true;
    if (markA11yScript(file, out)) continue;
    const dir = dirOf(file);
    if (rustStandalone.test(file)) continue;
    if (rust.test(file)) {
      out.rust = true;
      out.webdriver = true;
    } else if (native.test(file)) {
      out.webdriver = true;
    } else if (dir) {
      touched.add(ws.dirs[dir]);
      if (!unitOnly.test(file)) pageFiles.push({ file, pkg: ws.dirs[dir] });
    } else {
      return everything([`${file}: not covered by any rule`], ws);
    }
  }
  applyReach(out, withDependents(touched, ws.deps), ws);
  applyPages(out, pageFiles, ws, specsFor);
  out.reasons = [
    ...(touched.size ? [`packages: ${[...touched].sort().join(", ")}`] : []),
    ...(out.rust ? ["Rust sources"] : []),
    ...(out.e2e ? ["the app's pages"] : []),
  ];
  return out;
}

/** The selection as a Markdown summary of what CI runs. */
export function summarize(sel, files) {
  const yn = (b) => (b ? "run" : "skip");
  return [
    "### Test selection",
    "",
    `${files.length} changed file(s). ${sel.full ? "**Everything** runs" : "Selected"}: ${sel.reasons.join("; ") || "nothing needs a test"}.`,
    "",
    "| Part | CI |",
    "| --- | --- |",
    `| Unit tests | ${sel.full ? "all packages" : sel.packages.length ? sel.packages.join(", ") : "none"} |`,
    `| Rust | ${yn(sel.rust)} |`,
    `| Playwright e2e | ${sel.e2e ? (sel.e2eSpecs.length ? sel.e2eSpecs.join(", ") : "run (all specs)") : "skip"} |`,
    `| Accessibility sweeps | ${sel.a11y ? [sel.a11yPages && "pages", sel.a11yTools && "exporter validators"].filter(Boolean).join(" and ") : "skip"} |`,
    `| External tools for unit tests | ${yn(sel.tools)} |`,
    `| WebDriver | ${yn(sel.webdriver)} |`,
    `| Licenses | ${yn(sel.licenses)} |`,
    `| Website build | ${yn(sel.website)} |`,
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
    const specsFor = createSpecIndex(readImportGraph(process.cwd()), readSpecMap(process.cwd()));
    sel = select(files, ws, { forceFull: process.env.FORCE_FULL === "1", specsFor });
    // A spec the change deletes cannot be run; with none left the run falls back to the whole suite.
    const present = sel.e2eSpecs.filter((spec) =>
      existsSync(join(process.cwd(), "apps/desktop", spec)),
    );
    if (present.length !== sel.e2eSpecs.length) sel.e2eSpecs = present;
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
      `e2e_specs=${sel.e2eSpecs.join(",")}`,
      `e2e_shards=${JSON.stringify(shardsFor(sel.e2eSpecs.length))}`,
      `a11y=${sel.a11y}`,
      `a11y_tools=${sel.a11yTools}`,
      `a11y_pages=${sel.a11yPages}`,
      `tools=${sel.tools}`,
      `webdriver=${sel.webdriver}`,
      `licenses=${sel.licenses}`,
      `website=${sel.website}`,
      `packages=${sel.packages.join(",")}`,
    ];
    appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
