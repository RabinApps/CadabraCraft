// A11yLens rule tests: form labels, groups, autocomplete and name-matching (static HTML rules).
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

const EMAIL = '<label for="e">Email</label><input id="e" type="email" name="email"';
const FORM = (extra = "") =>
  `<form><label for="q">Q</label><input id="q"><button>Go</button>${extra}</form>`;

runCases([
  {
    rule: "form-label",
    severity: "error",
    bad: '<input type="text" name="q">',
    good: [
      '<label for="q">Search</label><input id="q" type="text">',
      '<label>Search <input type="text"></label>',
      '<input type="text" aria-label="Search">',
    ],
  },
  {
    rule: "form-placeholder-label",
    severity: "warning",
    bad: '<input type="text" placeholder="Search">',
    good: '<label for="q">Search</label><input id="q" type="text" placeholder="Find a word">',
  },
  {
    rule: "label-for-missing",
    severity: "warning",
    bad: '<label for="zzz">Search</label>',
    good: '<label for="q">Search</label><input id="q">',
  },
  {
    rule: "label-empty",
    severity: "warning",
    bad: '<label for="q"></label><input id="q" aria-label="q">',
    good: '<label for="q">Search</label><input id="q">',
  },
  {
    rule: "input-button-name",
    severity: "error",
    bad: '<input type="submit" value="">',
    good: ['<input type="submit" value="Save">', '<input type="button" value="Open">'],
  },
  {
    rule: "fieldset-legend",
    severity: "warning",
    bad: '<input type="radio" name="a" aria-label="A"><input type="radio" name="a" aria-label="B">',
    good: '<fieldset><legend>Pick</legend><input type="radio" name="a" aria-label="A"><input type="radio" name="a" aria-label="B"></fieldset>',
  },
  {
    rule: "fieldset-legend-missing",
    severity: "warning",
    bad: '<fieldset><input type="text" aria-label="A"></fieldset>',
    good: '<fieldset><legend>Name</legend><input type="text" aria-label="A"></fieldset>',
  },
  {
    rule: "autocomplete-missing",
    severity: "info",
    bad: `${EMAIL}>`,
    good: `${EMAIL} autocomplete="email">`,
  },
  {
    rule: "autocomplete-invalid",
    severity: "warning",
    bad: `${EMAIL} autocomplete="bogus-token">`,
    good: `${EMAIL} autocomplete="email">`,
  },
  {
    rule: "form-live-region",
    severity: "info",
    bad: FORM(),
    good: [FORM('<div role="status"></div>'), FORM('<div aria-live="polite"></div>')],
  },
  {
    rule: "label-in-name",
    severity: "warning",
    bad: '<button aria-label="Submit form now">Save</button>',
    good: ['<button aria-label="Save draft">Save</button>', "<button>Save</button>"],
  },
]);
