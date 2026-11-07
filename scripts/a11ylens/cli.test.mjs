// CLI contract tests for A11yLens: exit codes, commands, report formats, filters, config and baseline.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { fixture, lens, scanJson } from "./run.mjs";

const CLEAN =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Clean</title></head>' +
  '<body><a href="#main">Skip to main content</a><main id="main"><h1>Hello</h1><p>Text</p></main></body></html>';
// 4 errors (button-name, document-title, html-lang, img-alt), 3 warnings, 1 info; score 86.
const BROKEN =
  '<!doctype html><html><head></head><body><img src="a.png"><div onclick="x()">go</div><button></button></body></html>';
const ERROR_RULES = ["button-name", "document-title", "html-lang", "img-alt"];

const clean = () => fixture({ "index.html": CLEAN });
const broken = () => fixture({ "index.html": BROKEN });
const ruleIds = (report) => report.findings.map((f) => f.ruleId).sort();

describe("exit codes", () => {
  test("0 for a clean page", () => {
    const { status, report } = scanJson([clean()]);
    assert.equal(status, 0);
    assert.equal(report.findings.length, 0);
    assert.equal(report.score, 100);
  });

  test("1 for a broken page", () => {
    const { status, report } = scanJson([broken()]);
    assert.equal(status, 1);
    assert.deepEqual(report.summary.errors, 4);
    assert.deepEqual(report.summary.warnings, 3);
    assert.deepEqual(report.summary.infos, 1);
    assert.deepEqual(
      ruleIds(report).filter((id) => ERROR_RULES.includes(id)),
      ERROR_RULES,
    );
  });

  test("2 for a missing path", () => {
    const r = lens(["/definitely/not/here"]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /Target not found/);
  });

  test("2 for a directory without scannable files", () => {
    const r = lens([fixture({ "notes.txt": "hi" })]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /No HTML, component, CSS/);
  });

  test("2 for an unknown flag", () => {
    const r = lens([clean(), "--bogus"]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /Unknown option --bogus/);
  });

  test("2 for a value flag without a value", () => {
    const r = lens([clean(), "--fail-on"]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /--fail-on needs a value/);
  });

  test("--help and --version exit 0", () => {
    const h = lens(["--help"]);
    assert.equal(h.status, 0);
    assert.match(h.stdout, /EXIT CODES/);
    const v = lens(["--version"]);
    assert.equal(v.status, 0);
    assert.match(v.stdout, /^A11yLens \d+\.\d+\.\d+/);
  });

  test("a single HTML file can be scanned", () => {
    const dir = fixture({ "a.html": BROKEN, "b.html": CLEAN });
    const { report } = scanJson([join(dir, "b.html")]);
    assert.equal(report.findings.length, 0);
    assert.deepEqual(report.files.html, ["b.html"]);
  });
});

describe("rules", () => {
  test("lists every rule as JSON with the documented keys", () => {
    const r = lens(["rules", "--json"]);
    assert.equal(r.status, 0);
    const rules = JSON.parse(r.stdout);
    assert.equal(rules.length, 95);
    assert.equal(new Set(rules.map((x) => x.id)).size, 95);
    for (const key of [
      "id",
      "title",
      "category",
      "severity",
      "wcag",
      "level",
      "description",
      "renderOnly",
    ]) {
      assert.ok(key in rules[0], key);
    }
    assert.match(lens(["rules"]).stdout, /95 checks/);
  });

  test("filters by category", () => {
    const rules = JSON.parse(lens(["rules", "images", "--json"]).stdout);
    assert.ok(rules.length > 1);
    assert.ok(rules.every((x) => x.category === "images"));
    assert.ok(rules.some((x) => x.id === "img-alt"));
  });

  test("filters by id prefix and exact id", () => {
    const prefixed = JSON.parse(lens(["rules", "img-", "--json"]).stdout);
    assert.deepEqual(prefixed.map((x) => x.id).sort(), [
      "img-alt",
      "img-alt-filename",
      "img-alt-redundant",
    ]);
    const exact = JSON.parse(lens(["rules", "img-alt", "--json"]).stdout);
    assert.equal(exact.length, 3, "exact id also matches as a prefix");
  });

  test("an unknown filter exits 2", () => {
    const r = lens(["rules", "nope"]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /No rule matches "nope"/);
  });
});

describe("explain, manual, doctor", () => {
  test("explain describes a known rule", () => {
    const r = lens(["explain", "img-alt"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /ID:\s+img-alt/);
    assert.match(r.stdout, /WCAG:\s+1\.1\.1/);
    assert.match(r.stdout, /Screen reader impact/);
  });

  test("explain exits 2 for an unknown or missing rule", () => {
    const unknown = lens(["explain", "nope"]);
    assert.equal(unknown.status, 2);
    assert.match(unknown.stderr, /Unknown rule "nope"/);
    const missing = lens(["explain"]);
    assert.equal(missing.status, 2);
    assert.match(missing.stderr, /Usage: a11ylens explain/);
  });

  test("manual prints the full protocol", () => {
    const r = lens(["manual"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /manual screen reader test plan/);
    assert.match(r.stdout, /FULL PROTOCOL/);
  });

  test("manual --findings is limited to the findings of a project", () => {
    const r = lens(["manual", broken(), "--findings"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /CHECKS FOR THE FINDINGS IN THIS REPORT/);
    assert.match(r.stdout, /\[ERROR\] button-name/);
    assert.doesNotMatch(r.stdout, /FULL PROTOCOL/);
  });

  test("manual --findings without a source exits 2", () => {
    const r = lens(["manual", "--findings"]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /needs a project path or --from/);
  });

  test("manual --from reads a saved JSON report", () => {
    const dir = broken();
    const out = join(dir, "r.json");
    scanJson([dir, "-o", out]);
    const r = lens(["manual", "--from", out, "--findings"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /img-alt/);
  });

  test("doctor reports versions and the config state", () => {
    const withConfig = fixture({ ".a11ylensrc.json": "{}" });
    const r = lens(["doctor"], withConfig);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /A11yLens doctor/);
    assert.match(r.stdout, /Node\.js/);
    assert.match(r.stdout, /axe-core — \d+\./);
    assert.match(r.stdout, /Config file — .*\.a11ylensrc\.json/);
    assert.match(lens(["doctor"], fixture({ "x.txt": "" })).stdout, /Config file — none found/);
  });
});

describe("init", () => {
  test("creates .a11ylensrc.json that the scanner accepts", () => {
    const dir = fixture({ "index.html": CLEAN });
    const r = lens(["init", dir]);
    assert.equal(r.status, 0);
    const config = JSON.parse(readFileSync(join(dir, ".a11ylensrc.json"), "utf8"));
    assert.equal(config.failOn, "error");
    assert.deepEqual(config.ignoreRules, []);
    assert.ok(Array.isArray(config.exclude));
    assert.equal(scanJson([dir]).status, 0);
  });

  test("does not clobber an existing config without --force", () => {
    const dir = fixture({ ".a11ylensrc.json": '{"failOn":"warning"}' });
    const r = lens(["init", dir]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /already exists/);
    assert.equal(readFileSync(join(dir, ".a11ylensrc.json"), "utf8"), '{"failOn":"warning"}');
    assert.equal(lens(["init", dir, "--force"]).status, 0);
    assert.equal(JSON.parse(readFileSync(join(dir, ".a11ylensrc.json"), "utf8")).failOn, "error");
  });
});

describe("report formats", () => {
  test("json has the documented top-level keys", () => {
    const { report } = scanJson([broken()]);
    for (const key of [
      "tool",
      "root",
      "files",
      "pages",
      "findings",
      "errors",
      "summary",
      "score",
      "config",
      "truncated",
      "rulesExecuted",
    ]) {
      assert.ok(key in report, key);
    }
    assert.equal(report.tool.name, "A11yLens");
    assert.equal(report.score, report.summary.score);
    assert.equal(report.summary.total, report.findings.length);
    const f = report.findings[0];
    for (const key of [
      "id",
      "ruleId",
      "severity",
      "message",
      "file",
      "line",
      "wcag",
      "helpUrl",
      "srImpact",
      "engine",
    ]) {
      assert.ok(key in f, key);
    }
  });

  test("--json is shorthand for -f json", () => {
    assert.ok(JSON.parse(lens([broken(), "--json"]).stdout).findings);
  });

  test("sarif is a 2.1.0 log with runs, results and rules", () => {
    const sarif = JSON.parse(lens([broken(), "-f", "sarif"]).stdout);
    assert.equal(sarif.version, "2.1.0");
    assert.match(sarif.$schema, /sarif-2\.1\.0/);
    const [run] = sarif.runs;
    assert.equal(run.tool.driver.name, "A11yLens");
    assert.equal(run.results.length, 8);
    const ids = run.tool.driver.rules.map((r) => r.id);
    for (const result of run.results) {
      assert.ok(["error", "warning", "note"].includes(result.level), result.level);
      assert.equal(ids[result.ruleIndex], result.ruleId);
      assert.equal(result.locations[0].physicalLocation.artifactLocation.uri, "index.html");
      assert.ok(result.locations[0].physicalLocation.region.startLine >= 1);
    }
    assert.equal(run.results.find((r) => r.ruleId === "img-alt").level, "error");
  });

  test("markdown has a heading, summary and findings table", () => {
    const r = lens([broken(), "-f", "markdown"]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /^# A11yLens Accessibility Audit/);
    assert.match(r.stdout, /\*\*Findings:\*\* 4 errors · 3 warnings · 1 info/);
    assert.match(r.stdout, /\| Severity \| Rule \| Location \| Message \|/);
    assert.match(r.stdout, /\| error \| `img-alt` \| `index\.html:1` \|/);
  });

  test("html is a standalone document written to a file", () => {
    const dir = broken();
    const out = join(dir, "report.html");
    const r = lens([dir, "-f", "html", "-o", out, "--title", "My Audit"]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /Report written to/);
    const html = readFileSync(out, "utf8");
    assert.match(html, /^<!doctype html>/i);
    assert.match(html, /<title>My Audit<\/title>/);
    assert.match(html, /img-alt/);
  });

  test("html without -o writes a default file in the working directory", () => {
    const cwd = fixture({ "x.txt": "" });
    const r = lens([broken(), "-f", "html"], cwd);
    assert.equal(r.status, 1);
    const written = /Report written to (.+)/.exec(r.stdout)?.[1];
    assert.ok(written && existsSync(written), r.stdout);
    assert.ok(written.startsWith(cwd));
  });

  test("pretty is the default and lists rule ids and a summary", () => {
    const r = lens([broken()]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /ERROR index\.html:1/);
    assert.match(r.stdout, /img-alt · WCAG 1\.1\.1 \(A\)/);
    assert.match(r.stdout, /4 errors · 3 warnings · 1 info/);
    assert.match(r.stdout, /Score 86\/100/);
    assert.ok(!r.stdout.includes("\u001b["));
  });

  test("--quiet prints only the summary", () => {
    const r = lens([broken(), "-q"]);
    assert.match(r.stdout, /Summary/);
    assert.doesNotMatch(r.stdout, /img-alt/);
  });

  test("an unknown --format exits 2", () => {
    const r = lens([clean(), "-f", "yaml"]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /Unknown report format/);
  });
});

describe("-o / --output", () => {
  test("writes the report to a file, creating folders, and prints a summary", () => {
    const dir = broken();
    const out = join(dir, "nested/deeper/out.json");
    const r = lens([dir, "-f", "json", "--output", out]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /4 error\(s\), 3 warning\(s\), 1 info · score 86\/100/);
    assert.doesNotMatch(r.stdout, /"findings"/);
    assert.equal(JSON.parse(readFileSync(out, "utf8")).summary.errors, 4);
  });

  test("the format is inferred from the extension", () => {
    const dir = broken();
    const sarif = join(dir, "r.sarif");
    lens([dir, "-o", sarif]);
    assert.equal(JSON.parse(readFileSync(sarif, "utf8")).version, "2.1.0");
    const md = join(dir, "r.md");
    lens([dir, "-o", md]);
    assert.match(readFileSync(md, "utf8"), /^# A11yLens/);
  });
});

describe("--fail-on and --min-score", () => {
  const warningsOnly = () =>
    fixture({ "index.html": CLEAN.replace('<a href="#main">Skip to main content</a>', "") });
  const status = (dir, ...args) => lens([dir, "-f", "json", ...args]).status;

  test("the fixture really only has a skip-link warning", () => {
    const { report } = scanJson([warningsOnly()]);
    assert.deepEqual(ruleIds(report), ["skip-link"]);
  });

  test("error (default) ignores warnings", () => {
    assert.equal(status(warningsOnly()), 0);
    assert.equal(status(warningsOnly(), "--fail-on", "error"), 0);
    assert.equal(status(broken(), "--fail-on", "error"), 1);
  });

  test("warning fails on warnings", () => {
    assert.equal(status(warningsOnly(), "--fail-on", "warning"), 1);
    assert.equal(status(clean(), "--fail-on", "warning"), 0);
  });

  test("info fails on any finding", () => {
    const infoOnly = fixture({ "index.html": CLEAN.replace("<h1>Hello</h1>", "") });
    const { report } = scanJson([infoOnly]);
    assert.deepEqual(ruleIds(report), ["page-h1"]);
    assert.equal(status(infoOnly, "--fail-on", "warning"), 0);
    assert.equal(status(infoOnly, "--fail-on", "info"), 1);
    assert.equal(status(clean(), "--fail-on", "info"), 0);
  });

  test("none never fails on findings", () => {
    assert.equal(status(broken(), "--fail-on", "none"), 0);
  });

  test("an invalid level exits 2", () => {
    const r = lens([clean(), "--fail-on", "bad"]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /failOn must be error, warning, info or none/);
  });

  test("--min-score fails strictly below the score", () => {
    const dir = broken();
    assert.equal(scanJson([dir]).report.score, 86);
    assert.equal(status(dir, "--fail-on", "none", "--min-score", "86"), 0);
    assert.equal(status(dir, "--fail-on", "none", "--min-score", "87"), 1);
    assert.equal(status(clean(), "--min-score", "100"), 0);
  });

  test("--min-score must be an integer from 0 to 100", () => {
    const text = lens([clean(), "--min-score", "abc"]);
    assert.equal(text.status, 2);
    assert.match(text.stderr, /--min-score needs a non-negative integer/);
    const range = lens([clean(), "--min-score", "101"]);
    assert.equal(range.status, 2);
    assert.match(range.stderr, /minScore must be an integer between 0 and 100/);
  });
});
