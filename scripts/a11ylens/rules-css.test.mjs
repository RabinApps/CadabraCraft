// A11yLens rule tests: stylesheet rules (focus outline, reduced motion, order, static contrast).
import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, scanJson } from "./run.mjs";

/** A clean HTML page; `body` starts on line 8. Document-level cases pass whole files instead. */
const page = (body, head = "") =>
  `<!doctype html>\n<html lang="en">\n<head><title>T</title>${head}</head>\n<body>\n<a href="#main">Skip to content</a>\n<main id="main">\n<h1>Title</h1>\n${body}\n</main>\n</body>\n</html>\n`;
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

const LINK = '<link rel="stylesheet" href="s.css">';
const withCss = (css, body = '<button>Go</button><p class="t">Text</p>') => ({
  "index.html": page(body, LINK),
  "s.css": css,
});
const RM = "@media (prefers-reduced-motion: reduce) { .a { transition: none; } }\n";

runCases([
  {
    rule: "css-focus-outline",
    severity: "warning",
    file: "s.css",
    line: 1,
    bad: withCss("button:focus { outline: none; }\n"),
    good: [
      withCss("button:focus { outline: none; box-shadow: 0 0 0 3px #00f; }\n"),
      withCss("button:focus-visible { outline: 2px solid #00f; }\n"),
    ],
  },
  {
    rule: "css-focus-outline",
    severity: "warning",
    file: "s.css",
    line: 3,
    bad: withCss("a { color: #00f }\n\n*:focus { outline: 0 }\n"),
    good: withCss("a { color: #00f }\n\n*:focus-visible { outline: 2px solid #00f }\n"),
  },
  {
    rule: "css-focus-outline",
    severity: "warning",
    file: "index.html",
    line: 4,
    bad: {
      "index.html": page(
        "<button>Go</button>",
        "<style>\nbutton:focus { outline: none; }\n</style>",
      ),
    },
    good: {
      "index.html": page(
        "<button>Go</button>",
        "<style>\nbutton:focus { outline: 2px solid #00f; }\n</style>",
      ),
    },
  },
  {
    rule: "css-reduced-motion",
    severity: "info",
    file: "s.css",
    line: 1,
    bad: withCss(".a { transition: color 1s; }\n"),
    good: withCss(`.a { transition: color 1s; }\n${RM}`),
  },
  {
    rule: "css-order",
    severity: "info",
    file: "s.css",
    line: 2,
    bad: withCss(".a { display: flex; }\n.t { order: 2; }\n"),
    good: withCss(".a { display: flex; }\n.t { margin: 0; }\n"),
  },
  {
    rule: "css-contrast",
    severity: "warning",
    bad: withCss(".t { color: #aaa; background: #fff; }\n"),
    good: withCss(".t { color: #222; background: #fff; }\n"),
  },
  {
    rule: "css-contrast",
    severity: "warning",
    bad: withCss(".t { color: #999; background: #fff; font-size: 30px; }\n"),
    good: withCss(".t { color: #767676; background: #fff; font-size: 30px; }\n"),
  },
  {
    rule: "css-contrast",
    severity: "warning",
    bad: { "index.html": page('<p style="color:#bbb;background:#fff">Pale</p>') },
    good: { "index.html": page('<p style="color:#222;background:#fff">Dark</p>') },
  },
  {
    rule: "css-contrast",
    severity: "warning",
    line: 10,
    bad: {
      "index.html": page(
        '<p class="t">Pale</p>',
        "<style>\n.t { color: #bbb; background: #fff; }\n</style>",
      ),
    },
    good: {
      "index.html": page(
        '<p class="t">Dark</p>',
        "<style>\n.t { color: #222; background: #fff; }\n</style>",
      ),
    },
  },
]);
