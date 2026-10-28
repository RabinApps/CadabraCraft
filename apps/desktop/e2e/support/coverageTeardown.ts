import { CoverageReport } from "monocart-coverage-reports";
import { coverageOptions } from "./coverageOptions";

/** Merges what every worker added and writes the report. */
export default async function globalTeardown() {
  if (process.env.COVERAGE) await new CoverageReport(coverageOptions).generate();
}
