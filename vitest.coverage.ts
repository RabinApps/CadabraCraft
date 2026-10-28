// Shared coverage settings for every vitest package. Thresholds are ratcheted per package
// (see docs/coverage-gaps.md); exclusions are an allowlist and each needs a reason in docs/testing.md.
export const coverage = {
  provider: "v8" as const,
  include: ["src/**"],
  exclude: ["**/__tests__/**", "**/*.d.ts", "**/*.test.*"],
  reporter: ["text-summary", "lcov", "json-summary"],
};

/** For packages that have reached 100%: any drop fails the run. */
export const strictCoverage = {
  ...coverage,
  thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
};
