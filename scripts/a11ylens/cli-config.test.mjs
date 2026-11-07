// CLI contract tests for A11yLens: file filters, the config file and baselines.
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { fixture, lens, scanJson } from "./run.mjs";

const CLEAN =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Clean</title></head>' +
  '<body><a href="#main">Skip to main content</a><main id="main"><h1>Hello</h1><p>Text</p></main></body></html>';
const BROKEN =
  '<!doctype html><html><head></head><body><img src="a.png"><div onclick="x()">go</div><button></button></body></html>';
const ERROR_RULES = ["button-name", "document-title", "html-lang", "img-alt"];

const broken = () => fixture({ "index.html": BROKEN });
const clean = () => fixture({ "index.html": CLEAN });
const ruleIds = (report) => report.findings.map((f) => f.ruleId).sort();

describe("--include / --exclude", () => {
  const site = () =>
    fixture({
      "index.html": CLEAN,
      "docs/bad.html": BROKEN,
      "drafts/bad2.html": BROKEN,
    });
  const files = (report) => [...new Set(report.findings.map((f) => f.file))].sort();

  test("without filters every page is scanned", () => {
    const { report } = scanJson([site()]);
    assert.deepEqual(files(report), ["docs/bad.html", "drafts/bad2.html"]);
    assert.equal(report.files.html.length, 3);
  });

  test("--include limits the scan", () => {
    const { status, report } = scanJson([site(), "--include", "docs/**"]);
    assert.deepEqual(report.files.html, ["docs/bad.html"]);
    assert.deepEqual(files(report), ["docs/bad.html"]);
    assert.equal(status, 1);
    assert.equal(scanJson([site(), "--include", "index.html"]).status, 0);
  });

  test("--exclude skips files and accepts comma separated globs", () => {
    const one = scanJson([site(), "--exclude", "docs/**"]).report;
    assert.deepEqual(files(one), ["drafts/bad2.html"]);
    const both = scanJson([site(), "--exclude", "docs/**,drafts/**"]);
    assert.equal(both.status, 0);
    assert.deepEqual(both.report.files.html, ["index.html"]);
  });
});

describe("config file", () => {
  const withConfig = (config, files = { "index.html": BROKEN }) =>
    fixture({
      ...files,
      ".a11ylensrc.json": typeof config === "string" ? config : JSON.stringify(config),
    });

  test("rules overrides severity", () => {
    const dir = withConfig({ rules: { "img-alt": "info", "html-lang": "off" } });
    const { report } = scanJson([dir]);
    assert.equal(report.findings.find((f) => f.ruleId === "img-alt").severity, "info");
    assert.ok(!ruleIds(report).includes("html-lang"));
    assert.equal(report.config.configFile, join(dir, ".a11ylensrc.json"));
  });

  test("rules accepts the object form", () => {
    const { report } = scanJson([withConfig({ rules: { "img-alt": { severity: "warning" } } })]);
    assert.equal(report.findings.find((f) => f.ruleId === "img-alt").severity, "warning");
  });

  test("downgrading every error makes the scan pass", () => {
    const rules = Object.fromEntries(ERROR_RULES.map((id) => [id, "warning"]));
    assert.equal(scanJson([withConfig({ rules })]).status, 0);
    assert.equal(scanJson([withConfig({ rules, failOn: "warning" })]).status, 1);
  });

  test("ignoreRules supports wildcards", () => {
    const { report } = scanJson([withConfig({ ignoreRules: ["img-alt", "landmark-*"] })]);
    const ids = ruleIds(report);
    assert.ok(!ids.includes("img-alt") && !ids.includes("landmark-main"));
    assert.ok(ids.includes("html-lang"));
  });

  test("exclude skips files", () => {
    const dir = withConfig(
      { exclude: ["skip/**"] },
      { "index.html": CLEAN, "skip/bad.html": BROKEN },
    );
    const { status, report } = scanJson([dir]);
    assert.equal(status, 0);
    assert.deepEqual(report.files.html, ["index.html"]);
  });

  test("failOn from the config is used", () => {
    const dir = withConfig({ failOn: "none" });
    assert.equal(scanJson([dir]).status, 0);
  });

  test("--config points at an explicit file", () => {
    const dir = broken();
    const cfg = join(dir, "custom.json");
    writeFileSync(cfg, '{"failOn":"none"}');
    assert.equal(scanJson([dir, "--config", cfg]).status, 0);
    assert.equal(scanJson([dir]).status, 1);
  });

  test("CLI flags override the config", () => {
    const dir = withConfig({ failOn: "none" });
    assert.equal(scanJson([dir, "--fail-on", "error"]).status, 1);
    const strict = withConfig({ failOn: "error" });
    assert.equal(scanJson([strict, "--fail-on", "none"]).status, 0);
  });

  test("CLI --ignore and --exclude add to the config lists", () => {
    const dir = withConfig({ ignoreRules: ["img-alt"] });
    const { report } = scanJson([dir, "--ignore", "html-lang"]);
    assert.deepEqual(report.config.ignoreRules, ["img-alt", "html-lang"]);
    const ids = ruleIds(report);
    assert.ok(!ids.includes("img-alt") && !ids.includes("html-lang"));
    assert.ok(ids.includes("button-name"));
  });

  test("the config format is overridden by -f", () => {
    const dir = withConfig({ format: "markdown" });
    assert.match(lens([dir]).stdout, /^# A11yLens/);
    assert.ok(JSON.parse(lens([dir, "-f", "json"]).stdout).findings);
  });

  test("malformed JSON exits 2 naming the file", () => {
    const dir = withConfig("{ not json");
    const r = lens([dir]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /\.a11ylensrc\.json is not valid JSON/);
  });

  test("a config that is not an object exits 2", () => {
    const r = lens([withConfig("[1]")]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /must be a JSON object/);
  });

  test("invalid values exit 2", () => {
    const sev = lens([withConfig({ rules: { "img-alt": "loud" } })]);
    assert.equal(sev.status, 2);
    assert.match(sev.stderr, /Invalid rule configuration for img-alt/);
    const failOn = lens([withConfig({ failOn: "maybe" })]);
    assert.equal(failOn.status, 2);
    assert.match(failOn.stderr, /failOn must be/);
  });

  test("a missing --config file exits 2", () => {
    const r = lens([clean(), "--config", "/no/such/config.json"]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /Cannot read config file/);
  });
});

describe("baseline", () => {
  test("--update-baseline records findings, then only new ones fail", () => {
    const dir = broken();
    const update = lens([dir, "--update-baseline", "-f", "json"]);
    // Surprising: recording a baseline still fails with the pre-baseline findings (exit 1).
    assert.equal(update.status, 1);
    assert.match(update.stderr, /Baseline updated: .*\.a11ylens-baseline\.json \(8 entries\)/);
    const baseline = JSON.parse(readFileSync(join(dir, ".a11ylens-baseline.json"), "utf8"));
    assert.equal(baseline.fingerprints.length, 8);

    const again = scanJson([dir]);
    assert.equal(again.status, 0);
    assert.equal(again.report.findings.length, 0);

    writeFileSync(join(dir, "new.html"), BROKEN);
    const next = scanJson([dir]);
    assert.equal(next.status, 1);
    assert.ok(next.report.findings.length > 0);
    assert.ok(next.report.findings.every((f) => f.file === "new.html"));
  });

  test("a custom --baseline path is used", () => {
    const dir = broken();
    const file = join(dir, "custom-baseline.json");
    assert.equal(lens([dir, "--update-baseline", "--baseline", file]).status, 1);
    assert.ok(existsSync(file));
    assert.equal(existsSync(join(dir, ".a11ylens-baseline.json")), false);
    assert.equal(scanJson([dir, "--baseline", file]).status, 0);
    assert.equal(scanJson([dir]).status, 1);
  });

  test("a missing explicit baseline exits 2", () => {
    const r = lens([broken(), "--baseline", "nope.json"]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /Baseline file not found/);
  });

  test("a corrupt baseline exits 2", () => {
    const dir = fixture({ "index.html": BROKEN, ".a11ylens-baseline.json": "{ nope" });
    const r = lens([dir]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /Cannot read JSON file/);
    const bad = fixture({
      "index.html": BROKEN,
      ".a11ylens-baseline.json": '{"fingerprints":[1]}',
    });
    assert.match(lens([bad]).stderr, /Invalid baseline fingerprints/);
  });
});
