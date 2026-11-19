import { CoverageReport } from "monocart-coverage-reports";
import { coverageOptions } from "./coverageOptions";
import { clearParts, keepParts, reportEnabled, specMapEnabled } from "./specMap";

/** Clears the shared cache so a run only reports its own coverage. */
export default async function globalSetup() {
  if (reportEnabled()) await new CoverageReport(coverageOptions).cleanCache();
  if (specMapEnabled() && !keepParts()) clearParts();
}
