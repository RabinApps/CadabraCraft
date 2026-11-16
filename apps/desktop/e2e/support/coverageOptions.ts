import type { CoverageReportOptions } from "monocart-coverage-reports";
import { isE2eScope, isUnmeasured } from "../../coverageScopes";

/** Vite's dev sourcemaps name sources by basename only, so the path is rebuilt from the served URL (src/app/x.tsx). */
const port = Number(process.env.E2E_PORT) || 1420;
/** As in playwright.config.ts: own output folders for parallel local runs, the plain ones in CI (one checkout per runner). */
const ownOutputs = port !== 1420 && !process.env.CI;

const appPath = (filePath: string, info: { distFile?: string }): string =>
  (info.distFile ?? filePath)
    .replace(/\?.*$/, "")
    .replace(new RegExp(`^localhost-${port}/@fs/.*?/cadabracraft/`), "")
    .replace(`localhost-${port}/`, "");

/** Only apps/desktop/src (no node_modules, workspace packages or test helpers). Reports land in ../../coverage/e2e. */
export const coverageOptions: CoverageReportOptions = {
  name: "CadabraCraft e2e",
  outputDir: ownOutputs ? `../../coverage/e2e-${port}` : "../../coverage/e2e",
  entryFilter: (entry) =>
    !String(typeof entry === "string" ? entry : entry.url).includes("node_modules"),
  sourcePath: appPath,
  sourceFilter: (p) => p.startsWith("src/") && isE2eScope(p) && !isUnmeasured(p),
  all: {
    dir: ["./src"],
    filter: { "**/__tests__/**": false, "**/*.d.ts": false, "**/*.{ts,tsx}": true },
  },
  reports: ["lcovonly", "json-summary", "console-summary"],
};
