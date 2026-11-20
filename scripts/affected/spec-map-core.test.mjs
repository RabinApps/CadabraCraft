import assert from "node:assert/strict";
import test from "node:test";
import { patchMap, planMerge, runNarrowing } from "../../apps/desktop/e2e/support/specMapCore.ts";

const all = ["e2e/a.spec.ts", "e2e/b.spec.ts", "e2e/c.spec.ts"];
let n = 0;
const part = (spec, ...files) => ({ spec, test: `t${n++}`, files });
const run = (over = {}) => ({
  subset: false,
  named: false,
  skipped: [],
  tests: Object.fromEntries(all.map((s) => [s, 1])),
  ...over,
});

test("a complete unfiltered run makes the map, sorted, with the specs it ran", () => {
  const plan = planMerge(
    [
      part("e2e/b.spec.ts", "src/x.ts"),
      part("e2e/a.spec.ts", "src/x.ts", "src/y.ts"),
      part("e2e/c.spec.ts"),
    ],
    all,
    run(),
  );
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.map, { specs: all, files: { "src/x.ts": [0, 1], "src/y.ts": [0] } });
});

test("a filtered run is refused, even when it ran something in every spec", () => {
  const parts = all.map((s) => part(s, "src/x.ts"));
  for (const over of [{ subset: true }, { named: true }]) {
    const plan = planMerge(parts, all, run(over));
    assert.equal(plan.ok, false);
    assert.match(plan.reason, /filtered/);
  }
});

test("a spec that recorded nothing is refused, unless it is skipped entirely", () => {
  const parts = [part("e2e/a.spec.ts", "src/x.ts"), part("e2e/b.spec.ts", "src/x.ts")];
  const refused = planMerge(parts, all, run());
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /1 spec\(s\).*c\.spec\.ts/);
  const skipped = run({
    skipped: ["e2e/c.spec.ts"],
    tests: { "e2e/a.spec.ts": 1, "e2e/b.spec.ts": 1 },
  });
  const accepted = planMerge(parts, all, skipped);
  assert.equal(accepted.ok, true);
  assert.deepEqual(accepted.map.specs, all);
});

test("a spec whose tests did not all record is refused (a crash part way through)", () => {
  const parts = all.map((s) => part(s, "src/x.ts"));
  const plan = planMerge(parts, all, run({ tests: { ...run().tests, "e2e/b.spec.ts": 3 } }));
  assert.equal(plan.ok, false);
  assert.match(plan.reason, /did not all record.*b\.spec\.ts/);
});

test("a spec file deleted since the run is left out of the map", () => {
  const parts = [...all, "e2e/gone.spec.ts"].map((s) => part(s, "src/x.ts"));
  assert.deepEqual(planMerge(parts, all, run()).map.specs, all);
});

test("runNarrowing tells tests taken out of the files from files named", () => {
  const plain = { grep: /.*/ };
  assert.deepEqual(runNarrowing(plain, ["--workers=3"]), { subset: false, named: false });
  assert.deepEqual(runNarrowing({ grep: /find/ }, []), { subset: true, named: false });
  assert.deepEqual(runNarrowing({ ...plain, grepInvert: /slow/ }, []), {
    subset: true,
    named: false,
  });
  assert.deepEqual(runNarrowing({ ...plain, shard: { current: 1, total: 4 } }, []), {
    subset: true,
    named: false,
  });
  assert.deepEqual(runNarrowing(plain, ["--last-failed"]), { subset: true, named: false });
  assert.deepEqual(runNarrowing(plain, ["e2e/find.spec.ts"]), { subset: false, named: true });
  // A line (and column) selector runs one test of a file.
  assert.deepEqual(runNarrowing(plain, ["e2e/find.spec.ts:42"]), { subset: true, named: true });
  assert.equal(runNarrowing(plain, ["e2e/find.spec.ts:42:7"]).subset, true);
  assert.equal(runNarrowing(plain, ["e2e/a.spec.ts", "e2e/find.spec.ts:42"]).subset, true);
  // Test lists filter before the reporter counts tests.
  assert.equal(runNarrowing(plain, ["--test-list=list.txt"]).subset, true);
  assert.equal(runNarrowing(plain, ["--test-list-invert", "list.txt"]).subset, true);
  // An option's value is not a spec file, whether it follows after a space or an equals sign.
  assert.deepEqual(runNarrowing(plain, ["--workers", "1"]), { subset: false, named: false });
  assert.deepEqual(runNarrowing(plain, ["-j", "2", "--reporter=list", "--trace", "off"]), {
    subset: false,
    named: false,
  });
  assert.deepEqual(runNarrowing(plain, ["--workers", "1", "e2e/find.spec.ts"]), {
    subset: false,
    named: true,
  });
});

const existing = {
  specs: ["e2e/a.spec.ts", "e2e/b.spec.ts"],
  files: { "src/x.ts": [0, 1], "src/y.ts": [0] },
};

test("patchMap replaces the specs a run covered, keeps the others, and adds new ones", () => {
  const patched = patchMap(
    existing,
    [part("e2e/a.spec.ts", "src/z.ts"), part("e2e/c.spec.ts", "src/y.ts")],
    all,
    run({ named: true, tests: { "e2e/a.spec.ts": 1, "e2e/c.spec.ts": 1 } }),
  );
  assert.equal(patched.ok, true);
  assert.deepEqual(patched.map, {
    specs: all,
    files: { "src/x.ts": [1], "src/y.ts": [2], "src/z.ts": [0] },
  });
});

test("patchMap refuses a run that took only some tests of a spec, or lost some", () => {
  const parts = [part("e2e/a.spec.ts", "src/z.ts")];
  const grep = patchMap(existing, parts, all, run({ subset: true, tests: { "e2e/a.spec.ts": 1 } }));
  assert.equal(grep.ok, false);
  assert.match(grep.reason, /only some of the tests/);
  const lost = patchMap(existing, parts, all, run({ named: true, tests: { "e2e/a.spec.ts": 2 } }));
  assert.equal(lost.ok, false);
  assert.match(lost.reason, /did not all record/);
});

test("patchMap drops specs that no longer exist", () => {
  const old = { specs: ["e2e/a.spec.ts", "e2e/gone.spec.ts"], files: { "src/x.ts": [0, 1] } };
  const patched = patchMap(old, [], all, run({ tests: {} }));
  assert.deepEqual(patched.map, { specs: ["e2e/a.spec.ts"], files: { "src/x.ts": [0] } });
});
