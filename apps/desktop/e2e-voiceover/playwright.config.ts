import { defineConfig, devices } from "@playwright/test";

/**
 * Real VoiceOver on macOS through Guidepup, driving the web build of the app in Playwright's WebKit (the engine of the
 * Tauri window). Run with `pnpm --filter @cadabracraft/desktop test:voiceover` after the one-time machine setup in
 * docs/accessibility.md. It is not part of CI or `pnpm a11y`: it takes over the keyboard and speaker of the Mac.
 */
const port = Number(process.env.E2E_PORT) || 1420;

export default defineConfig({
  testDir: ".",
  timeout: 120_000,
  workers: 1,
  retries: 0,
  outputDir: "../test-results-voiceover",
  use: { ...devices["Desktop Safari"], headless: false, baseURL: `http://localhost:${port}` },
  projects: [{ name: "voiceover-webkit" }],
  webServer: {
    command: "pnpm dev",
    url: `http://localhost:${port}`,
    reuseExistingServer: true,
    cwd: "..",
  },
});
