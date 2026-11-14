import assert from "node:assert/strict";
import { test } from "node:test";
import { applyThemes, collectThemes, rebakeBoundColors } from "./themes.mjs";

test("collectThemes finds the mode of every themed node", () => {
  const doc = {
    children: [
      {
        id: "a",
        theme: { Theme: "dark" },
        children: [{ id: "b", theme: { Theme: "light" } }, { id: "c" }],
      },
    ],
  };
  assert.deepEqual(
    [...collectThemes(doc)],
    [
      ["a", "dark"],
      ["b", "light"],
    ],
  );
});

const graphWith = (nodes) => ({
  getNode: (id) => nodes[id],
  variableCollections: new Map([
    [
      "c1",
      {
        id: "c1",
        modes: [
          { name: "light", modeId: "m1" },
          { name: "dark", modeId: "m2" },
        ],
      },
    ],
  ]),
});

test("applyThemes sets the variable mode on themed nodes and reports unknown modes", () => {
  const dark = { variableModes: {} };
  const other = { variableModes: {} };
  const result = applyThemes(
    graphWith({ a: dark, b: other }),
    new Map([
      ["a", "dark"],
      ["b", "sepia"],
      ["gone", "dark"],
    ]),
  );
  assert.deepEqual(result, { applied: 1, unknown: ["sepia"] });
  assert.deepEqual(dark.variableModes, { c1: "m2" });
  assert.deepEqual(other.variableModes, {});
});

test("rebakeBoundColors re-resolves fills and strokes bound to a variable", () => {
  const light = { r: 1, g: 1, b: 1, a: 1 };
  const dark = { r: 0, g: 0, b: 0, a: 1 };
  const node = {
    id: "n",
    boundVariables: { "fills[0]": "v1", "strokes[0]": "v2", fontFamily: "v3" },
    fills: [{ type: "SOLID", color: light }],
    strokes: [{ type: "SOLID", color: dark }],
  };
  const graph = {
    nodes: new Map([["n", node]]),
    resolveColorVariableForNode: (_id, variable) => (variable === "v1" ? dark : dark),
  };
  assert.deepEqual(rebakeBoundColors(graph), { rebaked: 1 });
  assert.deepEqual(node.fills[0].color, dark);
  assert.deepEqual(node.strokes[0].color, dark);
});
