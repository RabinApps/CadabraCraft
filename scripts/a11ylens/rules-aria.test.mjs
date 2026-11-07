// A11yLens rule tests: ARIA roles, states, relationships and custom widgets (static HTML rules).
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

const CHECKBOX = (extra) => `<div role="checkbox" tabindex="0" aria-label="c"${extra}>x</div>`;

runCases([
  {
    rule: "role-widget-name",
    severity: "error",
    bad: '<div role="tab" tabindex="0" aria-selected="false"></div>',
    good: [
      '<div role="tab" tabindex="0" aria-selected="false" aria-label="One"></div>',
      '<div role="tab" tabindex="0" aria-selected="false">One</div>',
    ],
  },
  {
    rule: "aria-role-invalid",
    severity: "error",
    bad: '<div role="banana">x</div>',
    good: '<div role="region" aria-label="Notes">x</div>',
  },
  {
    rule: "aria-role-invalid",
    severity: "error",
    bad: '<div role="widget">x</div>',
    good: '<div role="group" aria-label="Notes">x</div>',
  },
  {
    rule: "aria-hidden-focus",
    severity: "error",
    bad: '<div aria-hidden="true"><button>Go</button></div>',
    good: [
      '<div aria-hidden="true"><button tabindex="-1">Go</button></div>',
      '<div aria-hidden="true"><span>x</span></div>',
    ],
  },
  {
    rule: "aria-label-empty",
    severity: "warning",
    bad: '<div role="region" aria-label="">x</div>',
    good: '<div role="region" aria-label="Notes">x</div>',
  },
  {
    rule: "aria-labelledby-missing",
    severity: "warning",
    bad: '<div role="region" aria-labelledby="nope">x</div>',
    good: '<h2 id="t">T</h2><div role="region" aria-labelledby="t">x</div>',
  },
  {
    rule: "aria-describedby-missing",
    severity: "info",
    bad: '<button aria-describedby="nope">Go</button>',
    good: '<p id="d">Hint</p><button aria-describedby="d">Go</button>',
  },
  {
    rule: "aria-required-attr",
    severity: "error",
    bad: CHECKBOX(""),
    good: CHECKBOX(' aria-checked="false"'),
  },
  {
    rule: "aria-allowed-attr",
    severity: "warning",
    bad: '<div role="button" tabindex="0" aria-checked="true">x</div>',
    good: '<div role="button" tabindex="0" aria-pressed="true">x</div>',
  },
  {
    rule: "aria-unknown-attr",
    severity: "warning",
    bad: '<div aria-foo="x">x</div>',
    good: '<div aria-live="polite">x</div>',
  },
  {
    rule: "role-presentation-focusable",
    severity: "error",
    bad: '<button role="presentation">x</button>',
    good: '<div role="presentation">x</div>',
  },
  {
    rule: "interactive-role-focusable",
    severity: "warning",
    bad: '<div role="button" aria-label="x">x</div>',
    good: '<div role="button" tabindex="0" aria-label="x">x</div>',
  },
  {
    rule: "click-handler-noninteractive",
    severity: "warning",
    bad: '<div onclick="go()">x</div>',
    good: [
      '<button onclick="go()">x</button>',
      '<div onclick="go()" role="button" tabindex="0" onkeydown="k()">x</div>',
    ],
  },
  {
    rule: "dialog-name",
    severity: "warning",
    bad: '<div role="dialog">x</div>',
    good: [
      '<div role="dialog" aria-label="Settings">x</div>',
      '<dialog open aria-label="Settings">x</dialog>',
    ],
  },
  {
    rule: "dialog-name",
    severity: "warning",
    bad: "<dialog open>x</dialog>",
    good: '<h2 id="dt">Settings</h2><dialog open aria-labelledby="dt">x</dialog>',
  },
  {
    rule: "progress-name",
    severity: "warning",
    bad: '<div role="progressbar" aria-valuenow="3" aria-valuemin="0" aria-valuemax="10"></div>',
    good: '<div role="progressbar" aria-label="Export" aria-valuenow="3" aria-valuemin="0" aria-valuemax="10"></div>',
  },
  {
    rule: "progress-name",
    severity: "warning",
    bad: '<progress value="3" max="10"></progress>',
    good: '<progress value="3" max="10" aria-label="Export"></progress>',
  },
  {
    rule: "aria-required-children",
    severity: "warning",
    bad: '<div role="listbox" aria-label="t"><p>x</p></div>',
    good: '<div role="listbox" aria-label="t"><div role="option" aria-selected="false">x</div></div>',
  },
  {
    rule: "aria-required-children",
    severity: "warning",
    bad: '<div role="tablist" aria-label="t"><span>x</span></div>',
    good: '<div role="tablist" aria-label="t"><div role="tab" aria-selected="true" tabindex="0">One</div></div>',
  },
  {
    rule: "aria-valid-attr-value",
    severity: "error",
    bad: CHECKBOX(' aria-checked="maybe"'),
    good: CHECKBOX(' aria-checked="mixed"'),
  },
  {
    rule: "aria-idref-missing",
    severity: "warning",
    bad: '<button aria-controls="nope">x</button>',
    good: '<div id="p">Panel</div><button aria-controls="p">x</button>',
  },
  {
    rule: "aria-range",
    severity: "error",
    bad: '<div role="slider" tabindex="0" aria-label="s" aria-valuemin="10" aria-valuemax="5" aria-valuenow="7"></div>',
    good: '<div role="slider" tabindex="0" aria-label="s" aria-valuemin="0" aria-valuemax="10" aria-valuenow="7"></div>',
  },
]);
