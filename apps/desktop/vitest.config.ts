import { defineConfig } from "vitest/config";
import babel from "@rolldown/plugin-babel";
import { lingui } from "@lingui/vite-plugin";
import { coverage } from "../../vitest.coverage";

export default defineConfig({
  plugins: [babel({ plugins: ["@lingui/babel-plugin-lingui-macro"] }), lingui()],
  test: {
    setupFiles: ["./src/i18n/test-setup.ts"],
    exclude: ["e2e/**", "e2e-native/**", "node_modules/**"],
    coverage,
  },
});
