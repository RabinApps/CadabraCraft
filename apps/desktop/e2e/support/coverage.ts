import { test as base } from "@playwright/test";
import { CoverageReport } from "monocart-coverage-reports";
import { coverageOptions } from "./coverageOptions";
import { exercisedFiles, reportEnabled, specMapEnabled, writePart } from "./specMap";

export * from "@playwright/test";

/** Playwright's `test` with Chromium V8 coverage of the app source switched on when COVERAGE=1 (see coverageOptions.ts). */
export const test = base.extend<{ appCoverage: void }>({
  appCoverage: [
    async ({ page, browserName }, use, testInfo) => {
      // V8 coverage exists only in Chromium.
      if (!process.env.COVERAGE || browserName !== "chromium") {
        await use();
        return;
      }
      await page.coverage.startJSCoverage({ resetOnNavigation: false });
      let collected = false;
      // A page's coverage is gone once it closes, and some tests close their context themselves: collect first, so the files
      // such a test exercised still reach the spec map. A closed page still records its spec (with no files).
      const collect = async () => {
        if (collected) return;
        collected = true;
        if (page.isClosed()) {
          if (specMapEnabled()) writePart(testInfo.file, testInfo.testId, []);
          return;
        }
        const coverage = await page.coverage.stopJSCoverage();
        // A page that never loaded a script (a crashed or navigated-away one) gives nothing to add.
        if (coverage.length > 0 && reportEnabled())
          await new CoverageReport(coverageOptions).add(coverage);
        if (specMapEnabled()) writePart(testInfo.file, testInfo.testId, exercisedFiles(coverage));
      };
      const context = page.context();
      const closeContext = context.close.bind(context);
      context.close = async (options) => {
        await collect();
        return closeContext(options);
      };
      try {
        await use();
      } finally {
        await collect();
      }
    },
    { auto: true },
  ],
});
