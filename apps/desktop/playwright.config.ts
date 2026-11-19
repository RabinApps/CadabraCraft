import { defineConfig, devices } from "@playwright/test";

/** The specs that also run on Playwright's WebKit (the engine of WKWebView and WebKitGTK); opt in with WEBKIT=1 so the default run stays Chromium only. */
const webkitSpecs =
  /(a11y|a11y-ui|a11y-tree|a11y-keyboard|a11y-forced-colors|a11y-adaptive|a11y-label-in-name|a11y-dragging|a11y-errors|a11y-shell-keys|a11y-os-settings|a11y-wcag-extra|a11y-engines|a11y-screenreader|language-mark|images)\.spec\.ts$/;

/** The specs the locale projects run (opt in with E2E_LOCALES=1, see `test:a11y:locales`). */
const localeSpecs = /(a11y|a11y-label-in-name|a11y-adaptive)\.spec\.ts$/;

const port = Number(process.env.E2E_PORT) || 1420;
/** Parallel local runs (own E2E_PORT) keep their own output folders. In CI each runner has its own checkout, so the folders keep their plain names, which scripts/coverage.mjs and the artifact upload read. */
const ownOutputs = port !== 1420 && !process.env.CI;

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
  // In CI the tests of one file spread over the workers too (the a11y sweeps are independent tests), and E2E_WORKERS sets the count.
  // CI machines run several jobs at once (keystrokes took about 200 ms in a 20k-word chapter there), so a test can time out on load alone: the
  // coverage run's room for that (90 s a test, 20 s an assertion), and two retries; a retried pass is reported as "flaky", not hidden. The
  // explicit ceilings of the perf specs (typing latency and so on) are asserted in the tests and are not affected.
  ...(process.env.CI && {
    fullyParallel: true,
    timeout: 90_000,
    expect: { timeout: 20_000 },
    retries: 2,
    ...(process.env.E2E_WORKERS && { workers: Number(process.env.E2E_WORKERS) }),
  }),
  // SPEC_MAP: the reporter tells the map merge whether the run was filtered (e2e/support/specMapCore.ts).
  // A `test.only` would filter the suite before the reporter counts it, and the map would take a spec's one focused test for all of it.
  ...(process.env.SPEC_MAP && {
    forbidOnly: true,
    reporter: [[process.env.CI ? "dot" : "list"], ["./e2e/support/specMapReporter.ts"]],
  }),
  ...(ownOutputs && { outputDir: `test-results-${port}` }),
  ...(process.env.WEBKIT && {
    projects: [{ name: "webkit", testMatch: webkitSpecs, use: { ...devices["Desktop Safari"] } }],
  }),
  // `pnpm test:a11y:locales`: the screen sweeps again in a translated interface (E2E_LOCALE says which, see helpers.ts).
  ...(process.env.E2E_LOCALES && {
    projects: ["he", "ar", "pseudo", "pseudo-rtl"].map((code) => ({
      name: `locale-${code}`,
      testMatch: localeSpecs,
      metadata: { locale: code },
    })),
  }),
  use: { baseURL: `http://localhost:${port}` },
  webServer: {
    command: "pnpm dev",
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
  },
});
