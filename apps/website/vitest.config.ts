import path from "node:path";
import { defineConfig } from "vitest/config";
import { coverage } from "../../vitest.coverage";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    include: ["src/**/*.test.ts"],
    // Only the logic is measured: pages and components are static markup, checked by the build and a11ylens.
    coverage: {
      ...coverage,
      include: ["src/i18n/**", "src/lib/seo.ts", "src/lib/docs/entries.ts", "src/lib/docs/frontmatter.ts", "src/lib/docs/headings.ts"],
      thresholds: { statements: 90, branches: 80, functions: 90, lines: 90 },
    },
  },
});
