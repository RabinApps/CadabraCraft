// OpenPencil's .pen reader leaves text sizes bound to a variable as the string "$type-body".
// This resolves them to numbers on the loaded scene graph so text renders and exports.

/** @param {string} ref e.g. "$type-body" */
export function variableName(ref) {
  return ref.startsWith("$") ? ref.slice(1) : ref;
}

/**
 * Replaces every text node's string fontSize with the number its variable resolves to.
 * @param {{ nodes: Map<string, any>, variables: Map<string, any>, resolveNumberVariable: (id: string) => number | undefined }} graph
 * @returns {{ fixed: number, missing: string[] }}
 */
export function resolveFontSizes(graph) {
  const byName = new Map([...graph.variables.values()].map((v) => [v.name, v]));
  const missing = new Set();
  let fixed = 0;
  for (const node of graph.nodes.values()) {
    if (node.type !== "TEXT" || typeof node.fontSize !== "string") continue;
    const variable = byName.get(variableName(node.fontSize));
    const value = variable ? graph.resolveNumberVariable(variable.id) : undefined;
    if (typeof value === "number") {
      node.fontSize = value;
      fixed++;
    } else {
      missing.add(node.fontSize);
    }
  }
  return { fixed, missing: [...missing] };
}

/** The instance id named by OpenPencil's ".fig" writer error "Missing instance geometry address for X under Y". */
export function failingInstanceId(message) {
  return /Missing instance geometry address for \S+ under (\S+)/.exec(message)?.[1];
}

/**
 * Turns an instance into a plain frame (its children are already expanded in the graph), so the
 * ".fig" writer no longer needs an address for children authored inside the instance.
 * @returns {boolean} whether a node was detached
 */
export function detachInstance(graph, id) {
  const node = graph.getNode(id);
  if (!node || node.type !== "INSTANCE") return false;
  node.type = "FRAME";
  node.componentId = undefined;
  return true;
}
