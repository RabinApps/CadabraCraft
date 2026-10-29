import { defineConfig } from "vitest/config";
import babel from "@rolldown/plugin-babel";
import { lingui } from "@lingui/vite-plugin";
import { coverage } from "../../vitest.coverage";

export default defineConfig({
  plugins: [babel({ plugins: ["@lingui/babel-plugin-lingui-macro"] }), lingui()],
  test: {
    setupFiles: ["./src/i18n/test-setup.ts"],
    exclude: ["e2e/**", "e2e-native/**", "node_modules/**"],
    // Pure TypeScript only: components and hooks are measured through Playwright (see coverageScopes.ts).
    coverage: {
      ...coverage,
      exclude: [
        ...coverage.exclude,
        "src/main.tsx",
        "**/*.tsx",
        "**/use[A-Z]*.ts",
        "src/editor/findHooks.ts",
        "src/editor/pagination/dom.ts",
        "src/editor/pagination/plugin.ts",
        "src/editor/pagination/rows.ts",
        "src/i18n/locales/**",
        "src/test/**",
        "src/i18n/test-setup.ts",
      ],
    },
  },
});
