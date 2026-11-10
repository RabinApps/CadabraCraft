import { defineConfig } from "@playwright/test";

// Website screenshots: `pnpm screenshots:website` (see apps/website/README.md). Runs the real UI against the in-memory
// fake backend used by the e2e specs, so the shots are reproducible and need no installed app. Kept out of the normal
// e2e run (its own testDir) and out of coverage.
const port = Number(process.env.E2E_PORT) || 1420;

export default defineConfig({
  testDir: "e2e-screenshots",
  workers: 1,
  retries: 0,
  outputDir: "test-results-screenshots",
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${port}` },
  webServer: {
    command: "pnpm dev",
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
  },
});
