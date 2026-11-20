import assert from "node:assert/strict";
import test from "node:test";
import { createSpecIndex, relativeImports, specsForAll } from "./e2e-specs.mjs";

test("relativeImports resolves relative imports, with extensions and index files, and skips packages", () => {
  const files = new Set([
    "apps/desktop/e2e/support/helpers.ts",
    "apps/desktop/e2e/fixtures.ts",
    "apps/desktop/src/test/bigBook.ts",
    "apps/desktop/e2e/support/pages/index.ts",
  ]);
  const source = `
    import { a } from "./support/helpers";
    import { b } from "./fixtures";
    import { c } from "../src/test/bigBook";
    import { d } from "./support/pages";
    import { e } from "@playwright/test";
    const f = await import("./support/helpers");
    import { g } from "./missing";
  `;
  assert.deepEqual(
    relativeImports("apps/desktop/e2e/a.spec.ts", source, (p) => files.has(p)),
    [
      "apps/desktop/e2e/support/helpers.ts",
      "apps/desktop/e2e/fixtures.ts",
      "apps/desktop/src/test/bigBook.ts",
      "apps/desktop/e2e/support/pages/index.ts",
      "apps/desktop/e2e/support/helpers.ts",
    ],
  );
});

const graph = {
  "apps/desktop/e2e/a.spec.ts": ["apps/desktop/e2e/support/helpers.ts"],
  "apps/desktop/e2e/b.spec.ts": [
    "apps/desktop/e2e/support/helpers.ts",
    "apps/desktop/e2e/support/cards.ts",
  ],
  "apps/desktop/e2e/support/helpers.ts": ["apps/desktop/e2e/support/base.ts"],
  "apps/desktop/e2e/support/cards.ts": [],
  "apps/desktop/e2e/support/base.ts": [],
};
const map = {
  specs: ["e2e/a.spec.ts", "e2e/b.spec.ts"],
  files: { "apps/desktop/src/app/X.tsx": [1], "apps/desktop/src/app/Y.tsx": [0, 1] },
};

test("the index follows imports in reverse, through several levels", () => {
  const specsFor = createSpecIndex(graph, map);
  assert.deepEqual(specsFor("apps/desktop/e2e/support/base.ts"), [
    "e2e/a.spec.ts",
    "e2e/b.spec.ts",
  ]);
  assert.deepEqual(specsFor("apps/desktop/e2e/support/cards.ts"), ["e2e/b.spec.ts"]);
  assert.deepEqual(specsFor("apps/desktop/e2e/a.spec.ts"), ["e2e/a.spec.ts"]);
});

test("the index uses the coverage map for sources, and gives null for a file nothing knows", () => {
  const specsFor = createSpecIndex(graph, map);
  assert.deepEqual(specsFor("apps/desktop/src/app/X.tsx"), ["e2e/b.spec.ts"]);
  assert.deepEqual(specsFor("apps/desktop/src/app/Y.tsx"), ["e2e/a.spec.ts", "e2e/b.spec.ts"]);
  assert.equal(specsFor("apps/desktop/src/app/Z.tsx"), null);
  assert.equal(createSpecIndex(graph, null)("apps/desktop/src/app/X.tsx"), null);
});

test("specsForAll unions the specs and gives every spec ([]) when one file is unknown", () => {
  const specsFor = createSpecIndex(graph, map);
  assert.deepEqual(
    specsForAll(["apps/desktop/src/app/X.tsx", "apps/desktop/e2e/a.spec.ts"], specsFor),
    ["e2e/a.spec.ts", "e2e/b.spec.ts"],
  );
  assert.deepEqual(
    specsForAll(["apps/desktop/src/app/X.tsx", "apps/desktop/src/app/Z.tsx"], specsFor),
    [],
  );
});
