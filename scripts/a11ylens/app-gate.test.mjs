// Static A11yLens gate for the two apps: scans the source with the repo config (.a11ylensrc.json) and fails on any
// error-severity finding, a failing exit code, a score under the config's minimum, or a scan that covered nothing.
import assert from "node:assert/strict";
import { test } from "node:test";
import { scanJson } from "./run.mjs";

const MIN_SCORE = 95;
const MIN_FILES = 100; // the apps hold about 155 source and CSS files; far fewer means a glob matched nothing

test("apps/desktop/src and apps/website have no accessibility errors", () => {
  const { status, report, stderr } = scanJson(["apps/desktop/src", "apps/website"]);
  assert.ok(report, `no JSON report: ${stderr}`);
  assert.ok(report.summary.files >= MIN_FILES, `scan covered only ${report.summary.files} files`);
  assert.ok(report.checks > 0, "scan ran no checks");
  const errors = report.findings.filter((f) => f.severity === "error");
  assert.deepEqual(
    errors.map((f) => `${f.ruleId ?? f.rule} ${f.file}:${f.line}`),
    [],
    "error-severity findings",
  );
  assert.equal(report.summary.errors, 0);
  assert.ok(report.score >= MIN_SCORE, `score ${report.score} is under ${MIN_SCORE}`);
  assert.equal(status, 0, `exit code ${status}: ${stderr}`);
});
