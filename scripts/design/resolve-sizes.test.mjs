import assert from "node:assert/strict";
import { test } from "node:test";
import {
  detachInstance,
  failingInstanceId,
  resolveFontSizes,
  variableName,
} from "./resolve-sizes.mjs";

const graphWith = (nodes, values) => ({
  nodes: new Map(nodes.map((n, i) => [String(i), n])),
  variables: new Map(Object.keys(values).map((name) => [`id-${name}`, { id: `id-${name}`, name }])),
  resolveNumberVariable: (id) => values[id.replace("id-", "")],
});

test("variableName strips the dollar sign", () => {
  assert.equal(variableName("$type-body"), "type-body");
  assert.equal(variableName("type-body"), "type-body");
});

test("resolves string sizes on text nodes and leaves numbers alone", () => {
  const a = { type: "TEXT", fontSize: "$type-body" };
  const b = { type: "TEXT", fontSize: 12 };
  const c = { type: "FRAME", fontSize: "$type-body" };
  const result = resolveFontSizes(graphWith([a, b, c], { "type-body": 14 }));
  assert.deepEqual(result, { fixed: 1, missing: [] });
  assert.equal(a.fontSize, 14);
  assert.equal(b.fontSize, 12);
  assert.equal(c.fontSize, "$type-body");
});

test("reports sizes whose variable is unknown", () => {
  const a = { type: "TEXT", fontSize: "$nope" };
  assert.deepEqual(resolveFontSizes(graphWith([a], {})), { fixed: 0, missing: ["$nope"] });
  assert.equal(a.fontSize, "$nope");
});

test("failingInstanceId reads the instance from the writer's error", () => {
  assert.equal(
    failingInstanceId("Missing instance geometry address for y6VavD under RegMV"),
    "RegMV",
  );
  assert.equal(failingInstanceId("something else"), undefined);
});

test("detachInstance turns only instances into frames", () => {
  const instance = { type: "INSTANCE", componentId: "c1" };
  const frame = { type: "FRAME" };
  const graph = { getNode: (id) => ({ i: instance, f: frame })[id] };
  assert.equal(detachInstance(graph, "i"), true);
  assert.deepEqual(instance, { type: "FRAME", componentId: undefined });
  assert.equal(detachInstance(graph, "f"), false);
  assert.equal(detachInstance(graph, "missing"), false);
});
