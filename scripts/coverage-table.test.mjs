import assert from "node:assert/strict";
import { test } from "node:test";
import { formatTable, rowsOf, statusOf, THIN_MARGIN, verdict } from "./coverage-table.mjs";

test("a metric under its floor fails, one just over it is thin, one clear of it passes", () => {
  assert.equal(statusOf({ actual: 98.99, floor: 99 }), "FAIL");
  assert.equal(statusOf({ actual: 99, floor: 99 }), "THIN");
  assert.equal(statusOf({ actual: 99 + THIN_MARGIN - 0.01, floor: 99 }), "THIN");
  assert.equal(statusOf({ actual: 99 + THIN_MARGIN, floor: 99 }), "pass");
  assert.equal(statusOf({ actual: 100, floor: 99 }), "pass");
});

test("a missing or non-numeric number is a failure, never a pass", () => {
  assert.equal(statusOf({ actual: undefined, floor: 99 }), "FAIL");
  assert.equal(statusOf({ actual: Number.NaN, floor: 99 }), "FAIL");
});

test("rowsOf reads each floor from the totals of the area", () => {
  const rows = rowsOf(
    "Rust",
    { lines: { pct: 99.3 }, functions: { pct: 98.1 } },
    { lines: 99, functions: 98 },
  );
  assert.deepEqual(rows, [
    { area: "Rust", metric: "lines", actual: 99.3, floor: 99 },
    { area: "Rust", metric: "functions", actual: 98.1, floor: 98 },
  ]);
  assert.equal(rowsOf("Rust", undefined, { lines: 99 })[0].actual, undefined);
});

test("the table shows margins with a sign, and an area that was not run", () => {
  const rows = [
    { area: "Rust", metric: "lines", actual: 99.3, floor: 99 },
    { area: "Rust", metric: "functions", actual: 97.5, floor: 98 },
  ];
  const table = formatTable(rows, ["Desktop Playwright"]);
  assert.match(table, /\| Rust \| lines \| 99\.30% \| 99% \| \+0\.30 \| pass \|/);
  assert.match(table, /\| Rust \| functions \| 97\.50% \| 98% \| -0\.50 \| FAIL \|/);
  assert.match(table, /\| Desktop Playwright \| all \| not run \| \| \| NOT RUN \|/);
});

test("the verdict counts failures, thin margins and areas not run", () => {
  const ok = [{ area: "A", metric: "lines", actual: 100, floor: 99 }];
  assert.equal(verdict(ok), "every measured metric meets its floor");
  const mixed = [
    { area: "A", metric: "lines", actual: 98, floor: 99 },
    { area: "A", metric: "functions", actual: 99.1, floor: 99 },
  ];
  assert.match(
    verdict(mixed, ["E2E"]),
    /1 metric\(s\) under the floor; 1 within 0\.25 points of it .*; not run: E2E/,
  );
});
