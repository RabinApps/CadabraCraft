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
