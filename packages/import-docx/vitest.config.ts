import { defineConfig } from "vitest/config";
import { strictCoverage as coverage } from "../../vitest.coverage.ts";

// Hostile-input and performance tests run several times slower with v8 coverage on.
export default defineConfig({ test: { testTimeout: 30_000, coverage } });
