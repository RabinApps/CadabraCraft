// A pen frame can carry `theme: { <axis>: "<mode>" }` (the dark frames carry "dark"). OpenPencil's .pen
// reader uses it only while creating nodes and does not keep it, so a dark frame comes out light.
// Collect the themed nodes from the parsed pen JSON, then set the matching variable mode on each node.

/** @returns {Map<string, string>} node id -> mode name, for every node that sets a theme */
export function collectThemes(doc) {
  const themes = new Map();
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (value.id && value.theme && typeof value.theme === "object") {
      const mode = Object.values(value.theme)[0];
      if (typeof mode === "string") themes.set(value.id, mode);
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(doc);
  return themes;
}

/**
 * Sets `variableModes` on every themed node whose mode name exists in a variable collection.
 * @param {{ getNode: (id: string) => any, variableCollections: Map<string, any> }} graph
 * @param {Map<string, string>} themes
 * @returns {{ applied: number, unknown: string[] }}
 */
export function applyThemes(graph, themes) {
  const modeIds = new Map(); // mode name -> [collection id, mode id]
  for (const collection of graph.variableCollections.values()) {
    for (const mode of collection.modes) {
      if (!modeIds.has(mode.name)) modeIds.set(mode.name, []);
      modeIds.get(mode.name).push([collection.id, mode.modeId]);
    }
  }
  let applied = 0;
  const unknown = new Set();
  for (const [id, name] of themes) {
    const node = graph.getNode(id);
    const targets = modeIds.get(name);
    if (!node) continue;
    if (!targets) {
      unknown.add(name);
      continue;
    }
    node.variableModes = { ...node.variableModes, ...Object.fromEntries(targets) };
    applied++;
  }
  return { applied, unknown: [...unknown] };
}

/**
 * Colours are baked into a node's fills when it is created, so after the modes are set every colour
 * bound to a variable is resolved again for its node's mode ("fills[0]", "strokes[1]", text fills too).
 * @param {{ nodes: Map<string, any>, resolveColorVariableForNode: (nodeId: string, variableId: string) => any }} graph
 * @returns {{ rebaked: number }}
 */
export function rebakeBoundColors(graph) {
  let rebaked = 0;
  for (const node of graph.nodes.values()) {
    for (const [key, variableId] of Object.entries(node.boundVariables ?? {})) {
      const match = /^(fills|strokes)\[(\d+)\]$/.exec(key);
      if (!match || typeof variableId !== "string") continue;
      const list = node[match[1]];
      const index = Number(match[2]);
      const color = graph.resolveColorVariableForNode(node.id, variableId);
      if (!color || !list?.[index]) continue;
      if (JSON.stringify(list[index].color) === JSON.stringify(color)) continue;
      node[match[1]] = list.map((paint, i) => (i === index ? { ...paint, color } : paint));
      rebaked++;
    }
  }
  return { rebaked };
}
