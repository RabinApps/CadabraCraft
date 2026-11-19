import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { FullConfig, Reporter, Suite } from "@playwright/test/reporter";
import { runNarrowing, type Run } from "./specMapCore";
import { desktopDir, runInfoPath } from "./specMap";

/** Added by playwright.config.ts when SPEC_MAP is set: tells the merge whether the run was filtered and which specs are skipped entirely. */
export default class SpecMapReporter implements Reporter {
  onBegin(config: FullConfig, suite: Suite): void {
    const argv = process.argv;
    const args = argv.slice(argv.indexOf("test") + 1);
    const byFile = new Map<string, { run: number; skipped: number }>();
    for (const test of suite.allTests()) {
      const file = relative(desktopDir, test.location.file).split("\\").join("/");
      const count = byFile.get(file) ?? { run: 0, skipped: 0 };
      if (test.expectedStatus === "skipped") count.skipped += 1;
      else count.run += 1;
      byFile.set(file, count);
    }
    const run: Run = {
      ...runNarrowing(config, args),
      skipped: [...byFile].filter(([, c]) => c.run === 0).map(([file]) => file),
      tests: Object.fromEntries(
        [...byFile].filter(([, c]) => c.run > 0).map(([f, c]) => [f, c.run]),
      ),
    };
    mkdirSync(join(runInfoPath, ".."), { recursive: true });
    writeFileSync(runInfoPath, JSON.stringify(run));
  }
}
