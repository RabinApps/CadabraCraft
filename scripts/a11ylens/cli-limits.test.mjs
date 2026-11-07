// CLI contract tests for A11yLens: report limiting and rule ignoring flags.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { fixture, lens, scanJson } from "./run.mjs";

const CLEAN =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Clean</title></head>' +
  '<body><a href="#main">Skip to main content</a><main id="main"><h1>Hello</h1><p>Text</p></main></body></html>';
const BROKEN =
  '<!doctype html><html><head></head><body><img src="a.png"><div onclick="x()">go</div><button></button></body></html>';
const ERROR_RULES = ["button-name", "document-title", "html-lang", "img-alt"];

const clean = () => fixture({ "index.html": CLEAN });
const broken = () => fixture({ "index.html": BROKEN });
const ruleIds = (report) => report.findings.map((f) => f.ruleId).sort();

describe("--max-findings", () => {
  test("truncates the reported findings but not the exit code or summary", () => {
    const r = scanJson([broken(), "--max-findings", "2"]);
    assert.equal(r.status, 1);
    assert.equal(r.report.findings.length, 2);
    assert.equal(r.report.truncated, 6);
    assert.equal(r.report.summary.total, 8);
    assert.deepEqual(
      r.report.findings.map((f) => f.severity),
      ["error", "error"],
    );
  });

  test("0 means unlimited and a large limit truncates nothing", () => {
    assert.equal(scanJson([broken(), "--max-findings", "0"]).report.findings.length, 8);
    const big = scanJson([broken(), "--max-findings", "100"]).report;
    assert.equal(big.findings.length, 8);
    assert.equal(big.truncated, 0);
  });

  test("a non-numeric value exits 2", () => {
    const r = lens([clean(), "--max-findings", "x"]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /--max-findings needs a non-negative integer/);
  });
});

describe("--ignore", () => {
  test("disables a rule by id", () => {
    const { report } = scanJson([broken(), "--ignore", "img-alt"]);
    assert.ok(!ruleIds(report).includes("img-alt"));
    assert.equal(report.summary.errors, 3);
  });

  test("supports comma separated and repeated flags", () => {
    const { report } = scanJson([
      broken(),
      "--ignore",
      "img-alt,html-lang",
      "--ignore",
      "button-name",
    ]);
    assert.deepEqual(
      ruleIds(report).filter((id) => ERROR_RULES.includes(id)),
      ["document-title"],
    );
  });

  test("supports prefix* wildcards", () => {
    const dir = broken();
    const ids = ruleIds(scanJson([dir, "--ignore", "landmark-*,skip-*"]).report);
    assert.ok(!ids.includes("landmark-main"));
    assert.ok(!ids.includes("skip-link"));
    assert.ok(ids.includes("img-alt"));
  });

  test("ignoring every finding gives exit 0", () => {
    const { status, report } = scanJson([broken(), "--ignore", "*"]);
    assert.equal(report.findings.length, 0);
    assert.equal(status, 0);
  });

  test("an ignored rule is not reported as executed", () => {
    const { report } = scanJson([broken(), "--ignore", "img-alt"]);
    assert.ok(!report.rulesExecuted.includes("img-alt"));
  });
});
