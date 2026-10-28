import { test as base } from "@playwright/test";
import { CoverageReport } from "monocart-coverage-reports";
import { coverageOptions } from "./coverageOptions";

export * from "@playwright/test";

/** Playwright's `test` with Chromium V8 coverage of the app source switched on when COVERAGE=1 (see coverageOptions.ts). */
export const test = base.extend<{ appCoverage: void }>({
  appCoverage: [
    async ({ page }, use) => {
      if (!process.env.COVERAGE) {
        await use();
        return;
      }
      await page.coverage.startJSCoverage({ resetOnNavigation: false });
      await use();
      await new CoverageReport(coverageOptions).add(await page.coverage.stopJSCoverage());
    },
    { auto: true },
  ],
});
