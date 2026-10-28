import { defineConfig } from "vitest/config";

// Opt-in native suite: `pnpm test:native`. Not picked up by the default `pnpm test` (see vitest.config.ts exclude).
export default defineConfig({
  test: {
    include: ["e2e-native/**/*.native.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
