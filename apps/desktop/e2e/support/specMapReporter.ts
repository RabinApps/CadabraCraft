import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { FullConfig, Reporter, Suite } from "@playwright/test/reporter";
import { isFilteredRun, type Run } from "./specMapCore";
import { desktopDir, runInfoPath } from "./specMap";

/** Added by playwright.config.ts when SPEC_MAP is set: tells the merge whether the run was filtered and which specs are skipped entirely. */
export default class SpecMapReporter implements Reporter {
  onBegin(config: FullConfig, suite: Suite): void {
    const argv = process.argv;
    const args = argv.slice(argv.indexOf("test") + 1);
    const byFile = new Map<string, boolean>();
    for (const test of suite.allTests()) {
      const file = relative(desktopDir, test.location.file).split("\\").join("/");
      byFile.set(file, (byFile.get(file) ?? true) && test.expectedStatus === "skipped");
    }
    const run: Run = {
      filtered: isFilteredRun(config, args),
      skipped: [...byFile].filter(([, skipped]) => skipped).map(([file]) => file),
    };
    mkdirSync(join(runInfoPath, ".."), { recursive: true });
    writeFileSync(runInfoPath, JSON.stringify(run));
  }
}
