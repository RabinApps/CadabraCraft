import assert from "node:assert/strict";
import { test } from "node:test";
import { markInstanceOverrides } from "./overrides.mjs";

const state = () => ({ self: new Map(), descendants: new Map() });

test("records the fields where an instance's copy differs from its component", () => {
  const nodes = {
    comp: { id: "comp", type: "COMPONENT", childIds: ["cl"] },
    cl: { id: "cl", type: "TEXT", text: "Button", childIds: [] },
    inst: {
      id: "inst",
      type: "INSTANCE",
      componentId: "comp",
      instanceOverrides: state(),
      childIds: ["il"],
    },
    il: { id: "il", type: "TEXT", text: "Sponsor", childIds: [] },
  };
  const graph = {
    nodes: new Map(Object.entries(nodes)),
    getNode: (id) => nodes[id],
    getChildren: (id) => nodes[id].childIds.map((c) => nodes[c]),
  };
  assert.deepEqual(markInstanceOverrides(graph), { instances: 1, fields: 1 });
  assert.deepEqual([...nodes.inst.instanceOverrides.descendants.get("il")], [["text", true]]);
  assert.equal(nodes.inst.instanceOverrides.self.size, 0);
});
