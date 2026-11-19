import assert from "node:assert/strict";
import test from "node:test";
import { isFilteredRun, patchMap, planMerge } from "../../apps/desktop/e2e/support/specMapCore.ts";

const all = ["e2e/a.spec.ts", "e2e/b.spec.ts", "e2e/c.spec.ts"];
const part = (spec, ...files) => ({ spec, files });
const run = { filtered: false, skipped: [] };

test("a complete unfiltered run makes the map, sorted, with the specs it ran", () => {
  const plan = planMerge(
    [
      part("e2e/b.spec.ts", "src/x.ts"),
      part("e2e/a.spec.ts", "src/x.ts", "src/y.ts"),
      part("e2e/c.spec.ts"),
    ],
    all,
    run,
  );
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.map, {
    specs: all,
    files: { "src/x.ts": [0, 1], "src/y.ts": [0] },
  });
});

test("a filtered run is refused, even when it ran something in every spec", () => {
  const parts = all.map((s) => part(s, "src/x.ts"));
  const plan = planMerge(parts, all, { filtered: true, skipped: [] });
  assert.equal(plan.ok, false);
  assert.match(plan.reason, /filtered/);
});

test("a spec that recorded nothing is refused, unless it is skipped entirely", () => {
  const parts = [part("e2e/a.spec.ts", "src/x.ts"), part("e2e/b.spec.ts", "src/x.ts")];
  const refused = planMerge(parts, all, run);
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /1 spec\(s\).*c\.spec\.ts/);
  const accepted = planMerge(parts, all, { filtered: false, skipped: ["e2e/c.spec.ts"] });
  assert.equal(accepted.ok, true);
  assert.deepEqual(accepted.map.specs, all);
});

test("a spec file deleted since the run is left out of the map", () => {
  const parts = [...all, "e2e/gone.spec.ts"].map((s) => part(s, "src/x.ts"));
  assert.deepEqual(planMerge(parts, all, run).map.specs, all);
});

test("isFilteredRun sees a grep, a shard, named files and reruns, and not a plain run", () => {
  assert.equal(isFilteredRun({ grep: /.*/ }, []), false);
  assert.equal(isFilteredRun({ grep: /.*/ }, ["--workers=3", "--trace", "off"].slice(0, 2)), false);
  assert.equal(isFilteredRun({ grep: /find/ }, []), true);
  assert.equal(isFilteredRun({ grep: /.*/, grepInvert: /slow/ }, []), true);
  assert.equal(isFilteredRun({ grep: /.*/, shard: { current: 1, total: 4 } }, []), true);
  assert.equal(isFilteredRun({ grep: /.*/ }, ["e2e/find.spec.ts"]), true);
  assert.equal(isFilteredRun({ grep: /.*/ }, ["--last-failed"]), true);
});

test("patchMap replaces the specs a run covered, keeps the others, and adds new ones", () => {
  const existing = {
    specs: ["e2e/a.spec.ts", "e2e/b.spec.ts"],
    files: { "src/x.ts": [0, 1], "src/y.ts": [0] },
  };
  const patched = patchMap(
    existing,
    [part("e2e/a.spec.ts", "src/z.ts"), part("e2e/c.spec.ts", "src/y.ts")],
    all,
  );
  assert.deepEqual(patched, {
    specs: all,
    files: { "src/x.ts": [1], "src/y.ts": [2], "src/z.ts": [0] },
  });
});

test("patchMap drops specs that no longer exist", () => {
  const existing = { specs: ["e2e/a.spec.ts", "e2e/gone.spec.ts"], files: { "src/x.ts": [0, 1] } };
  assert.deepEqual(patchMap(existing, [], all), {
    specs: ["e2e/a.spec.ts"],
    files: { "src/x.ts": [0] },
  });
});
