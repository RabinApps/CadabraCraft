// A11yLens rule tests: document, headings, landmarks, lists, tables, links, media (static HTML rules).
import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, scanJson } from "./run.mjs";

/** A clean HTML page; `body` starts on line 8. Document-level cases pass whole files instead. */
const page = (body, head = "") =>
  `<!doctype html>\n<html lang="en">\n<head><title>T</title>${head}</head>\n<body>\n<a href="#main">Skip to content</a>\n<main id="main">\n<h1>Title</h1>\n${body}\n</main>\n</body>\n</html>\n`;
/** A whole HTML document with no skip link or main landmark added; line 1 is the doctype. */
const doc = (head, body) =>
  `<!doctype html><html lang="en"><head><title>T</title>${head}</head><body>${body}</body></html>`;
const SKIP_MAIN = '<a href="#m">Skip</a><main id="m"><h1>x</h1></main>';
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

const docCase = (rule, head, body, good) => ({
  rule,
  severity: "error",
  line: 1,
  bad: { "index.html": doc(head, body) },
  good,
});

runCases([
  {
    rule: "html-lang",
    severity: "error",
    line: 1,
    bad: {
      "index.html": `<!doctype html><html><head><title>T</title></head><body>${SKIP_MAIN}</body></html>`,
    },
    good: { "index.html": doc("", SKIP_MAIN) },
  },
  {
    rule: "html-lang",
    severity: "error",
    line: 1,
    bad: {
      "index.html": `<!doctype html><html lang="zz-bogus-1"><head><title>T</title></head><body>${SKIP_MAIN}</body></html>`,
    },
    good: { "index.html": doc("", SKIP_MAIN) },
  },
  {
    rule: "document-title",
    severity: "error",
    line: 1,
    bad: {
      "index.html": `<!doctype html><html lang="en"><head></head><body>${SKIP_MAIN}</body></html>`,
    },
    good: { "index.html": doc("", SKIP_MAIN) },
  },
  docCase(
    "meta-viewport-zoom",
    '<meta name="viewport" content="width=device-width, user-scalable=no">',
    SKIP_MAIN,
    [
      {
        "index.html": doc(
          '<meta name="viewport" content="width=device-width, initial-scale=1">',
          SKIP_MAIN,
        ),
      },
    ],
  ),
  docCase(
    "meta-viewport-zoom",
    '<meta name="viewport" content="width=device-width, maximum-scale=1">',
    SKIP_MAIN,
    [
      {
        "index.html": doc(
          '<meta name="viewport" content="width=device-width, initial-scale=1">',
          SKIP_MAIN,
        ),
      },
    ],
  ),
  docCase("meta-refresh", '<meta http-equiv="refresh" content="5;url=b.html">', SKIP_MAIN, [
    { "index.html": doc("", SKIP_MAIN) },
  ]),
  {
    rule: "aria-hidden-body",
    severity: "error",
    line: 1,
    bad: {
      "index.html": `<!doctype html><html lang="en"><head><title>T</title></head><body aria-hidden="true">${SKIP_MAIN}</body></html>`,
    },
    good: { "index.html": doc("", SKIP_MAIN) },
  },
  {
    rule: "landmark-main",
    severity: "warning",
    line: 1,
    bad: { "index.html": doc("", '<a href="#c">Skip</a><div id="c"><h1>x</h1></div>') },
    good: { "index.html": doc("", SKIP_MAIN) },
  },
  {
    rule: "skip-link",
    severity: "warning",
    line: 1,
    bad: { "index.html": doc("", "<main><h1>x</h1><p>p</p></main>") },
    good: { "index.html": doc("", SKIP_MAIN) },
  },
  {
    rule: "page-h1",
    severity: "info",
    line: 1,
    bad: { "index.html": doc("", '<a href="#m">Skip</a><main id="m"><h2>x</h2></main>') },
    good: { "index.html": doc("", SKIP_MAIN) },
  },
  {
    rule: "duplicate-id",
    severity: "warning",
    bad: '<p id="a">x</p><p id="a">y</p>',
    good: '<p id="a">x</p><p id="b">y</p>',
  },
  {
    rule: "tabindex-positive",
    severity: "warning",
    bad: '<button tabindex="3">x</button>',
    good: ['<button tabindex="0">x</button>', '<div tabindex="-1">x</div>'],
  },
  {
    rule: "landmark-unique",
    severity: "info",
    bad: '<nav><a href="#main">Alpha page</a></nav><nav><a href="#main">Beta page</a></nav>',
    good: '<nav aria-label="Primary"><a href="#main">Alpha page</a></nav><nav aria-label="Footer"><a href="#main">Beta page</a></nav>',
  },
  {
    rule: "nav-label",
    severity: "warning",
    bad: '<nav><a href="a.html">Alpha</a></nav><nav><a href="b.html">Beta</a></nav>',
    good: [
      '<nav><a href="a.html">Alpha</a></nav>',
      '<nav aria-label="One"><a href="a.html">Alpha</a></nav><nav aria-label="Two"><a href="b.html">Beta</a></nav>',
    ],
  },
  {
    rule: "heading-order",
    severity: "warning",
    bad: "<h3>Skipped</h3>",
    good: "<h2>Section</h2><h3>Sub</h3>",
  },
  {
    rule: "heading-empty",
    severity: "error",
    bad: "<h2></h2>",
    good: "<h2>Section</h2>",
  },
  {
    rule: "list-structure",
    severity: "warning",
    bad: "<ul><div>x</div></ul>",
    good: ["<ul><li>x</li></ul>", "<ol><li>x</li><li>y</li></ol>"],
  },
  {
    rule: "table-headers",
    severity: "warning",
    bad: "<table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>",
    good: '<table><caption>c</caption><tr><th scope="col">a</th></tr><tr><td>b</td></tr></table>',
  },
  {
    rule: "table-caption",
    severity: "info",
    bad: '<table><tr><th scope="col">a</th></tr><tr><td>b</td></tr></table>',
    good: [
      '<table><caption>c</caption><tr><th scope="col">a</th></tr><tr><td>b</td></tr></table>',
      '<table aria-label="Totals"><tr><th scope="col">a</th></tr><tr><td>b</td></tr></table>',
    ],
  },
  {
    rule: "th-scope",
    severity: "info",
    bad: "<table><caption>c</caption><tr><th>a</th></tr><tr><td>b</td></tr></table>",
    good: '<table><caption>c</caption><tr><th scope="col">a</th></tr><tr><td>b</td></tr></table>',
  },
  {
    rule: "th-empty",
    severity: "warning",
    bad: '<table><caption>c</caption><tr><th scope="col"></th></tr><tr><td>b</td></tr></table>',
    good: '<table><caption>c</caption><tr><th scope="col">a</th></tr><tr><td>b</td></tr></table>',
  },
  {
    rule: "link-name",
    severity: "error",
    bad: '<a href="#main"></a>',
    good: ['<a href="#main" aria-label="Home"></a>', '<a href="#main">Home</a>'],
  },
  {
    rule: "link-vague",
    severity: "warning",
    bad: '<a href="#main">click here</a>',
    good: '<a href="#main">Read the style guide</a>',
  },
  {
    rule: "link-placeholder-href",
    severity: "info",
    bad: '<a href="#">Top thing</a>',
    good: '<a href="#main">Top thing</a>',
  },
  {
    rule: "link-target-blank",
    severity: "info",
    bad: '<a href="https://example.com" target="_blank">Docs page</a>',
    good: '<a href="https://example.com" target="_blank" rel="noopener">Docs page (opens in a new window)</a>',
  },
  {
    rule: "anchor-target-missing",
    severity: "warning",
    bad: '<a href="#nowhere">Jump to part</a>',
    good: '<a href="#main">Jump to part</a>',
  },
  {
    rule: "link-same-text",
    severity: "info",
    bad: '<a href="a.html">Read more about it</a><a href="b.html">Read more about it</a>',
    good: '<a href="a.html">Read more about cats</a><a href="b.html">Read more about dogs</a>',
  },
  {
    rule: "video-captions",
    severity: "warning",
    bad: '<video src="a.mp4" controls></video>',
    good: '<video src="a.mp4" controls><track kind="captions" src="a.vtt" srclang="en" label="English"></video>',
  },
  {
    rule: "audio-transcript",
    severity: "info",
    bad: '<audio src="a.mp3" controls></audio>',
    good: '<audio src="a.mp3" controls></audio><p><a href="transcript.html">Read the transcript</a></p>',
  },
  {
    rule: "media-autoplay",
    severity: "warning",
    bad: '<video src="a.mp4" autoplay controls><track kind="captions" src="a.vtt"></video>',
    good: '<video src="a.mp4" autoplay muted loop controls><track kind="captions" src="a.vtt"></video>',
  },
  {
    rule: "media-controls",
    severity: "info",
    bad: '<video src="a.mp4"><track kind="captions" src="a.vtt"></video>',
    good: '<video src="a.mp4" controls><track kind="captions" src="a.vtt"></video>',
  },
  {
    rule: "marquee-blink",
    severity: "error",
    bad: "<marquee>x</marquee>",
    good: "<p>x</p>",
  },
]);
