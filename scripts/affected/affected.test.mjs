import assert from "node:assert/strict";
import test from "node:test";
import { select, summarize, withDependents } from "./affected.mjs";

// A small workspace shaped like the real one: the desktop app uses format and export-pdf; mcp uses export-pdf.
const ws = {
  dirs: {
    "apps/desktop": "@x/desktop",
    "apps/website": "@x/website",
    "packages/format": "@x/format",
    "packages/export-pdf": "@x/export-pdf",
    "packages/mcp": "@x/mcp",
    "packages/lonely": "@x/lonely",
  },
  deps: {
    "@x/desktop": ["@x/format", "@x/export-pdf"],
    "@x/website": [],
    "@x/format": [],
    "@x/export-pdf": ["@x/format"],
    "@x/mcp": ["@x/export-pdf"],
    "@x/lonely": [],
  },
};

test("withDependents walks the dependency edges in reverse, through several levels", () => {
  assert.deepEqual([...withDependents(["@x/format"], ws.deps)].sort(), [
    "@x/desktop",
    "@x/export-pdf",
    "@x/format",
    "@x/mcp",
  ]);
  assert.deepEqual([...withDependents(["@x/lonely"], ws.deps)], ["@x/lonely"]);
});

test("documentation, designs and agent settings need no test", () => {
  const sel = select(
    ["docs/testing.md", "design/cadabracraft.fig", "README.md", ".claude/skills/x/SKILL.md"],
    ws,
  );
  assert.equal(sel.full, false);
  assert.deepEqual(sel.packages, []);
  assert.equal(sel.rust || sel.e2e || sel.a11y || sel.webdriver, false);
});

test("a Rust-only change runs the Rust job and the WebDriver build, not the pages", () => {
  const sel = select(["apps/desktop/src-tauri/src/audio/m4b.rs"], ws);
  assert.equal(sel.rust, true);
  assert.equal(sel.webdriver, true);
  assert.equal(sel.e2e, false);
  assert.equal(sel.a11y, false);
  assert.deepEqual(sel.packages, []);
});

test("a change in a package the app uses runs that package, its dependents, and the app's pages", () => {
  const sel = select(["packages/export-pdf/src/typst.ts"], ws);
  assert.deepEqual(sel.packages, ["@x/desktop", "@x/export-pdf", "@x/mcp"]);
  assert.equal(sel.e2e, true);
  assert.equal(sel.a11y, true);
  assert.equal(sel.rust, false);
});

test("a change in a package nothing else uses runs only that package", () => {
  const sel = select(["packages/lonely/src/index.ts"], ws);
  assert.deepEqual(sel.packages, ["@x/lonely"]);
  assert.equal(sel.e2e, false);
});

test("the website does not reach the app", () => {
  const sel = select(["apps/website/src/lib/release.ts"], ws);
  assert.deepEqual(sel.packages, ["@x/website"]);
  assert.equal(sel.e2e || sel.rust, false);
});

test("a change to the app's sources, pages or e2e specs runs the pages and the accessibility sweeps", () => {
  for (const file of [
    "apps/desktop/src/app/App.tsx",
    "apps/desktop/e2e/images.spec.ts",
    "apps/desktop/index.html",
    "apps/desktop/public/logo.svg",
  ]) {
    const sel = select([file], ws);
    assert.equal(sel.e2e, true, file);
    assert.equal(sel.a11y, true, file);
    assert.deepEqual(sel.packages, ["@x/desktop"], file);
  }
});

test("a change that is only spec files runs just those specs", () => {
  const sel = select(["apps/desktop/e2e/find.spec.ts"], ws);
  assert.equal(sel.e2e, true);
  assert.deepEqual(sel.e2eSpecs, ["e2e/find.spec.ts"]);
  const both = select(["apps/desktop/e2e/paste.spec.ts", "apps/desktop/e2e/find.spec.ts"], ws);
  assert.deepEqual(both.e2eSpecs, ["e2e/find.spec.ts", "e2e/paste.spec.ts"]);
});

test("app sources, a used package or a spec helper keep the whole suite", () => {
  for (const file of [
    "apps/desktop/src/app/App.tsx",
    "apps/desktop/e2e/fixtures.ts",
    "apps/desktop/index.html",
    "packages/export-pdf/src/typst.ts",
  ]) {
    const sel = select(["apps/desktop/e2e/find.spec.ts", file], ws);
    assert.equal(sel.e2e, true, file);
    assert.deepEqual(sel.e2eSpecs, [], file);
  }
});

test("a full run names no specs, and the summary lists the ones selected", () => {
  assert.deepEqual(select([], ws).e2eSpecs, []);
  const files = ["apps/desktop/e2e/find.spec.ts"];
  assert.match(summarize(select(files, ws), files), /\| Playwright e2e \| e2e\/find\.spec\.ts \|/);
});

test("the native specs run only the WebDriver job", () => {
  const sel = select(["apps/desktop/e2e-native/driver.ts"], ws);
  assert.equal(sel.webdriver, true);
  assert.equal(sel.e2e || sel.rust || sel.a11y, false);
});

test("a global trigger selects everything, whatever else changed", () => {
  for (const file of [
    "pnpm-lock.yaml",
    "package.json",
    ".github/workflows/ci.yml",
    "scripts/coverage.mjs",
    "apps/desktop/playwright.config.ts",
    "apps/desktop/e2e/support/fakeTauri.ts",
    "tsconfig.base.json",
    "vitest.coverage.ts",
  ]) {
    const sel = select(["docs/a.md", file], ws);
    assert.equal(sel.full, true, file);
    assert.equal(sel.rust && sel.e2e && sel.a11y && sel.webdriver, true, file);
    assert.deepEqual(sel.packages, Object.values(ws.dirs).sort(), file);
  }
});

test("a file no rule knows selects everything", () => {
  const sel = select(["tools/new-thing/run.sh"], ws);
  assert.equal(sel.full, true);
  assert.match(sel.reasons[0], /not covered by any rule/);
});

test("no changed files, or a forced run, select everything", () => {
  assert.equal(select([], ws).full, true);
  const forced = select(["docs/a.md"], ws, { forceFull: true });
  assert.equal(forced.full, true);
  assert.deepEqual(forced.reasons, ["forced (full-ci)"]);
});

test("the summary says what would run and what would be skipped", () => {
  const files = ["apps/desktop/src-tauri/src/lib.rs"];
  const text = summarize(select(files, ws), files);
  assert.match(text, /1 changed file/);
  assert.match(text, /\| Rust \| run \|/);
  assert.match(text, /\| Playwright e2e \| skip \|/);
  assert.match(text, /\| Unit tests \| none \|/);
  const all = summarize(select([], ws), []);
  assert.match(all, /\*\*Everything\*\*/);
  assert.match(all, /\| Unit tests \| all packages \|/);
  const some = summarize(select(["packages/lonely/a.ts"], ws), ["packages/lonely/a.ts"]);
  assert.match(some, /\| Unit tests \| @x\/lonely \|/);
});

test("the license check runs only for manifests, lockfiles and the cargo-deny setup", () => {
  assert.equal(select(["packages/format/src/a.ts"], ws).licenses, false);
  assert.equal(select(["apps/desktop/src-tauri/src/audio/m4b.rs"], ws).licenses, false);
  assert.equal(select(["packages/format/package.json"], ws).licenses, true);
  assert.equal(select(["apps/desktop/src-tauri/Cargo.lock"], ws).licenses, true);
  assert.equal(select(["apps/desktop/src-tauri/deny.toml"], ws).licenses, true);
  assert.equal(
    select(["apps/desktop/src-tauri/licenses/THIRD_PARTY_NOTICES-rust.txt"], ws).licenses,
    true,
  );
  assert.equal(select(["docs/a.md"], ws).licenses, false);
  assert.equal(select([], ws).licenses, true);
});

test("scripts only the perf, design or release runs need no test; the a11y scripts run only the a11y job", () => {
  for (const file of [
    "scripts/perf/huge-book.ts",
    "scripts/design/sync.mjs",
    "scripts/set-version.mjs",
    ".github/workflows/pages.yml",
    ".github/workflows/perf-fuzz.yml",
    ".github/dependabot.yml",
    ".githooks/pre-commit",
    "brand/cadabracraft-icon.svg",
  ]) {
    const sel = select([file], ws);
    assert.equal(sel.full, false, file);
    assert.equal(sel.rust || sel.e2e || sel.a11y || sel.webdriver || sel.licenses, false, file);
    assert.deepEqual(sel.packages, [], file);
  }
  for (const file of ["scripts/a11y.sh", "scripts/a11ylens/gate.mjs", "scripts/fetch-ace.sh"]) {
    const sel = select([file], ws);
    assert.equal(sel.full, false, file);
    assert.equal(sel.a11y, true, file);
    assert.equal(sel.rust || sel.e2e || sel.webdriver, false, file);
  }
});

test("other scripts and the CI workflow files still select everything", () => {
  for (const file of [
    "scripts/cargo-test.sh",
    "scripts/fetch-typst.sh",
    ".github/workflows/ci.yml",
    ".github/workflows/release.yml",
    ".github/actions/setup-js/action.yml",
  ])
    assert.equal(select([file], ws).full, true, file);
});

test("the perf probe and the fuzz crate do not run the app's Rust or WebDriver jobs", () => {
  for (const file of [
    "apps/desktop/src-tauri/tools/perf/src/main.rs",
    "apps/desktop/src-tauri/fuzz/fuzz_targets/a.rs",
  ]) {
    const sel = select([file], ws);
    assert.equal(sel.rust || sel.webdriver, false, file);
  }
  assert.equal(select(["apps/desktop/src-tauri/tools/perf/Cargo.lock"], ws).licenses, true);
});

test("the website build runs only when the website changed", () => {
  assert.equal(select(["apps/website/src/lib/release.ts"], ws).website, true);
  assert.equal(select(["packages/format/src/a.ts"], ws).website, false);
  assert.equal(select(["docs/a.md"], ws).website, false);
  assert.equal(select([], ws).website, true);
});

test("the external tools and the exporter validators follow the exporter packages", () => {
  // In this workspace export-pdf and mcp drive tools; format is used by export-pdf, so it reaches them.
  const pdf = select(["packages/export-pdf/src/typst.ts"], ws);
  assert.equal(pdf.tools, true);
  assert.equal(pdf.a11yTools, true);
  const format = select(["packages/format/src/a.ts"], ws);
  assert.equal(format.tools && format.a11yTools, true);
  // mcp drives tools in its tests but is no exporter: no validators.
  const mcp = select(["packages/mcp/src/server.ts"], ws);
  assert.equal(mcp.tools, true);
  assert.equal(mcp.a11yTools, false);
  // App pages and unrelated packages need neither.
  for (const file of [
    "apps/desktop/src/app/App.tsx",
    "packages/lonely/src/a.ts",
    "apps/website/src/a.ts",
  ]) {
    const sel = select([file], ws);
    assert.equal(sel.tools || sel.a11yTools, false, file);
  }
  assert.equal(select(["apps/desktop/src/app/App.tsx"], ws).a11yPages, true);
  assert.equal(select(["apps/desktop/src/app/App.tsx"], ws).a11y, true);
});

test("the validator scripts run only the validators, a11y.sh runs both parts, a full run all", () => {
  const ace = select(["scripts/fetch-ace.sh"], ws);
  assert.equal(ace.a11yTools && !ace.a11yPages, true);
  const sh = select(["scripts/a11y.sh"], ws);
  assert.equal(sh.a11yTools && sh.a11yPages, true);
  const full = select([], ws);
  assert.equal(full.a11yTools && full.a11yPages && full.tools, true);
});
