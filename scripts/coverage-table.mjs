// The coverage report as a table: every gated metric with its floor and how far above it the number is. Pure, so the
// rules (what counts as failing and as thin) are tested without a coverage run. Used by scripts/coverage.mjs.

/** A metric within this many points of its floor passes but is flagged: the next small change could take it under. */
export const THIN_MARGIN = 0.25;

/** @typedef {{ area: string, metric: string, actual: number | undefined, floor: number }} Row */

/** @param {Row} row @returns {"pass" | "THIN" | "FAIL"} */
export function statusOf({ actual, floor }) {
  if (typeof actual !== "number" || Number.isNaN(actual) || actual < floor) return "FAIL";
  return actual - floor < THIN_MARGIN ? "THIN" : "pass";
}

/** The rows of one area: its totals (`{ lines: { pct }, ... }`) against its floors (`{ lines: 99, ... }`). */
export function rowsOf(area, total, floors) {
  return Object.entries(floors).map(([metric, floor]) => ({
    area,
    metric,
    actual: total?.[metric]?.pct,
    floor,
  }));
}

const fixed = (n) => (typeof n === "number" ? n.toFixed(2) : "n/a");

/**
 * @param {Row[]} rows
 * @param {string[]} notRun areas that were not measured in this run (shown, never counted as passing)
 */
export function formatTable(rows, notRun = []) {
  const lines = [
    "| Area | Metric | Actual | Floor | Margin | Status |",
    "| --- | --- | ---: | ---: | ---: | --- |",
  ];
  for (const row of rows) {
    const margin = typeof row.actual === "number" ? row.actual - row.floor : undefined;
    const sign = margin !== undefined && margin >= 0 ? "+" : "";
    lines.push(
      `| ${row.area} | ${row.metric} | ${fixed(row.actual)}% | ${row.floor}% | ${
        margin === undefined ? "n/a" : `${sign}${margin.toFixed(2)}`
      } | ${statusOf(row)} |`,
    );
  }
  for (const area of notRun) lines.push(`| ${area} | all | not run | | | NOT RUN |`);
  return lines.join("\n");
}

/** The one-line verdict printed under the table. */
export function verdict(rows, notRun = []) {
  const failed = rows.filter((r) => statusOf(r) === "FAIL").length;
  const thin = rows.filter((r) => statusOf(r) === "THIN").length;
  const parts = [
    failed ? `${failed} metric(s) under the floor` : "every measured metric meets its floor",
  ];
  if (thin) parts.push(`${thin} within ${THIN_MARGIN} points of it (add tests before finishing)`);
  if (notRun.length) parts.push(`not run: ${notRun.join(", ")}`);
  return parts.join("; ");
}
