import assert from "node:assert/strict";
import { test } from "node:test";
import { compare, countLines, findViolations, isTest } from "./check-size.mjs";

test("countLines ignores blank lines", () => assert.equal(countLines("a\n\n  \nb\n"), 2));

test("isTest recognises test locations", () => {
  assert.ok(isTest("apps/desktop/e2e/a.spec.ts"));
  assert.ok(isTest("packages/x/src/__tests__/a.ts"));
  assert.ok(isTest("src-tauri/src/ipc_tests.rs"));
  assert.ok(!isTest("src-tauri/src/fonts/catalog.rs"));
});

test("findViolations flags long Rust files, long tests and crowded folders", () => {
  const sizes = { "a/big.rs": 401, "a/ok.rs": 400, "a/t.test.ts": 801, "a/u.test.ts": 800 };
  const files = [...Object.keys(sizes)];
  for (let i = 0; i < 21; i++) files.push(`crowd/f${i}.ts`);
  const keys = findViolations(files, (p) => sizes[p] ?? 1)
    .map((v) => v.key)
    .sort();
  assert.deepEqual(keys, ["a/big.rs", "a/t.test.ts", "dir:crowd"]);
});

test("compare: baseline may shrink but not grow, and stale entries fail", () => {
  const v = [{ key: "a.rs", value: 500, limit: 400, kind: "source file" }];
  assert.equal(compare(v, { "a.rs": 500 }).length, 0);
  assert.equal(compare(v, { "a.rs": 450 }).length, 1);
  assert.equal(compare(v, {}).length, 1);
  assert.equal(compare([], { "gone.rs": 500 }).length, 1);
});
