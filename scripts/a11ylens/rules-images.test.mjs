// A11yLens rule tests: images, SVG, buttons and embedded content names (static HTML rules).
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

runCases([
  {
    rule: "img-alt",
    severity: "error",
    bad: "<img src=a.png>",
    good: ['<img src="a.png" alt="A cat">', '<img src="a.png" alt="">'],
  },
  {
    rule: "img-alt-filename",
    severity: "warning",
    bad: '<img src="a.png" alt="photo.jpg">',
    good: '<img src="a.png" alt="A cat on a sofa">',
  },
  {
    rule: "img-alt-redundant",
    severity: "info",
    bad: '<img src="a.png" alt="image of a cat">',
    good: '<img src="a.png" alt="A cat on a sofa">',
  },
  {
    rule: "svg-name",
    severity: "warning",
    bad: '<svg width="10" height="10"><circle r="3"/></svg>',
    good: [
      '<svg width="10" height="10" aria-hidden="true"><circle r="3"/></svg>',
      '<svg width="10" height="10" role="img" aria-label="Dot"><circle r="3"/></svg>',
    ],
  },
  {
    rule: "button-name",
    severity: "error",
    bad: "<button></button>",
    good: ["<button>Go</button>", '<button aria-label="Go"></button>'],
  },
  {
    rule: "role-img-name",
    severity: "error",
    bad: '<div role="img"></div>',
    good: '<div role="img" aria-label="Chart of sales"></div>',
  },
  {
    rule: "input-image-alt",
    severity: "error",
    bad: '<input type="image" src="a.png">',
    good: '<input type="image" src="a.png" alt="Search">',
  },
  {
    rule: "area-alt",
    severity: "error",
    bad: '<map name="m"><area shape="rect" coords="0,0,1,1" href="#main"></map>',
    good: '<map name="m"><area shape="rect" coords="0,0,1,1" href="#main" alt="Top"></map>',
  },
  {
    rule: "object-name",
    severity: "warning",
    bad: '<object data="a.pdf"></object>',
    good: '<object data="a.pdf" title="Manual"></object>',
  },
  {
    rule: "iframe-title",
    severity: "error",
    bad: '<iframe src="a.html"></iframe>',
    good: '<iframe src="a.html" title="Embed"></iframe>',
  },
]);
