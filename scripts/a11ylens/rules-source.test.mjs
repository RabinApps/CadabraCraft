// A11yLens rule tests: component source rules for React (.tsx), Vue, Svelte and Astro files.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, scanJson } from "./run.mjs";

/** A clean HTML page; `body` starts on line 8. Document-level cases pass whole files instead. */
const page = (body, head = "") =>
  `<!doctype html>\n<html lang="en">\n<head><title>T</title>${head}</head>\n<body>\n<a href="#main">Skip to content</a>\n<main id="main">\n<h1>Title</h1>\n${body}\n</main>\n</body>\n</html>\n`;
/** A TSX component whose JSX body starts on line 4. */
const tsx = (body) =>
  `export function C() {\n  return (\n    <div>\n${body}\n    </div>\n  );\n}\n`;
const asFiles = (x) => (typeof x === "string" ? { "index.html": page(x) } : x);

function findings(x) {
  const dir = fixture(asFiles(x));
  const { report, stderr } = scanJson([dir, "--fail-on", "none"]);
  assert.ok(report, `no JSON report: ${stderr}`);
  return report.findings;
}

/** Each case: { rule, severity, bad, good, line = 8, file = "index.html" }; bad/good are a body string or a files map. */
function runCases(cases) {
  for (const c of cases) {
    const { rule, severity, line = 8, file = "index.html" } = c;
    test(`${rule}: flags the known-bad fixture`, () => {
      const hits = findings(c.bad).filter((f) => f.ruleId === rule);
      assert.ok(hits.length > 0, `expected ${rule}`);
      assert.ok(
        hits.every((f) => f.severity === severity),
        `severity should be ${severity}`,
      );
      assert.ok(
        hits.some((f) => f.file === file && f.line === line),
        `expected ${rule} at ${file}:${line}, got ${hits.map((f) => `${f.file}:${f.line}`).join(", ")}`,
      );
    });
    [].concat(c.good).forEach((good, i) => {
      test(`${rule}: stays quiet on known-good fixture ${i + 1}`, () => {
        const hits = findings(good).filter((f) => f.ruleId === rule);
        assert.deepEqual(
          hits.map((f) => `${f.file}:${f.line}`),
          [],
        );
      });
    });
  }
}

const T = (body) => ({ "src/C.tsx": tsx(body) });
const vue = (body) => ({ "src/C.vue": `<template>\n${body}\n</template>\n` });
const svelte = (body) => ({ "src/C.svelte": `${body}\n` });
const astro = (body) => ({ "src/C.astro": `---\nconst a = 1;\n---\n${body}\n` });

/** Cases for one rule across frameworks; line is where the bad tag sits in each wrapper. */
const tsxRule = (rule, severity, bad, good) => ({
  rule,
  severity,
  file: "src/C.tsx",
  line: 4,
  bad: T(bad),
  good: [].concat(good).map(T),
});

runCases([
  tsxRule("src-img-alt", "error", '<img src="a.png" />', [
    '<img src="a.png" alt="" />',
    '<img src="a.png" alt="A cat" />',
    "<img {...rest} />",
  ]),
  {
    rule: "src-img-alt",
    severity: "error",
    file: "src/C.vue",
    line: 2,
    bad: vue('<img src="a.png">'),
    good: vue('<img src="a.png" alt="A">'),
  },
  {
    rule: "src-img-alt",
    severity: "error",
    file: "src/C.svelte",
    line: 1,
    bad: svelte('<img src="a.png">'),
    good: svelte('<img src="a.png" alt="A">'),
  },
  {
    rule: "src-img-alt",
    severity: "error",
    file: "src/C.astro",
    line: 4,
    bad: astro('<img src="a.png">'),
    good: astro('<img src="a.png" alt="A">'),
  },
  tsxRule("src-image-component", "warning", '<Image src="a.png" />', [
    '<Image src="a.png" alt="A" />',
    "<Image {...p} />",
  ]),
  tsxRule("src-anchor-href", "warning", "<a onClick={go}>Go</a>", [
    '<a href="/x">Go</a>',
    "<a {...rest}>Go</a>",
  ]),
  tsxRule("src-click-noninteractive", "error", "<div onClick={go}>Go</div>", [
    "<button onClick={go}>Go</button>",
    '<div onClick={go} onKeyDown={k} role="button" tabIndex={0}>Go</div>',
  ]),
  {
    rule: "src-click-noninteractive",
    severity: "error",
    file: "src/C.vue",
    line: 2,
    bad: vue('<div @click="go">x</div>'),
    good: vue('<button @click="go">x</button>'),
  },
  {
    rule: "src-click-noninteractive",
    severity: "error",
    file: "src/C.svelte",
    line: 1,
    bad: svelte("<div on:click={go}>x</div>"),
    good: svelte("<button on:click={go}>x</button>"),
  },
  {
    rule: "src-click-noninteractive",
    severity: "error",
    file: "src/C.astro",
    line: 4,
    bad: astro('<div onclick="go()">x</div>'),
    good: astro('<button onclick="go()">x</button>'),
  },
  tsxRule("src-icon-button", "error", "<button onClick={go}><svg /></button>", [
    '<button aria-label="Close" onClick={go}><svg /></button>',
    "<button>Close<svg /></button>",
    '<button title="Close"><svg /></button>',
  ]),
  tsxRule(
    "src-icon-button",
    "error",
    "<button onClick={go}></button>",
    '<button aria-labelledby="t" onClick={go}></button>',
  ),
  {
    rule: "src-icon-button",
    severity: "error",
    file: "src/C.vue",
    line: 2,
    bad: vue('<button @click="go"><svg /></button>'),
    good: vue('<button aria-label="Close" @click="go"><svg /></button>'),
  },
  {
    rule: "src-icon-button",
    severity: "error",
    file: "src/C.astro",
    line: 4,
    bad: astro("<button><svg /></button>"),
    good: astro('<button aria-label="Close"><svg /></button>'),
  },
  tsxRule("src-label-for", "info", "<label>Name</label>", '<label htmlFor="n">Name</label>'),
  tsxRule("src-tabindex-positive", "warning", "<div tabIndex={2}>x</div>", [
    "<div tabIndex={0}>x</div>",
    "<div tabIndex={-1}>x</div>",
  ]),
  tsxRule(
    "src-autofocus",
    "info",
    '<input autoFocus aria-label="q" />',
    '<input aria-label="q" />',
  ),
  tsxRule(
    "src-dangerous-html",
    "info",
    "<div dangerouslySetInnerHTML={{ __html: h }} />",
    "<div>{h}</div>",
  ),
  {
    rule: "src-v-html",
    severity: "info",
    file: "src/C.vue",
    line: 2,
    bad: vue('<div v-html="h"></div>'),
    good: vue("<div>{{ h }}</div>"),
  },
  {
    rule: "src-svelte-html",
    severity: "info",
    file: "src/C.svelte",
    line: 2,
    bad: svelte("<div>\n  {@html h}\n</div>"),
    good: svelte("<div>{h}</div>"),
  },
  tsxRule("src-dialog-name", "info", "<Dialog open>x</Dialog>", [
    '<Dialog open aria-label="Settings">x</Dialog>',
    '<Dialog open aria-labelledby="t">x</Dialog>',
    "<Dialog {...props}>x</Dialog>",
  ]),
  tsxRule(
    "src-role-button-focus",
    "warning",
    '<div role="button" onClick={go}>x</div>',
    '<div role="button" tabIndex={0} onKeyDown={k}>x</div>',
  ),
]);

test("src-click-noninteractive: also reports role=button without a key handler, with a specific message", () => {
  const hit = findings(T('<div role="button" tabIndex={0} onClick={go}>x</div>')).find(
    (f) => f.ruleId === "src-click-noninteractive",
  );
  assert.ok(hit);
  assert.match(hit.message, /no keyboard handler/);
});

test("source rules skip .js files unless --scan-js is given", () => {
  const dir = fixture({
    "index.html": page("<p>x</p>"),
    "src/d.js": 'export const x = <img src="a" />;\n',
  });
  const off = scanJson([dir, "--fail-on", "none"]).report;
  assert.deepEqual(off.files.source, []);
  assert.equal(off.findings.filter((f) => f.ruleId === "src-img-alt").length, 0);
  const on = scanJson([dir, "--fail-on", "none", "--scan-js"]).report;
  assert.deepEqual(on.files.source, ["src/d.js"]);
  assert.ok(
    on.findings.some((f) => f.ruleId === "src-img-alt" && f.file === "src/d.js" && f.line === 1),
  );
});
