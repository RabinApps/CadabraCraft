import { test as base } from "@playwright/test";
import { CoverageReport } from "monocart-coverage-reports";
import { coverageOptions } from "./coverageOptions";

export * from "@playwright/test";

/** Playwright's `test` with Chromium V8 coverage of the app source switched on when COVERAGE=1 (see coverageOptions.ts). */
export const test = base.extend<{ appCoverage: void }>({
  appCoverage: [
    async ({ page, browserName }, use) => {
      // V8 coverage exists only in Chromium.
      if (!process.env.COVERAGE || browserName !== "chromium") {
        await use();
        return;
      }
      await page.coverage.startJSCoverage({ resetOnNavigation: false });
      try {
        await use();
      } finally {
        if (!page.isClosed()) {
          const coverage = await page.coverage.stopJSCoverage();
          await new CoverageReport(coverageOptions).add(coverage);
        }
      }
    },
    { auto: true },
  ],
});
