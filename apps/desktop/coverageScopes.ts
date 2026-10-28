/**
 * Which tool owns which desktop source file for the 100% coverage rule (docs/testing.md):
 * Vitest covers pure TypeScript; Playwright (instrumented, `pnpm test:e2e:coverage`) covers everything that needs a DOM.
 * Paths are relative to apps/desktop.
 */
const E2E_TS = [
  /\/use[A-Z][^/]*\.ts$/,
  /^src\/editor\/findHooks\.ts$/,
  // Page view pagination: the part that reads layout from the editor's DOM and the plugin that schedules it.
  /^src\/editor\/pagination\/(dom|plugin)\.ts$/,
];

/** True when the file is measured by the Playwright run (React components, hooks, the entry point). */
export const isE2eScope = (path: string): boolean =>
  path.endsWith(".tsx") || E2E_TS.some((re) => re.test(path));

/** Files neither run measures: tests, helpers, generated catalogs, ambient types. */
export const isUnmeasured = (path: string): boolean =>
  /__tests__|\.test\.|\.d\.ts$|^src\/test\/|^src\/i18n\/(test-setup|locales\/)|\.css$/.test(path);
