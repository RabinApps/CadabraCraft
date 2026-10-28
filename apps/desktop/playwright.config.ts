import { defineConfig } from "@playwright/test";

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
  use: { baseURL: `http://localhost:${port}` },
  webServer: {
    command: "pnpm dev",
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
  },
});
