import { defineConfig } from "vitest/config";
import { strictCoverage as coverage } from "../../vitest.coverage.ts";

export default defineConfig({ test: { coverage } });
