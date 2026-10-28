import { CoverageReport } from "monocart-coverage-reports";
import { coverageOptions } from "./coverageOptions";

/** Clears the shared cache so a run only reports its own coverage. */
export default async function globalSetup() {
  if (process.env.COVERAGE) await new CoverageReport(coverageOptions).cleanCache();
}
