import { defineConfig } from "vitest/config";

// Real typst, EPUBCheck (JVM start) and the esbuild step make some tests slow.
export default defineConfig({ test: { testTimeout: 120_000, hookTimeout: 120_000 } });
