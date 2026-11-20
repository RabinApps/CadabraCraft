import { test as base } from "@playwright/test";
import { CoverageReport } from "monocart-coverage-reports";
import { coverageOptions } from "./coverageOptions";
import { createTracker } from "./pageCoverage";
import { exercisedFiles, reportEnabled, specMapEnabled, writePart } from "./specMap";

export * from "@playwright/test";

/** Playwright's `test` with Chromium V8 coverage of the app source switched on when COVERAGE=1 (see coverageOptions.ts). */
export const test = base.extend<{ appCoverage: void }>({
  appCoverage: [
    async ({ page, browser, browserName }, use, testInfo) => {
      // V8 coverage exists only in Chromium.
      if (!process.env.COVERAGE || browserName !== "chromium") {
        await use();
        return;
      }
      const files = new Set<string>();
      const tracker = createTracker(async (coverage) => {
        // A page that never loaded a script (a crashed or navigated-away one) gives nothing to add.
        if (coverage.length > 0 && reportEnabled())
          await new CoverageReport(coverageOptions).add(coverage);
        for (const file of exercisedFiles(coverage)) files.add(file);
      });
      tracker.watch(page.context());
      const unwatch = tracker.watchBrowser(browser);
      await tracker.track(page);
      try {
        await use();
      } finally {
        unwatch();
        await tracker.finish();
        // One part per test, with the files of all its pages; a test whose pages all closed early still records its spec.
        if (specMapEnabled()) writePart(testInfo.file, testInfo.testId, [...files]);
      }
    },
    { auto: true },
  ],
});
