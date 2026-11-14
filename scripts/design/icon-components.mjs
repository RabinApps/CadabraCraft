// The pen draws icons as plain nodes and lets an instance pick another icon or colour. Figma-style files
// model that as components: one component per lucide icon, each icon frame an instance of it, and an
// instance that shows another icon swaps the component (an "instance swap" override).
import { parsePenFile } from "@open-pencil/core/io";
import { iconToFrame } from "./icons.mjs";

const SIZE = 16;
const STYLE = [
  "strokes",
  "strokeWeight",
  "strokeAlign",
  "strokeCap",
  "strokeJoin",
  "boundVariables",
];

/** The path node's vector network for one icon at the default size, from a one-icon pen document. */
function networkOf(shapes, version) {
  const frame = iconToFrame({ id: "i", icon: "i", width: SIZE, height: SIZE }, shapes);
  const graph = parsePenFile(JSON.stringify({ version, children: [frame] }));
  const root = graph.getNode(graph.getPages()[0].childIds[0]);
  return graph.getNode(root.childIds[0])?.vectorNetwork;
}

/**
 * Makes each icon frame an instance of a per-icon component.
 * @param {any} graph prepared scene graph (instances' children already expanded)
 * @param {Map<string, string>} iconIds icon node id -> icon name (the masters)
 * @param {Array<{ instanceId: string, key: string, icon?: string }>} overrides icon choices made by instances
 * @param {Map<string, any[]>} shapes lucide shapes by icon name
 * @param {string} version the pen document's version
 * @returns {{ components: number, instances: number, swaps: number }}
 */
export function makeIconComponents(graph, iconIds, overrides, shapes, version) {
  const page = graph.getPages()[0];
  const holder = graph.createNode("FRAME", page.id, {
    name: "Icons",
    x: 0,
    y: -400,
    width: 1200,
    height: 200,
  });
  const components = new Map(); // icon name -> component node
  const componentFor = (name, template) => {
    if (components.has(name)) return components.get(name);
    const component = graph.createNode("COMPONENT", holder.id, {
      name: `Icon / ${name}`,
      x: components.size * 40,
      y: 0,
      width: SIZE,
      height: SIZE,
    });
    const path = graph.createNode("VECTOR", component.id, {
      name,
      x: 0,
      y: 0,
      width: SIZE,
      height: SIZE,
    });
    for (const field of STYLE)
      if (template[field] !== undefined) path[field] = structuredClone(template[field]);
    path.vectorNetwork = networkOf(shapes.get(name), version);
    components.set(name, component);
    return component;
  };

  let instances = 0;
  let swaps = 0;
  const toInstance = (frame, name) => {
    const path = graph.getChildren(frame.id)[0];
    if (!path || path.type !== "VECTOR" || !shapes.has(name)) return undefined;
    const component = componentFor(name, path);
    frame.type = "INSTANCE";
    frame.componentId = component.id;
    // the copy of the component's path inside this instance points back at it, as expanded instances do
    path.componentId = graph.getChildren(component.id)[0].id;
    frame.fills = [];
    if (frame.boundVariables) delete frame.boundVariables["fills[0]"];
    instances++;
    return { frame, path, component };
  };

  // masters (the icons drawn directly in components and screens)
  const made = new Map();
  for (const [id, name] of iconIds) {
    const frame = graph.getNode(id);
    if (frame) made.set(id, toInstance(frame, name));
  }
  // copies inside instances: the same icon, or the one the instance chose
  const chosen = new Map(
    overrides.filter((o) => o.icon).map((o) => [`${o.instanceId}/${o.key}`, o.icon]),
  );
  for (const node of [...graph.nodes.values()]) {
    if (node.type !== "FRAME" || !iconIds.has(node.componentId)) continue;
    const owners = instanceAncestors(graph, node); // nearest first
    const originalId = node.componentId; // the icon node in the component this copy came from
    const chosenBy = owners.find((o) => chosen.has(`${o.id}/${originalId}`));
    const name = chosenBy ? chosen.get(`${chosenBy.id}/${originalId}`) : iconIds.get(originalId);
    const result = toInstance(node, name);
    if (!result || owners.length === 0) continue;
    // `componentId` now names the icon component, so the link to the original node is kept as an override
    // on the nearest instance, which is the scope the writer resolves that node against.
    const owner = owners[0];
    const fields = owner.instanceOverrides.descendants.get(node.id) ?? new Map();
    fields.set("sourceComponentId", originalId);
    if (name !== iconIds.get(originalId)) {
      fields.set("componentId", true);
      result.path.vectorNetwork = networkOf(shapes.get(name), version);
      swaps++;
    }
    owner.instanceOverrides.descendants.set(node.id, fields);
  }
  // a copy keeps its own colour: an override fill on the frame has already been cleared above
  return { components: components.size, instances, swaps };
}

/** The instances a node sits inside, nearest first. */
function instanceAncestors(graph, node) {
  const found = [];
  for (let id = node.parentId; id; id = graph.getNode(id)?.parentId) {
    const ancestor = graph.getNode(id);
    if (ancestor?.type === "INSTANCE") found.push(ancestor);
  }
  return found;
}
