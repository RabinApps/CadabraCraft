import assert from "node:assert/strict";
import test from "node:test";
import { createTracker } from "../../apps/desktop/e2e/support/pageCoverage.ts";

// A page whose coverage works as Playwright's: a second start is rejected, and stopping hands over what the page ran.
function fakePage(url) {
  let on = false;
  return {
    coverage: {
      startJSCoverage: async () => {
        if (on) throw new Error("JS coverage has already been started");
        on = true;
      },
      stopJSCoverage: async () => {
        on = false;
        return [{ url }];
      },
    },
    isClosed: () => false,
  };
}
function fakeContext(pages) {
  const handlers = {};
  return {
    pages: () => pages,
    on: (event, fn) => (handlers[event] = fn),
    emit: (event, arg) => handlers[event]?.(arg),
    close: async () => {},
  };
}

test("the fixture page is tracked once, though the context watcher and the fixture both start it", async () => {
  const seen = [];
  const tracker = createTracker(async (coverage) => void seen.push(...coverage.map((c) => c.url)));
  const page = fakePage("page");
  const context = fakeContext([page]);
  tracker.watch(context);
  await tracker.track(page);
  await tracker.finish();
  assert.deepEqual(seen, ["page"]);
});

test("pages of several fresh contexts are each collected, before a context closes or at the end", async () => {
  const seen = [];
  const tracker = createTracker(async (coverage) => void seen.push(...coverage.map((c) => c.url)));
  const main = fakePage("main");
  const mainContext = fakeContext([main]);
  tracker.watch(mainContext);
  await tracker.track(main);
  const contexts = ["one", "two"].map((name) => {
    const page = fakePage(name);
    const context = fakeContext([]);
    tracker.watch(context);
    context.pages = () => [page];
    context.emit("page", page);
    return context;
  });
  await contexts[0].close(); // closes: its page is collected first
  assert.deepEqual(seen, ["one"]);
  await tracker.finish();
  assert.deepEqual(seen.sort(), ["main", "one", "two"]);
});
