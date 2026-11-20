import type { Browser, BrowserContext, Page } from "@playwright/test";

type Entry = Awaited<ReturnType<Page["coverage"]["stopJSCoverage"]>>;

/**
 * V8 coverage of every page a test opens: the fixture's own page and the pages of contexts the test makes with
 * `browser.newContext()` (a11yWcagExtra.ts `fresh`). A page's coverage is gone once it closes, and tests close contexts themselves,
 * so a watched context's `close` collects its pages first.
 */
export function createTracker(onCoverage: (coverage: Entry) => Promise<void>) {
  const started = new Map<Page, Promise<void>>();
  const track = (page: Page): Promise<void> => {
    // Idempotent: the fixture's page is tracked by `watch` and by the fixture; a second start would be rejected by Playwright.
    const existing = started.get(page);
    if (existing) return existing;
    const start = page.coverage.startJSCoverage({ resetOnNavigation: false }).catch(() => {
      started.delete(page);
    });
    started.set(page, start);
    return start;
  };
  const collect = async (page: Page): Promise<void> => {
    const start = started.get(page);
    if (!start) return;
    started.delete(page);
    await start;
    if (!page.isClosed()) await onCoverage(await page.coverage.stopJSCoverage());
  };
  const watch = (context: BrowserContext): void => {
    for (const page of context.pages()) void track(page);
    context.on("page", (page) => void track(page));
    const close = context.close.bind(context);
    context.close = async (options) => {
      await Promise.all(context.pages().map(collect));
      return close(options);
    };
  };
  /** Makes `browser.newContext()` watch the contexts it returns; the returned function puts it back. */
  const watchBrowser = (browser: Browser): (() => void) => {
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async (options) => {
      const context = await newContext(options);
      watch(context);
      return context;
    };
    return () => {
      browser.newContext = newContext;
    };
  };
  const finish = async (): Promise<void> => {
    await Promise.all([...started.keys()].map(collect));
  };
  return { track, watch, watchBrowser, finish };
}
