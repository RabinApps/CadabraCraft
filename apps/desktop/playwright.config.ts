import { defineConfig, devices } from "@playwright/test";

/** The specs that also run on Playwright's WebKit (the engine of WKWebView and WebKitGTK); opt in with WEBKIT=1 so the default run stays Chromium only. */
const webkitSpecs =
  /(a11y|a11y-ui|a11y-tree|a11y-keyboard|a11y-forced-colors|a11y-adaptive|a11y-label-in-name|a11y-dragging|a11y-errors|a11y-shell-keys|a11y-os-settings|a11y-wcag-extra|a11y-engines|a11y-screenreader|language-mark|images)\.spec\.ts$/;

const port = Number(process.env.E2E_PORT) || 1420;

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/support/coverageSetup.ts",
  globalTeardown: "./e2e/support/coverageTeardown.ts",
  // V8 coverage slows the page down several times over, so give it room (and fewer parallel pages).
  ...(process.env.COVERAGE && {
    timeout: 90_000,
    expect: { timeout: 20_000 },
    workers: 3,
    retries: 2,
  }),
  ...(port !== 1420 && { outputDir: `test-results-${port}` }),
  ...(process.env.WEBKIT && {
    projects: [{ name: "webkit", testMatch: webkitSpecs, use: { ...devices["Desktop Safari"] } }],
  }),
  use: { baseURL: `http://localhost:${port}` },
  webServer: {
    command: "pnpm dev",
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
  },
});
