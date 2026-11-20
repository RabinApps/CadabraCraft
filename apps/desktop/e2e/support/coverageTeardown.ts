import { CoverageReport } from "monocart-coverage-reports";
import { coverageOptions } from "./coverageOptions";
import { mergeParts, reportEnabled, specMapEnabled } from "./specMap";

/** Merges what every worker added and writes the report. */
export default async function globalTeardown() {
  if (reportEnabled()) await new CoverageReport(coverageOptions).generate();
  if (specMapEnabled()) mergeParts();
}
