// OpenPencil's .pen reader copies a component's children into each instance and bakes the instance's
// own text, fills and so on into those copies, leaving the instance's override record empty. The .fig
// writer only writes what that record names, so every instance would come back with its component's
// defaults ("Button" instead of "Sponsor"). This marks each field that differs from the component.

/** Fields compared between an instance's copy and its component. Sizes are left out: layout owns them. */
export const OVERRIDE_FIELDS = [
  "name",
  "text",
  "fontSize",
  "fontWeight",
  "fontFamily",
  "italic",
  "letterSpacing",
  "lineHeight",
  "textCase",
  "textDecoration",
  "textAlignHorizontal",
  "textAlignVertical",
  "textAutoResize",
  "fills",
  "strokes",
  "effects",
  "opacity",
  "cornerRadius",
  "visible",
  "boundVariables",
  "layoutMode",
  "itemSpacing",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "primaryAxisAlign",
  "counterAxisAlign",
  "layoutGrow",
  "layoutAlignSelf",
  "clipsContent",
];

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function record(owner, nodeId, field) {
  const state = owner.instanceOverrides;
  if (nodeId === owner.id) {
    state.self.set(field, true);
    return;
  }
  const fields = state.descendants.get(nodeId) ?? new Map();
  fields.set(field, true);
  state.descendants.set(nodeId, fields);
}

/** Pairs an instance's copy with its component's nodes by position and records what differs. */
function compare(graph, owner, copy, master, counts) {
  for (const field of OVERRIDE_FIELDS) {
    if (!same(copy[field], master[field])) {
      record(owner, copy.id, field);
      counts.fields++;
    }
  }
  // A nested instance is handled on its own turn, against its own component.
  if (copy.type === "INSTANCE" && copy.id !== owner.id) return;
  const copies = graph.getChildren(copy.id);
  const masters = graph.getChildren(master.id);
  for (let i = 0; i < Math.min(copies.length, masters.length); i++) {
    if (copies[i].type === masters[i].type) compare(graph, owner, copies[i], masters[i], counts);
  }
}

/**
 * Records, on every instance, the fields in which it differs from its component.
 * @returns {{ instances: number, fields: number }}
 */
export function markInstanceOverrides(graph) {
  const counts = { instances: 0, fields: 0 };
  for (const node of graph.nodes.values()) {
    if (node.type !== "INSTANCE" || !node.componentId || !node.instanceOverrides) continue;
    const master = graph.getNode(node.componentId);
    if (!master) continue;
    compare(graph, node, node, master, counts);
    counts.instances++;
  }
  return counts;
}
